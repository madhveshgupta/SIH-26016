/** Phases 5 & 7: document repository, statutory notifications and objections. */
import { PrismaClient } from "@prisma/client";
import { scopeForOptionalParcel, scopeForProposal } from "../backend/rbac/scope";
import { uploadDocument, readDocument, accessHistory } from "../backend/documents/service";
import { encrypt, decrypt, checksum } from "../backend/storage";
import { generateNotificationPdf, generateAwardPdf } from "../backend/documents/generate";
import {
  publicationStatus, issueNotification, fileObjection, disposeObjection, scheduleHearing,
  objectionWindow, mayHearObjections, PUBLICATION_CHANNELS,
} from "../backend/statutory/notifications";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? "  " + d : ""}`);
  if (ok) pass++;
  else fail++;
};

async function main() {
  console.log("\nDOCUMENTS / NOTIFICATIONS SMOKE TEST\n======================================================");

  console.log("\nEncryption at rest:");
  const plain = Buffer.from("Khasra 347/4 — award ₹2,17,75,776.44 — Ramesh Chand Patil");
  const blob = encrypt(plain);
  check("ciphertext differs from plaintext", !blob.equals(plain));
  check("round-trips exactly", decrypt(blob).equals(plain));
  check("tampered ciphertext is REJECTED, not silently decoded",
    (() => { const t = Buffer.from(blob); t[t.length - 1] ^= 0xff;
             try { decrypt(t); return false; } catch { return true; } })(),
    "(AES-GCM authenticates as well as encrypts)");
  check("checksum is stable", checksum(plain) === checksum(Buffer.from(plain)));

  const collector = await prisma.user.findUnique({ where: { email: "collector.agra@bhoominayan.gov.in" } });
  if (!collector) throw new Error("Run db:seed:users first.");

  console.log("\nVersioning:");
  const v1 = await uploadDocument({
    title: "Smoke test survey report", category: "OTHER",
    uploadedById: collector.id, fileName: "survey.pdf", mimeType: "application/pdf",
    data: Buffer.from("%PDF-1.4 original content"),
  });
  check("first upload creates v1", v1.version === 1);
  const v2 = await uploadDocument({
    documentId: v1.documentId, title: "Smoke test survey report", category: "OTHER",
    uploadedById: collector.id, fileName: "survey.pdf", mimeType: "application/pdf",
    data: Buffer.from("%PDF-1.4 CORRECTED content"),
  });
  check("re-upload creates v2", v2.version === 2);
  const readV1 = await readDocument(v1.documentId, 1, collector.id);
  const readV2 = await readDocument(v1.documentId, 2, collector.id);
  check("v1 is still retrievable and unchanged",
    readV1.data.toString().includes("original"),
    "(in a paper system the correction silently replaces the original)");
  check("v2 has the corrected content", readV2.data.toString().includes("CORRECTED"));
  check("latest is served when no version is asked for",
    (await readDocument(v1.documentId, null, collector.id)).version === 2);

  console.log("\nAccess history:");
  const hist = await accessHistory(v1.documentId);
  check("every read is logged", hist.length >= 3, `${hist.length} entries`);
  check("the log names the actor", hist[0]?.actor === collector.fullName, hist[0]?.actor ?? "");

  console.log("\nUpload guards:");
  const rejects = async (fn: () => Promise<unknown>) => {
    try { await fn(); return false; } catch { return true; }
  };
  check("empty files rejected", await rejects(() => uploadDocument({
    title: "x", category: "OTHER", uploadedById: collector.id,
    fileName: "e.pdf", mimeType: "application/pdf", data: Buffer.alloc(0) })));
  check("disallowed types rejected", await rejects(() => uploadDocument({
    title: "x", category: "OTHER", uploadedById: collector.id,
    fileName: "x.exe", mimeType: "application/x-msdownload", data: Buffer.from("MZ") })),
    "(an upload endpoint is an obvious malware vector)");

  console.log("\nGenerated statutory documents:");
  const proposal = await prisma.proposal.findFirst({
    where: { status: { in: ["OBJECTIONS", "SEC_19_DECLARATION", "AWARD_DECLARED"] } },
  });
  if (proposal) {
    const gen = await generateNotificationPdf(proposal.id, "PRELIMINARY");
    check("notification PDF is generated", gen.pdf.byteLength > 1000, `${gen.pdf.byteLength} bytes`);
    check("it is a real PDF", gen.pdf.subarray(0, 4).toString() === "%PDF");
    check("it carries a verification code", gen.code.length === 10, gen.code);
    check("the section number matches the governing Act",
      gen.text.includes("SECTION 3A") || gen.text.includes("SECTION 11"),
      gen.text.split("\n")[0]);
    check("the notification names the public purpose",
      gen.text.includes("public purpose"));
  }
  const award = await prisma.award.findFirst();
  if (award) {
    const g = await generateAwardPdf(award.id);
    check("award statement PDF is generated", g.pdf.subarray(0, 4).toString() === "%PDF",
      `${g.pdf.byteLength} bytes`);
    check("it shows the s.30 solatium line", g.text.includes("Solatium (100%) s.30"));
    check("money renders without a broken glyph",
      g.text.includes("Rs. ") && !g.text.includes("\u00b9"),
      "(PDFKit's built-in font has no Rupee sign)");
  }

  console.log("\nPublication channels (the evidence that protects the project):");
  const complete = publicationStatus(Object.fromEntries(
    PUBLICATION_CHANNELS.map((c) => [c.key, true])));
  check("a fully published notification reports complete", complete.complete);
  const partial = publicationStatus({ publishedGazette: true, publishedWebsite: true });
  check("a partial one names what is missing", partial.missing.length === 4,
    partial.missing.join(", "));

  const seeded = await prisma.notification.findMany();
  const incomplete = seeded.filter((n) => !publicationStatus(n as never).complete);
  check("the seed contains a deliberately incomplete publication",
    incomplete.length >= 1,
    "(a real ground for an acquisition to be quashed)");

  console.log("\nObjections:");
  const target = await prisma.proposal.findFirst();
  // A case taking objections today, with a notified plot and its owner.
  let open: { id: string; act: "LARR_2013" | "NH_ACT_1956" | "RAILWAYS_ACT_1989" | "STATE_ACT" } | null = null;
  for (const p of await prisma.proposal.findMany({ where: { status: "OBJECTIONS" }, include: { project: true } })) {
    if ((await objectionWindow(p.id)).open) { open = { id: p.id, act: p.project.governingAct }; break; }
  }
  const closed = await prisma.proposal.findFirst({ where: { status: { in: ["SEC_19_DECLARATION", "AWARD_DECLARED"] } } });
  const plots = open
    ? await prisma.landParcel.findMany({
        where: { proposalId: open.id, status: "NOTIFIED", objections: { none: {} } },
        include: { owners: true }, take: 2,
      })
    : [];
  check("a case with an open objection period and notified plots exists", Boolean(open) && plots.length === 2);
  if (open && plots.length === 2) {
    const [a, b] = plots;
    const authorityRole = mayHearObjections(open.act, "DISTRICT_COLLECTOR") ? "DISTRICT_COLLECTOR" : "LAND_ACQUIRING_AUTHORITY";
    const wrongRole = authorityRole === "DISTRICT_COLLECTOR" ? "LAND_ACQUIRING_AUTHORITY" : "DISTRICT_COLLECTOR";
    const grounds = "The valuation omits the tube well and the standing crop on the plot.";
    const reasons = "Section 29 requires assets attached to the land to be valued; the tube well was omitted from the joint measurement report and must be included.";

    if (closed) {
      check("filing outside the objection period is refused", await rejects(() => fileObjection({
        proposalId: closed.id, objectorName: "Late Objector", grounds })));
    }
    const foreign = await prisma.landParcel.findFirst({ where: { proposalId: { not: open.id } } });
    const foreignErr = await fileObjection({ proposalId: open.id, parcelId: foreign!.id, objectorName: "X", grounds })
      .then(() => "", (e: Error) => e.message);
    check("a plot from a different case is refused", foreignErr.includes("not part of this acquisition case"), foreignErr);
    check("a citizen cannot object about a plot not in their name", await rejects(() => fileObjection({
      proposalId: open!.id, parcelId: a.id, objectorName: "X", grounds, objectorOwnerId: "not-an-owner" })));
    check("short grounds are rejected", await rejects(() => fileObjection({
      proposalId: open!.id, objectorName: "X", grounds: "no" })));

    const oa = await fileObjection({ proposalId: open.id, parcelId: a.id, objectorName: "Smoke Objector A", grounds, objectorOwnerId: a.owners[0]?.ownerId });
    const ob = await fileObjection({ proposalId: open.id, parcelId: b.id, objectorName: "Smoke Objector B", grounds });
    check("an owner can object about their own plot", Boolean(oa.id));
    check("filing moves the plot to under objection",
      (await prisma.landParcel.findUniqueOrThrow({ where: { id: a.id } })).status === "OBJECTED");

    check("an authority the Act does not name cannot decide", await rejects(() => scheduleHearing({
      objectionId: oa.id, hearingDate: new Date(Date.now() + 86_400_000), actorId: collector.id, actorRole: wrongRole })),
      `(${open.act}: ${authorityRole})`);
    check("deciding before a hearing is refused", await rejects(() => disposeObjection({
      objectionId: oa.id, status: "REJECTED", actorId: collector.id, actorRole: authorityRole, decision: "Rejected", decisionReasons: reasons })));
    check("a hearing cannot be listed in the past", await rejects(() => scheduleHearing({
      objectionId: oa.id, hearingDate: new Date(Date.now() - 3 * 86_400_000), actorId: collector.id, actorRole: authorityRole })));
    const listed = await scheduleHearing({ objectionId: oa.id, hearingDate: new Date(Date.now() + 2 * 86_400_000), actorId: collector.id, actorRole: authorityRole });
    check("a hearing can be listed", listed.status === "HEARING_SCHEDULED");
    check("a decision before the hearing date is refused", await rejects(() => disposeObjection({
      objectionId: oa.id, status: "REJECTED", actorId: collector.id, actorRole: authorityRole, decision: "Rejected", decisionReasons: reasons })));

    // Both objectors heard.
    await prisma.objection.updateMany({ where: { id: { in: [oa.id, ob.id] } }, data: { status: "HEARD", hearingDate: new Date(Date.now() - 60_000) } });
    check("disposal WITHOUT written reasons is refused", await rejects(() => disposeObjection({
      objectionId: oa.id, status: "REJECTED", actorId: collector.id, actorRole: authorityRole,
      decision: "Rejected", decisionReasons: "no" })),
      "(this is the most common ground on which acquisitions are quashed)");
    const rejected = await disposeObjection({
      objectionId: oa.id, status: "PARTIALLY_ACCEPTED", actorId: collector.id, actorRole: authorityRole,
      decision: "Valuation to be revised.", decisionReasons: reasons });
    check("disposal with reasons succeeds", rejected.status === "PARTIALLY_ACCEPTED");
    check("the plot returns to notified once nothing is pending",
      (await prisma.landParcel.findUniqueOrThrow({ where: { id: a.id } })).status === "NOTIFIED");
    check("a decided objection cannot be decided again", await rejects(() => disposeObjection({
      objectionId: oa.id, status: "ACCEPTED", actorId: collector.id, actorRole: authorityRole, decision: "x", decisionReasons: reasons })));
    await disposeObjection({
      objectionId: ob.id, status: "ACCEPTED", actorId: collector.id, actorRole: authorityRole,
      decision: "Plot left out of the acquisition.", decisionReasons: reasons });
    check("an accepted objection takes the plot out of the acquisition",
      (await prisma.landParcel.findUniqueOrThrow({ where: { id: b.id } })).status === "WITHDRAWN");

    await prisma.objection.deleteMany({ where: { id: { in: [oa.id, ob.id] } } });
    await prisma.landParcel.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: "NOTIFIED" } });
  }
  // Scope must not hide rows from an officer entitled to see them: an
  // unrestricted actor's parcel scope is {}, and the obvious Prisma spelling
  // of "parcel is mine, or there is no parcel" matches nothing at all.
  const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@bhoominayan.gov.in" }, include: { role: true } });
  const national = {
    id: admin.id, role: admin.role.type, jurisdictionLevel: admin.jurisdictionLevel,
    stateId: admin.stateId, districtId: admin.districtId, tehsilId: admin.tehsilId, agencyId: admin.agencyId,
  };
  const visibleToNational = await prisma.objection.count({
    where: { AND: [{ proposal: scopeForProposal(national) }, scopeForOptionalParcel(national)] },
  });
  check("a national officer sees every objection", visibleToNational === (await prisma.objection.count()),
    `${visibleToNational} of ${await prisma.objection.count()}`);
  const districtOfficer = await prisma.user.findFirstOrThrow({ where: { email: "collector.agra@bhoominayan.gov.in" }, include: { role: true } });
  const localScope = {
    id: districtOfficer.id, role: districtOfficer.role.type, jurisdictionLevel: districtOfficer.jurisdictionLevel,
    stateId: districtOfficer.stateId, districtId: districtOfficer.districtId, tehsilId: districtOfficer.tehsilId, agencyId: districtOfficer.agencyId,
  };
  const visibleToDistrict = await prisma.objection.count({
    where: { AND: [{ proposal: scopeForProposal(localScope) }, scopeForOptionalParcel(localScope)] },
  });
  check("a district officer sees no more than that", visibleToDistrict <= visibleToNational, `${visibleToDistrict}`);

  const citizenFiled = await prisma.objection.count({ where: { filedByUserId: { not: null } } });
  check("citizens can file objections online", citizenFiled >= 1,
    `${citizenFiled} filed through the portal`);

  console.log("\nNotification starts the statutory clock:");
  const n = await issueNotification({
    proposalId: target!.id, type: "SEC_19_DECLARATION", actorId: collector.id,
  });
  check("a s.19 declaration starts the 12-month award clock", n.startsDeadlineAt !== null,
    n.startsDeadlineAt?.toISOString().slice(0, 10));
  const days = n.startsDeadlineAt
    ? Math.round((n.startsDeadlineAt.getTime() - n.issuedOn.getTime()) / 86_400_000) : 0;
  check("the clock is 365 days", days === 365, `${days} days — s.25 lapse deadline`);

  // Clean up the rows this test created.
  await prisma.notification.delete({ where: { id: n.id } });
  await prisma.documentVersion.deleteMany({ where: { documentId: v1.documentId } });
  await prisma.document.delete({ where: { id: v1.documentId } });

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error("\n\x1b[31mError:\x1b[0m", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
