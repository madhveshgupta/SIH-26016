import { NextResponse } from "next/server";
import { LIMITS, rateLimit } from "@backend/security/rate-limit";
import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { appendAudit } from "@backend/audit/chain";
import { compensationTrend, delayDistribution, geoRows } from "@backend/analytics/geo";
import { jurisdictionRollup, stageDwellTimes, stageFunnel } from "@backend/analytics/kpi";
import { apiError, id } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Any dashboard widget, as CSV. */
const WIDGETS = ["geo", "rollup", "funnel", "dwell", "trend", "delays"] as const;
type Widget = (typeof WIDGETS)[number];

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Quote anything a spreadsheet could misread, and neutralise formula injection.
    const safe = /^[=+@-]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
}

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  const limit = rateLimit(`analytics-export:${s.id}`, LIMITS.export);
  if (!limit.ok) {
    return await apiJson(
      { error: "That is faster than this can be done by hand. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  if (!can(s.role, "dashboard", "export") && !can(s.role, "report", "export")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }

  const url = new URL(req.url);
  const widget = WIDGETS.find((w) => w === url.searchParams.get("widget")) as Widget | undefined;
  if (!widget) return await apiJson({ error: `Unknown widget. One of: ${WIDGETS.join(", ")}` }, { status: 400 });
  const stateId = url.searchParams.get("stateId") ? id(url.searchParams.get("stateId")) : null;

  try {
    let rows: Record<string, unknown>[] = [];
    switch (widget) {
      case "geo":
        rows = (await geoRows(s, stateId)) as unknown as Record<string, unknown>[];
        break;
      case "rollup": {
        const r = await jurisdictionRollup(s);
        rows = r.rows.map((x) => ({ level: r.level, ...x }));
        break;
      }
      case "funnel":
        rows = (await stageFunnel(s)) as unknown as Record<string, unknown>[];
        break;
      case "dwell":
        rows = (await stageDwellTimes(s)).map((d) => ({ stage: d.stage, avgDays: Math.round(d.avgDays), cases: Number(d.cases) }));
        break;
      case "trend":
        rows = (await compensationTrend(s)) as unknown as Record<string, unknown>[];
        break;
      case "delays":
        rows = (await delayDistribution(s)) as unknown as Record<string, unknown>[];
        break;
    }

    await appendAudit({
      actorId: s.id,
      action: "DOWNLOAD",
      entityType: "AnalyticsExport",
      entityId: widget,
      afterJson: { widget, stateId, rows: rows.length },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bhoomi-nayan-${widget}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const { status, error } = apiError(e, "analytics export");
    return await apiJson({ error }, { status });
  }
}
