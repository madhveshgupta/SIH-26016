import type { SessionClaims } from "@backend/auth/session";
import { headers } from "next/headers";
import { describeScope } from "@backend/rbac/scope";
import { projectWorkspace } from "@frontend/lib/nav-workspace";
import { can } from "@backend/rbac/permissions";
import { prisma } from "@backend/db/client";
import { getTranslator } from "@backend/i18n/locale";
import { COVERAGE, TRANSLATED, type MessageKey } from "@backend/i18n";
import ShellFrame, { type NavGroup, type NavItem } from "./ShellFrame";

/** Nav is filtered by the permission matrix, so a role never sees a link it cannot use. */
type NavDef = {
  href: string;
  /** Dictionary key, so the sidebar speaks the user's language. */
  label: MessageKey;
  icon: string;
  resource: Parameters<typeof can>[1];
  /** The action the page itself requires, when it is more than reading. */
  action?: Parameters<typeof can>[2];
  officerOnly?: boolean;
  citizenOnly?: boolean;
};

// The model card is not in the menu: officers act on predictions, they do not audit the model.
const RECORDS: NavDef[] = [
  { href: "/reports", label: "nav.reports", icon: "reports", resource: "report" },
  { href: "/documents", label: "nav.documents", icon: "folder", resource: "document" },
  { href: "/audit", label: "nav.auditTrail", icon: "shield", resource: "auditLog" },
  { href: "/permissions", label: "nav.rolesAccess", icon: "users", resource: "user" },
  { href: "/admin/integrations", label: "nav.integrations", icon: "activity", resource: "integration" },
  { href: "/admin/masters", label: "nav.masterData", icon: "database", resource: "masterData" },
];

/**
 * The flat menu: citizens, and officers whose role does not work by project (the Rehabilitation
 * Authority reads families and cases, not projects).
 */
const FLAT_NAV: { group: MessageKey; items: NavDef[] }[] = [
  {
    group: "navGroups.overview",
    items: [
      { href: "/dashboard", label: "nav.dashboard", icon: "dashboard", resource: "dashboard" },
      { href: "/my-land", label: "nav.myLand", icon: "land", resource: "parcel", citizenOnly: true },
      { href: "/my-compensation", label: "nav.myCompensation", icon: "rupee", resource: "compensation", citizenOnly: true },
      { href: "/my-entitlements", label: "nav.myEntitlements", icon: "home", resource: "rnr", citizenOnly: true },
      { href: "/alerts", label: "nav.alerts", icon: "bell", resource: "parcel" },
    ],
  },
  {
    group: "navGroups.casework",
    items: [
      { href: "/inbox", label: "nav.inbox", icon: "inbox", resource: "proposal" },
      { href: "/proposals", label: "nav.proposals", icon: "file", resource: "proposal" },
      { href: "/projects", label: "nav.projects", icon: "projects", resource: "project" },
    ],
  },
  {
    group: "navGroups.land",
    items: [
      { href: "/parcels", label: "nav.landMap", icon: "map", resource: "parcel", officerOnly: true },
      { href: "/field", label: "nav.fieldSurvey", icon: "smartphone", resource: "parcel", action: "update", officerOnly: true },
      { href: "/notifications", label: "nav.notifications", icon: "megaphone", resource: "notification" },
      { href: "/objections", label: "nav.objections", icon: "scale", resource: "objection" },
      { href: "/grievances", label: "nav.grievances", icon: "inbox", resource: "grievance", officerOnly: true },
    ],
  },
  {
    group: "navGroups.analytics",
    items: [
      { href: "/analytics/predictions", label: "nav.predictions", icon: "brain", resource: "mlPrediction" },
      { href: "/analytics/simulator", label: "nav.policySimulator", icon: "sliders", resource: "mlPrediction" },
    ],
  },
  {
    group: "navGroups.entitlements",
    items: [
      { href: "/compensation", label: "nav.compensation", icon: "rupee", resource: "compensation", officerOnly: true },
      { href: "/rnr", label: "nav.rehabilitation", icon: "home", resource: "rnr", officerOnly: true },
    ],
  },
  {
    group: "navGroups.records",
    items: RECORDS,
  },
];


