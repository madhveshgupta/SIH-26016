import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BookOpen, Brain, Gavel, IndianRupee, TriangleAlert } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { storedPredictions } from "@backend/ml/scoring";
import { mlServiceHealth } from "@backend/ml/client";
import { formatIndianScale } from "@backend/compensation/format";
import { Badge, Card, CardBody, CardHeader, EmptyState, LinkButton, PageHeader, StatTile, type Tone } from "@frontend/components/ui";
import { cn } from "@frontend/lib/cn";
import RescoreButton from "./RescoreButton";
import { describeFactor, inWords, listOf, type Factor } from "./explain";
import { getTranslator } from "@backend/i18n/locale";
import type { Locale, MessageKey } from "@backend/i18n";
import { rich } from "@frontend/lib/rich";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.predictions") };
}

const HIGH = 0.66;
const MEDIUM = 0.33;
const COURT = 0.5;

/** The verdict an officer reads first, in words rather than a probability. */
const VERDICT = (risk: number | null): { label: MessageKey; tone: Tone; bar: string } =>
  risk === null ? { label: "screens.predictions.vNotChecked", tone: "neutral", bar: "bg-border" }
  : risk >= HIGH ? { label: "screens.predictions.vLate", tone: "danger", bar: "bg-danger" }
  : risk >= MEDIUM ? { label: "screens.predictions.vSome", tone: "warning", bar: "bg-warning" }
  : { label: "screens.predictions.vOnTrack", tone: "success", bar: "bg-success" };

type Show = "all" | "late" | "court" | "unusual";
const SHOWS: Show[] = ["all", "late", "court", "unusual"];

