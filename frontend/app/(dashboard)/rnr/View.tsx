import Link from "next/link";
import type { RnRStatus } from "@prisma/client";
import {
  ArrowRight, Check, ChevronDown, HeartHandshake, House, IndianRupee, ListChecks, MapPin, Scale, TriangleAlert, Users, X,
} from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { isNational, scopeForFamily } from "@backend/rbac/scope";
import {
  RNR_PIPELINE, SECOND_SCHEDULE, THIRD_SCHEDULE_AMENITIES, amenityCompletion,
} from "@backend/rnr/entitlements";
import { formatIndianScale, formatINR } from "@backend/compensation/format";
import { getTranslator } from "@backend/i18n/locale";
import type { MessageKey } from "@backend/i18n";
import { rich } from "@frontend/lib/rich";
import { projectCrumbs, sectionPath, type ProjectContext } from "@frontend/lib/project-context";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatTile, type Tone } from "@frontend/components/ui";
import { cn } from "@frontend/lib/cn";


const FAMILY_LIMIT = 20;


const STATUS_TONE: Record<string, Tone> = {
  IDENTIFIED: "neutral",
  ENTITLEMENT_DETERMINED: "info",
  AWARD_PASSED: "info",
  PAYMENT_MADE: "brand",
  RESETTLED: "brand",
  LIVELIHOOD_RESTORED: "success",
  DISPUTED: "danger",
};

const ALL_STATUSES = [...RNR_PIPELINE, "DISPUTED"] as const;
const isStatus = (v: string | undefined): v is RnRStatus => Boolean(v && (ALL_STATUSES as readonly string[]).includes(v));

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