/** The officers' menu. */
const WORKSPACE_NAV: { group: MessageKey; items: NavDef[] }[] = [
  {
    group: "navGroups.overview",
    items: [
      { href: "/dashboard", label: "nav.dashboard", icon: "dashboard", resource: "dashboard" },
      { href: "/alerts", label: "nav.alerts", icon: "bell", resource: "parcel" },
    ],
  },
  {
    group: "navGroups.casework",
    items: [
      { href: "/inbox", label: "nav.inbox", icon: "inbox", resource: "proposal" },
      { href: "/projects", label: "nav.projects", icon: "projects", resource: "project" },
      { href: "/grievances", label: "nav.grievances", icon: "inbox", resource: "grievance" },
    ],
  },
  {
    group: "navGroups.analytics",
    items: [
      { href: "/analytics/predictions", label: "nav.predictions", icon: "brain", resource: "mlPrediction" },
      { href: "/analytics/simulator", label: "nav.policySimulator", icon: "sliders", resource: "mlPrediction" },
    ],
  },
  {
    group: "navGroups.records",
    items: RECORDS.filter((r) => r.href !== "/documents"),
  },
];

export default async function Shell({ session, children }: { session: SessionClaims; children: React.ReactNode }) {
  const isCitizen = session.role === "LANDOWNER";

  const { locale, t } = await getTranslator();

  const [unread, district, state] = await Promise.all([
    prisma.alert.count({ where: { recipientId: session.id, isRead: false } }),
    session.districtId ? prisma.district.findUnique({ where: { id: session.districtId }, select: { name: true } }) : null,
    session.stateId ? prisma.state.findUnique({ where: { id: session.stateId }, select: { name: true } }) : null,
  ]);

  const allowed = (n: NavDef) =>
    (n.href === "/alerts" || can(session.role, n.resource, n.action ?? "read")) &&
    !(n.officerOnly && isCitizen) &&
    !(n.citizenOnly && !isCitizen);

  // Every citizen and officer can see their own alerts; the permission matrix
  // governs the rest.
  const workspace = !isCitizen && can(session.role, "project", "read");
  // Computed for the page that was loaded; after that the frame follows
  // client-side navigation itself (a layout is not re-rendered by it).
  const project = workspace ? await projectWorkspace(session, (await headers()).get("x-bs-path") ?? "", t) : null;

  const groups: NavGroup[] = (workspace ? WORKSPACE_NAV : FLAT_NAV)
    .map((g) => ({
      group: t(g.group),
      items: g.items.filter(allowed).map(({ href, label, icon }): NavItem =>
        href === "/projects" && workspace
          ? // Lit for the list and the new-project form; a project's own pages light its section.
            { href, label: t(label), icon, exact: true, also: ["/projects/new"], workspace: project ?? undefined }
          : { href, label: t(label), icon },
      ),
    }))
    .filter((g) => g.items.length > 0);

  const jurisdiction =
    session.role === "LANDOWNER"
      ? `${t("shell.citizen")} · ${district?.name ?? state?.name ?? ""}`
      : district
        ? t("shell.districtOf", { district: district.name, state: state?.name ?? "" })
        : state
          ? state.name
          : describeScope(session);

  return (
    <ShellFrame
      groups={groups}
      user={{
        fullName: session.fullName,
        designation: session.designation ?? session.role.replaceAll("_", " ").toLowerCase(),
        jurisdiction,
        isCitizen,
      }}
      unreadAlerts={unread}
      mustChangePassword={session.mustChangePassword}
      locale={locale}
      translatedLocales={[...TRANSLATED]}
      localeCoverage={COVERAGE}
      strings={{
        appName: t("shell.appName"),
        appTagline: t("shell.appTagline"),
        search: t("shell.searchPlaceholder"),
        searchShort: t("common.search"),
        mainNav: t("shell.mainNav"),
        openMenu: t("shell.openMenu"),
        closeMenu: t("shell.closeMenu"),
        collapseMenu: t("shell.collapseMenu"),
        expandMenu: t("shell.expandMenu"),
        alerts: t("nav.alerts"),
        initialPassword: t("shell.initialPassword"),
        changePassword: t("shell.changeItNow"),
        changePasswordMenu: t("shell.changePassword"),
        signOut: t("common.signOut"),
        account: t("shell.myAccount"),
        language: { change: t("shell.changeLanguage"), draft: t("language.draft"), note: t("language.note") },
      }}
    >
      {children}
    </ShellFrame>
  );
}