export default async function PredictionsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const s = await requirePermission("mlPrediction", "read");
  const { t, intl, locale } = await getTranslator();
  const raw = (await searchParams).show;
  const show: Show = SHOWS.includes(raw as Show) ? (raw as Show) : "all";
  const [rows, health] = await Promise.all([storedPredictions(s, 120), mlServiceHealth()]);

  const scored = rows.filter((r) => r.delayRisk !== null);
  const late = scored.filter((r) => (r.delayRisk ?? 0) >= HIGH);
  const court = scored.filter((r) => (r.litigationRisk ?? 0) >= COURT);
  const unusual = scored.filter((r) => r.isAnomaly);
  const visible = show === "late" ? late : show === "court" ? court : show === "unusual" ? unusual : rows;
  const tile = (key: Show) => (show === key ? "/analytics/predictions" : `/analytics/predictions?show=${key}`);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("pages.predictionsTitle")}
        description={t("screens.predictions.desc")}
        crumbs={[{ label: t("navGroups.analytics") }, { label: t("nav.predictions") }]}
        badge={!health.ok ? <Badge tone="danger">{t("screens.predictions.paused")}</Badge> : undefined}
      />

      {!health.ok && (
        <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {/* i18n-ignore — a command, typed as is */}
          {rich(t("screens.predictions.offline"), { cmd: <code className="font-mono">npm run ml:serve</code> })}
        </div>
      )}

      {/* How to read this page — three things, in the order an officer needs them. */}
      <section aria-label={t("screens.predictions.howTo")} className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpen className="h-4 w-4 text-brand" aria-hidden /> {t("screens.predictions.howTo")}
        </div>
        <ol className="grid gap-3 text-xs leading-relaxed text-muted sm:grid-cols-3">
          <li className="flex gap-2">
            <Step n={1} />
            <span>
              <span className="font-medium text-foreground">{t("screens.predictions.step1Title")}</span>{" "}
              {rich(t("screens.predictions.step1"), {
                red: <span className="text-danger">{t("screens.predictions.red")}</span>,
                amber: <span className="text-warning">{t("screens.predictions.amber")}</span>,
                green: <span className="text-success">{t("screens.predictions.green")}</span>,
              })}{" "}
              {health.ok
                ? t("screens.predictions.step1Chance", { rows: health.rows.toLocaleString(intl) })
                : t("screens.predictions.step1ChanceNoCount")}
            </span>
          </li>
          <li className="flex gap-2">
            <Step n={2} />
            <span>
              <span className="font-medium text-foreground">{t("screens.predictions.step2Title")}</span> {t("screens.predictions.step2")}
            </span>
          </li>
          <li className="flex gap-2">
            <Step n={3} />
            <span>
              <span className="font-medium text-foreground">{t("screens.predictions.step3Title")}</span> {t("screens.predictions.step3")}
            </span>
          </li>
        </ol>
      </section>

      <section aria-label={t("screens.predictions.filterAria")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          href={tile("late")}
          active={show === "late"}
          label={t("screens.predictions.tileLate")}
          value={String(late.length)}
          hint={t("screens.predictions.tileLateHint")}
          icon={<TriangleAlert className="h-4 w-4" />}
          tone={late.length ? "danger" : "success"}
        />
        <StatTile
          href={tile("court")}
          active={show === "court"}
          label={t("screens.predictions.tileCourt")}
          value={String(court.length)}
          hint={t("screens.predictions.tileCourtHint")}
          icon={<Gavel className="h-4 w-4" />}
          tone={court.length ? "warning" : "success"}
        />
        <StatTile
          href={tile("unusual")}
          active={show === "unusual"}
          label={t("screens.predictions.tileUnusual")}
          value={String(unusual.length)}
          hint={t("screens.predictions.tileUnusualHint")}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={unusual.length ? "warning" : "success"}
        />
        <StatTile
          href="/analytics/predictions"
          active={show === "all"}
          label={t("screens.predictions.tileAll")}
          value={String(rows.length)}
          hint={scored.length === rows.length ? t("screens.predictions.allChecked") : t("screens.predictions.checkedSoFar", { count: scored.length })}
          icon={<Brain className="h-4 w-4" />}
        />
      </section>

      <Card>
        <CardHeader
          title={
            show === "late" ? t("screens.predictions.listLate")
            : show === "court" ? t("screens.predictions.listCourt")
            : show === "unusual" ? t("screens.predictions.listUnusual")
            : t("screens.predictions.listAll")
          }
          description={show === "all" ? t("screens.predictions.startTop") : <Link href="/analytics/predictions" className="text-brand hover:underline">{t("screens.predictions.showAll")}</Link>}
          icon={<Brain className="h-4 w-4" />}
          action={<Link href="/analytics/models" className="text-xs text-brand hover:underline">{t("screens.predictions.howAccurate")}</Link>}
        />
        {visible.length === 0 ? (
          <CardBody>
            <EmptyState
              title={rows.length === 0 ? t("screens.predictions.noOpen") : t("screens.predictions.noneNow")}
              description={rows.length === 0 ? t("screens.predictions.noOpenDesc") : t("screens.predictions.noneNowDesc")}
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <CaseRow key={r.id} r={r} t={t} intl={intl} locale={locale} />
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[11px] leading-relaxed text-muted">
        {rich(
          health.ok
            ? t("screens.predictions.footer", { rows: health.rows.toLocaleString(intl) })
            : t("screens.predictions.footerNoCount"),
          {
            version: health.ok ? health.modelVersion : t("screens.predictions.offlineTag"),
            link: <Link href="/analytics/models" className="text-brand hover:underline">{t("screens.predictions.modelCard")}</Link>,
          },
        )}
      </p>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">{n}</span>
  );
}

type Row = Awaited<ReturnType<typeof storedPredictions>>[number];

function CaseRow({ r, t, intl, locale }: { r: Row; t: T; intl: string; locale: Locale }) {
  const verdict = VERDICT(r.delayRisk);
  // Strongest first, so the sentence names the two that matter most each way.
  const factors = [...(r.factors as Factor[])].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const describe = (f: Factor) => describeFactor(t, f);
  const against = factors.filter((f) => f.direction === "raises").slice(0, 2).map(describe);
  const helping = factors.filter((f) => f.direction === "lowers").slice(0, 2).map(describe);
  const likely = r.delayRisk !== null && r.delayRisk >= HIGH;
  const pct = r.delayRisk === null ? null : Math.round(r.delayRisk * 100);

  const summary =
    r.delayRisk === null
      ? t("screens.predictions.sumNotChecked")
      : r.delayRisk >= MEDIUM
        ? [
            r.expectedDelayDays
              ? t(likely ? "screens.predictions.sumLikelyBy" : "screens.predictions.sumCouldBy", { delay: inWords(t, r.expectedDelayDays) })
              : t(likely ? "screens.predictions.sumLikely" : "screens.predictions.sumCould"),
            against.length ? t("screens.predictions.mainly", { reasons: listOf(intl, against) }) : "",
          ].filter(Boolean).join(" ")
        : [
            t("screens.predictions.sumOnTrack"),
            helping.length ? t("screens.predictions.helping", { reasons: listOf(intl, helping) }) : "",
          ].filter(Boolean).join(" ");

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-4">
        {/* The chance, as a number and a bar — the colour carries the verdict. */}
        <div className="w-20 shrink-0 text-center">
          <div className={cn("text-2xl font-semibold tabular-nums", verdict.tone === "danger" ? "text-danger" : verdict.tone === "warning" ? "text-warning" : verdict.tone === "success" ? "text-success" : "text-muted")}>
            {pct === null ? "—" : `${pct}%`}
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
            <div className={cn("h-full rounded-full", verdict.bar)} style={{ width: `${pct ?? 0}%` }} />
          </div>
          <div className="mt-1 text-[10px] leading-tight text-muted">{t("screens.predictions.chanceOfDelay")}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{r.project}</span>
            <Badge tone={verdict.tone}>{t(verdict.label)}</Badge>
            {r.isAnomaly && <Badge tone="warning" icon={<AlertTriangle className="h-3 w-3" />}>{t("screens.predictions.awardUnusual")}</Badge>}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted">
            {r.referenceNo} · {t(r.parcels === 1 ? "screens.predictions.plotsOne" : "screens.predictions.plotsMany", { count: r.parcels })} ·{" "}
            {t(r.objections === 1 ? "screens.predictions.objectionsOne" : "screens.predictions.objectionsMany", { count: r.objections })}
          </div>

          <p className="mt-2 text-sm leading-relaxed text-foreground">{summary}</p>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {r.litigationRisk !== null && (
              <span>
                <Gavel className="mr-1 inline h-3 w-3" aria-hidden />
                {rich(t("screens.predictions.courtChance"), {
                  pct: <span className="font-medium text-foreground">{Math.round(r.litigationRisk * 100)}%</span>,
                })}
              </span>
            )}
            {r.compensationPerHa !== null && (
              <span>
                <IndianRupee className="mr-1 inline h-3 w-3" aria-hidden />
                {rich(t("screens.predictions.likelyAward"), {
                  amount: <span className="font-medium text-foreground">{formatIndianScale(r.compensationPerHa, locale)}</span>,
                })}
              </span>
            )}
            {r.scoredAt && <span>{t("screens.predictions.checkedOn", { date: new Date(r.scoredAt).toLocaleDateString(intl, { day: "numeric", month: "short" }) })}</span>}
          </div>

          {factors.length > 0 && (
            <details className="group mt-2">
              <summary className="cursor-pointer select-none text-xs font-medium text-brand hover:underline">{t("screens.predictions.why")}</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {factors.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                        f.direction === "raises" ? "bg-danger-soft text-danger" : "bg-success-soft text-success",
                      )}
                    >
                      {f.direction === "raises" ? t("screens.predictions.addsRisk") : t("screens.predictions.reducesRisk")}
                    </span>
                    <span className="text-foreground">{describe(f)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <LinkButton href={`/proposals/${r.id}`} size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>
            {t("screens.predictions.openCase")}
          </LinkButton>
          <RescoreButton proposalId={r.id} label={t("screens.rescore.checkAgain")} />
        </div>
      </div>
    </li>
  );
}
