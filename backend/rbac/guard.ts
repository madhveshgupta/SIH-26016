/** Page and action guards. */
import { redirect } from "next/navigation";
import { requireSession, type SessionClaims } from "@backend/auth/session";
import { can, type Resource, type Action } from "@backend/rbac/permissions";

/** Where each role belongs when it has no business on the page it asked for. */
function homeFor(session: SessionClaims): string {
  return session.role === "LANDOWNER" ? "/my-land" : "/dashboard";
}

/** Require a session AND a specific permission. */
export async function requirePermission(
  resource: Resource,
  action: Action = "read",
): Promise<SessionClaims> {
  const session = await requireSession();
  if (!can(session.role, resource, action)) {
    redirect(homeFor(session));
  }
  return session;
}

/** Assert a permission inside a server action or route handler. Throws. */
export function assertPermission(
  session: SessionClaims,
  resource: Resource,
  action: Action,
): void {
  if (!can(session.role, resource, action)) {
    throw new Error(`FORBIDDEN: ${session.role} may not ${action} ${resource}`);
  }
}
