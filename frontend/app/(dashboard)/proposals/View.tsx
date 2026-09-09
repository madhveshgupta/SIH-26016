import Link from "next/link";
import { AlarmClock } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForProposal } from "@backend/rbac/scope";
import { computeClock, SEVERITY_ORDER, type ClockSeverity } from "@backend/statutory/clock";
import { stageKey, type MessageKey } from "@backend/i18n";
import { stageFor } from "@backend/workflow/engine";
import { Badge, PageHeader } from "@frontend/components/ui";
import { cn } from "@frontend/lib/cn";
import ProposalTable, { type ProposalRow } from "./ProposalTable";
import { getTranslator } from "@backend/i18n/locale";
import { projectCrumbs, type ProjectContext } from "@frontend/lib/project-context";


export default async function ProposalsView({
  clock: clockFilter,
  project: projectFilter,
  scoped,
}: {
  clock?: string;
  /** Narrow the all-projects list to one project (?project=). */
  project?: string;
  /** Inside a project workspace. */
  scoped?: ProjectContext;
}) {
  const s = await requirePermission("proposal", "read");
  const { t } = await getTranslator();
  const project = scoped?.id ?? projectFilter;
  // Chips keep the viewer where they are: inside the project, or on the list.
  const base = scoped ? `/projects/${scoped.id}/proposals` : "/proposals";
  const withProject = !scoped && project ? `project=${project}` : "";

  const proposals = await prisma.proposal.findMany({
    where: { AND: [scopeForProposal(s), project ? { projectId: project } : {}] },
    include: {
      project: { select: { id: true, name: true, governingAct: true, type: true } },
      stages: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
      _count: { select: { parcels: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Attach the clock, then sort by urgency — the case about to lapse belongs at
  // the top of a collector's screen, not buried by creation date.
  const rows: ProposalRow[] = proposals
    .map((p) => {
      const open = p.stages[0];
      const clock = computeClock(p.project.governingAct, p.status, open?.enteredAt ?? p.createdAt, open?.statutoryDeadline ?? null);
      const stage = stageFor(p.project.governingAct, p.status);
      return {
        id: p.id,
        referenceNo: p.referenceNo,
        project: p.project.name,
        projectId: p.project.id,
        act: t(`screens.act.${p.project.governingAct}` as MessageKey),
        stage: stage ? t(stageKey(p.project.governingAct, p.status)) : p.status.replaceAll("_", " ").toLowerCase(),
        section: stage?.section ?? null,
        areaHa: Number(p.proposedAreaHectares ?? 0),
        parcels: p._count.parcels,
        severity: clock.severity,
        daysRemaining: clock.daysRemaining,
        hasDeadline: Boolean(clock.deadline),
        isFatal: clock.isFatal,
      };
    })
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9));

  const counts = new Map<ClockSeverity, number>();
  for (const r of rows) if (r.hasDeadline) counts.set(r.severity, (counts.get(r.severity) ?? 0) + 1);
  const visible = clockFilter ? rows.filter((r) => r.hasDeadline && r.severity === clockFilter) : rows;
  const projectName = project ? rows[0]?.project : null;

  return (
    <div>
      <PageHeader
        title={t("pages.proposalsTitle")}
        description={t("pageDesc.proposals")}
        crumbs={
          scoped
            ? projectCrumbs(scoped, t("nav.projects"), t("nav.proposals"))
            : [{ label: t("navGroups.casework") }, { label: t("nav.proposals"), href: "/proposals" }, ...(projectName ? [{ label: projectName }] : [])]
        }
        badge={<Badge tone="brand">{rows.length}</Badge>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AlarmClock className="h-4 w-4 text-muted" aria-hidden />
        <FilterChip href={withProject ? `${base}?${withProject}` : base} active={!clockFilter} label={t("common.all")} count={rows.length} />
        {SEVERITY_ORDER.map((sev) => (
          <FilterChip
            key={sev}
            href={`${base}?clock=${sev}${withProject ? `&${withProject}` : ""}`}
            active={clockFilter === sev}
            label={t(`screens.severity.${sev}` as MessageKey)}
            count={counts.get(sev) ?? 0}
          />
        ))}
      </div>

      <ProposalTable rows={visible} />
    </div>
  );
}

function FilterChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition",
        active ? "border-brand bg-brand text-white" : "border-border bg-surface text-foreground hover:border-brand/40",
      )}
    >
      {label}
      <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-white/20" : "bg-surface-muted text-muted")}>{count}</span>
    </Link>
  );
}
