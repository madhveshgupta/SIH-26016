import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForParcel } from "@backend/rbac/scope";
import { areaDiscrepancies } from "@backend/gis/parcels";
import { projectsWithLand } from "@backend/projects/land";
import ParcelMapPanel from "@frontend/components/map/ParcelMapPanel";
import { PageHeader, Badge } from "@frontend/components/ui";
import { scopeTitleKey } from "@backend/i18n/scope";
import { getTranslator } from "@backend/i18n/locale";
import { projectCrumbs, type ProjectContext } from "@frontend/lib/project-context";

export default async function ParcelsView({
  project: projectFilter,
  status,
  scoped,
}: {
  /** Preselect one project on the national map (?project=). */
  project?: string;
  status?: string;
  /** Inside a project: the map, conflicts and discrepancies are that project's alone. */
  scoped?: ProjectContext;
}) {
  const s = await requirePermission("parcel", "read");
  const { t } = await getTranslator();
  // Citizens see their own land on /my-land; this is the officers' map.
  if (s.role === "LANDOWNER") redirect("/my-land");
  const project = scoped?.id ?? projectFilter;
  const where = scoped ? { AND: [scopeForParcel(s), { projectId: scoped.id }] } : scopeForParcel(s);

  const [projects, conflicted, candidates] = await Promise.all([
    projectsWithLand(s, scoped?.id),
    // One plot claimed by two projects is two parcel rows, so count the plots rather than the rows.
    prisma.landParcel.findMany({
      where: { AND: [where, { hasConflict: true }] },
      select: { villageId: true, khasraNo: true },
      distinct: ["villageId", "khasraNo"],
    }),
    // The discrepancy report compares the revenue record against the measured boundary, so only
    // plots that have both can appear in it.
    prisma.landParcel.findMany({
      where: {
        AND: [where, { areaFromRecord: true, geometryKind: { not: "ENVELOPE" }, computedAreaHectares: { not: null } }],
      },
      select: { id: true },
    }),
  ]);
  const discrepancies = await areaDiscrepancies(0.01, candidates.map((p) => p.id));
  // A plot claimed by two projects appears once per claim; list the plot once.
  const flagged = discrepancies
    .filter((d) => Math.abs(d.pctDifference) >= 10)
    .filter((d, i, all) => all.findIndex((x) => x.khasraNo === d.khasraNo && x.declared === d.declared) === i);

  const totalParcels = projects.reduce((a, p) => a + p.totals.parcels, 0);
  const totalMapHa = projects.reduce((a, p) => a + p.totals.mapHa, 0);
  const conflicts = conflicted.length;
  const initial = projects.find((p) => p.id === project)?.id ?? null;
  const plots = (n: number) => t(n === 1 ? "screens.globe.plotsOne" : "screens.globe.plotsMany", { count: n });
  const withLand = projects.filter((p) => p.totals.parcels).length;
  const hectares = t("screens.units.ha", { value: totalMapHa.toFixed(2) });

  return (
    <div>
      <PageHeader
        title={t(scopeTitleKey(s, "landMap"))}
        crumbs={scoped ? projectCrumbs(scoped, t("nav.projects"), t("nav.landMap")) : undefined}
        description={
          scoped
            ? t("screens.parcelsList.descScoped", { plots: plots(totalParcels), ha: hectares })
            : t("screens.parcelsList.desc", {
                plots: plots(totalParcels),
                ha: hectares,
                projects: t(withLand === 1 ? "screens.parcelsList.projectsOne" : "screens.parcelsList.projectsMany", { count: withLand }),
              })
        }
        actions={
          conflicts > 0 ? (
            <Badge tone="danger">
              {t(conflicts === 1 ? "screens.parcelsList.conflictsOne" : "screens.parcelsList.conflictsMany", { count: conflicts })}
            </Badge>
          ) : undefined
        }
      />

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[1fr_300px]">
        <ParcelMapPanel
          projects={projects.map((p) => ({
            id: p.id,
            referenceNo: p.referenceNo,
            name: p.name,
            states: p.states.map((x) => x.state),
            parcels: p.totals.parcels,
          }))}
          initialProjectId={initial}
          initialStatus={status ?? null}
          // Inside a project there is one project: no picker, no colour-by-project.
          lockProject={Boolean(scoped)}
          // Fill the window below the header and controls, so the map is all on
          // screen when the page opens; never smaller than a usable map.
          mapHeight={scoped ? "max(420px, calc(100dvh - 300px))" : "max(420px, calc(100dvh - 340px))"}
        />

        <div className="space-y-4">
          {!scoped && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("nav.projects")}</h2>
            <ul className="mt-2 space-y-2">
              {projects.filter((p) => p.totals.parcels > 0).slice(0, 8).map((p) => (
                <li key={p.id} className="text-[11px]">
                  <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <div className="text-muted">
                    {t("screens.parcelsList.projectLine", {
                      states: p.states.filter((x) => !x.outsideScope).map((x) => x.state).join(", "),
                      plots: plots(p.totals.parcels),
                      pct: p.totals.possessedPct,
                    })}
                  </div>
                </li>
              ))}
            </ul>
            {projects.filter((p) => p.totals.parcels > 0).length > 8 && (
              <Link href="/projects" className="mt-3 block text-xs font-medium text-brand hover:underline">
                {t("screens.parcelsList.allProjects", { count: withLand })}
              </Link>
            )}
          </div>
          )}

          {/* Compensation is paid per hectare, so this gap is money. */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("screens.parcelsList.mapVsRecord")}</h2>
            <p className="mt-1 text-[10px] leading-snug text-muted">
              {t("screens.parcelsList.mapVsRecordDesc")}
            </p>
            {flagged.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted">{t("screens.parcelsList.noDiff")}</p>
            ) : (
              <table className="mt-2 w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[10px] text-muted">
                    <th className="pb-1 font-normal">{t("common.khasra")}</th>
                    <th className="pb-1 text-right font-normal">{t("screens.parcelsList.record")}</th>
                    <th className="pb-1 text-right font-normal">{t("screens.parcelsList.map")}</th>
                    <th className="pb-1 text-right font-normal">{t("screens.parcelsList.diff")}</th>
                  </tr>
                </thead>
                <tbody>
                  {flagged.slice(0, 8).map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="py-1 font-mono">{d.khasraNo}</td>
                      <td className="py-1 text-right tabular-nums text-muted">{d.declared.toFixed(4)}</td>
                      <td className="py-1 text-right tabular-nums text-muted">{d.computed.toFixed(4)}</td>
                      <td className={`py-1 text-right tabular-nums font-medium ${d.difference > 0 ? "text-amber-700 dark:text-amber-400" : "text-blue-700 dark:text-blue-400"}`}>
                        {d.pctDifference > 0 ? "+" : ""}
                        {d.pctDifference.toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {flagged.length > 8 && <p className="mt-1 text-[10px] text-muted">{t("screens.parcelsList.more", { count: flagged.length - 8 })}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
