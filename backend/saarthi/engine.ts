/** Saarthi's reasoning, as pure functions over a snapshot. */
import type { ProposalStatus, RoleType } from "@prisma/client";
import { computeClock } from "@backend/statutory/clock";
import { definitionFor, stageFor } from "@backend/workflow/engine";
import { TERMINAL } from "@backend/workflow/types";
import type { StageDefinition } from "@backend/workflow/types";
import type {
  Accountability,
  CaseSnapshot,
  Cause,
  Confidence,
  Diagnosis,
  Health,
  Recovery,
  Remedy,
  ScheduleStep,
  Severity,
  StageDelay,
  StageHop,
} from "./types";

const DAY = 86_400_000;

const days = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY));

/** Stages whose period belongs to the landowner, not to the administration. */
const PROTECTED_WINDOWS: ProposalStatus[] = ["OBJECTIONS"];

/** Stages that are not part of the forward chain, so they carry no definition. */
const EXCEPTION_LABEL: Partial<Record<ProposalStatus, string>> = {
  RETURNED_FOR_CLARIFICATION: "Returned for clarification",
  REJECTED: "Rejected",
  LAPSED: "Lapsed",
  URGENCY_FAST_TRACK: "Urgency fast-track",
};

/** No stage is realistically deliverable in under this share of its service level. */
const MIN_COMPRESSION = 0.4;

/** Days of silence on an open case before it counts as dormant. */
const DORMANT_DAYS = 30;

/** LARR s.2(2) consent thresholds. */
const CONSENT_THRESHOLD_PPP = 70;
const CONSENT_THRESHOLD_PRIVATE = 80;

function labelFor(stage: ProposalStatus, def: StageDefinition | undefined): string {
  return def?.label ?? EXCEPTION_LABEL[stage] ?? stage.replaceAll("_", " ").toLowerCase();
}

/** Days this desk was allowed before it counts as overrunning. */
function allowedFor(hop: StageHop, def: StageDefinition | undefined): number {
  const sla = hop.slaDays ?? def?.slaDays ?? 0;
  if (PROTECTED_WINDOWS.includes(hop.stage)) return Math.max(sla, def?.statutoryDays ?? 0);
  return sla;
}

/** Which desk held a stage. */
function holderOf(
  snapshot: CaseSnapshot,
  index: number,
  def: StageDefinition | undefined,
): { role: RoleType | null; name: string | null } {
  const next = snapshot.hops[index + 1];
  if (next?.actorRole) return { role: next.actorRole, name: next.actorName };
  if (!snapshot.hops[index].exitedAt) {
    return { role: snapshot.currentHolderRole ?? def?.actors[0] ?? null, name: null };
  }
  return { role: def?.actors[0] ?? null, name: null };
}

/** Where the time went, hop by hop. */
export function attribute(snapshot: CaseSnapshot, now: Date): StageDelay[] {
  const rows = snapshot.hops.map((hop, i) => {
    const def = stageFor(snapshot.act, hop.stage);
    const allowedDays = allowedFor(hop, def);
    const heldDays = days(hop.enteredAt, hop.exitedAt ?? now);
    const holder = holderOf(snapshot, i, def);
    const bench = snapshot.benchmark[hop.stage];
    return {
      stage: hop.stage,
      label: labelFor(hop.stage, def),
      section: def?.section ?? null,
      allowedDays,
      heldDays,
      overrunDays: Math.max(0, heldDays - allowedDays),
      open: !hop.exitedAt,
      holderRole: holder.role,
      holderName: holder.name,
      share: 0,
      peerMedianDays: bench && bench.sampleSize >= 5 ? bench.medianDays : null,
    } satisfies StageDelay;
  });

  const total = rows.reduce((a, r) => a + r.overrunDays, 0);
  for (const r of rows) r.share = total > 0 ? r.overrunDays / total : 0;
  return rows;
}

