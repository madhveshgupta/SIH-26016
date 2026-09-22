import {
  AlertTriangle,
  CalendarClock,
  Compass,
  Gavel,
  ListChecks,
  Lock,
  TrendingDown,
  UserRound,
} from "lucide-react";
import type { MessageKey } from "@backend/i18n";
import { getTranslator } from "@backend/i18n/locale";
import { dictionaryText } from "@backend/i18n/api-text";
import { alertText } from "@backend/alerts/words";
import type { Accountability, Cause, Diagnosis, Line, Remedy, Severity, StageDelay } from "@backend/saarthi";
import { SEVERITY_STYLES } from "@backend/statutory/clock";
import { Badge, Card, CardBody, CardHeader, type Tone } from "@frontend/components/ui";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Message keys are built from codes, so the cast is where that meets the type. */
const line = (t: T, l: Line) => t(l.key as MessageKey, l.vars);
const roleLabel = (t: T, role: string | null) => (role ? t(`roles.${role}` as MessageKey) : "—");
/** A stage name from the workflow definition, in the reader's language. */
const stageName = (t: T, label: string) => dictionaryText(t, label) ?? label;

const SEVERITY_TONE: Record<Severity, Tone> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "accent",
  LOW: "neutral",
};

const HEALTH_TONE: Record<Diagnosis["health"], Tone> = {
  ON_TRACK: "success",
  SLIPPING: "info",
  LATE: "warning",
  CRITICAL: "danger",
  BREACHED: "danger",
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Saarthi, on the case it is diagnosing. */
export default async function SaarthiPanel({ diagnosis }: { diagnosis: Diagnosis }) {
  const { t } = await getTranslator();
  const d = diagnosis;
  const late = d.slippageDays > 0;

  return (
    <Card>
      <CardHeader
        title={t("saarthi.title")}
        description={t("saarthi.subtitle")}
        icon={<Compass className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={HEALTH_TONE[d.health]}>{t(`saarthi.health.${d.health}` as MessageKey)}</Badge>
            <span className="text-[10px] text-muted" title={t("saarthi.confidenceNote")}>
              {t("saarthi.confidence")}: {t(`saarthi.level.${d.confidence}` as MessageKey)}
            </span>
          </div>
        }
      />

      <CardBody className="space-y-6">
        {/* The headline three numbers. */}
        <div className="grid grid-cols-3 gap-3">
          <Figure label={t("saarthi.elapsed")} value={d.elapsedDays} />
          <Figure label={t("saarthi.expected")} value={d.expectedDays} />
          <Figure
            label={late ? t("saarthi.slippage") : t("saarthi.slippageAhead")}
            value={Math.abs(d.slippageDays)}
            tone={late ? "danger" : "success"}
          />
        </div>

        {d.clock.deadline && (
          <p className={`rounded-lg px-3 py-2 text-[11px] ${SEVERITY_STYLES[d.clock.severity]}`}>
            {alertText(t, d.clock.message)}
          </p>
        )}

        {!late && d.causes.length === 0 && (
          <p className="rounded-lg bg-success-soft px-3 py-2 text-xs text-success">{t("saarthi.onTrack")}</p>
        )}

        <Section icon={<TrendingDown className="h-3.5 w-3.5" />} title={t("saarthi.whereTimeWent")} hint={t("saarthi.whereTimeWentHint")}>
          <StageTable t={t} stages={d.stages} />
        </Section>

        {d.accountability.length > 0 && (
          <Section icon={<UserRound className="h-3.5 w-3.5" />} title={t("saarthi.whoIsHolding")} hint={t("saarthi.whoIsHoldingHint")}>
            <DeskTable t={t} rows={d.accountability} />
          </Section>
        )}

        {d.causes.length > 0 && (
          <Section icon={<AlertTriangle className="h-3.5 w-3.5" />} title={t("saarthi.whyItIsLate")}>
            <ul className="space-y-2.5">
              {d.causes.map((c) => (
                <CauseRow key={c.code} t={t} cause={c} />
              ))}
            </ul>
          </Section>
        )}

        {d.remedies.length > 0 && (
          <Section icon={<ListChecks className="h-3.5 w-3.5" />} title={t("saarthi.whatToDo")}>
            <ol className="space-y-2.5">
              {d.remedies.map((r, i) => (
                <RemedyRow key={r.code} t={t} remedy={r} index={i + 1} />
              ))}
            </ol>
          </Section>
        )}

        <Section icon={<CalendarClock className="h-3.5 w-3.5" />} title={t("saarthi.recoveryPlan")} hint={t("saarthi.recoveryPlanHint")}>
          <RecoveryPlan t={t} diagnosis={d} />
        </Section>

        <p className="border-t border-border pt-3 text-[10px] leading-relaxed text-muted">
          {t("saarthi.generatedAt", { date: iso(d.generatedAt) })} {t("saarthi.method")}
        </p>
      </CardBody>
    </Card>
  );
}

function Figure({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "danger" | "success" }) {
  const colour = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <span className="text-brand">{icon}</span>
        {title}
      </h3>
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Where the time went, with the overrun share drawn as a bar. */
function StageTable({ t, stages }: { t: T; stages: StageDelay[] }) {
  if (stages.length === 0) return <p className="text-[11px] text-muted">{t("saarthi.noOverrun")}</p>;
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted">
          <th className="py-1 font-medium">{t("saarthi.colStage")}</th>
          <th className="py-1 text-right font-medium">{t("saarthi.colHeld")}</th>
          <th className="py-1 text-right font-medium">{t("saarthi.colAllowed")}</th>
          <th className="py-1 pr-4 text-right font-medium">{t("saarthi.colOverrun")}</th>
          <th className="w-28 py-1 font-medium">{t("saarthi.colShare")}</th>
          <th className="py-1 font-medium">{t("saarthi.colDesk")}</th>
        </tr>
      </thead>
      <tbody>
        {stages.map((s, i) => (
          <tr key={`${s.stage}-${i}`} className="border-b border-border/60 last:border-0">
            <td className="py-1.5 pr-2">
              <span className={s.open ? "font-medium text-foreground" : "text-foreground"}>{stageName(t, s.label)}</span>
              {s.section && <span className="ml-1 font-mono text-[9px] text-muted">{s.section}</span>}
              {s.open && <span className="ml-1 text-[9px] text-brand">· {t("saarthi.stillHere")}</span>}
              {s.peerMedianDays !== null && (
                <div className="text-[9px] text-muted">{t("saarthi.peerMedian", { days: s.peerMedianDays })}</div>
              )}
            </td>
            <td className="py-1.5 text-right tabular-nums">{s.heldDays}</td>
            <td className="py-1.5 text-right tabular-nums text-muted">{s.allowedDays}</td>
            <td className={`py-1.5 pr-4 text-right tabular-nums ${s.overrunDays > 0 ? "font-medium text-danger" : "text-muted"}`}>
              {s.overrunDays > 0 ? `+${s.overrunDays}` : "—"}
            </td>
            <td className="py-1.5 pr-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-danger" style={{ width: `${Math.round(s.share * 100)}%` }} />
              </div>
            </td>
            <td className="py-1.5 text-muted">
              {roleLabel(t, s.holderRole)}
              {s.holderName && <div className="text-[9px]">{s.holderName}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The "who" answer, which is the one nobody could get before. */
function DeskTable({ t, rows }: { t: T; rows: Accountability[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.role} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              {roleLabel(t, r.role)}
              {r.holdingNow && <Badge tone="brand">{t("saarthi.holdingNow")}</Badge>}
            </div>
            <div className="text-[10px] text-muted">
              {t("saarthi.stageCount", { count: r.stageCount })}
              {r.officers.length > 0 && ` · ${r.officers.map((o) => `${o.name} (+${o.overrunDays})`).join(", ")}`}
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-warning" style={{ width: `${Math.round(r.share * 100)}%` }} />
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold tabular-nums text-danger">+{r.overrunDays}</div>
            <div className="text-[9px] text-muted">{t("saarthi.ofDelay", { pct: Math.round(r.share * 100) })}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CauseRow({ t, cause }: { t: T; cause: Cause }) {
  return (
    <li className="rounded-lg border border-border bg-surface-muted/50 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium text-foreground">{line(t, cause.title)}</div>
        <Badge tone={SEVERITY_TONE[cause.severity]}>{t(`saarthi.level.${cause.severity}` as MessageKey)}</Badge>
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{line(t, cause.detail)}</p>
      {cause.evidence.length > 0 && (
        <div className="mt-1.5 border-l-2 border-border pl-2">
          <div className="text-[9px] font-medium uppercase tracking-wide text-muted">{t("saarthi.evidence")}</div>
          {cause.evidence.map((e, i) => (
            <div key={i} className="text-[10px] leading-snug text-muted">
              {line(t, e)}
            </div>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
        {cause.delayDays !== null && <span>{t("saarthi.attributableDays", { days: cause.delayDays })}</span>}
        {cause.role && <span>{t("saarthi.owner")}: {roleLabel(t, cause.role)}</span>}
      </div>
    </li>
  );
}

function RemedyRow({ t, remedy, index }: { t: T; remedy: Remedy; index: number }) {
  return (
    <li className="flex gap-2.5 rounded-lg border border-border px-3 py-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand">
        {index}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-foreground">{line(t, remedy.title)}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{line(t, remedy.detail)}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
          {remedy.owner && <span>{t("saarthi.owner")}: {roleLabel(t, remedy.owner)}</span>}
          {remedy.statutoryBasis && (
            <span className="font-mono">{t("saarthi.basis", { section: remedy.statutoryBasis })}</span>
          )}
          {remedy.savesDays !== null && remedy.savesDays > 0 && (
            <span className="text-success">{t("saarthi.saves", { days: remedy.savesDays })}</span>
          )}
        </div>
        {remedy.caution && (
          <p className="mt-1 flex gap-1.5 rounded bg-accent-soft px-2 py-1 text-[10px] leading-snug text-warning">
            <Gavel className="mt-px h-3 w-3 shrink-0" aria-hidden />
            <span>
              <strong>{t("saarthi.caution")}. </strong>
              {line(t, remedy.caution)}
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

/** The dated plan. The compression is shown per stage, not as one percentage. */
function RecoveryPlan({ t, diagnosis }: { t: T; diagnosis: Diagnosis }) {
  const r = diagnosis.recovery;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
        {r.deadline ? (
          <span className="font-medium text-foreground">{t("saarthi.deadlineIs", { date: iso(r.deadline) })}</span>
        ) : (
          <span>{t("saarthi.noDeadline")}</span>
        )}
        {r.daysAvailable !== null && <span>{t("saarthi.daysAvailable")}: {r.daysAvailable}</span>}
        <span>{t("saarthi.daysNeeded")}: {r.daysNeededAtSla}</span>
        {r.slackDays !== null &&
          (r.slackDays >= 0 ? (
            <span className="text-success">{t("saarthi.slack")}: {r.slackDays}</span>
          ) : (
            <span className="text-danger">{t("saarthi.shortBy", { days: Math.abs(r.slackDays) })}</span>
          ))}
        <span>{t("saarthi.projectedFinish", { date: iso(r.projectedFinish) })}</span>
      </div>

      <p
        className={`mb-2 rounded px-2 py-1.5 text-[10px] leading-snug ${
          r.feasible ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
        }`}
      >
        {r.feasible ? t("saarthi.feasible") : t("saarthi.infeasible")}
      </p>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted">
            <th className="py-1 font-medium">{t("saarthi.colStage")}</th>
            <th className="py-1 text-right font-medium">{t("saarthi.colPlanned")}</th>
            <th className="py-1 text-right font-medium">{t("saarthi.colStart")}</th>
            <th className="py-1 text-right font-medium">{t("saarthi.colFinish")}</th>
          </tr>
        </thead>
        <tbody>
          {r.steps.map((s) => (
            <tr key={s.stage} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 pr-2">
                {stageName(t, s.label)}
                {s.section && <span className="ml-1 font-mono text-[9px] text-muted">{s.section}</span>}
                {s.protectedWindow && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] text-muted">
                    <Lock className="h-2.5 w-2.5" aria-hidden />
                    {t("saarthi.protectedBadge")}
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {s.plannedDays}
                {s.compressed && (
                  <span className="ml-1 text-[9px] text-warning">
                    ({t("saarthi.compressedBadge")} · {s.normalDays})
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right font-mono text-[10px] text-muted">{iso(s.startOn)}</td>
              <td className="py-1.5 text-right font-mono text-[10px]">{iso(s.finishBy)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {r.steps.some((s) => s.protectedWindow) && (
        <p className="mt-1.5 text-[10px] leading-snug text-muted">{t("saarthi.protectedNote")}</p>
      )}
    </div>
  );
}
