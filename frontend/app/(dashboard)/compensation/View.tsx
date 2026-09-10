import Link from "next/link";
import { Banknote, Calculator, Landmark, TriangleAlert } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { getTranslator } from "@backend/i18n/locale";
import { projectCrumbs, type ProjectContext } from "@frontend/lib/project-context";
import type { MessageKey } from "@backend/i18n";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForDistrict } from "@backend/rbac/scope";
import { calculateCompensation } from "@backend/compensation/calculator";
import { formatIndianScale, formatINR } from "@backend/compensation/format";
import { disbursementQueue, reconciliation } from "@backend/compensation/disbursement";
import CompensationBreakdownView from "@frontend/components/CompensationBreakdown";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatTile, type Tone } from "@frontend/components/ui";
import { DisburseButton, SettleButton } from "./DisburseActions";


const PAYMENT_TONE: Record<string, Tone> = {
  PAID: "success",
  DEPOSITED_WITH_AUTHORITY: "info",
  INSTRUCTED: "warning",
  PARTIALLY_PAID: "warning",
  FAILED: "danger",
  DISPUTED: "danger",
  PENDING: "neutral",
};

const PAYMENT_LABEL: Record<string, MessageKey> = {
  PAID: "officerCompensation.statusPaid",
  DEPOSITED_WITH_AUTHORITY: "officerCompensation.statusDeposited",
  INSTRUCTED: "officerCompensation.statusInstructed",
  PARTIALLY_PAID: "officerCompensation.statusPartiallyPaid",
  FAILED: "officerCompensation.statusFailed",
  DISPUTED: "officerCompensation.statusDisputed",
  PENDING: "officerCompensation.statusPending",
};

