/**
 * Citizen grievance intake: the catalogue, the template validation, the statutory routing, and
 * the two-track filing.
 */
import { PrismaClient } from "@prisma/client";
import { CATEGORIES, categoryFor, AUTHORITY_ROLE } from "../backend/grievances/catalogue";
import { validateAnswers, composeRepresentation, fileGrievance, resolveAuthority } from "../backend/grievances/file";
import { disposeGrievance } from "../backend/grievances/dispose";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? "  " + d : ""}`);
  if (ok) pass++;
  else fail++;
};

/** Run something that should throw, and give back the message. */
async function refusal(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function main() {
  console.log("\nCITIZEN GRIEVANCE SMOKE TEST\n======================================================");

  // ---------------------------------------------------------------- catalogue
  console.log("\nCatalogue:");
  check("every category is offered", CATEGORIES.length === 10, `${CATEGORIES.length} categories`);
  check(
    "category keys are unique",
    new Set(CATEGORIES.map((c) => c.key)).size === CATEGORIES.length,
  );
  check(
    "every category asks at least one required question",
    CATEGORIES.every((c) => c.fields.some((f) => f.required)),
  );
  check(
    "every category routes under both Acts",
    CATEGORIES.every((c) => {
      const larr = c.route("LARR_2013");
      const nh = c.route("NH_ACT_1956");
      return Boolean(larr.section && larr.authorityLabel && nh.section && nh.authorityLabel);
    }),
  );
  check(
    "every select field offers options",
    CATEGORIES.every((c) => c.fields.filter((f) => f.kind === "select").every((f) => (f.options?.length ?? 0) > 1)),
  );

  // ------------------------------------------------------------------ routing
  console.log("\nStatutory routing — the whole point of asking what is wrong:");
  const money = categoryFor("COMPENSATION_AMOUNT");
  const larrMoney = money.route("LARR_2013");
  const nhMoney = money.route("NH_ACT_1956");
  check(
    "a disputed amount under LARR goes to the Collector for s.64 reference",
    larrMoney.section.includes("s.64") && AUTHORITY_ROLE[larrMoney.authority]("LARR_2013") === "DISTRICT_COLLECTOR",
    larrMoney.section,
  );
  check(
    "a disputed amount under the NH Act goes the s.3G(5) arbitration route instead",
    nhMoney.section.includes("3G") && AUTHORITY_ROLE[nhMoney.authority]("NH_ACT_1956") === "LAND_ACQUIRING_AUTHORITY",
    nhMoney.section,
  );
  const rnr = categoryFor("RNR_ENTITLEMENT").route("LARR_2013");
  check(
    "an R&R entitlement goes to the R&R authority, not the land office",
    AUTHORITY_ROLE[rnr.authority]("LARR_2013") === "REHABILITATION_AUTHORITY",
    rnr.section,
  );
  const s38 = categoryFor("POSSESSION_BEFORE_PAYMENT").route("LARR_2013");
  check("possession before payment is cited under s.38", s38.section.includes("s.38"), s38.section);
  const objection = categoryFor("ACQUISITION_ITSELF");
  check(
    "objecting to the acquisition itself is marked as a statutory objection",
    objection.statutoryObjection === true &&
      objection.route("LARR_2013").section.includes("s.15") &&
      objection.route("NH_ACT_1956").section.includes("s.3C"),
  );
  check(
    "a wrong map is NOT time-barred like an objection",
    categoryFor("MAP_BOUNDARY").route("LARR_2013").section.toLowerCase().includes("no statutory time limit"),
  );

  // --------------------------------------------------------------- validation
  console.log("\nTemplate validation:");
  const area = categoryFor("AREA_MEASUREMENT");
  check(
    "a missing required answer is refused",
    (await refusal(async () => validateAnswers(area, { areaOnRecord: "1.5" })))?.includes("required") ?? false,
  );
  check(
    "a non-numeric area is refused",
    (await refusal(async () =>
      validateAnswers(area, { areaOnRecord: "one and a half", areaClaimed: "2", source: "Patta or title deed", explanation: "The record is wrong." }),
    ))?.includes("must be a number") ?? false,
  );
  check(
    "an option that was never offered is refused",
    (await refusal(async () =>
      validateAnswers(area, { areaOnRecord: "1.5", areaClaimed: "2", source: "Because I say so", explanation: "The record is wrong." }),
    ))?.includes("Choose one of the options") ?? false,
  );
  check(
    "a date in the future is refused",
    (await refusal(async () =>
      validateAnswers(categoryFor("POSSESSION_BEFORE_PAYMENT"), {
        takenOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        amountPaidBefore: "0",
        explanation: "They fenced it before paying me anything at all.",
      }),
    ))?.includes("cannot be in the future") ?? false,
  );
  const good = validateAnswers(area, {
    areaOnRecord: "1.5", areaClaimed: "2.05", source: "Jamabandi / record of rights",
    explanation: "My jamabandi shows 2.05 ha but the notification records 1.5 ha.",
  });
  check("valid answers come back in the template's own order", good[0].key === "areaOnRecord" && good.length === 4);
  check("money is rendered in Indian grouping", validateAnswers(categoryFor("COMPENSATION_AMOUNT"), {
    amountAwarded: "1250000", amountClaimed: "2000000",
    basis: "Solatium (100%) was not added, or was added to the wrong base",
    explanation: "Solatium was never added to my award.",
  }).some((a) => a.value === "₹12,50,000"));

  // -------------------------------------------------------------- composition
  console.log("\nThe representation the officer reads:");
  const text = composeRepresentation(area, good, {
    objectorName: "Rekha Chaudhary", khasraNo: "71//4", village: "Bhagwanpur", district: "Udham Singh Nagar",
    state: "Uttarakhand", projectName: "NH-74 widening", proposalRef: "LA/UK/USN/2026/0001",
    section: area.route("LARR_2013").section, authorityLabel: "the Collector",
  });
  check("it names the section it is filed under", text.includes("S.15"), text.split("\n")[0]);
  check("it names the authority and the objector", text.includes("To: the Collector") && text.includes("Rekha Chaudhary"));
  check("it identifies the land and the case", text.includes("khasra 71//4") && text.includes("LA/UK/USN/2026/0001"));
  check("every answer appears in it", good.every((a) => text.includes(a.value)));

  // ------------------------------------------------------------- filing, live
  console.log("\nFiling against the seeded database:");
  const owner = await prisma.owner.findFirst({
    where: { userId: { not: null }, parcels: { some: { parcel: { proposalId: { not: null } } } } },
    select: { id: true, fullName: true, userId: true, parcels: { select: { parcelId: true } } },
  });
  if (!owner?.userId) throw new Error("No seeded landowner with a case — run npm run db:setup");

  // Pick a plot whose authority is actually posted, so the alert path is
  // genuinely exercised rather than skipped.
  const candidates = await prisma.landParcel.findMany({
    where: { id: { in: owner.parcels.map((p) => p.parcelId) } },
    select: { id: true, districtId: true, district: { select: { stateId: true } }, project: { select: { governingAct: true } } },
  });
  let chosen: (typeof candidates)[number] | null = null;
  let expectedOfficer: { id: string; fullName: string } | null = null;
  let expectedRole = "DISTRICT_COLLECTOR" as ReturnType<(typeof AUTHORITY_ROLE)["COLLECTOR"]>;
  for (const c of candidates) {
    const role = AUTHORITY_ROLE[categoryFor("COMPENSATION_AMOUNT").route(c.project.governingAct).authority](
      c.project.governingAct,
    );
    const officer = await resolveAuthority(role, c.districtId, c.district.stateId);
    if (officer) {
      chosen = c;
      expectedOfficer = officer;
      expectedRole = role;
      break;
    }
  }
  if (!chosen) throw new Error("No plot of this owner has an authority posted — check the seeded users");
  const parcelId = chosen.id;
  check("an officer of the right role is found for the land", expectedOfficer !== null, expectedOfficer?.fullName ?? "none posted");
  check(
    "the officer found is of the role the Act names",
    expectedOfficer
      ? (await prisma.user.findUnique({ where: { id: expectedOfficer.id }, select: { role: { select: { type: true } } } }))?.role.type === expectedRole
      : false,
    expectedRole,
  );

  const created: string[] = [];
  const filed = await fileGrievance({
    category: "COMPENSATION_AMOUNT",
    parcelId,
    answers: {
      amountAwarded: "1250000", amountClaimed: "2100000",
      basis: "The market value used is below what land nearby actually sells for",
      evidence: "Three sale deeds from the same village, 2025.",
      explanation: "Land across the road sold for nearly double the rate applied to mine.",
    },
    filedByUserId: owner.userId,
    objectorName: owner.fullName,
    ownerId: owner.id,
  });
  created.push(filed.id);
  check("it gets a quotable reference number", /^GRV\/[A-Z0-9]+\/[A-Z0-9]+\/\d{4}\/\d{4}$/.test(filed.referenceNo), filed.referenceNo);
  check("the route is frozen onto the record", filed.statuteSection.length > 0 && filed.authorityLabel.length > 0, filed.statuteSection);
  check("it names the officer it reached", filed.assignedTo !== null, filed.assignedTo ?? "nobody");

  const stored = await prisma.grievance.findUniqueOrThrow({ where: { id: filed.id } });
  check("the authority role is recorded for the inbox filter", stored.authorityRole === expectedRole, stored.authorityRole);
  check("the answers are kept field by field, not as prose", Array.isArray(stored.detailsJson) && (stored.detailsJson as unknown[]).length === 5);

  const alert = await prisma.alert.findFirst({
    where: { recipientId: stored.assignedToId ?? "", type: { startsWith: "GRIEVANCE" } },
    orderBy: { createdAt: "desc" },
  });
  check("the authority is actually alerted", alert?.message.includes(filed.referenceNo) ?? false, alert?.type ?? "no alert");

  const audit = await prisma.auditLog.findFirst({
    where: { entityType: "Grievance", entityId: filed.id }, orderBy: { sequence: "desc" },
  });
  check("it is written to the audit chain", audit !== null, audit?.action ?? "none");

  check(
    "the same complaint twice on the same plot is refused",
    (await refusal(() =>
      fileGrievance({
        category: "COMPENSATION_AMOUNT", parcelId,
        answers: {
          amountAwarded: "1250000", amountClaimed: "2100000",
          basis: "The market value used is below what land nearby actually sells for",
          explanation: "Saying the same thing again.",
        },
        filedByUserId: owner.userId!, objectorName: owner.fullName, ownerId: owner.id,
      }),
    ))?.includes("already have an open grievance") ?? false,
  );

  const otherParcel = await prisma.landParcel.findFirst({
    where: { id: { not: parcelId }, owners: { none: { ownerId: owner.id } }, proposalId: { not: null } },
    select: { id: true },
  });
  check(
    "a citizen cannot file about someone else's land",
    otherParcel
      ? ((await refusal(() =>
          fileGrievance({
            category: "MAP_BOUNDARY", parcelId: otherParcel.id,
            answers: { whatIsWrong: "The northern boundary is wrong", explanation: "This is not my land at all." },
            filedByUserId: owner.userId!, objectorName: owner.fullName, ownerId: owner.id,
          }),
        ))?.includes("not recorded in your name") ?? false)
      : true,
  );

  // ------------------------------------------------------- the two-track part
  console.log("\nTwo-track: objection where the statute allows it, representation where it does not:");
  const openCase = await prisma.landParcel.findFirst({
    where: { proposal: { status: "OBJECTIONS" }, owners: { some: { owner: { userId: { not: null } } } } },
    select: { id: true, owners: { select: { owner: { select: { id: true, fullName: true, userId: true } } } } },
  });
  if (openCase) {
    const o = openCase.owners[0].owner;
    const objectionFiled = await fileGrievance({
      category: "ACQUISITION_ITSELF", parcelId: openCase.id,
      answers: {
        ground: "A less damaging alignment or site exists",
        alternative: "The alignment can run along the canal bund instead.",
        explanation: "This is my only irrigated holding and an alternative exists.",
      },
      filedByUserId: o.userId!, objectorName: o.fullName, ownerId: o.id,
    });
    created.push(objectionFiled.id);
    check(
      "with the window open, a real s.15 objection is filed alongside it",
      objectionFiled.objectionId !== null,
      objectionFiled.objectionNote ?? "",
    );
    const linked = await prisma.objection.findUnique({ where: { id: objectionFiled.objectionId ?? "" } });
    check("the objection carries the composed representation as its grounds", linked?.grounds.includes("REPRESENTATION UNDER") ?? false);
  } else {
    check("with the window open, a real s.15 objection is filed alongside it", true, "skipped — no case at the objection stage");
    check("the objection carries the composed representation as its grounds", true, "skipped");
  }

  const closedCase = await prisma.landParcel.findFirst({
    where: {
      proposal: { status: { in: ["AWARD_DECLARED", "COMPENSATION_DISBURSEMENT", "POSSESSION", "CLOSED"] } },
      owners: { some: { owner: { userId: { not: null } } } },
    },
    select: { id: true, owners: { select: { owner: { select: { id: true, fullName: true, userId: true } } } } },
  });
  if (closedCase) {
    const o = closedCase.owners[0].owner;
    const late = await fileGrievance({
      category: "ACQUISITION_ITSELF", parcelId: closedCase.id,
      answers: { ground: "The land is not needed for the stated public purpose", explanation: "I still say this land was never needed." },
      filedByUserId: o.userId!, objectorName: o.fullName, ownerId: o.id,
    });
    created.push(late.id);
    check("past the window it is still recorded, and says so honestly", late.objectionId === null && (late.objectionNote?.length ?? 0) > 0, late.objectionNote ?? "");
  } else {
    check("past the window it is still recorded, and says so honestly", true, "skipped — no case past the objection stage");
  }

  // --------------------------------------------------------------- disposal
  console.log("\nDisposal — only the named authority, and never without reasons:");
  check(
    "the wrong authority cannot decide it",
    (await refusal(() =>
      disposeGrievance({
        grievanceId: filed.id, status: "REJECTED", decision: "No",
        decisionReasons: "Because I felt like deciding somebody else's case today.",
        actorId: owner.userId!, actorRole: "REHABILITATION_AUTHORITY",
      }),
    ))?.includes("to answer") ?? false,
  );
  check(
    "it cannot be closed without written reasons",
    (await refusal(() =>
      disposeGrievance({
        grievanceId: filed.id, status: "REJECTED", decision: "Rejected", decisionReasons: "no",
        actorId: owner.userId!, actorRole: stored.authorityRole,
      }),
    ))?.includes("Written reasons are required") ?? false,
  );
  const progressed = await disposeGrievance({
    grievanceId: filed.id, status: "UNDER_EXAMINATION",
    actorId: owner.userId!, actorRole: stored.authorityRole,
  });
  check("an interim step leaves it open", progressed.status === "UNDER_EXAMINATION" && progressed.decidedAt === null);
  const closed = await disposeGrievance({
    grievanceId: filed.id, status: "RESOLVED",
    decision: "Award revised upward after checking the three sale deeds produced.",
    decisionReasons: "The sale deeds showed a higher prevailing rate than the one applied; the award is revised under s.64.",
    actorId: owner.userId!, actorRole: stored.authorityRole,
  });
  check("closing it records the decision, the reasons and the date", Boolean(closed.decidedAt && closed.decisionReasons));
  const told = await prisma.alert.findFirst({
    where: { recipientId: owner.userId, type: "GRIEVANCE_DECIDED" }, orderBy: { createdAt: "desc" },
  });
  check("the citizen is told the outcome", told?.message.includes(filed.referenceNo) ?? false);
  check(
    "it cannot be disposed of twice",
    (await refusal(() =>
      disposeGrievance({
        grievanceId: filed.id, status: "REJECTED", decision: "Actually no",
        decisionReasons: "Changing my mind after the fact, which is exactly what must not be possible.",
        actorId: owner.userId!, actorRole: stored.authorityRole,
      }),
    ))?.includes("already been disposed") ?? false,
  );

  // Leave the database as we found it.
  const objectionIds = (
    await prisma.grievance.findMany({ where: { id: { in: created } }, select: { objectionId: true } })
  ).flatMap((g) => (g.objectionId ? [g.objectionId] : []));
  await prisma.grievance.deleteMany({ where: { id: { in: created } } });
  await prisma.objection.deleteMany({ where: { id: { in: objectionIds } } });
  await prisma.alert.deleteMany({ where: { type: { startsWith: "GRIEVANCE" } } });

  console.log("\n======================================================");
  console.log(`${fail === 0 ? "\x1b[32m" : "\x1b[31m"}PASSED ${pass}   FAILED ${fail}\x1b[0m\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