export default async function RnRView({ status: rawStatus, project }: { status?: string; project?: ProjectContext }) {
  const s = await requirePermission("rnr", "read");
  const { t, intl, locale } = await getTranslator();
  const tk = (key: string) => t(key as MessageKey);
  /** A coded value by its dictionary name, or the given fallback when the dictionary has none. */
  const named = (key: string, fallback: string | null | undefined) => {
    const text = tk(key);
    return text === key ? fallback ?? null : text;
  };
  const stageName = (st: string) => named(`rnr.status.${st}`, st)!;
  const category = (c: string) => named(`rnr.category.${c}`, c)!;
  const scheduleItem = (english: string) => {
    const m = /^Item (\d+)( proviso)?$/.exec(english);
    return m ? t(m[2] ? "rnr.proviso" : "rnr.item", { n: m[1] }) : english;
  };
  const num = (n: number) => n.toLocaleString(intl);
  const base = sectionPath(project, "rnr", "/rnr");
  const status = isStatus(rawStatus) ? rawStatus : undefined;

  // Inside a project: families who own a plot in it, or live in a village it
  // takes land from — the landless labourer owns nothing but is still affected.
  const scope = project
    ? {
        AND: [
          scopeForFamily(s),
          {
            OR: [
              { owner: { parcels: { some: { parcel: { projectId: project.id } } } } },
              { village: { parcels: { some: { projectId: project.id } } } },
            ],
          },
        ],
      }
    : scopeForFamily(s);
  const listWhere = { AND: [scope, status ? { status } : {}] };

  const [byStatus, byCategory, displaced, total, members, sites, entitlementSum, families, listed] = await Promise.all([
    prisma.affectedFamily.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.affectedFamily.groupBy({ by: ["category", "isDisplaced"], where: scope, _count: { _all: true } }),
    prisma.affectedFamily.count({ where: { AND: [scope, { isDisplaced: true }] } }),
    prisma.affectedFamily.count({ where: scope }),
    prisma.affectedFamily.aggregate({ where: scope, _sum: { memberCount: true } }),
    // Sites carry no geography of their own; an officer sees the ones their families were moved to.
    prisma.resettlementSite.findMany({
      where: isNational(s) && !project ? {} : { families: { some: scope } },
      include: { _count: { select: { families: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.rnREntitlement.aggregate({ where: { family: scope }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.affectedFamily.findMany({
      where: listWhere,
      // Postgres orders enums by declaration: least-progressed families first.
      orderBy: [{ status: "asc" }, { familyHeadName: "asc" }],
      take: FAMILY_LIMIT,
      include: {
        village: { select: { name: true } },
        site: { select: { name: true } },
        entitlements: { select: { amount: true } },
      },
    }),
    prisma.affectedFamily.count({ where: listWhere }),
  ]);

  const statusCount = (st: string) => byStatus.find((x) => x.status === st)?._count._all ?? 0;
  const restored = statusCount("LIVELIHOOD_RESTORED");
  const disputed = statusCount("DISPUTED");
  const people = members._sum.memberCount ?? 0;

  // A family at "Resettled" has also passed every earlier stage, so each bar shows everyone who has
  // got at least that far.
  const reached = RNR_PIPELINE.map((_, i) => RNR_PIPELINE.slice(i).reduce((sum, st) => sum + statusCount(st), 0));

  const categories = Object.entries(
    byCategory.reduce<Record<string, { all: number; displaced: number }>>((acc, row) => {
      const c = (acc[row.category] ??= { all: 0, displaced: 0 });
      c.all += row._count._all;
      if (row.isDisplaced) c.displaced += row._count._all;
      return acc;
    }, {}),
  ).sort((a, b) => b[1].all - a[1].all);
  const largestCategory = categories[0]?.[1].all ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("pages.rehabilitationTitle")}
        description={t("screens.rnrPage.desc")}
        crumbs={project ? projectCrumbs(project, t("nav.projects"), t("nav.rehabilitation")) : [{ label: t("navGroups.entitlements") }, { label: t("nav.rehabilitation") }]}
      />

      <section aria-label={t("screens.rnrPage.summary")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("screens.rnrPage.affected")}
          value={num(total)}
          hint={t("screens.rnrPage.affectedHint", { people: num(people) })}
          icon={<Users className="h-4 w-4" />}
        />
        <StatTile
          label={t("screens.rnrPage.displaced")}
          value={num(displaced)}
          hint={t("screens.rnrPage.displacedHint", { pct: pct(displaced, total) })}
          icon={<House className="h-4 w-4" />}
          tone="warning"
        />
        <StatTile
          label={stageName("LIVELIHOOD_RESTORED")}
          value={`${pct(restored, total)}%`}
          hint={t("screens.rnrPage.restoredHint", { done: num(restored), total: num(total) })}
          icon={<HeartHandshake className="h-4 w-4" />}
          tone={total > 0 && restored === total ? "success" : "info"}
          href={`${base}?status=LIVELIHOOD_RESTORED#families`}
        />
        <StatTile
          label={t("screens.rnrPage.owed")}
          value={formatIndianScale(Number(entitlementSum._sum.amount ?? 0), locale)}
          hint={t("screens.rnrPage.owedHint", { count: num(entitlementSum._count._all) })}
          icon={<IndianRupee className="h-4 w-4" />}
          tone="success"
        />
      </section>

      {disputed > 0 && (
        <Link
          href={`${base}?status=DISPUTED#families`}
          className="flex items-center gap-2 rounded-lg bg-danger-soft px-4 py-2.5 text-sm text-danger hover:underline"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {rich(t(disputed === 1 ? "screens.rnrPage.disputingOne" : "screens.rnrPage.disputingMany"), { count: <strong>{disputed}</strong> })}
          </span>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0" aria-hidden />
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title={t("screens.rnrPage.whereTitle")}
            description={t("screens.rnrPage.whereDesc")}
            icon={<ListChecks className="h-4 w-4" />}
          />
          <CardBody>
            {total === 0 ? (
              <EmptyState title={t("screens.rnrPage.noFamilies")} description={t("screens.rnrPage.noFamiliesDesc")} />
            ) : (
              <ol className="space-y-1">
                {RNR_PIPELINE.map((st, i) => {
                  const here = statusCount(st);
                  const isFinal = st === "LIVELIHOOD_RESTORED";
                  const active = status === st;
                  return (
                    <li key={st}>
                      <Link
                        href={active ? `${base}#families` : `${base}?status=${st}#families`}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-2 py-2 transition hover:bg-surface-muted sm:grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)]",
                          active && "bg-brand-soft hover:bg-brand-soft",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                            isFinal ? "bg-success text-white" : "bg-surface-muted text-muted",
                          )}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0">
                          <span className={cn("block text-sm", isFinal ? "font-semibold text-foreground" : "font-medium text-foreground")}>
                            {stageName(st)}
                          </span>
                          <span className="block text-xs text-muted">{tk(`screens.rnrPage.stage_${st}`)}</span>
                        </span>
                        <span className="col-start-2 mt-1.5 flex items-center gap-3 sm:col-start-3 sm:mt-0">
                          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                            <span
                              className={cn("block h-full rounded-full", isFinal ? "bg-success" : "bg-brand")}
                              style={{ width: `${pct(reached[i], total)}%` }}
                            />
                          </span>
                          <span className="w-24 shrink-0 text-right text-xs tabular-nums">
                            <span className="font-semibold text-foreground">{reached[i]}</span>
                            <span className="text-muted"> · {t("screens.rnrPage.hereN", { count: here })}</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={t("screens.rnrPage.whoTitle")}
            description={t("screens.rnrPage.whoDesc")}
            icon={<Users className="h-4 w-4" />}
          />
          <CardBody>
            {categories.length === 0 ? (
              <p className="text-sm text-muted">{t("screens.rnrPage.noneRecorded")}</p>
            ) : (
              <ul className="space-y-3">
                {categories.map(([cat, c]) => (
                  <li key={cat}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-foreground">{category(cat)}</span>
                        {(cat === "SC" || cat === "ST") && <Badge tone="accent">ss.41–42</Badge>}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-semibold">{c.all}</span>
                        {c.displaced > 0 && <span className="text-xs text-muted"> · {t("screens.rnrPage.displacedN", { count: c.displaced })}</span>}
                      </span>
                    </div>
                    <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-muted" title={t("screens.rnrPage.displacedOf", { displaced: c.displaced, total: c.all })}>
                      <span className="bg-warning" style={{ width: `${pct(c.displaced, largestCategory)}%` }} />
                      <span className="bg-brand" style={{ width: `${pct(c.all - c.displaced, largestCategory)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px] text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />{t("rnr.displaced")}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" />{t("screens.rnrPage.staying")}</span>
              <span>{t("screens.rnrPage.scst")}</span>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <div id="families" className="scroll-mt-20" />
        <CardHeader
          title={status ? t("screens.rnrPage.familiesAt", { stage: stageName(status) }) : t("screens.rnrPage.families")}
          description={
            listed > FAMILY_LIMIT
              ? t("screens.rnrPage.showingOf", { shown: FAMILY_LIMIT, total: num(listed) })
              : t("screens.rnrPage.leastFirst")
          }
          icon={<Users className="h-4 w-4" />}
          action={
            status && (
              <Link href={`${base}#families`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                <X className="h-3.5 w-3.5" aria-hidden /> {t("screens.rnrPage.clearFilter")}
              </Link>
            )
          }
        />
        {families.length === 0 ? (
          <CardBody>
            <EmptyState
              title={status ? t("screens.rnrPage.noneAt", { stage: stageName(status) }) : t("screens.rnrPage.noFamilies")}
              description={status ? t("screens.rnrPage.tryAnother") : t("screens.rnrPage.noFamiliesDesc")}
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 text-left font-semibold">{t("screens.rnrPage.colHead")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("screens.rnrPage.colCategory")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("screens.rnrPage.colSituation")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("screens.rnrPage.colEntitled")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("screens.rnrPage.colResettled")}</th>
                  <th className="px-5 py-2.5 text-left font-semibold">{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => {
                  const owed = f.entitlements.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
                  return (
                    <tr key={f.id} className="border-t border-border align-top">
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-foreground">{f.familyHeadName}</div>
                        <div className="flex items-center gap-1 text-[11px] text-muted">
                          <MapPin className="h-3 w-3" aria-hidden />
                          {f.village.name} · {t(f.memberCount === 1 ? "screens.rnrPage.memberOne" : "screens.rnrPage.memberMany", { count: f.memberCount })}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs">{category(f.category)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {f.isDisplaced ? <Badge tone="warning">{t("rnr.displaced")}</Badge> : <Badge>{t("screens.rnrPage.stayingTag")}</Badge>}
                          {f.livelihoodDependent && <Badge tone="info">{t("screens.rnrPage.livelihoodLost")}</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {f.entitlements.length === 0 ? (
                          <span className="text-xs text-muted">{t("screens.rnrPage.notComputed")}</span>
                        ) : (
                          <>
                            <div className="font-medium">{formatINR(owed)}</div>
                            <div className="text-[11px] text-muted">{t(f.entitlements.length === 1 ? "screens.rnrPage.itemOne" : "screens.rnrPage.itemMany", { count: f.entitlements.length })}</div>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {f.site?.name ?? <span className="text-muted">{f.isDisplaced ? t("screens.rnrPage.notAllotted") : t("screens.rnrPage.na")}</span>}
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge tone={STATUS_TONE[f.status] ?? "neutral"}>{stageName(f.status)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <section aria-labelledby="sites-heading" className="space-y-3">
        <div>
          <h2 id="sites-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <House className="h-4 w-4 text-brand" aria-hidden /> {t("screens.rnrPage.sites")}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {t("screens.rnrPage.sitesDesc")}
          </p>
        </div>
        {sites.length === 0 ? (
          <EmptyState title={t("screens.rnrPage.noSites")} description={t("screens.rnrPage.noSitesDesc")} icon={<House className="h-5 w-5" />} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sites.map((site) => {
              const a = amenityCompletion(site as unknown as Record<string, unknown>);
              const complete = a.pct === 100;
              const allotPct = pct(site.allottedPlots, site.totalPlots);
              const occupied = site.allottedPlots > 0 || site._count.families > 0;
              return (
                <Card key={site.id} className={cn(!complete && occupied && "border-danger/40")}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-foreground">{site.name}</h3>
                        <p className="text-xs text-muted">
                          {t(site._count.families === 1 ? "screens.rnrPage.assignedOne" : "screens.rnrPage.assignedMany", { count: site._count.families })}
                        </p>
                      </div>
                      <Badge tone={complete ? "success" : "danger"}>
                        {t("screens.rnrPage.amenities", { done: a.done, total: a.total })}
                      </Badge>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted">{t("screens.rnrPage.plotsAllotted")}</span>
                        <span className="tabular-nums">
                          <span className="font-medium">{site.allottedPlots}</span>
                          <span className="text-muted"> {t("screens.rnrPage.ofTotal", { total: site.totalPlots })}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${allotPct}%` }} />
                      </div>
                    </div>

                    <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                      {THIRD_SCHEDULE_AMENITIES.map((am) => {
                        const has = Boolean((site as unknown as Record<string, unknown>)[am.key]);
                        return (
                          <li key={am.key} className={cn("flex items-center gap-2 text-xs", has ? "text-foreground" : "text-danger")}>
                            <span
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                                has ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
                              )}
                            >
                              {has ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                            </span>
                            {named(`rnr.amenity.${am.key}`, am.label)}
                            <span className="sr-only">{has ? t("screens.rnrPage.provided") : t("screens.rnrPage.missing")}</span>
                          </li>
                        );
                      })}
                    </ul>

                    {!complete && occupied && (
                      <p className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>
                          {a.missing.length === 1
                            ? t("screens.rnrPage.missingOne")
                            : t("screens.rnrPage.missingMany", { count: a.missing.length })}
                        </span>
                      </p>
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Card>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-start gap-2.5">
              <Scale className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{t("screens.rnrPage.guarantees")}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {t("screens.rnrPage.guaranteesDesc")}
                </span>
              </span>
            </span>
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 text-left font-semibold">{t("screens.rnrPage.colEntitlement")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("screens.rnrPage.colWho")}</th>
                  <th className="px-5 py-2.5 text-right font-semibold">{t("screens.plotRecord.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {SECOND_SCHEDULE.map((r) => (
                  <tr key={r.type} className="border-t border-border align-top">
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-foreground">{named(`rnr.entitlement.${r.type}`, r.label)}</div>
                      <div className="text-[11px] text-muted">
                        {scheduleItem(r.scheduleItem)}
                        {r.note && ` · ${named(`rnr.entitlement.${r.type}_NOTE`, r.note)}`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{named(`screens.rnrPage.who_${r.type}`, r.who)}</td>
                    <td className="px-5 py-2.5 text-right text-xs tabular-nums">
                      {r.amount ? <span className="font-medium">{formatINR(r.amount)}</span> : <span className="text-muted">{r.inKind ? named(`rnr.entitlement.${r.type}_KIND`, r.inKind) : t("screens.rnrPage.inKind")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
    </div>
  );
}
