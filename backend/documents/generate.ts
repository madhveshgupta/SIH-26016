/** Auto-generated statutory documents. */
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { prisma } from "@backend/db/client";
import { stageFor, definitionFor } from "@backend/workflow/engine";


const MARGIN = 56;

/** Money for PDFs. */
function pdfRupees(value: unknown): string {
  const n = Number(String(value));
  return `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/** Government letterhead. Kept consistent across every generated document. */
function letterhead(doc: PDFKit.PDFDocument, opts: { state: string; district: string }) {
  doc.fontSize(9).fillColor("#666").text("GOVERNMENT OF INDIA", { align: "center" });
  doc.fontSize(13).fillColor("#000").text(opts.state.toUpperCase(), { align: "center" });
  doc
    .fontSize(9)
    .fillColor("#444")
    .text(`OFFICE OF THE DISTRICT COLLECTOR, ${opts.district.toUpperCase()}`, { align: "center" });
  doc.moveDown(0.4);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(doc.page.width - MARGIN, doc.y)
    .strokeColor("#999")
    .stroke();
  doc.moveDown(0.8);
}

async function verificationBlock(
  doc: PDFKit.PDFDocument,
  code: string,
  reference: string,
) {
  const png = await QRCode.toBuffer(
    `https://bhoominayan.gov.in/verify/${code}`,
    { width: 120, margin: 0 },
  );
  const y = doc.page.height - MARGIN - 78;
  doc.image(png, doc.page.width - MARGIN - 62, y, { width: 62 });
  doc
    .fontSize(7)
    .fillColor("#666")
    .text(
      `Verification code ${code}\nScan to confirm this document is genuine.\nReference ${reference}`,
      MARGIN,
      y + 16,
      { width: 300 },
    );
}

/** A statutory notification — s.11/s.19/s.21 under LARR, or s.3A/s.3D under the NH Act. */
export interface GeneratedDocument {
  pdf: Buffer;
  title: string;
  code: string;
  /** The rendered text. */
  text: string;
}

export async function generateNotificationPdf(
  proposalId: string,
  type: "PRELIMINARY" | "DECLARATION",
): Promise<GeneratedDocument> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      project: { include: { agency: true, districts: { include: { district: { include: { state: true } } } } } },
      parcels: { include: { village: true, owners: { include: { owner: true } } } },
    },
  });
  if (!proposal) throw new Error("Proposal not found");

  const districtRow = proposal.project.districts[0]?.district;
  const state = districtRow?.state.name ?? "—";
  const district = districtRow?.name ?? "—";
  const act = definitionFor(proposal.project.governingAct);

  const status = type === "PRELIMINARY" ? "SEC_11_PRELIM_NOTIFICATION" : "SEC_19_DECLARATION";
  const stage = stageFor(proposal.project.governingAct, status);
  const section = stage?.section ?? (type === "PRELIMINARY" ? "s.11" : "s.19");
  const heading =
    type === "PRELIMINARY"
      ? `PRELIMINARY NOTIFICATION UNDER SECTION ${section.replace("s.", "")}`
      : `DECLARATION UNDER SECTION ${section.replace("s.", "")}`;

  const code = Math.random().toString(16).slice(2, 12).toUpperCase();
  const doc = new PDFDocument({ size: "A4", margin: MARGIN });

  letterhead(doc, { state, district });

  doc.fontSize(11).fillColor("#000").text(heading, { align: "center", underline: true });
  doc.fontSize(8).fillColor("#555").text(act.citation, { align: "center" });
  doc.moveDown(1);

  doc.fontSize(9).fillColor("#000");
  doc.text(`Notification No.: ${proposal.referenceNo}`);
  doc.text(`Date: ${new Date().toISOString().slice(0, 10)}`);
  doc.moveDown(0.8);

  const body =
    type === "PRELIMINARY"
      ? `Whereas it appears to the appropriate Government that land in the locality described below is required for a public purpose, namely ${proposal.project.name}, notice is hereby given under ${section} of the ${act.name} that the land described in the Schedule below is likely to be required for the said public purpose.\n\nAny person interested in the said land may, within the period prescribed, file objections under ${stageFor(proposal.project.governingAct, "OBJECTIONS")?.section ?? "s.15"} before the undersigned. From the date of publication of this notification, no person shall make any transaction in respect of the said land.`
      : `Whereas the appropriate Government is satisfied, after considering the objections filed and the report thereon, that the land described in the Schedule below is required for the public purpose of ${proposal.project.name}, it is hereby declared under ${section} of the ${act.name} that the said land is required for the said public purpose.\n\nThe Collector shall proceed to take order for the acquisition of the said land and make an award in accordance with the provisions of the Act.`;

  doc.text(body, { align: "justify", lineGap: 2 });
  doc.moveDown(0.8);

  doc.fontSize(9).text("PUBLIC PURPOSE", { underline: true });
  doc.fontSize(8.5).text(proposal.publicInterestNote ?? "—", { align: "justify", lineGap: 1.5 });
  doc.moveDown(0.8);

  doc.fontSize(9).text("SCHEDULE OF LAND", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(7.5);

  const cols = [MARGIN, MARGIN + 110, MARGIN + 210, MARGIN + 300, MARGIN + 370];
  const header = ["Village", "Khasra / Survey No.", "Area (hectares)", "Land use", "ULPIN"];
  header.forEach((h, i) => doc.text(h, cols[i], doc.y, { continued: i < header.length - 1 }));
  doc.moveDown(0.3);
  doc.moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).strokeColor("#ccc").stroke();
  doc.moveDown(0.2);

  let totalHa = 0;
  for (const p of proposal.parcels.slice(0, 22)) {
    const y = doc.y;
    totalHa += Number(p.declaredAreaHectares);
    doc.text(p.village.name.slice(0, 18), cols[0], y);
    doc.text(p.khasraNo, cols[1], y);
    doc.text(Number(p.declaredAreaHectares).toFixed(4), cols[2], y);
    doc.text(p.landUse.toLowerCase(), cols[3], y);
    doc.text(p.ulpin ?? "—", cols[4], y);
    doc.moveDown(0.15);
  }
  if (proposal.parcels.length > 22) {
    doc.moveDown(0.3).fillColor("#666").text(`… and ${proposal.parcels.length - 22} further entries`, MARGIN);
    doc.fillColor("#000");
  }
  doc.moveDown(0.4);
  doc.fontSize(8).text(`Total area notified: ${totalHa.toFixed(4)} hectares`, MARGIN);
  doc.moveDown(1.2);

  // The Act requires publication in all of these; courts have quashed
  // acquisitions purely because one channel could not be proved.
  doc.fontSize(8).fillColor("#444");
  doc.text(
    "To be published in the Official Gazette, in two daily newspapers (one in the regional language), " +
      "in the local language at convenient places in the locality, on the notice board of the concerned " +
      "Panchayat/Municipality, and on the official website.",
    { align: "justify" },
  );
  doc.moveDown(1.2);

  doc.fillColor("#000").fontSize(9);
  doc.text("District Collector", { align: "right" });
  doc.text(`${district}, ${state}`, { align: "right" });

  await verificationBlock(doc, code, proposal.referenceNo);

  return {
    pdf: await buffer(doc),
    title: `${heading} — ${proposal.referenceNo}`,
    code,
    text: [heading, act.citation, proposal.referenceNo, body,
           proposal.publicInterestNote ?? "", `Total area notified: ${totalHa.toFixed(4)} hectares`,
           `District Collector ${district}, ${state}`].join("\n"),
  };
}

