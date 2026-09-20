import { NextResponse } from "next/server";
import { LIMITS, rateLimit } from "@backend/security/rate-limit";
import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { filterFromParams } from "@backend/analytics/filters";
import { runReport } from "@backend/reports/registry";
import { runBuilder, validateDefinition } from "@backend/reports/builder";
import { exportReport, type ExportFormat } from "@backend/reports/export";
import { executiveBrief } from "@backend/reports/brief";
import { briefToPdf } from "@backend/reports/brief-pdf";
import { apiError, id } from "@backend/validation/request";
import { getTranslator } from "@backend/i18n/locale";
import { english, jurisdictionName } from "@backend/reports/words";
import { apiJson } from "@backend/http/respond";

const FORMATS: ExportFormat[] = ["CSV", "EXCEL", "PDF"];

/** Download a report. Same query as the screen, watermarked and audited. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  const limit = rateLimit(`report-export:${s.id}`, LIMITS.export);
  if (!limit.ok) {
    return await apiJson(
      { error: "That is faster than this can be done by hand. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  if (!can(s.role, "report", "export")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const url = new URL(req.url);
  const format = FORMATS.find((f) => f === url.searchParams.get("format")) ?? "CSV";
  const filter = filterFromParams(Object.fromEntries(url.searchParams.entries()));
  const key = url.searchParams.get("key");
  const templateId = url.searchParams.get("template") ? id(url.searchParams.get("template")) : null;
  // CSV and Excel in the viewer's language; the PDF in English (its fonts draw Latin script only).
  const t = format === "PDF" ? english : (await getTranslator()).t;

  try {
    // The brief is prose, not a table, so it has its own page layout.
    if (key === "executive-brief") {
      const brief = await executiveBrief(s, filter, english);
      const pdf = await briefToPdf(brief, s);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="bhoomi-nayan-executive-brief-${brief.generatedAt.toISOString().slice(0, 10)}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const report = templateId
      ? await (async () => {
          const template = await prisma.reportTemplate.findFirst({
            where: { id: templateId, OR: [{ ownerId: s.id }, { isShared: true }] },
          });
          if (!template) throw new Error("Saved report not found");
          return runBuilder(validateDefinition(template.definition), s, filter, template.name, t);
        })()
      : await runReport(String(key ?? ""), s, filter, t);

    const file = await exportReport(report, format, s, jurisdictionName(t, s), t);
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const { status, error } = apiError(e, "export report");
    return await apiJson({ error }, { status });
  }
}
