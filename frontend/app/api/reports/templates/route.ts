import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { validateDefinition } from "@backend/reports/builder";
import { appendAudit } from "@backend/audit/chain";
import { apiError, id, text } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Save a built report so it can be run again. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "report", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const body = await req.json().catch(() => null);
  try {
    if (body?.delete) {
      const templateId = id(body.delete);
      // Only ever your own: a shared report is not yours to remove.
      const { count } = await prisma.reportTemplate.deleteMany({ where: { id: templateId ?? "", ownerId: s.id } });
      if (!count) return await apiJson({ error: "Saved report not found" }, { status: 404 });
      return await apiJson({ ok: true, deleted: templateId });
    }

    const name = text(body?.name, { min: 3, max: 120 });
    if (!name) return await apiJson({ error: "Give the report a name" }, { status: 400 });
    const definition = validateDefinition(body?.definition);
    const template = await prisma.reportTemplate.create({
      data: {
        name,
        description: text(body?.description, { max: 500 }),
        definition: definition as never,
        ownerId: s.id,
        isShared: body?.isShared === true,
      },
    });
    await appendAudit({ actorId: s.id, action: "CREATE", entityType: "ReportTemplate", entityId: template.id, afterJson: { name, definition } });
    return await apiJson({ ok: true, id: template.id });
  } catch (e) {
    const { status, error } = apiError(e, "save report template");
    return await apiJson({ error }, { status });
  }
}
