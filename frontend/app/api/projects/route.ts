import { LIMITS, rateLimit } from "@backend/security/rate-limit";
import type { AcquisitionAct, ProjectType } from "@prisma/client";
import { getSession } from "@backend/auth/session";
import { createProjectWithLand, mayCreateProjects, parsePicks } from "@backend/projects/land-selection";
import { apiError, id, lineString, num, text } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

const TYPES: ProjectType[] = ["HIGHWAY", "RAILWAY", "IRRIGATION", "INDUSTRIAL_CORRIDOR", "URBAN_DEVELOPMENT", "RENEWABLE_ENERGY", "MINING", "DEFENCE", "OTHER"];
const ACTS: AcquisitionAct[] = ["LARR_2013", "NH_ACT_1956", "RAILWAYS_ACT_1989", "STATE_ACT"];

/** Create a project with the land it needs. The body that needs the land, or an administrator. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  const limit = rateLimit(`projects:${s.id}`, LIMITS.officerWrite);
  if (!limit.ok) {
    return await apiJson(
      { error: "That is faster than this can be done by hand. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  if (!mayCreateProjects(s.role)) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body) return await apiJson({ error: "Malformed request" }, { status: 400 });
  const type = TYPES.find((t) => t === body.type);
  const act = ACTS.find((a) => a === body.governingAct);
  if (!type || !act) return await apiJson({ error: "Choose the project type and the Act it is acquired under" }, { status: 400 });

  // A requiring body creates projects for itself only; an administrator names the agency.
  const agencyId = s.role === "SUPER_ADMIN" ? id(body.agencyId) : s.agencyId;
  if (!agencyId) return await apiJson({ error: "Choose the agency that needs the land" }, { status: 400 });

  const name = text(body.name, { min: 5, max: 200 });
  if (!name) return await apiJson({ error: "Give the project a descriptive name" }, { status: 400 });
  const description = body.description == null || body.description === "" ? null : text(body.description, { max: 2000 });
  if (body.description != null && body.description !== "" && !description) {
    return await apiJson({ error: "The public purpose contains characters that cannot be stored" }, { status: 400 });
  }
  // An alignment that was sent but cannot be read is an error, not something
  // to drop quietly: the user drew it and expects the right-of-way to apply.
  const alignment = body.alignment == null ? null : lineString(body.alignment);
  if (body.alignment != null && !alignment) {
    return await apiJson({ error: "Draw the alignment inside India, as at least two points" }, { status: 400 });
  }
  const rightOfWayM = alignment ? num(body.rightOfWayM, { min: 5, max: 500 }) : null;
  if (alignment && rightOfWayM == null) {
    return await apiJson({ error: "Right-of-way must be between 5 and 500 metres" }, { status: 400 });
  }
  const cost = body.estimatedCostCrore == null || body.estimatedCostCrore === "" ? null : num(body.estimatedCostCrore, { min: 0, max: 10_000_000 });
  if (body.estimatedCostCrore != null && body.estimatedCostCrore !== "" && cost == null) {
    return await apiJson({ error: "Estimated cost must be a number of crore, zero or more" }, { status: 400 });
  }

  try {
    const created = await createProjectWithLand(
      { name, description, type, governingAct: act, agencyId, estimatedCostCrore: cost, alignment, rightOfWayM, picks: parsePicks(body.picks) },
      s,
    );
    return await apiJson({ ok: true, ...created });
  } catch (e) {
    const { status, error } = apiError(e, "create project");
    return await apiJson({ error }, { status });
  }
}
