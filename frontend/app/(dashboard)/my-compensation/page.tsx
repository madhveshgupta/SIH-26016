import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Landmark, Scale, TriangleAlert } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForParcel } from "@backend/rbac/scope";
import { formatIndianScale, formatINR } from "@backend/compensation/format";
import { getTranslator } from "@backend/i18n/locale";
import { formatDate, type MessageKey } from "@backend/i18n";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatTile, type Tone } from "@frontend/components/ui";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.myCompensation") };
}

const PAYMENT_TONE: Record<string, Tone> = {
  PAID: "success", DEPOSITED_WITH_AUTHORITY: "info", INSTRUCTED: "warning",
  PARTIALLY_PAID: "warning", FAILED: "danger", DISPUTED: "danger", PENDING: "neutral",
};


/** What the landowner is owed, how it was worked out, and where it is. */
export default async function MyCompensationPage() {
  const s = await requirePermission("compensation", "read");
  const { locale, t } = await getTranslator();
  const day = (d: Date) => formatDate(locale, d);
  const payLabel = (status: string) => t(`award.pay${status}` as MessageKey);
  const BASIS: Record<string, MessageKey> = {
    CIRCLE_RATE: "award.basisCircleRate",
    SALE_DEEDS_TOP_50PCT: "award.basisSaleDeeds",
    CONSENTED_AMOUNT: "award.basisConsented",
  };

  const records = await prisma.compensationRecord.findMany({
    where: {
      // Ownership, not geography: their own records, wherever the land is.
      AND: [{ parcel: scopeForParcel(s) }, s.ownerId ? { ownerId: s.ownerId } : {}],
    },
    orderBy: { assessedAt: "desc" },
    select: {
      id: true, marketValuePerHectare: true, marketValueBasis: true, areaHectares: true,
      multiplierFactor: true, landValue: true, assetsSubtotal: true, solatium: true, interestAmount: true,
      totalCompensation: true, payableToOwner: true,
      ownerSharePct: true, assessedAt: true,
      award: { select: { awardNo: true, declaredOn: true } },
      parcel: {
        select: {
          id: true, khasraNo: true, status: true,
          village: { select: { name: true } }, district: { select: { name: true } },
          project: { select: { name: true } },
        },
      },
      payments: { orderBy: { createdAt: "desc" }, select: { amount: true, status: true, utrNumber: true, paidAt: true, failureReason: true } },
    },
  });

  const assessed = records.reduce((a, r) => a + Number(r.payableToOwner), 0);
  const received = records.reduce(
    (a, r) => a + r.payments.filter((p) => p.status === "PAID").reduce((b, p) => b + Number(p.amount), 0),
    0,
  );
  const held = records.reduce(
    (a, r) => a + r.payments.filter((p) => p.status === "DEPOSITED_WITH_AUTHORITY").reduce((b, p) => b + Number(p.amount), 0),
    0,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("compensation.title")}
        description={t("compensation.intro")}
        crumbs={[{ label: t("navGroups.overview") }, { label: t("compensation.title") }]}
      />

      {records.length === 0 ? (
        <EmptyState
          icon={<Banknote className="h-5 w-5" />}
          title={t("compensation.nothingYet")}
          description={t("compensation.nothingYetHint")}
        />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <StatTile label={t("compensation.assessedForYou")} value={formatIndianScale(assessed, locale)} hint={t("award.plots", { count: records.length })} icon={<Banknote className="h-4 w-4" />} />
            <StatTile label={t("compensation.received")} value={formatIndianScale(received, locale)} hint={assessed ? t("award.pctOfOwed", { percent: Math.round((received / assessed) * 100) }) : undefined} icon={<Banknote className="h-4 w-4" />} tone="success" />
            <StatTile label={t("compensation.heldByAuthority")} value={formatIndianScale(held, locale)} hint={t("compensation.heldHint")} icon={<Landmark className="h-4 w-4" />} tone={held > 0 ? "info" : "neutral"} />
          </section>

          {records.map((r) => {
            const latest = r.payments[0];
            const area = Number(r.areaHectares);
            // Every figure is the stored one from the award record, not
            // re-derived here: a page that recomputes can disagree with the
            // award it is explaining.
            const marketValue = Number(r.marketValuePerHectare) * area;
            const multiplied = Number(r.landValue);
            const assets = Number(r.assetsSubtotal);
            const solatium = Number(r.solatium);
            const interest = Number(r.interestAmount);
            const total = Number(r.totalCompensation);

            return (
              <Card key={r.id}>
                <CardHeader
                  title={t("award.khasraTitle", { khasra: r.parcel.khasraNo, village: r.parcel.village.name })}
                  description={`${r.parcel.project.name} · ${r.parcel.district.name} · ${area.toFixed(4)} ha`}
                  action={<Badge tone={PAYMENT_TONE[latest?.status ?? "PENDING"]}>{payLabel(latest?.status ?? "PENDING")}</Badge>}
                />
                <CardBody className="space-y-4">
                  <table className="w-full text-sm">
                    <tbody>
                      {[
                        [t("compensation.marketValue"), t("award.marketValueDetail", { rate: formatINR(Number(r.marketValuePerHectare)), area: area.toFixed(4) }), marketValue, t("award.marketValueBasis", { basis: BASIS[r.marketValueBasis] ? t(BASIS[r.marketValueBasis]) : r.marketValueBasis })],
                        [`${t("compensation.multiplier")} ×${Number(r.multiplierFactor).toFixed(2)}`, t("award.multiplierDetail"), multiplied - marketValue, t("screens.misc.firstSchedule")],
                        [t("compensation.assets"), t("award.assetsDetail"), assets, "ss.27–29"],
                        [t("compensation.solatium"), t("award.solatiumDetail"), solatium, "s.30(1)"],
                        [t("compensation.interest"), t("award.interestDetail"), interest, "s.30(3)"],
                      ].map(([label, detail, amount, section]) => (
                        <tr key={String(label)} className="border-b border-border last:border-0">
                          <td className="py-2 pr-3">
                            <div className="text-foreground">{label as string}</div>
                            <div className="text-xs text-muted">{detail as string}</div>
                          </td>
                          <td className="py-2 text-right align-top">
                            <div className="tabular-nums text-foreground">{formatINR(Number(amount))}</div>
                            <div className="text-[11px] text-muted">{section as string}</div>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border">
                        <td className="py-2 font-semibold text-foreground">{t("compensation.totalForPlot")}</td>
                        <td className="py-2 text-right font-semibold tabular-nums text-foreground">{formatINR(total)}</td>
                      </tr>
                      {Number(r.ownerSharePct) < 100 && (
                        <tr>
                          <td className="py-2 text-foreground">
                            {t("compensation.yourShare")}
                            <div className="text-xs text-muted">{t("award.jointlyHeld", { percent: Number(r.ownerSharePct).toFixed(0) })}</div>
                          </td>
                          <td className="py-2 text-right font-semibold tabular-nums text-brand">{formatINR(Number(r.payableToOwner))}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  <div className="rounded-lg bg-surface-muted p-3 text-xs">
                    {latest?.status === "PAID" && t("award.paid", { date: latest.paidAt ? day(latest.paidAt) : "—", utr: latest.utrNumber ?? "—" })}
                    {latest?.status === "DEPOSITED_WITH_AUTHORITY" && t("award.deposited")}
                    {latest?.status === "INSTRUCTED" && t("award.instructed", { date: latest.paidAt ? day(latest.paidAt) : "—", utr: latest.utrNumber ?? "—" })}
                    {latest?.status === "FAILED" && <span className="text-danger">{t("award.failed")}</span>}
                    {(!latest || latest.status === "PENDING") && (
                      <>
                        {t("compensation.notPaidYet")}
                        {r.award && <> {t("award.awardRef", { number: r.award.awardNo, date: day(r.award.declaredOn) })}</>}
                      </>
                    )}
                    {/* The recorded reason is an officer's note, kept as written. */}
                    {latest?.failureReason && (latest.status === "FAILED" || latest.status === "DEPOSITED_WITH_AUTHORITY") && (
                      <span className="mt-1 block text-muted">{latest.failureReason}</span>
                    )}
                  </div>

                  <p className="flex items-start gap-1.5 text-xs text-muted">
                    <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {t("award.disagree")}{" "}
                      <Link href="/my-land" className="text-brand hover:underline">{t("award.disagreeLink")}</Link>
                    </span>
                  </p>
                </CardBody>
              </Card>
            );
          })}

          {assessed > received + held && (
            <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {t("award.unpaidWarning", { amount: formatIndianScale(assessed - received - held, locale) })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