/** The same overrun, aggregated to the desk that owns it. */
export function accountability(stages: StageDelay[]): Accountability[] {
  const byRole = new Map<RoleType, Accountability>();

  for (const s of stages) {
    if (!s.holderRole || s.overrunDays <= 0) continue;
    const row = byRole.get(s.holderRole) ?? {
      role: s.holderRole,
      overrunDays: 0,
      stageCount: 0,
      share: 0,
      officers: [],
      holdingNow: false,
    };
    row.overrunDays += s.overrunDays;
    row.stageCount += 1;
    row.holdingNow ||= s.open;
    if (s.holderName) {
      const officer = row.officers.find((o) => o.name === s.holderName);
      if (officer) officer.overrunDays += s.overrunDays;
      else row.officers.push({ name: s.holderName, overrunDays: s.overrunDays });
    }
    byRole.set(s.holderRole, row);
  }

  const rows = [...byRole.values()];
  const total = rows.reduce((a, r) => a + r.overrunDays, 0);
  for (const r of rows) {
    r.share = total > 0 ? r.overrunDays / total : 0;
    r.officers.sort((a, b) => b.overrunDays - a.overrunDays);
  }
  return rows.sort((a, b) => b.overrunDays - a.overrunDays);
}

const K = (name: string) => `saarthi.cause.${name}`;
const R = (name: string) => `saarthi.remedy.${name}`;

