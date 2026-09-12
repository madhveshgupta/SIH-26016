import Link from "next/link";
import { requirePermission } from "@backend/rbac/guard";
import { projectsWithLand } from "@backend/projects/land";
import { mayCreateProjects } from "@backend/projects/land-selection";
import { EmptyState, LinkButton, PageHeader } from "@frontend/components/ui";
import ProgressBar from "@frontend/components/ProgressBar";
import type { MessageKey } from "@backend/i18n";
import { scopeTitleKey } from "@backend/i18n/scope";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const s = await requirePermission("project", "read");
  const { t } = await getTranslator();
  const projects = await projectsWithLand(s);

  // State → the projects that require land in it.
  const byState = new Map<string, typeof projects>();
  for (const p of projects) {
    for (const st of p.states) byState.set(st.state, [...(byState.get(st.state) ?? []), p]);
    const none = t("screens.projectsList.stateNotRecorded");
    if (p.states.length === 0) byState.set(none, [...(byState.get(none) ?? []), p]);
  }
  const groups = [...byState.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div>
      <PageHeader
        title={t(scopeTitleKey(s, "projects"))}
        description={t(projects.length === 1 ? "screens.projectsList.countOne" : "screens.projectsList.countMany", { count: projects.length })}
        actions={
          mayCreateProjects(s.role) ? (
            <LinkButton href="/projects/new" size="sm">
              {t("screens.projectsList.newProject")}
            </LinkButton>
          ) : undefined
        }
      />

      {groups.length === 0 && (
        <EmptyState
          title={t("screens.projectsList.noProjects")}
          description={t("screens.projectsList.noProjectsDesc")}
        />
      )}

      <div className="mt-5 space-y-6">
        {groups.map(([state, list]) => (
          <section key={state}>
            <h2 className="flex items-baseline gap-2 text-sm font-semibold">
              {state}
              <span className="text-xs font-normal text-muted">
                {t(list.length === 1 ? "screens.projectsList.stateCountOne" : "screens.projectsList.stateCountMany", { count: list.length })}
              </span>
            </h2>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {list.map((p) => {
                const here = p.states.find((x) => x.state === state)!;
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="block rounded-lg border border-border bg-surface p-4 transition hover:border-neutral-400 dark:hover:border-neutral-600"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-[10px] text-muted">{p.referenceNo}</div>
                        <div className="mt-0.5 text-sm font-medium">{p.name}</div>
                      </div>
                      <span className="shrink-0 rounded bg-surface-muted px-2 py-0.5 text-[10px] text-foreground">
                        {t(`screens.projectType.${p.type}` as MessageKey)}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted">
                      {p.agency} · {t(`screens.act.${p.governingAct}` as MessageKey)}
                      {p.states.length > 1 && ` · ${t("screens.projectsList.spans", { states: p.states.map((x) => x.state).join(", ") })}`}
                    </div>

                    {here.outsideScope ? (
                      <p className="mt-3 text-[11px] text-muted">
                        {here.parcels === 0 && p.totals.parcels === 0
                          ? t("screens.projectsList.noParcelsYet")
                          : t("screens.projectsList.outsideState")}
                      </p>
                    ) : (
                      <>
                        <div className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
                          <Stat label={t("screens.geoMetric.parcels")} value={here.parcels} />
                          <Stat label={t("screens.projectsList.areaMap")} value={t("screens.units.ha", { value: here.mapHa.toFixed(2) })} />
                          <Stat label={t("screens.projectPage.possessed")} value={`${here.possessedPct}%`} />
                          <Stat label={t("screens.dashboard.colConflicts")} value={here.conflicts} alert={here.conflicts > 0} />
                        </div>
                        <div className="mt-3">
                          <ProgressBar byStatus={here.byStatus} total={here.parcels} />
                        </div>
                        <div className="mt-2 text-[10px] text-muted">
                          {here.districts.map((d) => `${d.district} (${d.villages.map((v) => v.village).join(", ")})`).join(" · ")}
                        </div>
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className={`mt-0.5 font-medium tabular-nums ${alert ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}
