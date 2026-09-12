import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@backend/rbac/guard";
import { projectParcelRegister, projectsWithLand } from "@backend/projects/land";
import { corridorReadiness } from "@backend/projects/corridor";
import { getTranslator } from "@backend/i18n/locale";
import type { RoleType } from "@prisma/client";
import { EDITABLE_PROPOSAL, mayChangeProjectLand } from "@backend/projects/land-selection";
import { prisma } from "@backend/db/client";
import { LinkButton } from "@frontend/components/ui";
import ParcelMapPanel from "@frontend/components/map/ParcelMapPanel";
import WhenNear from "@frontend/components/WhenNear";
import ProgressBar from "@frontend/components/ProgressBar";
import CorridorReadiness from "@frontend/components/corridor/CorridorReadiness";
import { STATUS_COLOUR } from "@frontend/components/map/legend";
import { parcelStatusKey } from "@backend/i18n/scope";
import type { MessageKey } from "@backend/i18n";

export const dynamic = "force-dynamic";

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("project", "read");
  const { id } = await params;

  // Scoped lookup: a project outside the viewer's jurisdiction is not found,
  // rather than rendered with its land hidden.
  const [project] = await projectsWithLand(s, id);
  if (!project) notFound();
  const [register, corridor, { t }] = await Promise.all([projectParcelRegister(s, id), corridorReadiness(s, id), getTranslator()]);
  const possessed = (pct: number) => t("screens.projectPage.pctPossessed", { pct });
  const roleLabels = Object.fromEntries(
    corridor?.plots.flatMap((p) => (p.desk ? [[p.desk.role, t(`roles.${p.desk.role satisfies RoleType}`)]] : [])) ?? [],
  );
  // Land can be changed while any of the project's land is still at draft, or
  // when it has none yet.
  const editableLand =
    mayChangeProjectLand(s.role) &&
    (project.totals.parcels === 0 ||
      (await prisma.proposal.count({ where: { projectId: id, status: { in: [...EDITABLE_PROPOSAL] } } })) > 0);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/projects" className="text-[11px] text-muted hover:underline">
          ← {t("nav.projects")}
        </Link>
        <div className="mt-1 font-mono text-[10px] text-muted">{project.referenceNo}</div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
          {editableLand && (
            <LinkButton href={`/projects/${project.id}/land`} size="sm" variant="secondary">
              {t("screens.projectPage.addRemoveLand")}
            </LinkButton>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {t(`screens.projectType.${project.type}` as MessageKey)} · {project.agency}
          {project.ministry ? ` (${project.ministry})` : ""} · {t("screens.projectPage.acquiredUnder", { act: t(`screens.act.${project.governingAct}` as MessageKey) })}
          {project.rightOfWayM ? ` · ${t("screens.projectPage.rightOfWay", { m: project.rightOfWayM })}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label={t("screens.geoMetric.parcels")} value={project.totals.parcels} />
        <Tile label={t("screens.projectPage.areaOnRecord")} value={t("screens.units.ha", { value: project.totals.recordHa.toFixed(2) })} />
        <Tile label={t("screens.projectPage.areaOnMap")} value={t("screens.units.ha", { value: project.totals.mapHa.toFixed(2) })} />
        <Tile label={t("screens.projectPage.possessed")} value={`${project.totals.possessedPct}%`} />
        <Tile label={t("screens.projectPage.claimedByAnother")} value={project.totals.conflicts} alert={project.totals.conflicts > 0} />
      </div>

      {corridor && corridor.plots.length > 0 && <CorridorReadiness data={corridor} roleLabels={roleLabels} />}

      {/* Which state requires what — every state the project needs land in. */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("screens.projectPage.landByState")}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                <th className="pb-2 font-medium">{t("screens.projectPage.colPlace")}</th>
                <th className="pb-2 text-right font-medium">{t("screens.geoMetric.parcels")}</th>
                <th className="pb-2 text-right font-medium">{t("screens.projectPage.colRecordHa")}</th>
                <th className="pb-2 text-right font-medium">{t("screens.projectPage.colMapHa")}</th>
                <th className="pb-2 pl-4 font-medium">{t("screens.projectPage.colProgress")}</th>
                <th className="pb-2 text-right font-medium">{t("screens.dashboard.colConflicts")}</th>
              </tr>
            </thead>
            <tbody>
              {project.states.map((st) => (
                <Fragment key={st.stateId}>
                  <tr className="border-t border-border">
                    <td className="py-2 font-semibold">{st.state}</td>
                    {st.outsideScope ? (
                      <td colSpan={5} className="py-2 text-right text-[11px] text-muted">
                        {project.totals.parcels === 0 ? t("screens.projectPage.noParcelsMapped") : t("screens.projectPage.outsideJurisdiction")}
                      </td>
                    ) : (
                      <Cells row={st} possessed={possessed} />
                    )}
                  </tr>
                  {st.districts.map((d) => (
                    <Fragment key={d.districtId}>
                      <tr className="border-t border-border">
                        <td className="py-1.5 pl-4">{t("screens.projectPage.districtName", { name: d.district })}</td>
                        <Cells row={d} possessed={possessed} />
                      </tr>
                      {d.villages.map((v) => (
                        <tr key={v.villageId} className="text-muted">
                          <td className="py-1 pl-8">{v.village}</td>
                          <Cells row={v} possessed={possessed} />
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("screens.projectPage.map")}</h2>
        {/* Below the project's figures: the globe loads only when scrolled near. */}
        <WhenNear height={560}>
          <ParcelMapPanel
            projects={[{ id: project.id, referenceNo: project.referenceNo, name: project.name, states: project.states.map((x) => x.state), parcels: project.totals.parcels }]}
            initialProjectId={project.id}
            lockProject
          />
        </WhenNear>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("screens.projectPage.register")} <span className="font-normal normal-case">{t("screens.projectPage.registerSub")}</span>
        </h2>
        <div className="mt-3 max-h-[480px] overflow-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                <th className="pb-2 font-medium">{t("screens.projectPage.colChainage")}</th>
                <th className="pb-2 font-medium">{t("common.khasra")}</th>
                <th className="pb-2 font-medium">{t("common.village")}</th>
                <th className="pb-2 font-medium">{t("common.status")}</th>
                <th className="pb-2 text-right font-medium">{t("screens.projectPage.colRecordHa")}</th>
                <th className="pb-2 text-right font-medium">{t("screens.projectPage.colMapHa")}</th>
                <th className="pb-2 text-right font-medium">{t("screens.projectPage.colDiff")}</th>
              </tr>
            </thead>
            <tbody>
              {register.map((r) => {
                const rec = r.areaFromRecord ? Number(r.declaredAreaHectares) : null;
                const map = r.computedAreaHectares == null ? null : Number(r.computedAreaHectares);
                const pct = rec && map != null ? ((map - rec) / rec) * 100 : null;
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1.5 tabular-nums text-muted">
                      {r.chainageM == null ? "—" : `km ${(r.chainageM / 1000).toFixed(2)}`}
                    </td>
                    <td className="py-1.5 font-mono">
                      {r.khasraNo}
                      {r.hasConflict && (
                        <span className="ml-1.5 rounded bg-red-100 px-1 text-[10px] font-sans text-red-700 dark:bg-red-950 dark:text-red-300">
                          {t("screens.projectPage.twoProjects")}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5">{r.village.name}</td>
                    <td className="py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm" style={{ background: STATUS_COLOUR[r.status] }} />
                        {t(parcelStatusKey(r.status))}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{rec == null ? t("screens.projectPage.notPublished") : rec.toFixed(4)}</td>
                    <td className="py-1.5 text-right tabular-nums">{map == null ? "—" : map.toFixed(4)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pct != null && Math.abs(pct) >= 10 ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted"}`}>
                      {pct == null ? "" : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`}
                    </td>
                  </tr>
                );
              })}
              {register.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted">
                    {t("screens.projectPage.noParcelsHere")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted">
          {t("screens.projectPage.sourceNote")}
        </p>
      </section>

      <div className="text-[11px]">
        <Link href={`/proposals?project=${project.id}`} className="underline">
          {t("screens.projectPage.viewProposals")}
        </Link>
      </div>
    </div>
  );
}

function Tile({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-base font-semibold tabular-nums ${alert ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}

function Cells({
  row: t,
  possessed,
}: {
  row: { parcels: number; recordHa: number; mapHa: number; byStatus: Partial<Record<string, number>>; conflicts: number; possessedPct: number };
  possessed: (pct: number) => string;
}) {
  return (
    <>
      <td className="py-1.5 text-right tabular-nums">{t.parcels}</td>
      <td className="py-1.5 text-right tabular-nums">{t.recordHa.toFixed(4)}</td>
      <td className="py-1.5 text-right tabular-nums">{t.mapHa.toFixed(4)}</td>
      <td className="py-1.5 pl-4">
        <div className="flex items-center gap-2">
          <div className="w-32"><ProgressBar byStatus={t.byStatus} total={t.parcels} /></div>
          <span className="text-[10px] text-muted">{possessed(t.possessedPct)}</span>
        </div>
      </td>
      <td className={`py-1.5 text-right tabular-nums ${t.conflicts ? "font-medium text-red-600" : "text-muted"}`}>{t.conflicts}</td>
    </>
  );
}