function severityForRatio(held: number, allowed: number): Severity {
  if (allowed <= 0) return "LOW";
  const ratio = held / allowed;
  if (ratio >= 3) return "CRITICAL";
  if (ratio >= 2) return "HIGH";
  if (ratio > 1.25) return "MEDIUM";
  return "LOW";
}

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Why the case is late. Each cause carries the record that produced it. */
export function findCauses(snapshot: CaseSnapshot, stages: StageDelay[], now: Date): Cause[] {
  const causes: Cause[] = [];
  const open = stages.find((s) => s.open);
  const def = definitionFor(snapshot.act);
  const chain = def.stages.map((s) => s.status);
  const reached = (stage: ProposalStatus) => {
    const at = chain.indexOf(snapshot.status);
    const target = chain.indexOf(stage);
    return at >= 0 && target >= 0 && at >= target;
  };

  // 1. The desk the file is on right now has held it past its service level.
  if (open && open.overrunDays > 0) {
    causes.push({
      code: "DESK_OVERRUN",
      severity: severityForRatio(open.heldDays, open.allowedDays),
      title: { key: K("deskOverrun.title"), vars: { days: open.overrunDays } },
      detail: {
        key: K("deskOverrun.detail"),
        vars: { stage: open.label, held: open.heldDays, allowed: open.allowedDays },
      },
      evidence: [
        {
          key: K("deskOverrun.evidence"),
          vars: { held: open.heldDays, allowed: open.allowedDays, stage: open.label },
        },
      ],
      delayDays: open.overrunDays,
      role: open.holderRole,
    });
  }

  // 2. Rework loops.
  const returns = stages.filter((s) => s.stage === "RETURNED_FOR_CLARIFICATION");
  if (returns.length > 0) {
    const lost = returns.reduce((a, r) => a + r.heldDays, 0);
    causes.push({
      code: "REWORK_LOOP",
      severity: returns.length >= 2 ? "HIGH" : "MEDIUM",
      title: { key: K("reworkLoop.title"), vars: { count: returns.length } },
      detail: { key: K("reworkLoop.detail"), vars: { count: returns.length, days: lost } },
      evidence: snapshot.hops
        .filter((h) => h.stage === "RETURNED_FOR_CLARIFICATION" && h.remarks)
        .map((h) => ({
          key: K("reworkLoop.evidence"),
          vars: { date: h.enteredAt.toISOString().slice(0, 10), remarks: h.remarks ?? "" },
        })),
      delayDays: lost,
      role: returns[0]?.holderRole ?? null,
    });
  }

  // 3. Slower than comparable cases at the same stage.
  if (open && open.peerMedianDays !== null && open.heldDays > open.peerMedianDays * 1.5) {
    causes.push({
      code: "SLOWER_THAN_PEERS",
      severity: "MEDIUM",
      title: { key: K("slowerThanPeers.title") },
      detail: {
        key: K("slowerThanPeers.detail"),
        vars: { stage: open.label, held: open.heldDays, median: open.peerMedianDays },
      },
      evidence: [{ key: K("slowerThanPeers.evidence"), vars: { median: open.peerMedianDays } }],
      delayDays: open.heldDays - open.peerMedianDays,
      role: open.holderRole,
    });
  }

  // 4. Objections filed and never listed for hearing.
  const unheard = snapshot.objections.filter(
    (o) => !o.decidedAt && !o.hearingDate && (o.status === "FILED" || o.status === "UNDER_REVIEW"),
  );
  if (unheard.length > 0) {
    const oldest = unheard.reduce((a, o) => (o.filedAt < a.filedAt ? o : a), unheard[0]);
    const waiting = days(oldest.filedAt, now);
    causes.push({
      code: "OBJECTIONS_UNHEARD",
      severity: waiting > 60 ? "CRITICAL" : "HIGH",
      title: { key: K("objectionsUnheard.title"), vars: { count: unheard.length } },
      detail: { key: K("objectionsUnheard.detail"), vars: { count: unheard.length, days: waiting } },
      evidence: [
        {
          key: K("objectionsUnheard.evidence"),
          vars: { date: oldest.filedAt.toISOString().slice(0, 10), days: waiting },
        },
      ],
      delayDays: waiting,
      role: snapshot.currentHolderRole,
    });
  }

  // 5. Heard, but never decided. Written reasons are owed and are not written.
  const heardUndecided = snapshot.objections.filter(
    (o) => !o.decidedAt && o.hearingDate !== null && o.hearingDate < now,
  );
  if (heardUndecided.length > 0) {
    const oldest = heardUndecided.reduce(
      (a, o) => ((o.hearingDate as Date) < (a.hearingDate as Date) ? o : a),
      heardUndecided[0],
    );
    const since = days(oldest.hearingDate as Date, now);
    causes.push({
      code: "HEARING_LAPSED",
      severity: since > 30 ? "HIGH" : "MEDIUM",
      title: { key: K("hearingLapsed.title"), vars: { count: heardUndecided.length } },
      detail: { key: K("hearingLapsed.detail"), vars: { count: heardUndecided.length, days: since } },
      evidence: [
        {
          key: K("hearingLapsed.evidence"),
          vars: { date: (oldest.hearingDate as Date).toISOString().slice(0, 10) },
        },
      ],
      delayDays: since,
      role: snapshot.currentHolderRole,
    });
  }

  // 6. Consent short of the statutory threshold.
  if (snapshot.consents.length > 0 && (snapshot.isPPP || snapshot.isPrivateCompany)) {
    const granted = snapshot.consents.filter((c) => c.status === "GRANTED").length;
    const pct = Math.round((granted / snapshot.consents.length) * 100);
    const required = snapshot.isPPP ? CONSENT_THRESHOLD_PPP : CONSENT_THRESHOLD_PRIVATE;
    if (pct < required) {
      causes.push({
        code: "CONSENT_SHORTFALL",
        severity: "HIGH",
        title: { key: K("consentShortfall.title"), vars: { pct, required } },
        detail: {
          key: K("consentShortfall.detail"),
          vars: {
            pct,
            required,
            granted,
            total: snapshot.consents.length,
            short: Math.ceil((required / 100) * snapshot.consents.length) - granted,
          },
        },
        evidence: [
          { key: K("consentShortfall.evidence"), vars: { granted, total: snapshot.consents.length } },
        ],
        delayDays: null,
        role: "LAND_REQUIRING_BODY",
      });
    }
  }

  // 7. A notification issued but not published everywhere the Act requires.
  const incomplete = snapshot.notifications.filter(
    (n) => !n.publishedGazette || !n.publishedNewspaper1 || !n.publishedNewspaper2 || !n.publishedLocalLang,
  );
  if (incomplete.length > 0) {
    const missing: string[] = [];
    for (const n of incomplete) {
      if (!n.publishedGazette) missing.push("gazette");
      if (!n.publishedNewspaper1 || !n.publishedNewspaper2) missing.push("newspapers");
      if (!n.publishedLocalLang) missing.push("localLanguage");
    }
    causes.push({
      code: "PUBLICATION_GAP",
      severity: "HIGH",
      title: { key: K("publicationGap.title"), vars: { count: incomplete.length } },
      detail: { key: K("publicationGap.detail"), vars: { count: incomplete.length } },
      evidence: [...new Set(missing)].map((m) => ({ key: K(`publicationGap.channel.${m}`) })),
      delayDays: null,
      role: "LAND_ACQUIRING_AUTHORITY",
    });
  }

  // 8. Parcels without a surveyed boundary.
  const unsurveyed = snapshot.parcels.filter((p) => !p.hasBoundary).length;
  if (unsurveyed > 0 && reached("SEC_11_PRELIM_NOTIFICATION")) {
    causes.push({
      code: "SURVEY_INCOMPLETE",
      severity: unsurveyed > snapshot.parcels.length / 2 ? "HIGH" : "MEDIUM",
      title: { key: K("surveyIncomplete.title"), vars: { count: unsurveyed } },
      detail: {
        key: K("surveyIncomplete.detail"),
        vars: { count: unsurveyed, total: snapshot.parcels.length },
      },
      evidence: [
        { key: K("surveyIncomplete.evidence"), vars: { count: unsurveyed, total: snapshot.parcels.length } },
      ],
      delayDays: null,
      role: "LAND_ACQUIRING_AUTHORITY",
    });
  }

  // 9. Compensation assessed but not paid.
  const { assessed, paid, unpaidOwnerCount, unreachableOwnerCount } = snapshot.compensation;
  if (assessed > 0 && paid < assessed && reached("AWARD_DECLARED")) {
    const outstanding = Math.round(assessed - paid);
    causes.push({
      code: "COMPENSATION_UNPAID",
      severity: reached("POSSESSION") ? "CRITICAL" : "HIGH",
      title: { key: K("compensationUnpaid.title"), vars: { owners: unpaidOwnerCount } },
      detail: {
        key: K("compensationUnpaid.detail"),
        vars: { owners: unpaidOwnerCount, pct: Math.round((paid / assessed) * 100) },
      },
      evidence: [
        { key: K("compensationUnpaid.evidence"), vars: { amount: outstanding } },
        ...(unreachableOwnerCount > 0
          ? [{ key: K("compensationUnpaid.unreachable"), vars: { count: unreachableOwnerCount } }]
          : []),
      ],
      delayDays: null,
      role: "LAND_ACQUIRING_AUTHORITY",
    });
  }

  // 10. Nobody is posted to the desk the file is sitting on.
  if (open && snapshot.holderStaffCount === 0) {
    causes.push({
      code: "DESK_UNSTAFFED",
      severity: "CRITICAL",
      title: { key: K("deskUnstaffed.title") },
      detail: { key: K("deskUnstaffed.detail"), vars: { stage: open.label } },
      evidence: [{ key: K("deskUnstaffed.evidence") }],
      delayDays: open.overrunDays || null,
      role: open.holderRole,
    });
  }

  // 11. Nothing has been recorded against the case for a month.
  if (open && !TERMINAL.includes(snapshot.status)) {
    const openHop = snapshot.hops.find((h) => !h.exitedAt);
    const lastTouched = snapshot.lastActivityAt ?? openHop?.enteredAt ?? snapshot.createdAt;
    const idle = days(lastTouched, now);
    if (idle >= DORMANT_DAYS) {
      causes.push({
        code: "DORMANT",
        severity: idle >= 90 ? "HIGH" : "MEDIUM",
        title: { key: K("dormant.title"), vars: { days: idle } },
        detail: { key: K("dormant.detail"), vars: { days: idle } },
        evidence: [
          {
            key: K("dormant.evidence"),
            vars: { date: lastTouched.toISOString().slice(0, 10) },
          },
        ],
        delayDays: idle,
        role: open.holderRole,
      });
    }
  }

  // 12. The statutory clock itself, where it is close or already past.
  const clock = computeClock(
    snapshot.act,
    snapshot.status,
    snapshot.hops.find((h) => !h.exitedAt)?.enteredAt ?? snapshot.createdAt,
    snapshot.hops.find((h) => !h.exitedAt)?.statutoryDeadline ?? null,
    now,
  );
  if (clock.deadline && (clock.severity === "BREACHED" || clock.severity === "CRITICAL" || clock.severity === "URGENT")) {
    causes.push({
      code: "STATUTORY_CLOCK",
      severity: clock.severity === "BREACHED" ? "CRITICAL" : clock.isFatal ? "CRITICAL" : "HIGH",
      title: {
        key: K(clock.severity === "BREACHED" ? "statutoryClock.breachedTitle" : "statutoryClock.title"),
        vars: { days: Math.abs(clock.daysRemaining ?? 0), section: clock.section ?? "" },
      },
      detail: {
        key: K(`statutoryClock.${(clock.consequence ?? "ESCALATE").toLowerCase()}`),
        vars: { days: Math.abs(clock.daysRemaining ?? 0), section: clock.section ?? "" },
      },
      evidence: [
        {
          key: K("statutoryClock.evidence"),
          vars: { date: clock.deadline.toISOString().slice(0, 10), section: clock.section ?? "" },
        },
      ],
      delayDays: clock.daysRemaining !== null && clock.daysRemaining < 0 ? Math.abs(clock.daysRemaining) : null,
      role: snapshot.currentHolderRole,
    });
  }

  // 13. The delay model, if it is reachable.
  if (snapshot.prediction && snapshot.prediction.band === "HIGH") {
    causes.push({
      code: "MODEL_RISK",
      severity: "MEDIUM",
      title: {
        key: K("modelRisk.title"),
        vars: { pct: Math.round(snapshot.prediction.delayRisk * 100) },
      },
      detail: {
        key: K("modelRisk.detail"),
        vars: {
          days: snapshot.prediction.expectedDelayDays,
          version: snapshot.prediction.modelVersion,
        },
      },
      evidence: snapshot.prediction.topFactors
        .filter((f) => f.direction === "raises")
        .slice(0, 3)
        .map((f) => ({ key: K("modelRisk.evidence"), vars: { factor: f.humanLabel } })),
      delayDays: null,
      role: null,
    });
  }

  return causes.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** One rung up the chain of command, for escalation advice that names a desk. */
const ESCALATES_TO: Partial<Record<RoleType, RoleType>> = {
  LAND_REQUIRING_BODY: "LAND_ACQUIRING_AUTHORITY",
  LAND_ACQUIRING_AUTHORITY: "DISTRICT_COLLECTOR",
  REHABILITATION_AUTHORITY: "DISTRICT_COLLECTOR",
  DISTRICT_COLLECTOR: "STATE_GOVERNMENT",
  STATE_GOVERNMENT: "CENTRAL_MINISTRY",
};

/** Stage pairs that may lawfully run together. */
const PARALLELISABLE: { after: ProposalStatus; with: ProposalStatus; basis: string }[] = [
  // Both clocks run from the award under s.38(1): three months for compensation, six for monetary
  // R&R.
  { after: "COMPENSATION_DISBURSEMENT", with: "RNR_IMPLEMENTATION", basis: "s.38(1)" },
  { after: "AWARD_ENQUIRY", with: "SEC_21_NOTICE", basis: "s.21" },
];

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** A dated plan from here to the deadline. */
export function planRecovery(snapshot: CaseSnapshot, stages: StageDelay[], now: Date): Recovery {
  const def = definitionFor(snapshot.act);
  const chain = def.stages;

  // An exception state (returned, rejected) carries no place in the forward
  // chain, so the plan resumes from the furthest forward stage actually reached.
  let resumeIdx = chain.findIndex((s) => s.status === snapshot.status);
  if (resumeIdx < 0) {
    const reached = snapshot.hops
      .map((h) => chain.findIndex((s) => s.status === h.stage))
      .filter((i) => i >= 0);
    resumeIdx = reached.length ? Math.max(...reached) : 0;
  }

  const openStage = stages.find((s) => s.open);
  const remaining = chain.slice(resumeIdx).filter((s) => !TERMINAL.includes(s.status));

  const base = remaining.map((s, i) => {
    const protectedWindow = PROTECTED_WINDOWS.includes(s.status);
    const normalDays = protectedWindow ? Math.max(s.slaDays, s.statutoryDays ?? 0) : s.slaDays;
    // The stage the file is on now only needs what is left of its allowance.
    const first = i === 0 && openStage?.stage === s.status;
    const need = first ? Math.max(1, (openStage?.allowedDays ?? normalDays) - (openStage?.heldDays ?? 0)) : normalDays;
    return { def: s, normalDays, need, protectedWindow };
  });

  const daysNeededAtSla = base.reduce((a, b) => a + b.need, 0);

  const openHop = snapshot.hops.find((h) => !h.exitedAt);
  const clock = computeClock(
    snapshot.act,
    snapshot.status,
    openHop?.enteredAt ?? snapshot.createdAt,
    openHop?.statutoryDeadline ?? null,
    now,
  );
  const deadline = clock.deadline;
  const daysAvailable = deadline ? Math.round((deadline.getTime() - now.getTime()) / DAY) : null;

  let compressionFactor: number | null = null;
  let feasible = true;

  if (daysAvailable !== null && daysAvailable < daysNeededAtSla) {
    const protectedDays = base.filter((b) => b.protectedWindow).reduce((a, b) => a + b.need, 0);
    const compressible = daysNeededAtSla - protectedDays;
    const budget = daysAvailable - protectedDays;
    if (compressible <= 0 || budget <= 0) {
      feasible = false;
      compressionFactor = MIN_COMPRESSION;
    } else {
      compressionFactor = budget / compressible;
      if (compressionFactor < MIN_COMPRESSION) {
        feasible = false;
        compressionFactor = MIN_COMPRESSION;
      }
    }
  }

  let cursor = now;
  const steps: ScheduleStep[] = base.map((b) => {
    const planned =
      compressionFactor !== null && !b.protectedWindow
        ? Math.max(1, Math.round(b.need * compressionFactor))
        : b.need;
    const startOn = cursor;
    const finishBy = addDays(startOn, planned);
    cursor = finishBy;
    return {
      stage: b.def.status,
      label: b.def.label,
      section: b.def.section ?? null,
      normalDays: b.normalDays,
      plannedDays: planned,
      startOn,
      finishBy,
      compressed: planned < b.need,
      protectedWindow: b.protectedWindow,
    } satisfies ScheduleStep;
  });

  return {
    deadline,
    consequence: clock.consequence,
    daysAvailable,
    daysNeededAtSla,
    slackDays: daysAvailable === null ? null : daysAvailable - daysNeededAtSla,
    compressionFactor,
    feasible,
    projectedFinish: steps.length ? steps[steps.length - 1].finishBy : now,
    steps,
  };
}

/** What to do about it. */
export function prescribe(
  snapshot: CaseSnapshot,
  stages: StageDelay[],
  causes: Cause[],
  recovery: Recovery,
  now: Date,
): Remedy[] {
  const out: Remedy[] = [];
  const has = (code: Cause["code"]) => causes.find((c) => c.code === code);
  const open = stages.find((s) => s.open);
  const holder = snapshot.currentHolderRole ?? open?.holderRole ?? null;
  const escalateTo = holder ? (ESCALATES_TO[holder] ?? "STATE_GOVERNMENT") : null;
  const isNh = snapshot.act === "NH_ACT_1956";

  const push = (r: Remedy) => out.push(r);

  if (has("DESK_UNSTAFFED")) {
    push({
      code: "STAFF_DESK",
      priority: 1,
      title: { key: R("staffDesk.title") },
      detail: { key: R("staffDesk.detail"), vars: { stage: open?.label ?? "" } },
      owner: escalateTo,
      savesDays: open?.overrunDays ?? null,
      statutoryBasis: null,
      caution: null,
    });
  }

  if (!recovery.feasible) {
    push({
      code: "DEADLINE_UNREACHABLE",
      priority: 1,
      title: { key: R("deadlineUnreachable.title") },
      detail: {
        key: R("deadlineUnreachable.detail"),
        vars: { needed: recovery.daysNeededAtSla, available: Math.max(0, recovery.daysAvailable ?? 0) },
      },
      owner: escalateTo,
      savesDays: null,
      statutoryBasis: isNh ? "s.3G" : "s.25",
      caution: { key: R("deadlineUnreachable.caution") },
    });
  }

  const clockCause = has("STATUTORY_CLOCK");
  const overrun = has("DESK_OVERRUN");
  if (escalateTo && (clockCause?.severity === "CRITICAL" || overrun?.severity === "CRITICAL" || overrun?.severity === "HIGH")) {
    push({
      code: "ESCALATE",
      priority: 2,
      title: { key: R("escalate.title") },
      detail: {
        key: R("escalate.detail"),
        vars: { stage: open?.label ?? "", days: open?.overrunDays ?? 0 },
      },
      owner: escalateTo,
      savesDays: null,
      statutoryBasis: null,
      caution: null,
    });
  }

  const rework = has("REWORK_LOOP");
  if (rework) {
    push({
      code: "CONSOLIDATE_QUERIES",
      priority: 3,
      title: { key: R("consolidateQueries.title") },
      detail: { key: R("consolidateQueries.detail"), vars: { days: rework.delayDays ?? 0 } },
      owner: holder,
      // A further return costs what the previous ones averaged.
      savesDays: rework.delayDays ? Math.round(rework.delayDays / Math.max(1, stages.filter((s) => s.stage === "RETURNED_FOR_CLARIFICATION").length)) : null,
      statutoryBasis: null,
      caution: null,
    });
  }

  const unheard = has("OBJECTIONS_UNHEARD");
  if (unheard) {
    push({
      code: "BATCH_HEARINGS",
      priority: 2,
      title: { key: R("batchHearings.title") },
      detail: {
        key: R("batchHearings.detail"),
        vars: {
          count: snapshot.objections.filter((o) => !o.decidedAt && !o.hearingDate).length,
          date: addDays(now, 14).toISOString().slice(0, 10),
        },
      },
      owner: holder,
      savesDays: unheard.delayDays,
      statutoryBasis: isNh ? "s.3C(2)" : "s.15(2)",
      caution: null,
    });
  }

  if (has("HEARING_LAPSED")) {
    push({
      code: "DECIDE_HEARD_OBJECTIONS",
      priority: 2,
      title: { key: R("decideHeardObjections.title") },
      detail: {
        key: R("decideHeardObjections.detail"),
        vars: { count: snapshot.objections.filter((o) => !o.decidedAt && o.hearingDate && o.hearingDate < now).length },
      },
      owner: holder,
      savesDays: null,
      statutoryBasis: isNh ? "s.3C(2)" : "s.15(2)",
      caution: { key: R("decideHeardObjections.caution") },
    });
  }

  const consent = has("CONSENT_SHORTFALL");
  if (consent) {
    push({
      code: "CLOSE_CONSENT_GAP",
      priority: 3,
      title: { key: R("closeConsentGap.title") },
      detail: { key: R("closeConsentGap.detail"), vars: { short: Number(consent.detail.vars?.short ?? 0) } },
      owner: "LAND_REQUIRING_BODY",
      savesDays: null,
      statutoryBasis: "s.2(2)",
      caution: null,
    });
  }

  if (has("PUBLICATION_GAP")) {
    push({
      code: "COMPLETE_PUBLICATION",
      priority: 2,
      title: { key: R("completePublication.title") },
      detail: { key: R("completePublication.detail") },
      owner: "LAND_ACQUIRING_AUTHORITY",
      savesDays: null,
      statutoryBasis: isNh ? "s.3A(1)" : "s.11(1)",
      caution: { key: R("completePublication.caution") },
    });
  }

  if (has("SURVEY_INCOMPLETE")) {
    push({
      code: "FINISH_SURVEY",
      priority: 3,
      title: { key: R("finishSurvey.title") },
      detail: {
        key: R("finishSurvey.detail"),
        vars: { count: snapshot.parcels.filter((p) => !p.hasBoundary).length },
      },
      owner: "LAND_ACQUIRING_AUTHORITY",
      savesDays: null,
      statutoryBasis: null,
      caution: null,
    });
  }

  if (has("COMPENSATION_UNPAID")) {
    push({
      code: "RELEASE_PAYMENTS",
      priority: 2,
      title: { key: R("releasePayments.title") },
      detail: {
        key: R("releasePayments.detail"),
        vars: { owners: snapshot.compensation.unpaidOwnerCount },
      },
      owner: "LAND_ACQUIRING_AUTHORITY",
      savesDays: null,
      statutoryBasis: "s.38",
      caution: null,
    });
    if (snapshot.compensation.unreachableOwnerCount > 0) {
      push({
        code: "DEPOSIT_WITH_AUTHORITY",
        priority: 3,
        title: { key: R("depositWithAuthority.title") },
        detail: {
          key: R("depositWithAuthority.detail"),
          vars: { count: snapshot.compensation.unreachableOwnerCount },
        },
        owner: "LAND_ACQUIRING_AUTHORITY",
        savesDays: null,
        statutoryBasis: "s.77",
        caution: null,
      });
    }
  }

  // Scheduling advice, from the plan rather than from a cause.
  const parallel = PARALLELISABLE.find((p) => recovery.steps.some((s) => s.stage === p.after) && recovery.steps.some((s) => s.stage === p.with));
  if (parallel && (recovery.slackDays ?? 0) < 0) {
    const withStep = recovery.steps.find((s) => s.stage === parallel.with);
    push({
      code: "PARALLELISE",
      priority: 3,
      title: { key: R("parallelise.title") },
      detail: {
        key: R("parallelise.detail"),
        vars: {
          first: recovery.steps.find((s) => s.stage === parallel.after)?.label ?? "",
          second: withStep?.label ?? "",
        },
      },
      owner: holder,
      savesDays: withStep?.plannedDays ?? null,
      statutoryBasis: parallel.basis,
      caution: null,
    });
  }

  if (recovery.compressionFactor !== null && recovery.feasible) {
    push({
      code: "COMPRESS_SCHEDULE",
      priority: 2,
      title: {
        key: R("compressSchedule.title"),
        vars: { pct: Math.round((1 - recovery.compressionFactor) * 100) },
      },
      detail: {
        key: R("compressSchedule.detail"),
        vars: {
          pct: Math.round((1 - recovery.compressionFactor) * 100),
          date: recovery.projectedFinish.toISOString().slice(0, 10),
        },
      },
      owner: holder,
      savesDays: Math.max(0, recovery.daysNeededAtSla - (recovery.daysAvailable ?? recovery.daysNeededAtSla)),
      statutoryBasis: null,
      caution: null,
    });
  }

  // The urgency clause is real and is also the most abused provision in the
  // Act, so it is offered last, only when nothing else reaches the deadline,
  // and never without saying what it costs the landowner.
  if (!recovery.feasible && !snapshot.isUrgency) {
    push({
      code: "REVIEW_URGENCY",
      priority: 4,
      title: { key: R("reviewUrgency.title") },
      detail: { key: R("reviewUrgency.detail") },
      owner: "STATE_GOVERNMENT",
      savesDays: null,
      statutoryBasis: isNh ? "s.3A(2)" : "s.40",
      caution: { key: R("reviewUrgency.caution") },
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

function healthFor(slippageDays: number, expectedDays: number, clockSeverity: string): Health {
  if (clockSeverity === "BREACHED") return "BREACHED";
  if (clockSeverity === "CRITICAL") return "CRITICAL";
  if (expectedDays > 0 && slippageDays >= expectedDays) return "CRITICAL";
  if (expectedDays > 0 && slippageDays >= expectedDays * 0.25) return "LATE";
  if (slippageDays > 0) return "SLIPPING";
  return "ON_TRACK";
}

/** How far the record itself can be trusted. */
function confidenceFor(snapshot: CaseSnapshot): Confidence {
  if (snapshot.hops.length <= 1) return "LOW";
  const benchmarked = Object.values(snapshot.benchmark).filter((b) => b && b.sampleSize >= 5).length;
  if (snapshot.hops.length >= 4 && snapshot.lastActivityAt && benchmarked >= 2) return "HIGH";
  if (snapshot.hops.length >= 3) return "MEDIUM";
  return "LOW";
}

/** The whole diagnosis. */
export function diagnose(snapshot: CaseSnapshot, now: Date = new Date()): Diagnosis {
  const stages = attribute(snapshot, now);
  const openHop = snapshot.hops.find((h) => !h.exitedAt);
  const clock = computeClock(
    snapshot.act,
    snapshot.status,
    openHop?.enteredAt ?? snapshot.createdAt,
    openHop?.statutoryDeadline ?? null,
    now,
  );

  const start = snapshot.hops[0]?.enteredAt ?? snapshot.createdAt;
  const elapsedDays = days(start, now);
  const expectedDays = stages.reduce((a, s) => a + s.allowedDays, 0);
  const slippageDays = elapsedDays - expectedDays;

  const causes = findCauses(snapshot, stages, now);
  const recovery = planRecovery(snapshot, stages, now);
  const remedies = prescribe(snapshot, stages, causes, recovery, now);

  return {
    referenceNo: snapshot.referenceNo,
    projectName: snapshot.projectName,
    generatedAt: now,
    health: healthFor(slippageDays, expectedDays, clock.severity),
    confidence: confidenceFor(snapshot),
    elapsedDays,
    expectedDays,
    slippageDays,
    clock,
    stages,
    accountability: accountability(stages),
    causes,
    remedies,
    recovery,
    prediction: snapshot.prediction,
  };
}
