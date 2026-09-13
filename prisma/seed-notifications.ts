/** Notifications, objections and documents for the demo. */
import { PrismaClient, type RoleType } from "@prisma/client";
import { issueNotification, fileObjection, disposeObjection, mayHearObjections, objectionWindow } from "../backend/statutory/notifications";
import { generateNotificationPdf, generateAwardPdf } from "../backend/documents/generate";
import { uploadDocument } from "../backend/documents/service";

const prisma = new PrismaClient();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const OBJECTORS = [
  ["Bhagwati Prasad", "The proposed alignment passes through my only irrigated field, leaving the remainder unviable for cultivation."],
  ["Saira Bano", "The market value applied is the circle rate, which is well below the rate at which neighbouring plots have actually sold."],
  ["Devender Singh", "My family has cultivated this land for three generations as recorded tenants; no notice was served on us."],
  ["Kamla Devi", "The well and the mango trees on the plot have not been counted in the valuation at all."],
  ["Mukesh Chand", "An alternative alignment along the existing revenue boundary would avoid displacing eleven houses."],
];

async function main() {
  console.log("Seeding notifications, objections and documents…\n");

  await prisma.objection.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.documentVersion.deleteMany({});
  await prisma.document.deleteMany({});

  const collector = await prisma.user.findUnique({ where: { email: "collector.agra@bhoominayan.gov.in" } });
  const citizen = await prisma.user.findUnique({ where: { email: "landowner.agra@example.in" } });
  if (!collector) throw new Error("Run `npm run db:seed:users` first.");

  const proposals = await prisma.proposal.findMany({
    include: { project: true },
    orderBy: { referenceNo: "asc" },
  });

  let notifications = 0, objections = 0, docs = 0;

  for (const p of proposals) {
    const isNh = p.project.governingAct === "NH_ACT_1956";
    const reached = (s: string) =>
      ["SEC_11_PRELIM_NOTIFICATION","OBJECTIONS","SEC_19_DECLARATION","SEC_21_NOTICE",
       "AWARD_ENQUIRY","AWARD_DECLARED","COMPENSATION_DISBURSEMENT","RNR_IMPLEMENTATION",
       "POSSESSION","CLOSED"].indexOf(p.status) >=
      ["SEC_11_PRELIM_NOTIFICATION","OBJECTIONS","SEC_19_DECLARATION","SEC_21_NOTICE",
       "AWARD_ENQUIRY","AWARD_DECLARED","COMPENSATION_DISBURSEMENT","RNR_IMPLEMENTATION",
       "POSSESSION","CLOSED"].indexOf(s);

    if (!reached("SEC_11_PRELIM_NOTIFICATION")) continue;

    // SIA notification, for LARR projects only.
    if (!isNh) {
      await issueNotification({
        proposalId: p.id, type: "SEC_4_2_SIA", actorId: collector.id,
        issuedOn: daysAgo(520), gazetteRef: `GZT/SIA/${p.referenceNo.slice(-4)}`,
        channels: { publishedGazette: true, publishedNewspaper1: true, publishedNewspaper2: true,
                    publishedLocalLang: true, publishedPanchayat: true, publishedWebsite: true },
      });
      notifications++;
    }

    // Preliminary notification. One is deliberately left short of full
    // publication — that is a real ground for quashing an acquisition.
    const incomplete = p.referenceNo.endsWith("0002");
    const prelim = await issueNotification({
      proposalId: p.id,
      type: isNh ? "NH_3A_PRELIMINARY" : "SEC_11_PRELIMINARY",
      actorId: collector.id,
      issuedOn: daysAgo(400),
      gazetteRef: `GZT/${isNh ? "3A" : "S11"}/${p.referenceNo.slice(-4)}`,
      channels: {
        publishedGazette: true, publishedNewspaper1: true,
        publishedNewspaper2: !incomplete, publishedLocalLang: !incomplete,
        publishedPanchayat: true, publishedWebsite: true,
      },
    });
    notifications++;

    // The generated PDF, stored as a real versioned document.
    try {
      const gen = await generateNotificationPdf(p.id, "PRELIMINARY");
      await uploadDocument({
        title: gen.title, category: "PRELIMINARY_NOTIFICATION", proposalId: p.id,
        uploadedById: collector.id, fileName: `${p.referenceNo.replaceAll("/", "-")}-notification.pdf`,
        mimeType: "application/pdf", data: gen.pdf,
      });
      docs++;
    } catch (e) {
      console.warn(`  (pdf skipped for ${p.referenceNo}: ${(e as Error).message})`);
    }

    if (reached("SEC_19_DECLARATION")) {
      await issueNotification({
        proposalId: p.id,
        type: isNh ? "NH_3D_DECLARATION" : "SEC_19_DECLARATION",
        actorId: collector.id, issuedOn: daysAgo(370),
        gazetteRef: `GZT/${isNh ? "3D" : "S19"}/${p.referenceNo.slice(-4)}`,
        channels: { publishedGazette: true, publishedNewspaper1: true, publishedNewspaper2: true,
                    publishedLocalLang: true, publishedPanchayat: true, publishedWebsite: true },
      });
      notifications++;
    }
    void prelim;
  }

  // --- objections across the full lifecycle ---------------------------------
  // A case whose objection period is still open — filing is refused otherwise.
  let objectionTarget = proposals[0];
  for (const p of proposals.filter((x) => x.status === "OBJECTIONS")) {
    if ((await objectionWindow(p.id)).open) { objectionTarget = p; break; }
  }
  // Heard and decided by the authority the Act names: the Collector under
  // LARR, the CALA under the NH Act — in the case's own district.
  const deciderRole: RoleType = mayHearObjections(objectionTarget.project.governingAct, "DISTRICT_COLLECTOR") ? "DISTRICT_COLLECTOR" : "LAND_ACQUIRING_AUTHORITY";
  const districtIds = (await prisma.projectDistrict.findMany({ where: { projectId: objectionTarget.projectId } })).map((d) => d.districtId);
  const inDistrict = await prisma.user.findFirst({ where: { role: { type: deciderRole }, districtId: { in: districtIds } } });
  const decider = inDistrict
    ? { id: inDistrict.id, role: deciderRole }
    : { id: (await prisma.user.findFirstOrThrow({ where: { role: { type: "SUPER_ADMIN" } } })).id, role: "SUPER_ADMIN" as RoleType };
  const decide = async (id: string, input: Pick<Parameters<typeof disposeObjection>[0], "status" | "decision" | "decisionReasons">) => {
    // The objector is heard before the decision.
    await prisma.objection.update({ where: { id }, data: { status: "HEARD", hearingDate: daysAgo(3) } });
    return disposeObjection({ ...input, objectionId: id, actorId: decider.id, actorRole: decider.role });
  };

  // Objections (s.15 / NH Act s.3C) are filed after notification, against plots of the notified
  // project — never against land already awarded or possessed.
  const parcels = await prisma.landParcel.findMany({
    where: { proposalId: objectionTarget.id, status: "NOTIFIED", hasConflict: false },
    orderBy: { chainageM: "asc" },
    take: 5,
  });

  for (let i = 0; i < OBJECTORS.length; i++) {
    const [name, grounds] = OBJECTORS[i];
    const o = await fileObjection({
      proposalId: objectionTarget.id,
      parcelId: parcels[i]?.id ?? null,
      objectorName: name,
      grounds,
      // The first is filed online by the citizen account — the right to object
      // becomes usable rather than theoretical.
      filedByUserId: i === 0 ? citizen?.id ?? null : null,
    });
    objections++;

    if (i === 1) {
      await prisma.objection.update({
        where: { id: o.id },
        data: { status: "HEARING_SCHEDULED", hearingDate: new Date(Date.now() + 9 * 86_400_000) },
      });
    }
    if (i === 2) {
      await decide(o.id, {
        status: "ACCEPTED",
        decision: "Objection accepted; the alignment is revised to exclude the tenanted plot.",
        decisionReasons:
          "The objector produced recorded tenancy entries for three generations. Notice under s.21 was not served on the recorded tenants, and the defect is admitted by the acquiring body.",
      });
    }
    if (i === 3) {
      await decide(o.id, {
        status: "PARTIALLY_ACCEPTED",
        decision: "Valuation revised to include the well and the fruit-bearing trees.",
        decisionReasons:
          "Section 29 requires the value of assets attached to the land to be included. The joint measurement report omitted the well and eleven mango trees; a revised valuation is directed.",
      });
    }
    if (i === 4) {
      await decide(o.id, {
        status: "REJECTED",
        decision: "Objection rejected; the alternative alignment is not feasible.",
        decisionReasons:
          "The suggested alignment along the revenue boundary was examined and would require a curve below the design radius for the notified speed, which is not permissible under the highway standards. The displacement figure of eleven houses is also not borne out by the survey, which records four.",
      });
    }
  }

  // Award statements as stored documents.
  const awards = await prisma.award.findMany({ take: 4 });
  for (const a of awards) {
    try {
      const gen = await generateAwardPdf(a.id);
      await uploadDocument({
        title: gen.title, category: "AWARD_STATEMENT", proposalId: a.proposalId,
        uploadedById: collector.id, fileName: `${a.awardNo.replaceAll("/", "-")}.pdf`,
        mimeType: "application/pdf", data: gen.pdf,
      });
      docs++;
    } catch (e) {
      console.warn(`  (award pdf skipped: ${(e as Error).message})`);
    }
  }

  console.log(`  notifications issued   ${notifications}`);
  console.log(`  objections filed       ${objections}  (1 online by a citizen, 3 disposed with reasons)`);
  console.log(`  documents generated    ${docs}  (real PDFs, encrypted at rest, versioned)`);
  console.log(`\n  one notification is deliberately short of full publication —`);
  console.log(`  that alone is a ground for an acquisition to be quashed.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
