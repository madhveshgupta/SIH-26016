import { prisma } from "@backend/db/client";
import { publicGeo } from "@backend/public/stats";
import { apiError, id } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Land figures for the front page's map, by state or by district within one state. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("stateId");
  const stateId = raw ? id(raw) : null;
  if (raw && !stateId) return await apiJson({ error: "Unknown state" }, { status: 400 });
  if (stateId && !(await prisma.state.count({ where: { id: stateId } }))) {
    return await apiJson({ error: "Unknown state" }, { status: 404 });
  }
  try {
    return await apiJson(
      { level: stateId ? "district" : "state", rows: await publicGeo(stateId) },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (e) {
    const { status, error } = apiError(e, "public geo");
    return await apiJson({ error }, { status });
  }
}
