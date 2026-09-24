import type { SessionClaims } from "@backend/auth/session";
import type { MessageKey } from "@backend/i18n";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel, scopeForProject, scopeForProposal } from "@backend/rbac/scope";
import type { NavItem } from "@frontend/components/ShellFrame";

/** A project's own sections, as paths under /projects/<id>. */
const PROJECT_SECTIONS: { section: string; label: MessageKey; icon: string; resource: Parameters<typeof can>[1]; action?: Parameters<typeof can>[2] }[] = [
  { section: "", label: "nav.projectOverview", icon: "projects", resource: "project" },
  { section: "proposals", label: "nav.proposals", icon: "file", resource: "proposal" },
  { section: "map", label: "nav.landMap", icon: "map", resource: "parcel" },
  { section: "field", label: "nav.fieldSurvey", icon: "smartphone", resource: "parcel", action: "update" },
  { section: "notifications", label: "nav.notifications", icon: "megaphone", resource: "notification" },
  { section: "objections", label: "nav.objections", icon: "scale", resource: "objection" },
  { section: "compensation", label: "nav.compensation", icon: "rupee", resource: "compensation" },
  { section: "rnr", label: "nav.rehabilitation", icon: "home", resource: "rnr" },
  { section: "documents", label: "nav.documents", icon: "folder", resource: "document" },
];

const PROJECT_PATH = /^\/projects\/(?!new(?:[/?]|$))([a-z0-9]{20,32})(?:[/?]|$)/;
const DETAIL_PATH = /^\/(proposals|parcels)\/([a-z0-9]{20,32})(?:[/?]|$)/;
/** The field app lives at /field (its offline shell is scoped there); ?project= ties it to one. */
const FIELD_PATH = /^\/field\/?\?(?:.*&)?project=([a-z0-9]{20,32})(?:&|$)/;

/**
 * The workspace the sidebar shows under Projects: which project, and which of its sections the
 * page belongs to.
 */
export async function projectWorkspace(
  session: SessionClaims,
  path: string,
  t: (key: MessageKey) => string,
): Promise<NonNullable<NavItem["workspace"]> | null> {
  if (session.role === "LANDOWNER" || !can(session.role, "project", "read")) return null;

  const field = FIELD_PATH.exec(path)?.[1] ?? null;
  let id = PROJECT_PATH.exec(path)?.[1] ?? field;
  let owned: string | null = field ? "field" : null;
  const detail = DETAIL_PATH.exec(path);
  if (detail) {
    const owner =
      detail[1] === "proposals"
        ? await prisma.proposal.findFirst({ where: { AND: [{ id: detail[2] }, scopeForProposal(session)] }, select: { projectId: true } })
        : await prisma.landParcel.findFirst({ where: { AND: [{ id: detail[2] }, scopeForParcel(session)] }, select: { projectId: true } });
    if (owner) {
      id = owner.projectId;
      owned = detail[1] === "proposals" ? "proposals" : "map";
    }
  }
  if (!id) return null;

  const project = await prisma.project.findFirst({
    where: { AND: [{ id }, scopeForProject(session)] },
    select: { id: true, name: true, referenceNo: true },
  });
  if (!project) return null;

  const base = `/projects/${project.id}`;
  return {
    id: project.id,
    title: project.name,
    subtitle: project.referenceNo,
    switchLabel: t("nav.switchProject"),
    items: PROJECT_SECTIONS.filter((s) => can(session.role, s.resource, s.action ?? "read")).map((s) => ({
      // The field app is its own offline shell at /field.
      href: s.section === "field" ? `/field?project=${project.id}` : s.section ? `${base}/${s.section}` : base,
      label: t(s.label),
      icon: s.icon,
      // The overview also owns the land editor at /land.
      exact: !s.section,
      also: !s.section ? [`${base}/land`] : undefined,
      current: owned === s.section,
    })),
  };
}
