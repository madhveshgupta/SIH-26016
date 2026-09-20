/** Getting a report out of the system: CSV, Excel and PDF. */
import PDFDocument from "pdfkit";
import { appendAudit } from "@backend/audit/chain";
import { formatINR } from "@backend/compensation/format";
import type { Cell, ReportColumn, ReportResult } from "@backend/reports/registry";
import type { Actor } from "@backend/rbac/scope";
import { english, type Translate } from "@backend/reports/words";

export type ExportFormat = "CSV" | "EXCEL" | "PDF";

export interface ExportedFile {
  body: Buffer;
  contentType: string;
  filename: string;
}

const stamp = (d: Date) => d.toISOString().slice(0, 10);

function watermark(actor: { email?: string; fullName?: string }, at: Date, t: Translate): string {
  return t("screens.reportPack.watermark", {
    when: at.toISOString().slice(0, 16).replace("T", " "),
    who: actor.fullName ?? actor.email ?? t("screens.reportPack.anOfficer"),
  });
}

function display(value: Cell, column: ReportColumn): string {
  if (value === null || value === undefined) return "";
  if (column.format === "money" && typeof value === "number") return formatINR(value);
  if (column.format === "pct" && typeof value === "number") return `${value}%`;
  return String(value);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(value: Cell): string {
  const s = value == null ? "" : String(value);
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
  const safe = /^[=+@-]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(report: ReportResult, note: string): string {
  const lines = [
    `# ${report.title}`,
    `# ${report.filterNote}`,
    `# ${note}`,
    report.columns.map((c) => csvCell(c.label)).join(","),
    ...report.rows.map((r) => report.columns.map((c) => csvCell(r[c.key] ?? null)).join(",")),
  ];
  if (report.totals) lines.push(report.columns.map((c) => csvCell(report.totals![c.key] ?? null)).join(","));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Excel (SpreadsheetML)
// ---------------------------------------------------------------------------

const xml = (s: unknown) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function toExcel(report: ReportResult, note: string): string {
  const cell = (value: Cell, column: ReportColumn, style?: string) => {
    const numeric = column.numeric && typeof value === "number" && Number.isFinite(value);
    const styleAttr = style ? ` ss:StyleID="${style}"` : "";
    return numeric
      ? `<Cell${styleAttr}><Data ss:Type="Number">${value}</Data></Cell>`
      : `<Cell${styleAttr}><Data ss:Type="String">${xml(value ?? "")}</Data></Cell>`;
  };

  const rows = report.rows
    .map((r) => `<Row>${report.columns.map((c) => cell(r[c.key] ?? null, c)).join("")}</Row>`)
    .join("");
  const totals = report.totals
    ? `<Row>${report.columns.map((c) => cell(report.totals![c.key] ?? null, c, "sTotal")).join("")}</Row>`
    : "";

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="sTitle"><Font ss:Bold="1" ss:Size="13"/></Style>
    <Style ss:ID="sNote"><Font ss:Italic="1" ss:Color="#666666" ss:Size="9"/></Style>
    <Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3D91" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sTotal"><Font ss:Bold="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Style>
  </Styles>
  <Worksheet ss:Name="${xml(report.title.slice(0, 28))}">
    <Table>
      ${report.columns.map(() => '<Column ss:AutoFitWidth="1" ss:Width="110"/>').join("")}
      <Row><Cell ss:StyleID="sTitle"><Data ss:Type="String">${xml(report.title)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="sNote"><Data ss:Type="String">${xml(report.filterNote)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="sNote"><Data ss:Type="String">${xml(note)}</Data></Cell></Row>
      <Row></Row>
      <Row>${report.columns.map((c) => `<Cell ss:StyleID="sHead"><Data ss:Type="String">${xml(c.label)}</Data></Cell>`).join("")}</Row>
      ${rows}
      ${totals}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/><SplitHorizontal>5</SplitHorizontal><TopRowBottomPane>5</TopRowBottomPane><ActivePane>2</ActivePane>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function pdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export async function toPdf(report: ReportResult, note: string, jurisdiction: string): Promise<Buffer> {
  // Landscape: these are wide tables, and a report that needs a magnifying
  // glass does not get read.
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
  const width = doc.page.width - 72;

  doc.fontSize(8).fillColor("#666").text("GOVERNMENT OF INDIA", { align: "center" });
  doc.fontSize(14).fillColor("#000").text(report.title, { align: "center" });
  doc.fontSize(9).fillColor("#444").text(jurisdiction, { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(8).fillColor("#666").text(report.description, { align: "center" });
  doc.text(report.filterNote, { align: "center" });
  doc.moveDown(0.6);

  // Columns are laid out proportionally to their content, within the page.
  const weights = report.columns.map((c) => (c.numeric ? 0.8 : c.key === "grounds" || c.key === "reasons" ? 2.4 : 1.2));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / totalWeight) * width);

  const drawRow = (values: string[], opts: { bold?: boolean; fill?: string; colour?: string } = {}) => {
    const top = doc.y;
    const height = Math.max(
      14,
      ...values.map((v, i) => doc.fontSize(7).heightOfString(v, { width: widths[i] - 6 })),
    );
    if (top + height > doc.page.height - 48) {
      doc.addPage();
    }
    const y = doc.y;
    if (opts.fill) doc.rect(36, y - 2, width, height + 4).fill(opts.fill);
    let x = 36;
    values.forEach((v, i) => {
      doc
        .fillColor(opts.colour ?? "#111")
        .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(7)
        .text(v, x + 3, y, { width: widths[i] - 6, align: report.columns[i].numeric ? "right" : "left" });
      x += widths[i];
    });
    doc.y = y + height + 4;
  };

  drawRow(report.columns.map((c) => c.label), { bold: true, fill: "#0b3d91", colour: "#fff" });
  for (const row of report.rows.slice(0, 400)) {
    drawRow(report.columns.map((c) => display(row[c.key] ?? null, c)));
  }
  if (report.rows.length > 400) {
    doc.moveDown(0.3).fontSize(7).fillColor("#666").text(`… ${report.rows.length - 400} further rows — take the CSV or Excel export for the full set.`, 36);
  }
  if (report.totals) {
    drawRow(report.columns.map((c) => display(report.totals![c.key] ?? null, c)), { bold: true });
  }

  doc.moveDown(0.8).fontSize(7).fillColor("#666").text(note, 36, doc.y, { width });
  return pdfBuffer(doc);
}

// ---------------------------------------------------------------------------

/** Produce the file, and record that it was taken. */
export async function exportReport(
  report: ReportResult,
  format: ExportFormat,
  actor: Actor & { email?: string; fullName?: string },
  jurisdiction = "All States and Union Territories",
  t: Translate = english,
): Promise<ExportedFile> {
  // The PDF's built-in fonts draw Latin script only, so a PDF is always English.
  const note = watermark(actor, report.generatedAt, format === "PDF" ? english : t);
  const base = `bhoomi-nayan-${report.key}-${stamp(report.generatedAt)}`;

  const file: ExportedFile =
    format === "CSV"
      ? { body: Buffer.from(toCsv(report, note), "utf8"), contentType: "text/csv; charset=utf-8", filename: `${base}.csv` }
      : format === "EXCEL"
        ? { body: Buffer.from(toExcel(report, note), "utf8"), contentType: "application/vnd.ms-excel", filename: `${base}.xls` }
        : { body: await toPdf(report, note, jurisdiction), contentType: "application/pdf", filename: `${base}.pdf` };

  await appendAudit({
    actorId: actor.id,
    action: "DOWNLOAD",
    entityType: "Report",
    entityId: report.key,
    afterJson: { format, rows: report.rows.length, filter: report.filterNote, bytes: file.body.length },
  });

  return file;
}
