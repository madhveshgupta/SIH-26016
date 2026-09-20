/** The executive brief as a page someone can carry into a meeting. */
import PDFDocument from "pdfkit";
import type { ExecutiveBrief } from "@backend/reports/brief";
import type { Actor } from "@backend/rbac/scope";

const SEVERITY_COLOUR = { critical: "#b91c1c", warning: "#b45309", note: "#475569" } as const;
const SEVERITY_LABEL = { critical: "ACTION NEEDED", warning: "WATCH", note: "NOTE" } as const;

export async function briefToPdf(brief: ExecutiveBrief, actor: Actor & { fullName?: string; email?: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const width = doc.page.width - 96;
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(8).fillColor("#666").text("GOVERNMENT OF INDIA", { align: "center" });
  doc.fontSize(16).fillColor("#0b3d91").font("Helvetica-Bold").text("Executive brief", { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor("#333").text(`${brief.jurisdiction} · ${brief.generatedAt.toISOString().slice(0, 10)}`, { align: "center" });
  doc.fontSize(8).fillColor("#666").text(brief.filterNote, { align: "center" });
  doc.moveDown(0.8);

  doc.fontSize(10).fillColor("#111").text(brief.summary, { width, align: "left" });
  doc.moveDown(0.8);

  doc.fontSize(11).font("Helvetica-Bold").fillColor("#111").text("What needs a decision");
  doc.moveDown(0.3);
  for (const f of brief.findings) {
    const colour = SEVERITY_COLOUR[f.severity];
    doc.font("Helvetica-Bold").fontSize(7).fillColor(colour).text(SEVERITY_LABEL[f.severity]);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text(f.headline, { width });
    doc.font("Helvetica").fontSize(9).fillColor("#333").text(f.detail, { width });
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(colour).text(`→ ${f.action}`, { width });
    doc.font("Helvetica").moveDown(0.6);
  }

  doc.moveDown(0.2);
  doc.fontSize(11).font("Helvetica-Bold").fillColor("#111").text("The figures behind it");
  doc.moveDown(0.4);
  const columnWidth = width / 2;
  let y = doc.y;
  brief.headlines.forEach((h, i) => {
    const x = 48 + (i % 2) * columnWidth;
    if (i % 2 === 0 && i > 0) y += 18;
    doc.font("Helvetica").fontSize(9).fillColor("#666").text(h.label, x, y, { width: columnWidth - 12, continued: false });
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text(h.value, x + columnWidth - 120, y, { width: 108, align: "right" });
  });
  doc.y = y + 24;

  doc.font("Helvetica").fontSize(7).fillColor("#666").text(
    `Generated from Bhoomi Nayan for ${actor.fullName ?? actor.email ?? "an officer"} on ${brief.generatedAt.toISOString().slice(0, 16).replace("T", " ")}. ` +
      "Every figure is reproducible from the case records it was drawn from.",
    48,
    doc.page.height - 70,
    { width },
  );

  doc.end();
  return done;
}
