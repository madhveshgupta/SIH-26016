/** The field app's sync, and the citizen's own screens. */
import { prisma } from "@backend/db/client";
import { assignedParcels, receiveSurvey, type SurveyInput } from "@backend/field/surveys";
import type { Actor } from "@backend/rbac/scope";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? `  ${d}` : ""}`);
  if (ok) pass++;
  else fail++;
};
const refused = (p: Promise<unknown>) => p.then(() => "", (e: Error) => e.message);

async function actorFor(email: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true, ownerProfile: true } });
  return {
    id: u.id, role: u.role.type, jurisdictionLevel: u.jurisdictionLevel,
    stateId: u.stateId, districtId: u.districtId, tehsilId: u.tehsilId, agencyId: u.agencyId,
    ownerId: u.ownerProfile?.id ?? null,
  };
}

/** A square of roughly the given size, centred on a point — a walked boundary. */
function squareAround(lat: number, lng: number, metres: number): [number, number][] {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [Number((lng - dLng).toFixed(7)), Number((lat - dLat).toFixed(7))],
    [Number((lng + dLng).toFixed(7)), Number((lat - dLat).toFixed(7))],
    [Number((lng + dLng).toFixed(7)), Number((lat + dLat).toFixed(7))],
    [Number((lng - dLng).toFixed(7)), Number((lat + dLat).toFixed(7))],
  ];
}

async function main() {
  console.log("\nFIELD APP SMOKE TEST\n======================================================");
  const surveysBefore = await prisma.fieldSurvey.count();

  const cala = await actorFor("cala.agra@bhoominayan.gov.in");
  const otherDistrict = await actorFor("cala.north-goa@bhoominayan.gov.in");

  console.log("\nThe work list a phone caches:");
  const work = await assignedParcels(cala);
  check("a surveyor gets plots to visit", work.length > 0, `${work.length} plots`);
  check("flagged plots come first", work.length < 2 || !work.slice(1).some((p, i) => p.hasConflict && !work[i].hasConflict));
  check("it carries what the phone needs offline", work.every((p) => p.khasraNo && p.village.name && p.district.name));
  const target = work.find((p) => p.centroidLat && p.centroidLng) ?? work[0];
  check("a plot has a location to navigate to", Boolean(target.centroidLat), `khasra ${target.khasraNo}`);

  console.log("\nA survey recorded offline, synced later:");
  const capturedAt = new Date(Date.now() - 5 * 3_600_000); // walked five hours ago
  const boundary = squareAround(Number(target.centroidLat ?? 27.1), Number(target.centroidLng ?? 78.0), 40);
  const survey: SurveyInput = {
    clientId: "smoke-device-001",
    parcelId: target.id,
    kind: "JOINT_MEASUREMENT",
    capturedAt: capturedAt.toISOString(),
    boundary,
    accuracyM: 4.2,
    findings: { structures: "one cattle shed", trees: "11 mango", standingCrop: "wheat" },
    notes: "Walked with the owner present. The south edge follows the canal bund.",
    photos: [{ dataUrl: "data:image/jpeg;base64,/9j/4AAQ", lat: 27.1, lng: 78.0, takenAt: capturedAt.toISOString() }],
    signedBy: "Ram Prakash Yadav",
  };

  const stored = await receiveSurvey(survey, cala);
  check("the survey is accepted", Boolean(stored.id));
  check("the walked area is measured", (stored.walkedAreaHectares ?? 0) > 0, `${stored.walkedAreaHectares?.toFixed(4)} ha`);
  check("it is compared against the record", stored.differenceFromRecordPct !== null, `${stored.differenceFromRecordPct}% against the record`);

  const row = await prisma.fieldSurvey.findUniqueOrThrow({ where: { clientId: survey.clientId } });
  check("the device's capture time is kept", Math.abs(row.capturedAt.getTime() - capturedAt.getTime()) < 1000);
  check("the sync time is recorded separately", row.syncedAt.getTime() > row.capturedAt.getTime(),
    `${Math.round((row.syncedAt.getTime() - row.capturedAt.getTime()) / 3_600_000)} hours offline`);
  check("the findings are stored", JSON.stringify(row.findings).includes("mango"));
  check("the signature name is stored", row.signedBy === "Ram Prakash Yadav");
  check("it is written to the audit chain",
    (await prisma.auditLog.count({ where: { entityType: "FieldSurvey", entityId: row.id } })) === 1);

  console.log("\nA phone that retries does not duplicate:");
  const again = await receiveSurvey({ ...survey, notes: "Corrected: the south edge follows the field boundary, not the bund." }, cala);
  check("the same device id updates the same row", again.id === stored.id);
  check("there is still only one survey", (await prisma.fieldSurvey.count({ where: { clientId: survey.clientId } })) === 1);
  const updated = await prisma.fieldSurvey.findUniqueOrThrow({ where: { clientId: survey.clientId } });
  check("the correction is kept", updated.notes?.includes("field boundary") ?? false);

  console.log("\nWhat the server refuses:");
  check("a survey with no device reference",
    (await refused(receiveSurvey({ ...survey, clientId: "" }, cala))).includes("device reference"));
  check("a plot in another district",
    (await refused(receiveSurvey({ ...survey, clientId: "smoke-device-002" }, otherDistrict))).includes("not in your jurisdiction"));
  check("boundary points outside India",
    (await refused(receiveSurvey({ ...survey, clientId: "smoke-device-003", boundary: [[0, 0], [1, 1], [2, 2]] }, cala))).includes("outside India"));
  check("a phone clock set to next year",
    (await refused(receiveSurvey({ ...survey, clientId: "smoke-device-004", capturedAt: new Date(Date.now() + 400 * 86_400_000).toISOString() }, cala))).includes("device clock"));
  check("an unreadable capture time",
    (await refused(receiveSurvey({ ...survey, clientId: "smoke-device-005", capturedAt: "whenever" }, cala))).includes("capture time"));

  console.log("\nThe officer sees it:");
  const visible = await prisma.fieldSurvey.findMany({
    where: { parcelId: target.id },
    select: { id: true, parcel: { select: { khasraNo: true } }, surveyor: { select: { fullName: true } } },
  });
  check("the survey appears against the plot", visible.some((v) => v.id === stored.id));
  check("it names the surveyor", Boolean(visible.find((v) => v.id === stored.id)?.surveyor.fullName));

  // --- put the database back -----------------------------------------------
  await prisma.fieldSurvey.deleteMany({ where: { clientId: { startsWith: "smoke-device-" } } });
  check("the database is as it was", (await prisma.fieldSurvey.count()) === surveysBefore);

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
