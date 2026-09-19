import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import type { ParcelStatus } from "@prisma/client";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel } from "@backend/rbac/scope";
import { parcelShapes } from "@backend/gis/parcels";
import { OPEN_OBJECTION, objectionWindow, type ObjectionWindow } from "@backend/statutory/notifications";
import { getTranslator } from "@backend/i18n/locale";
import { formatDate, type MessageKey } from "@backend/i18n";
import { Badge, EmptyState, LinkButton, PageHeader, type Tone } from "@frontend/components/ui";
import FileObjectionButton from "./FileObjectionButton";
import PlotTimeline from "./PlotTimeline";
import MyLandMap from "@frontend/components/map/MyLandMap";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.myLand") };
}

/** The citizen view. */
/** Each parcel status as a dictionary key, so the card and timeline agree. */
const STATUS_KEY: Record<ParcelStatus, MessageKey> = {
  PROPOSED: "stages.proposed",
  NOTIFIED: "stages.notified",
  OBJECTED: "stages.underObjection",
  AWARD_DECLARED: "stages.awardDeclared",
  COMPENSATED: "stages.compensated",
  POSSESSED: "stages.possessed",
  DISPUTED: "stages.disputed",
  WITHDRAWN: "stages.withdrawn",
};

const STATUS_TONE: Record<ParcelStatus, Tone> = {
  PROPOSED: "neutral",
  NOTIFIED: "warning",
  OBJECTED: "info",
  AWARD_DECLARED: "brand",
  COMPENSATED: "success",
  POSSESSED: "success",
  DISPUTED: "danger",
  WITHDRAWN: "neutral",
};

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Why objections are not being taken, in the reader's language. */
function windowReason(t: Translate, w: ObjectionWindow | undefined, day: (d: Date) => string): string {
  switch (w?.code) {
    case "NOT_YET": return t("plot.windowNotYet");
    case "OVER": return t("plot.windowOver");
    case "CLOSED": return w.closesAt ? t("plot.windowClosed", { date: day(w.closesAt) }) : t("plot.windowOver");
    case "NOT_FOUND": return t("plot.windowUnknown");
    default: return t("myLand.notOpen");
  }
}

const STAGE_LABELS = (t: Translate): Record<string, string> =>
  Object.fromEntries((Object.keys(STATUS_KEY) as ParcelStatus[]).map((k) => [k, t(STATUS_KEY[k])]));

/** The representation a citizen can file as-is or edit. */
function formalTemplate(
  t: Translate,
  v: { authority: string; khasra: string; village: string; district: string; reference: string; name: string },
): string {
  return [
    t("objectionTemplate.to"),
    v.authority,
    "",
    t("objectionTemplate.subject", { khasra: v.khasra, village: v.village }),
    t("objectionTemplate.reference", { reference: v.reference }),
    "",
    t("objectionTemplate.opening"),
    "",
    t("objectionTemplate.groundsHeading"),
    t("objectionTemplate.groundPrompt"),
    "",
    t("objectionTemplate.prayer"),
    "",
    t("objectionTemplate.yours"),
    t("objectionTemplate.signature", {
      name: v.name,
      khasra: v.khasra,
      village: v.village,
      district: v.district,
    }),
  ].join("\n");
}

