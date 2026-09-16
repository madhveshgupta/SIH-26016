import type { Metadata } from "next";
import { CheckCircle2, Circle, Home, Users } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForFamily } from "@backend/rbac/scope";
import { computeEntitlements, entitlementTotal, RNR_PIPELINE, THIRD_SCHEDULE_AMENITIES, amenityCompletion } from "@backend/rnr/entitlements";
import { formatIndianScale, formatINR } from "@backend/compensation/format";
import { getTranslator } from "@backend/i18n/locale";
import type { MessageKey } from "@backend/i18n";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatTile } from "@frontend/components/ui";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.myEntitlements") };
}

/** The R&R package, on the citizen's own screen. */
export default async function MyEntitlementsPage() {
  const s = await requirePermission("rnr", "read");
  const { t, locale } = await getTranslator();
  const tk = (key: string) => t(key as MessageKey);
  /** A dictionary entry for this entitlement, or the Act's English wording if there is none. */
  const ent = (type: string, suffix: "" | "_KIND" | "_NOTE", english: string | null | undefined) => {
    if (!english) return english ?? null;
    const key = `rnr.entitlement.${type}${suffix}`;
    const text = tk(key);
    return text === key ? english : text;
  };
  const scheduleItem = (english: string) => {
    const m = /^Item (\d+)( proviso)?$/.exec(english);
    return m ? t(m[2] ? "rnr.proviso" : "rnr.item", { n: m[1] }) : english;
  };
  const overview = t("navGroups.overview");

  const families = await prisma.affectedFamily.findMany({
    where: scopeForFamily(s),
    select: {
      id: true, familyHeadName: true, category: true, memberCount: true, isDisplaced: true, status: true,
      livelihoodDependent: true,
      village: { select: { name: true, tehsil: { select: { district: { select: { name: true } } } } } },
      site: true,
      // What has actually been given, against what is owed.
      entitlements: { select: { entitlementType: true, status: true, amount: true } },
    },
  });

  if (families.length === 0) {
    return (
      <div>
        <PageHeader title={t("entitlements.title")} description={t("entitlements.intro")} crumbs={[{ label: overview }, { label: t("entitlements.title") }]} />
        <EmptyState
          icon={<Home className="h-5 w-5" />}
          title={t("entitlements.none")}
          description={t("entitlements.noneHint")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("entitlements.title")}
        description={t("entitlements.intro")}
        crumbs={[{ label: overview }, { label: t("entitlements.title") }]}
      />

      {families.map((family) => {
        const entitlements = computeEntitlements({
          category: family.category,
          isDisplaced: family.isDisplaced,
          livelihoodDependent: family.livelihoodDependent,
          // Land-for-land is owed on an irrigation project; the family's own
          // record does not carry the project, so it is read from the village.
          isIrrigationProject: false,
        });
        const given = new Map(family.entitlements.map((e) => [e.entitlementType, e]));
        const total = entitlementTotal(entitlements);
        const stageIndex = RNR_PIPELINE.indexOf(family.status as (typeof RNR_PIPELINE)[number]);
        const site = family.site as unknown as Record<string, unknown> | null;
        const amenities = site ? amenityCompletion(site) : null;

        return (
          <Card key={family.id}>
            <CardHeader
              title={family.familyHeadName}
              description={`${family.village.name}, ${family.village.tehsil.district.name} · ${t("rnr.members", { count: family.memberCount })} · ${tk(`rnr.category.${family.category}`)}`}
              icon={<Users className="h-4 w-4" />}
              action={<Badge tone={family.isDisplaced ? "warning" : "info"}>{family.isDisplaced ? t("rnr.displaced") : t("rnr.affected")}</Badge>}
            />
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile label={t("entitlements.packageValue")} value={formatIndianScale(total, locale)} hint={t("rnr.entitlementCount", { count: entitlements.length })} />
                <StatTile label={t("entitlements.progress")} value={tk(`rnr.status.${family.status}`)} hint={t("rnr.stepOf", { current: Math.max(1, stageIndex + 1), total: RNR_PIPELINE.length })} tone={family.status === "RESETTLED" || family.status === "LIVELIHOOD_RESTORED" ? "success" : "warning"} />
                <StatTile
                  label={t("entitlements.received")}
                  value={formatIndianScale(family.entitlements.filter((e) => e.status === "PAYMENT_MADE").reduce((a, e) => a + Number(e.amount ?? 0), 0), locale)}
                  hint={t("rnr.settled", { done: family.entitlements.filter((e) => e.status === "PAYMENT_MADE").length, total: entitlements.length })}
                />
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("entitlements.secondSchedule")}</h3>
                <ul className="mt-2 divide-y divide-border">
                  {entitlements.map((e) => (
                    <li key={e.type} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-foreground">{ent(e.type, "", e.label)}</div>
                        <div className="text-xs text-muted">
                          {scheduleItem(e.scheduleItem)}
                          {e.note ? ` · ${ent(e.type, "_NOTE", e.note)}` : ""}
                        </div>
                      </div>
                      <div className="text-right">
                        {e.amount != null ? (
                          <span className="font-medium tabular-nums text-foreground">{formatINR(e.amount)}</span>
                        ) : (
                          <span className="text-sm text-brand">{ent(e.type, "_KIND", e.inKind)}</span>
                        )}
                        <div className="text-[11px] text-muted">
                          {given.has(e.type)
                            ? tk(`rnr.status.${given.get(e.type)!.status}`)
                            : t("entitlements.notProcessed")}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {amenities && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("entitlements.thirdSchedule")} ({amenities.done}/{amenities.total})
                  </h3>
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {THIRD_SCHEDULE_AMENITIES.map((a) => {
                      const provided = Boolean(site?.[a.key]);
                      return (
                        <li key={a.key} className={`flex items-center gap-2 text-xs ${provided ? "text-foreground" : "text-muted"}`}>
                          {provided ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Circle className="h-3.5 w-3.5" />}
                          {tk(`rnr.amenity.${a.key}`)}
                        </li>
                      );
                    })}
                  </ul>
                  {amenities.pct < 100 && (
                    <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                      {t("entitlements.siteIncomplete", { percent: amenities.pct })}
                    </p>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