/** The award statement served on each landowner, with the full s.26–30 breakdown. */
export async function generateAwardPdf(awardId: string): Promise<GeneratedDocument> {
  const award = await prisma.award.findUnique({
    where: { id: awardId },
    include: {
      proposal: { include: { project: true } },
      parcel: { include: { village: true, district: { include: { state: true } } } },
      compensations: { include: { owner: true } },
    },
  });
  if (!award) throw new Error("Award not found");

  const district = award.parcel?.district.name ?? "—";
  const state = award.parcel?.district.state.name ?? "—";
  const code = Math.random().toString(16).slice(2, 12).toUpperCase();

  const doc = new PDFDocument({ size: "A4", margin: MARGIN });
  letterhead(doc, { state, district });

  doc.fontSize(11).text("AWARD UNDER SECTION 23", { align: "center", underline: true });
  doc.fontSize(8).fillColor("#555").text(
    "Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and Resettlement Act, 2013",
    { align: "center" },
  );
  doc.moveDown(1).fillColor("#000").fontSize(9);

  doc.text(`Award No.: ${award.awardNo}`);
  doc.text(`Proposal: ${award.proposal.referenceNo}`);
  doc.text(`Declared on: ${award.declaredOn.toISOString().slice(0, 10)}`);
  doc.text(`Parcel: khasra ${award.parcel?.khasraNo ?? "—"}, ${award.parcel?.village.name ?? "—"}`);
  doc.moveDown(0.8);

  const textLines: string[] = ["AWARD UNDER SECTION 23", award.awardNo, award.proposal.referenceNo];

  for (const c of award.compensations) {
    doc.fontSize(9).text(`Compensation payable to ${c.owner.fullName}`, { underline: true });
    textLines.push(`Compensation payable to ${c.owner.fullName}`);
    doc.moveDown(0.3).fontSize(8);

    const line = (label: string, section: string, amount: unknown) => {
      textLines.push(`${label} ${section} ${pdfRupees(amount)}`);
      const y = doc.y;
      doc.text(label, MARGIN, y);
      doc.fillColor("#666").text(section, MARGIN + 250, y);
      doc.fillColor("#000").text(pdfRupees(amount), MARGIN + 320, y, {
        width: 150,
        align: "right",
      });
      doc.moveDown(0.25);
    };

    line("Market value of land", "s.26", c.landValue);
    line("Value of assets attached to land", "s.29", c.assetsSubtotal);
    line("Sub-total", "", c.subTotal);
    line("Solatium (100%)", "s.30", c.solatium);
    line("Interest", "s.30(3)", c.interestAmount);
    doc.moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).strokeColor("#999").stroke();
    doc.moveDown(0.25);
    line("TOTAL COMPENSATION", "", c.totalCompensation);
    if (Number(String(c.ownerSharePct)) !== 100) {
      line(`Share of this owner (${String(c.ownerSharePct)}%)`, "", c.payableToOwner);
    }
    doc.moveDown(0.8);
  }

  doc.fontSize(8).fillColor("#444").text(
    "Solatium under section 30 is one hundred per cent of the sub-total, awarded in recognition of the " +
      "compulsory nature of the acquisition. Market value has been determined under section 26 as the " +
      "highest of the circle rate, the average of the top fifty per cent of sale deeds, and any consented " +
      "amount. Possession shall not be taken until compensation has been paid in full.",
    { align: "justify" },
  );
  doc.moveDown(1.2).fillColor("#000").fontSize(9);
  doc.text("Collector / Competent Authority", { align: "right" });
  doc.text(`${district}, ${state}`, { align: "right" });

  await verificationBlock(doc, code, award.awardNo);

  return {
    pdf: await buffer(doc),
    title: `Award ${award.awardNo}`,
    code,
    text: textLines.join("\n"),
  };
}
