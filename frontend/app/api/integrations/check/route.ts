import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { runHealthChecks } from "@backend/integrations/health";
import { appendAudit } from "@backend/audit/chain";
import { apiJson } from "@backend/http/respond";

/** Run every integration health check now. Read-only against the outside world, logged. */
export async function POST() {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "integration", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });
  const results = await runHealthChecks();
  await appendAudit({ actorId: s.id, action: "VIEW", entityType: "IntegrationHealth", entityId: "all", afterJson: { up: results.filter((r) => r.ok).length, total: results.length } });
  return await apiJson({ results });
}
