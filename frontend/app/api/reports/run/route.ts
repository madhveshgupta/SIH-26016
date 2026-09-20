import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { filterFromParams } from "@backend/analytics/filters";
import { runReport } from "@backend/reports/registry";
import { runBuilder, validateDefinition } from "@backend/reports/builder";
import { apiError, text } from "@backend/validation/request";
import { getTranslator } from "@backend/i18n/locale";
import { apiJson } from "@backend/http/respond";

/** Run a standing report, or a report built in the builder. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "report", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const filter = filterFromParams((body?.filter ?? {}) as Record<string, string>);
  const { t } = await getTranslator();
  try {
    const report = body?.definition
      ? await runBuilder(validateDefinition(body.definition), s, filter, text(body?.name, { max: 120 }) ?? undefined, t)
      : await runReport(String(body?.key ?? ""), s, filter, t);
    return await apiJson({ ok: true, report });
  } catch (e) {
    const { status, error } = apiError(e, "run report");
    return await apiJson({ error }, { status });
  }
}
