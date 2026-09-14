import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Landmark, Scale, User } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForOptionalParcel } from "@backend/rbac/scope";
import { storedRouteText } from "@backend/grievances/localise";
import type { MessageKey } from "@backend/i18n";
import { rich } from "@frontend/lib/rich";
import { Badge, EmptyState, PageHeader, type Tone } from "@frontend/components/ui";
import { cn } from "@frontend/lib/cn";
import GrievanceActions from "./GrievanceActions";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.grievances") };
}

const TONE: Record<string, Tone> = {
  SUBMITTED: "warning",
  ACKNOWLEDGED: "info",
  UNDER_EXAMINATION: "info",
  REFERRED: "brand",
  RESOLVED: "success",
  REJECTED: "neutral",
  WITHDRAWN: "neutral",
};

/**
 * What citizens have raised that is not a s.15 objection — the amount, the measurement, the map,
 * a missing entitlement, an unpaid award.
 */
export default async function GrievancesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const s = await requirePermission("grievance", "read");
  const { show } = await searchParams;
  const { t, intl } = await getTranslator();
  const tk = (key: string) => t(key as MessageKey);
  const day = (d: Date) => d.toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" });
  const level = s.role === "LANDOWNER" ? "mine" : (s.jurisdictionLevel ?? "NATIONAL").toLowerCase();

  const rows = await prisma.grievance.findMany({
    where: scopeForOptionalParcel(s),
    include: {
      parcel: { select: { khasraNo: true, village: { select: { name: true } } } },
      proposal: { select: { id: true, referenceNo: true, project: { select: { name: true } } } },
      filedByUser: { select: { fullName: true } },
      assignedTo: { select: { fullName: true } },
    },
    orderBy: [{ decidedAt: { sort: "asc", nulls: "first" } }, { filedAt: "desc" }],
    take: 200,
  });

  const open = rows.filter((r) => !r.decidedAt && r.status !== "WITHDRAWN");
  // Yours to answer: the Act gives each category to one authority, and this is
  // the subset this role is that authority for.
  const mine = open.filter((r) => r.authorityRole === s.role || s.role === "SUPER_ADMIN");
  const visible = show === "closed" ? rows.filter((r) => r.decidedAt) : show === "all" ? rows : open;
  const mayAct = can(s.role, "grievance", "approve");

  return (
    <div>
      <PageHeader
        title={tk(`screens.grvPage.title_${level}`)}
        description={t("screens.grvPage.desc")}
        crumbs={[{ label: t("navGroups.land") }, { label: t("nav.grievances") }]}
        badge={<Badge tone="brand">{rows.length}</Badge>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {[
          { key: undefined, label: t("screens.grvPage.open"), count: open.length },
          { key: "closed", label: t("screens.grvPage.closed"), count: rows.length - open.length },
          { key: "all", label: t("common.all"), count: rows.length },
        ].map((f) => (
          <Link
            key={f.label}
            href={f.key ? `/grievances?show=${f.key}` : "/grievances"}
            className={cn(
              "rounded-full border px-3 py-1",
              show === f.key
                ? "border-brand bg-brand text-white"
                : "border-border bg-surface text-foreground hover:bg-surface-muted",
            )}
          >
            {f.label} <span className="ml-1 tabular-nums opacity-70">{f.count}</span>
          </Link>
        ))}
        <span className="ml-auto text-muted">{t("screens.grvPage.forYou", { count: mine.length })}</span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title={t("screens.grvPage.nothing")}
          description={t("screens.grvPage.nothingDesc")}
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((g) => {
            const yours = g.authorityRole === s.role || s.role === "SUPER_ADMIN";
            const live = !g.decidedAt && g.status !== "WITHDRAWN";
            return (
              <li key={g.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {tk(`screens.objPage.cat_${g.category}`)}
                      {g.objectionId && (
                        <Badge tone="brand" icon={<Scale className="h-3 w-3" />}>{t("screens.grvPage.alsoS15")}</Badge>
                      )}
                      {!yours && <Badge tone="neutral">{t("screens.grvPage.notYours")}</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span className="font-mono">{g.referenceNo}</span>
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" aria-hidden />
                        {g.filedByUser.fullName}
                      </span>
                      {g.proposal && (
                        <Link href={`/proposals/${g.proposal.id}`} className="font-mono text-brand hover:underline">
                          {g.proposal.referenceNo}
                        </Link>
                      )}
                      {g.parcel && (
                        <span>
                          {rich(t("screens.objPage.khasraOf"), {
                            no: <span className="font-mono">{g.parcel.khasraNo}</span>,
                            village: g.parcel.village.name,
                          })}
                        </span>
                      )}
                      <span>{t("screens.objPage.raisedOn", { date: day(g.filedAt) })}</span>
                    </div>
                  </div>
                  <Badge tone={TONE[g.status] ?? "neutral"}>{tk(`screens.objPage.gst_${g.status}`)}</Badge>
                </div>

                <p className="mt-2 flex gap-2 text-xs leading-relaxed text-muted">
                  <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    {t("screens.objPage.withAuthority", {
                      section: storedRouteText(t, g.statuteSection),
                      authority: storedRouteText(t, g.authorityLabel),
                    })}
                    {g.assignedTo ? ` (${g.assignedTo.fullName})` : ` — ${t("screens.grvPage.noOfficer")}`}
                  </span>
                </p>

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-brand">{t("screens.grvPage.read")}</summary>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted p-3 font-mono text-[11px] leading-relaxed text-foreground">
                    {g.representation}
                  </pre>
                </details>

                {live && mayAct && yours && (
                  <div className="mt-3 flex justify-end border-t border-border pt-3">
                    <GrievanceActions id={g.id} reference={g.referenceNo} />
                  </div>
                )}

                {g.decidedAt && (
                  <div className="mt-3 rounded-lg bg-surface-muted p-3 text-xs">
                    <div className="font-medium">{g.decision}</div>
                    <div className="mt-1 leading-relaxed text-muted">
                      <span className="font-medium text-foreground">{t("screens.objPage.reasons")} </span>
                      {g.decisionReasons}
                    </div>
                    <div className="mt-1 text-muted">{t("screens.grvPage.disposed", { date: day(g.decidedAt) })}</div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
