import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Info, MapPin, Split, Smartphone } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForParcel } from "@backend/rbac/scope";
import { boundaryPoints } from "@backend/gis/vertices";
import { findConflictingParcels } from "@backend/gis/postgis";
import { formatIndianScale } from "@backend/compensation/calculator";
import { STATUS_COLOUR, STATUS_TONE } from "@frontend/components/map/legend";
import PlotRecord from "@frontend/components/map/PlotRecord";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@frontend/components/ui";
import type { Tone } from "@frontend/components/ui/Badge";
import BoundaryPanel from "./BoundaryPanel";
import { getTranslator } from "@backend/i18n/locale";
import { parcelStatusKey } from "@backend/i18n/scope";
import type { MessageKey } from "@backend/i18n";
import { rich } from "@frontend/lib/rich";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("screens.tab.landParcel") };
}

/** Where the outline came from; the wording is screens.plotRecord.src_<KIND>. */
const SOURCE_TONE: Record<string, Tone> = {
  TRACED: "success", SURVEYED: "success", OSM_FIELD: "info", GENERATED: "warning", ENVELOPE: "warning",
};

export default async function ParcelDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePermission("parcel", "read");
  const { t, intl, locale } = await getTranslator();
  const { id } = await params;
  const parcel = await prisma.landParcel.findFirst({
    where: { AND: [{ id }, scopeForParcel(s)] },
    include: {
      project: { select: { id: true, name: true, referenceNo: true } },
      proposal: { select: { id: true, referenceNo: true } },
      village: { select: { name: true, tehsil: { select: { name: true } } } },
      district: { select: { name: true, state: { select: { name: true } } } },
      owners: { include: { owner: { select: { fullName: true, userId: true } } } },
      compensations: { select: { payableToOwner: true, payments: { select: { amount: true, status: true } } } },
    },
  });
  if (!parcel) notFound();

  const [points, conflicts, surveys] = await Promise.all([
    boundaryPoints(id),
    findConflictingParcels(id),
    prisma.fieldSurvey.findMany({
      where: { parcelId: id },
      orderBy: { capturedAt: "desc" },
      take: 10,
      select: {
        id: true, kind: true, capturedAt: true, syncedAt: true, notes: true, signedBy: true,
        walkedAreaHectares: true, accuracyM: true, boundary: true, photos: true, findings: true,
        surveyor: { select: { fullName: true } },
      },
    }),
  ]);
  const otherProjects = conflicts.length
    ? await prisma.project.findMany({ where: { id: { in: conflicts.map((c) => c.projectId) } }, select: { id: true, name: true } })
    : [];
  const kind = SOURCE_TONE[parcel.geometryKind] ? parcel.geometryKind : "ENVELOPE";
  const source = {
    label: t(`screens.plotRecord.src_${kind}` as MessageKey),
    tone: SOURCE_TONE[kind],
    text: t(`screens.plotRecord.src_${kind}_text` as MessageKey),
  };
  const khasra = t("screens.parcelPage.khasraTitle", { no: parcel.khasraNo });
  const record = parcel.areaFromRecord ? Number(parcel.declaredAreaHectares) : null;
  const mapped = parcel.computedAreaHectares == null ? null : Number(parcel.computedAreaHectares);
  const diffPct = record && mapped != null ? ((mapped - record) / record) * 100 : null;
  const assessed = parcel.compensations.reduce((a, c) => a + Number(c.payableToOwner), 0);
  const paid = parcel.compensations.flatMap((c) => c.payments).filter((p) => p.status === "PAID").reduce((a, p) => a + Number(p.amount), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={khasra}
        description={t("screens.parcelPage.location", {
          village: parcel.village.name, tehsil: parcel.village.tehsil.name, district: parcel.district.name, state: parcel.district.state.name,
        })}
        crumbs={[{ label: t("nav.landMap"), href: `/parcels?project=${parcel.project.id}` }, { label: parcel.project.name, href: `/projects/${parcel.project.id}` }, { label: khasra }]}
        badge={
          <>
            <Badge tone={STATUS_TONE[parcel.status] ?? "neutral"} icon={<span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOUR[parcel.status] }} />}>{t(parcelStatusKey(parcel.status))}</Badge>
            <Badge tone={source.tone}>{source.label}</Badge>
          </>
        }
      />

      {conflicts.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          <Split className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">{t("screens.parcelPage.conflictTitle")}</div>
            <div className="mt-0.5 text-foreground/80">
              {rich(t("screens.parcelPage.conflictText"), {
                projects: otherProjects.map((p, i) => (
                  <span key={p.id}>{i > 0 && ", "}<Link href={`/projects/${p.id}`} className="underline">{p.name}</Link></span>
                )),
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("screens.parcelPage.factRecordArea")} value={record == null ? t("screens.plotRecord.notPublished") : t("screens.units.ha", { value: record.toFixed(4) })} />
        <Fact label={t("screens.parcelPage.factMapArea")} value={mapped == null ? "—" : t("screens.units.ha", { value: mapped.toFixed(4) })} hint={diffPct != null ? t("screens.parcelPage.vsRecord", { pct: `${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}` }) : undefined} alert={diffPct != null && Math.abs(diffPct) >= 10} />
        <Fact label="ULPIN / PNIU" value={parcel.ulpin ?? "—"} mono />
        <Fact label={t("screens.plotRecord.compensation")} value={assessed ? formatIndianScale(paid, locale) : t("screens.parcelPage.notAssessed")} hint={assessed ? t("screens.parcelPage.paidOf", { amount: formatIndianScale(assessed, locale) }) : undefined} />
      </div>

      {/* The complete record — ownership, compensation, awards, objections,
          project, provenance, nearby plots and the audit trail — as tabs. */}
      <PlotRecord key={parcel.id} plotId={parcel.id} />

      {surveys.length > 0 && (
        <Card>
          <CardHeader
            title={t("screens.plotRecord.fieldSurveys")}
            description={t("screens.parcelPage.surveysDesc")}
            icon={<Smartphone className="h-4 w-4" />}
          />
          <ul className="divide-y divide-border">
            {surveys.map((survey) => {
              const walked = survey.walkedAreaHectares == null ? null : Number(survey.walkedAreaHectares);
              const gap = walked && record ? ((walked - record) / record) * 100 : null;
              const photos = Array.isArray(survey.photos) ? (survey.photos as { lat: number; lng: number }[]) : [];
              const points = Array.isArray(survey.boundary) ? (survey.boundary as [number, number][]) : [];
              const offlineMinutes = Math.round((survey.syncedAt.getTime() - survey.capturedAt.getTime()) / 60000);
              const findings = (survey.findings ?? {}) as Record<string, string | null>;
              return (
                <li key={survey.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{t(`screens.surveyKind.${survey.kind}` as MessageKey)}</span>
                    <span className="text-xs text-muted">
                      {survey.surveyor.fullName} ·{" "}
                      {t("screens.parcelPage.captured", { date: survey.capturedAt.toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" }) })}
                      {offlineMinutes > 5 && (
                        <>
                          {" · "}
                          {offlineMinutes >= 120
                            ? t("screens.parcelPage.syncedHours", { n: Math.round(offlineMinutes / 60) })
                            : t("screens.parcelPage.syncedMinutes", { n: offlineMinutes })}
                        </>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {points.length > 0 && (
                      <span>
                        {t("screens.parcelPage.boundaryPointsN", { count: points.length })}
                        {survey.accuracyM ? ` · ${t("screens.parcelPage.gps", { m: Number(survey.accuracyM).toFixed(0) })}` : ""}
                      </span>
                    )}
                    {walked !== null && (
                      <span className={gap !== null && Math.abs(gap) > 10 ? "font-medium text-warning" : ""}>
                        {t("screens.parcelPage.walked", { ha: walked.toFixed(4) })}
                        {gap !== null && ` · ${t("screens.parcelPage.againstRecord", { pct: `${gap > 0 ? "+" : ""}${gap.toFixed(1)}` })}`}
                      </span>
                    )}
                    {photos.length > 0 && <span>{t("screens.parcelPage.photos", { count: photos.length })}</span>}
                    {survey.signedBy && <span>{t("screens.parcelPage.signedBy", { name: survey.signedBy })}</span>}
                  </div>
                  {(findings.structures || findings.trees || findings.standingCrop) && (
                    <div className="mt-1 text-xs text-foreground">
                      {[
                        findings.structures && t("screens.parcelPage.structures", { v: findings.structures }),
                        findings.trees && t("screens.parcelPage.trees", { v: findings.trees }),
                        findings.standingCrop && t("screens.parcelPage.crop", { v: findings.standingCrop }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                  {survey.notes && <p className="mt-1 text-xs leading-relaxed text-muted">{survey.notes}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title={t("screens.parcelPage.boundary")} description={t("screens.parcelPage.boundaryDesc")} icon={<MapPin className="h-4 w-4" />} />
        <CardBody>
          {points.length ? <BoundaryPanel parcelId={parcel.id} points={points} colour={STATUS_COLOUR[parcel.status]} /> : <EmptyState title={t("screens.plotRecord.noBoundary")} description={t("screens.plotRecord.noBoundaryDesc")} />}
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {source.text}
            {parcel.boundaryAccuracyM != null && ` ${t("screens.parcelPage.largestDev", { m: Number(parcel.boundaryAccuracyM).toFixed(2) })}`}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function Fact({ label, value, hint, alert, mono }: { label: string; value: string; hint?: string; alert?: boolean; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-base font-semibold ${mono ? "font-mono text-sm" : "tabular-nums"}`}>{value}</div>
      {hint && <div className={`mt-0.5 text-xs ${alert ? "font-medium text-warning" : "text-muted"}`}>{hint}</div>}
    </div>
  );
}
