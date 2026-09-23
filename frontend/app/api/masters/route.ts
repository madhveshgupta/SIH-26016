import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { saveAgency, saveMinistry, updateDistrict } from "@backend/masters/service";
import { apiError, id as cleanId } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Change master data. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "masterData", "update") && !can(s.role, "masterData", "create")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const id = body?.id == null ? null : cleanId(body.id);
  if (body?.id != null && !id) return await apiJson({ error: "Not found" }, { status: 404 });

  try {
    switch (body?.kind) {
      case "district": {
        if (!id) return await apiJson({ error: "Which district?" }, { status: 400 });
        const d = await updateDistrict(s, id, body);
        return await apiJson({ ok: true, id: d.id });
      }
      case "agency": {
        const a = await saveAgency(s, id, body);
        return await apiJson({ ok: true, id: a.id });
      }
      case "ministry": {
        const m = await saveMinistry(s, id, body);
        return await apiJson({ ok: true, id: m.id });
      }
      default:
        return await apiJson({ error: "Unknown kind of master data" }, { status: 400 });
    }
  } catch (e) {
    const { status, error } = apiError(e, "masters");
    return await apiJson({ error }, { status: /not found/i.test(error) ? 404 : /cannot|only a national/i.test(error) ? 403 : status });
  }
}