export default async function CompensationView({ project }: { project?: ProjectContext }) {
  const s = await requirePermission("compensation", "read");
  const mayPay = can(s.role, "payment", "approve");
  const { t, intl, locale } = await getTranslator();
  const money = (n: number) => formatIndianScale(n, locale);

  const [totals, queue, district] = await Promise.all([
    reconciliation(s, project?.id),
    disbursementQueue(s, 60, project?.id),
    prisma.district.findFirst({
      where: { AND: [scopeForDistrict(s), { circleRatePerHectare: { not: null } }] },
      include: { state: { select: { name: true } } },
    }),
  ]);

  const inFlight = queue.filter((r) => r.payments.some((p) => p.status === "INSTRUCTED")).length;
  const paidPct = totals.assessed ? Math.round(((totals.paid + totals.deposited) / totals.assessed) * 100) : 0;

  // The worked example keeps the calculator inspectable, whatever the data holds.
  const example = district?.circleRatePerHectare
    ? calculateCompensation({
        areaHectares: 1.25,
        circleRatePerHectare: Number(district.circleRatePerHectare),
        multiplierFactor: Number(district.multiplierFactor),
        assets: { trees: 450_000, wells: 300_000, standingCrop: 85_000 },
        // Fixed dates, so a worked example yields the same interest on every render.
        siaNotificationDate: new Date("2025-08-13T00:00:00.000Z"),
        awardDate: new Date("2026-09-17T00:00:00.000Z"),
      })
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("pages.compensationTitle")}
        description={t("officerCompensation.description")}
        crumbs={project ? projectCrumbs(project, t("nav.projects"), t("nav.compensation")) : [{ label: t("navGroups.entitlements") }, { label: t("nav.compensation") }]}
        actions={mayPay && inFlight > 0 ? <SettleButton count={inFlight} projectId={project?.id} /> : undefined}
      />

      <section aria-label={t("pages.compensationTitle")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("officerCompensation.assessed")} value={money(totals.assessed)} hint={t("officerCompensation.recordsCount", { count: totals.records })} icon={<Calculator className="h-4 w-4" />} />
        <StatTile label={t("officerCompensation.paidToOwners")} value={money(totals.paid)} hint={t("officerCompensation.pctOfAssessed", { percent: paidPct })} icon={<Banknote className="h-4 w-4" />} tone="success" />
        <StatTile label={t("officerCompensation.depositedWithAuthority")} value={money(totals.deposited)} hint={t("officerCompensation.depositedHint")} icon={<Landmark className="h-4 w-4" />} tone="info" />
        <StatTile label={t("officerCompensation.outstanding")} value={money(totals.outstanding)} hint={t("officerCompensation.outstandingHint")} icon={<TriangleAlert className="h-4 w-4" />} tone={totals.outstanding > 0 ? "danger" : "success"} />
      </section>

      {(totals.failed > 0 || totals.instructed > 0) && (
        <div className="flex flex-wrap gap-3 text-xs">
          {totals.instructed > 0 && (
            <span className="rounded-lg bg-warning-soft px-3 py-2 text-warning">
              {t("screens.comp.withBank", { amount: money(totals.instructed) })}
            </span>
          )}
          {totals.failed > 0 && (
            <span className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
              {t("screens.comp.rejected", { amount: money(totals.failed) })}
            </span>
          )}
        </div>
      )}

      <Card>
        <CardHeader
          title={t("officerCompensation.disbursement")}
          description={mayPay ? t("officerCompensation.disbursementHintPay") : t("officerCompensation.disbursementHintView")}
          icon={<Banknote className="h-4 w-4" />}
        />
        {queue.length === 0 ? (
          <CardBody><EmptyState title={t("officerCompensation.nothingAssessed")} description={t("officerCompensation.nothingAssessedHint")} /></CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 text-left font-semibold">{t("officerCompensation.colOwner")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("officerCompensation.colPlot")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("officerCompensation.colAward")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("officerCompensation.colPayable")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("common.status")}</th>
                  {mayPay && <th className="px-5 py-2.5 text-right font-semibold">{t("officerCompensation.colAction")}</th>}
                </tr>
              </thead>
              <tbody>
                {queue.map((r) => {
                  const latest = r.payments[0];
                  const settled = r.payments.some((p) => p.status === "PAID" || p.status === "DEPOSITED_WITH_AUTHORITY");
                  const status = latest?.status ?? "PENDING";
                  return (
                    <tr key={r.id} className="border-t border-border align-top">
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-foreground">{r.owner.fullName}</div>
                        <div className="text-[11px] text-muted">
                          {/* Both halves or neither: an account number without an
                              IFSC cannot be paid into. */}
                          {r.owner.bankAccountMasked && r.owner.bankIfsc
                            ? `${r.owner.bankAccountMasked} · ${r.owner.bankIfsc}`
                            : t("officerCompensation.noBankAccount")}
                          {Number(r.ownerSharePct) < 100 && ` · ${t("screens.comp.shareOf", { pct: Number(r.ownerSharePct).toFixed(0) })}`}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/parcels/${r.parcel.id}`} className="font-mono text-xs text-brand hover:underline">{r.parcel.khasraNo}</Link>
                        <div className="text-[11px] text-muted">{r.parcel.village.name}, {r.parcel.district.name}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {r.award ? (
                          <>
                            <div className="font-mono">{r.award.awardNo}</div>
                            <div className="text-[11px] text-muted">{r.award.declaredOn.toISOString().slice(0, 10)}</div>
                          </>
                        ) : (
                          <span className="text-muted">{t("screens.comp.notDeclared")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatINR(Number(r.payableToOwner))}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={PAYMENT_TONE[status] ?? "neutral"}>{PAYMENT_LABEL[status] ? t(PAYMENT_LABEL[status]) : status}</Badge>
                        {latest?.utrNumber && <div className="mt-1 font-mono text-[10px] text-muted">UTR {latest.utrNumber}</div>}
                        {latest?.failureReason && <div className="mt-1 max-w-[220px] text-[10px] leading-snug text-danger">{latest.failureReason}</div>}
                      </td>
                      {mayPay && (
                        <td className="px-5 py-2.5 text-right">
                          {settled ? (
                            <span className="text-[11px] text-muted">{t("screens.comp.settled")}</span>
                          ) : !r.awardId ? (
                            <span className="text-[11px] text-muted">{t("screens.comp.awaitingAward")}</span>
                          ) : status === "INSTRUCTED" ? (
                            <span className="text-[11px] text-muted">{t("screens.comp.withBankShort")}</span>
                          ) : (
                            <DisburseButton
                              compensationId={r.id}
                              amount={money(Number(r.payableToOwner))}
                              owner={r.owner.fullName}
                              // Nothing to pay into: s.77 is the only lawful route.
                              payable={Boolean(r.owner.bankAccountMasked && r.owner.bankIfsc)}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totals.byDistrict.length > 1 && (
        <Card>
          <CardHeader title={t("screens.comp.byDistrict")} description={t("screens.comp.byDistrictDesc")} icon={<Landmark className="h-4 w-4" />} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 text-left font-semibold">{t("common.district")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("screens.reportCol.records")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("officerCompensation.assessed")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("status.paid")}</th>
                  <th className="px-5 py-2.5 text-right font-semibold">{t("officerCompensation.outstanding")}</th>
                </tr>
              </thead>
              <tbody>
                {totals.byDistrict.slice(0, 12).map((d) => (
                  <tr key={`${d.state}-${d.district}`} className="border-t border-border">
                    <td className="px-5 py-2.5">{d.district}<span className="text-[11px] text-muted"> · {d.state}</span></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{d.records}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(d.assessed)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(d.paid)}</td>
                    <td className={`px-5 py-2.5 text-right tabular-nums ${d.outstanding > 0 ? "font-medium text-danger" : "text-muted"}`}>{money(d.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {example && district && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader
              title={t("screens.comp.howBuilt")}
              description={t("screens.comp.workedExample", { place: `${district.name}, ${district.state.name}` })}
              icon={<Calculator className="h-4 w-4" />}
            />
            <CardBody><CompensationBreakdownView breakdown={example} t={t} intl={intl} locale={locale} /></CardBody>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title={t("screens.comp.inputs")} />
              <CardBody>
                <dl className="space-y-2 text-xs">
                  {[
                    [t("common.district"), `${district.name}, ${district.state.name}`],
                    [t("screens.comp.circleRate"), t("screens.comp.perHa", { rate: Number(district.circleRatePerHectare).toLocaleString(intl) })],
                    [t("screens.masters.multLabel"), `×${Number(district.multiplierFactor).toFixed(2)}`],
                    [t("screens.comp.classification"), district.isUrban ? t("screens.comp.urbanMult") : t("screens.masters.rural")],
                    [
                      t("screens.comp.basis"),
                      t(example.marketValueBasis === "CIRCLE_RATE" ? "award.basisCircleRate" : example.marketValueBasis === "SALE_DEEDS_TOP_50PCT" ? "award.basisSaleDeeds" : "award.basisConsented"),
                    ],
                    [t("screens.comp.interestPeriod"), t("screens.comp.days", { n: example.interestDays })],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-muted">{k}</dt>
                      <dd className="text-right text-foreground">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-xs leading-relaxed text-muted">
                <strong className="text-foreground">{t("screens.comp.whyMatters")}</strong> {t("screens.comp.whyMattersText")}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