export default async function MyLandPage({
  searchParams,
}: {
  searchParams: Promise<{ plot?: string }>;
}) {
  const s = await requirePermission("parcel", "read");
  const { plot } = await searchParams;
  const { locale, t } = await getTranslator();
  const day = (d: Date) => formatDate(locale, d);

  const parcels = await prisma.landParcel.findMany({
    where: scopeForParcel(s),
    include: {
      village: { select: { name: true, nameLocal: true } },
      district: { select: { name: true } },
      project: { select: { name: true, referenceNo: true, governingAct: true } },
      proposal: { select: { id: true, referenceNo: true } },
      objections: { where: { ...OPEN_OBJECTION, filedByUserId: s.id }, select: { id: true } },
    },
    take: 50,
  });

  // Map shapes for the same parcels.
  const shapes = await parcelShapes(parcels.map((p) => p.id));
  const shapeById = new Map(shapes.map((sh) => [sh.id, sh]));
  const selected = (plot && shapeById.get(plot)) || null;
  const selectedParcel = selected ? parcels.find((p) => p.id === selected.id) : undefined;

  // One objection window per case, not per plot.
  const windows = new Map<string, ObjectionWindow>();
  for (const id of new Set(parcels.flatMap((p) => (p.proposalId ? [p.proposalId] : [])))) {
    windows.set(id, await objectionWindow(id));
  }

  const mine = await prisma.objection.findMany({
    where: { OR: [{ filedByUserId: s.id }, { parcel: scopeForParcel(s) }] },
    include: {
      parcel: { select: { khasraNo: true, village: { select: { name: true } } } },
      proposal: { select: { referenceNo: true } },
    },
    orderBy: { filedAt: "desc" },
  });

  const mayObject = can(s.role, "objection", "create");

  return (
    <div>
      <PageHeader
        title={t("myLand.title")}
        description={t("myLand.intro")}
        crumbs={[{ label: t("navGroups.overview") }, { label: t("myLand.title") }]}
      />

      {parcels.length === 0 ? (
        <EmptyState title={t("myLand.empty")} />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {parcels.map((p) => {
            const w = p.proposalId ? windows.get(p.proposalId) : undefined;
            const nh = p.project.governingAct === "NH_ACT_1956";
            const shape = shapeById.get(p.id);
            const on = selected?.id === p.id;
            const section = nh ? t("plot.sectionNh") : t("plot.sectionLarr");
            const reference = p.proposal?.referenceNo ?? p.project.referenceNo;
            const authority = nh ? t("objectionTemplate.authorityNh") : t("objectionTemplate.authorityLarr");

            return (
              <li
                key={p.id}
                className={`overflow-hidden rounded-2xl border bg-surface shadow-sm transition ${on ? "border-warning ring-2 ring-warning/25" : "border-border"}`}
              >
                {/* Header: what the plot is, and how to find it on the map. */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-muted/50 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-semibold text-foreground">{p.khasraNo}</span>
                      <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{t(STATUS_KEY[p.status])}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {p.village.nameLocal ?? p.village.name} · {p.district.name}
                    </div>
                  </div>

                  {shape && (
                    <LinkButton
                      href={on ? "/my-land#plot-map" : `/my-land?plot=${p.id}#plot-map`}
                      size="sm"
                      variant={on ? "accent" : "secondary"}
                      icon={<MapPin className="h-4 w-4" />}
                    >
                      {t("myLand.viewOnMap")}
                    </LinkButton>
                  )}
                </div>

                <div className="space-y-4 px-5 py-4">
                  {/* Facts a citizen checks first: how much land, which project. */}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted">{t("common.area")} (ha)</dt>
                      <dd className="mt-0.5 tabular-nums text-foreground">{Number(p.declaredAreaHectares).toFixed(4)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted">{t("common.project")}</dt>
                      <dd className="mt-0.5 truncate text-foreground" title={p.project.name}>{p.project.name}</dd>
                    </div>
                    {reference && (
                      <div className="col-span-2">
                        <dt className="text-xs text-muted">{t("objectionTemplate.reference", { reference: "" }).replace(/:\s*$/, "")}</dt>
                        <dd className="mt-0.5 font-mono text-xs text-foreground">{reference}</dd>
                      </div>
                    )}
                    {shape && (
                      <div className="col-span-2">
                        <dt className="text-xs text-muted">{t("myLand.mapTitle")}</dt>
                        <dd className="mt-0.5 font-mono text-[11px] text-muted">
                          {shape.lat.toFixed(6)}° N, {shape.lng.toFixed(6)}° E
                        </dd>
                      </div>
                    )}
                  </dl>

                  <div className="border-t border-border pt-4">
                    <PlotTimeline
                      status={p.status}
                      labels={{
                        title: t("timeline.title"),
                        hint: t("timeline.hint"),
                        current: t("timeline.current"),
                        stageOf: t("timeline.stageOf"),
                        stages: STAGE_LABELS(t),
                        offPathNote:
                          p.status === "WITHDRAWN"
                            ? t("timeline.withdrawnNote")
                            : p.status === "DISPUTED"
                              ? t("timeline.disputedNote")
                              : null,
                      }}
                    />
                  </div>

                  {/* The objection sits at the end of the record, where someone
                      has just read how far their acquisition has gone. */}
                  <div className="border-t border-border pt-4">
                    {p.objections.length > 0 ? (
                      <Badge tone="info">{t("myLand.objectionPending")}</Badge>
                    ) : w?.open && mayObject && p.status !== "WITHDRAWN" ? (
                      <div className="space-y-2">
                        <FileObjectionButton
                          parcelId={p.id}
                          khasraNo={p.khasraNo}
                          village={p.village.name}
                          closesOn={w.closesAt ? t("objection.windowCloses", { date: day(w.closesAt) }) : null}
                          section={section}
                          labels={{
                            dialogTitle: t("objection.dialogTitle", { khasra: p.khasraNo, village: p.village.name }),
                            filedUnder: t("objection.filedUnder", { section }),
                            grounds: t("objection.grounds"),
                            groundsHint: t("objection.groundsHint"),
                            commonGrounds: t("objection.commonGrounds"),
                            file: t("objection.file"),
                            cancel: t("common.cancel"),
                            filed: t("objection.filed"),
                            filedMessage: t("objection.filedMessage"),
                            examples: [t("plot.groundPurpose"), t("plot.groundArea"), t("plot.groundAssets"), t("plot.groundPersons")],
                            useTemplate: t("objectionTemplate.useTemplate"),
                            writeOwn: t("objectionTemplate.writeOwn"),
                            routedTo: t("objectionTemplate.routedTo", { authority, reference: reference ?? "—" }),
                            template: formalTemplate(t, {
                              authority,
                              khasra: p.khasraNo,
                              village: p.village.name,
                              district: p.district.name,
                              reference: reference ?? "—",
                              name: s.fullName,
                            }),
                          }}
                        />
                        {w.closesAt && (
                          <div className="text-xs text-warning">{t("myLand.closesOn", { date: day(w.closesAt) })}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">{windowReason(t, w, day)}</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {parcels.length > 0 && (
        <MyLandMap
          title={t("myLand.globeTitle")}
          intro={t("myLand.mapIntro")}
          empty={t("myLand.mapEmpty")}
          labels={{
            loading: t("globe.loading"),
            acquisition: t("globe.acquisition"),
            plots: t("globe.plots"),
            satellite: t("globe.satellite"),
            street: t("globe.street"),
            fullScreen: t("globe.fullScreen"),
            exitFullScreen: t("globe.exitFullScreen"),
            openFull: t("globe.openFull"),
            exitFull: t("globe.exitFull"),
            rightOfWay: t("globe.rightOfWay"),
            loadingGlobe: t("globe.loadingGlobe"),
            loadingLand: t("globe.loadingLand"),
            loadFailed: t("globe.loadFailed"),
            noParcels: t("globe.noParcels"),
            hint: t("globe.hint"),
            close: t("globe.close"),
          }}
          selected={selectedParcel ? { id: selectedParcel.id, projectId: selectedParcel.projectId } : null}
        />
      )}

      <h2 className="mt-6 text-sm font-semibold">{t("myLand.myObjections")}</h2>
      {mine.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("myLand.noObjections")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {mine.map((o) => (
            <li key={o.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-xs text-muted">
                  <span className="font-mono">{o.proposal.referenceNo}</span>
                  {o.parcel && <> · {t("plot.objectionOn", { khasra: o.parcel.khasraNo, village: o.parcel.village.name })}</>}
                  {" · "}{t("plot.filedOn", { date: day(o.filedAt) })}
                </div>
                <Badge tone={o.decidedAt ? (o.status === "REJECTED" ? "neutral" : "success") : "info"}>{t(`objectionStatus.${o.status}`)}</Badge>
              </div>
              <p className="mt-2">{o.grounds}</p>
              {!o.decidedAt && (
                <p className="mt-2 text-xs text-muted">
                  {o.hearingDate
                    ? t("myLand.yourHearing", { date: day(o.hearingDate) })
                    : t("myLand.hearingWillBeGiven")}
                </p>
              )}
              {o.decidedAt && (
                <div className="mt-2 rounded-lg bg-surface-muted p-3 text-xs">
                  <div className="font-medium">{o.decision}</div>
                  <div className="mt-1 text-muted"><span className="font-medium text-foreground">{t("myLand.reasons")}: </span>{o.decisionReasons}</div>
                  {o.status === "ACCEPTED" && <div className="mt-1 text-success">{t("myLand.acceptedOutcome")}</div>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 rounded-xl border border-border bg-surface p-4 text-xs leading-relaxed text-muted">
        <strong className="text-foreground">{t("myLand.rightsTitle")}</strong> {t("myLand.rights")}
      </div>
    </div>
  );
}
