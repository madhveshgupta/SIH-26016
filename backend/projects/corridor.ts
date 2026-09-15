/** Corridor readiness — how much of a linear project can be built today. */
import type { ParcelStatus, RoleType } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { scopeForParcel, type Actor } from "@backend/rbac/scope";
import { OPEN_OBJECTION } from "@backend/statutory/notifications";

/** Where a plot stands, as far as building on it goes. */
export type Readiness = "READY" | "PAID" | "IN_PROCESS" | "BLOCKED";
export type SegmentState = Readiness | "UNMAPPED";

/** Worst wins: a stretch is only as ready as the least-ready plot covering it. */
const RANK: Record<Readiness, number> = { READY: 0, PAID: 1, IN_PROCESS: 2, BLOCKED: 3 };

/**
 * Uncovered slivers shorter than this are boundary noise, not a missing plot:
 * neighbouring plots on a revenue map meet, but their projections onto a
 * curving centreline can miss by a metre or two.
 */
const SNAP_M = 5;

export interface PlotSpan {
  id: string;
  fromM: number;
  toM: number;
  readiness: Readiness;
}

export interface Segment {
  fromM: number;
  toM: number;
  state: SegmentState;
  /** Plots covering this stretch that are not yet in hand. */
  plotIds: string[];
}

export interface Stretch {
  fromM: number;
  toM: number;
}

export interface Gap extends Stretch {
  /** Every plot not in hand that touches the gap — settle these and it clears. */
  blockers: string[];
  byReadiness: Record<Exclude<Readiness, "READY">, number>;
  /** Length inside the gap no plot covers; settling plots cannot clear it. */
  unmappedM: number;
  /**
   * Continuous length once every blocker is settled, joined with the ready stretches either side
   * and stopping at unmapped land.
   */
  joinsM: number | null;
  /** How much the longest buildable stretch grows. */
  gainM: number;
  /** 1 = the most road per plot settled. */
  rank: number;
}

export interface CorridorAnalysis {
  lengthM: number;
  segments: Segment[];
  totals: Record<SegmentState, number>;
  stretches: Stretch[];
  longest: Stretch | null;
  /** The longest run that is in hand or paid for — ready once possession is taken. */
  longestAfterPossession: (Stretch & { plots: number }) | null;
  gaps: Gap[];
}

const len = (s: Stretch) => s.toM - s.fromM;

function worst(a: Readiness, b: Readiness): Readiness {
  return RANK[a] >= RANK[b] ? a : b;
}

function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.state === s.state && last.toM === s.fromM) {
      last.toM = s.toM;
      last.plotIds = [...new Set([...last.plotIds, ...s.plotIds])];
    } else {
      out.push({ ...s, plotIds: [...s.plotIds] });
    }
  }
  return out;
}

/** The longest run of segments whose states all pass `ok` — optionally only runs overlapping `within`. */
function longestRun(segments: Segment[], ok: (s: Segment) => boolean, within?: Stretch) {
  let best: { fromM: number; toM: number; ids: Set<string> } | null = null;
  let cur: { fromM: number; toM: number; ids: Set<string> } | null = null;
  const consider = () => {
    if (!cur || (within && (cur.toM <= within.fromM || cur.fromM >= within.toM))) return;
    if (!best || len(cur) > len(best)) best = { ...cur, ids: new Set(cur.ids) };
  };
  for (const s of segments) {
    if (!ok(s)) {
      consider();
      cur = null;
      continue;
    }
    if (cur && cur.toM === s.fromM) cur.toM = s.toM;
    else cur = { fromM: s.fromM, toM: s.toM, ids: new Set() };
    s.plotIds.forEach((id) => cur!.ids.add(id));
  }
  consider();
  return best as { fromM: number; toM: number; ids: Set<string> } | null;
}

export function analyseCorridor(lengthM: number, plots: PlotSpan[]): CorridorAnalysis {
  const L = Math.max(0, Math.round(lengthM));
  const spans = plots
    .map((p) => {
      const fromM = Math.max(0, Math.min(L, Math.round(Math.min(p.fromM, p.toM))));
      const toM = Math.max(0, Math.min(L, Math.round(Math.max(p.fromM, p.toM))));
      // A plot touching the line at one point still occupies it.
      return { ...p, fromM, toM: toM > fromM ? toM : Math.min(L, fromM + 1) };
    })
    .filter((p) => p.toM > p.fromM);
  const readinessOf = new Map(plots.map((p) => [p.id, p.readiness]));

  // Coverage is constant between consecutive plot ends.
  const cuts = [...new Set([0, L, ...spans.flatMap((p) => [p.fromM, p.toM])])].sort((a, b) => a - b);
  const raw: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const covering = spans.filter((p) => p.fromM <= a && p.toM >= b);
    const state = covering.length ? covering.map((p) => p.readiness).reduce(worst) : "UNMAPPED";
    raw.push({ fromM: a, toM: b, state, plotIds: covering.filter((p) => p.readiness !== "READY").map((p) => p.id) });
  }

  // Close boundary slivers into the worse of their neighbours — conservative:
  // a sliver never turns a gap into ready land it cannot vouch for.
  let segments = merge(raw);
  segments = merge(
    segments.map((s, i) => {
      if (s.state !== "UNMAPPED" || len(s) >= SNAP_M) return s;
      const sides = [segments[i - 1], segments[i + 1]].filter((n): n is Segment => !!n && n.state !== "UNMAPPED");
      if (!sides.length) return s;
      const state = sides.map((n) => n.state as Readiness).reduce(worst);
      return { ...s, state, plotIds: sides.filter((n) => n.state === state).flatMap((n) => n.plotIds) };
    }),
  );

  const totals: Record<SegmentState, number> = { READY: 0, PAID: 0, IN_PROCESS: 0, BLOCKED: 0, UNMAPPED: 0 };
  for (const s of segments) totals[s.state] += len(s);

  const stretches = segments.filter((s) => s.state === "READY").map(({ fromM, toM }) => ({ fromM, toM }));
  const longest = stretches.reduce<Stretch | null>((b, s) => (!b || len(s) > len(b) ? s : b), null);
  const longestLen = longest ? len(longest) : 0;

  const afterPossession = longestRun(segments, (s) => s.state === "READY" || s.state === "PAID");
  const longestAfterPossession =
    afterPossession && afterPossession.ids.size > 0
      ? { fromM: afterPossession.fromM, toM: afterPossession.toM, plots: afterPossession.ids.size }
      : null;

  // Gaps: maximal runs between ready stretches.
  const gaps: Gap[] = [];
  let run: Segment[] = [];
  const flush = () => {
    if (!run.length) return;
    const fromM = run[0].fromM;
    const toM = run[run.length - 1].toM;
    const blockers = [...new Set(run.flatMap((s) => s.plotIds))];
    const unmappedM = run.filter((s) => s.state === "UNMAPPED").reduce((n, s) => n + len(s), 0);
    // Settle every plot in the gap and see what continuous run results.
    const cleared = segments.map((s) => (run.includes(s) && s.state !== "UNMAPPED" ? { ...s, state: "READY" as const } : s));
    const joined = longestRun(cleared, (s) => s.state === "READY", { fromM, toM });
    const joinsM = joined ? len(joined) : null;
    const byReadiness = { PAID: 0, IN_PROCESS: 0, BLOCKED: 0 };
    for (const id of blockers) {
      const r = readinessOf.get(id);
      if (r && r !== "READY") byReadiness[r]++;
    }
    gaps.push({ fromM, toM, blockers, byReadiness, unmappedM, joinsM, gainM: joinsM == null ? 0 : Math.max(0, joinsM - longestLen), rank: 0 });
    run = [];
  };
  for (const s of segments) {
    if (s.state === "READY") flush();
    else run.push(s);
  }
  flush();

  // Most road per plot settled first; a gap that cannot clear goes last.
  const value = (g: Gap) => (g.joinsM == null || !g.blockers.length ? -1 : g.gainM / g.blockers.length);
  [...gaps]
    .sort((a, b) => value(b) - value(a) || (b.joinsM ?? 0) - (a.joinsM ?? 0) || a.blockers.length - b.blockers.length || a.fromM - b.fromM)
    .forEach((g, i) => (g.rank = i + 1));

  return { lengthM: L, segments, totals, stretches, longest, longestAfterPossession, gaps };
}

// ---------------------------------------------------------------------------
// Reading a project from the database
// ---------------------------------------------------------------------------

export function readinessOf(p: { status: ParcelStatus; hasConflict: boolean; openObjections: number; paymentDisputed: boolean }): Readiness {
  if (p.status === "POSSESSED") return "READY";
  if (p.status === "DISPUTED" || p.status === "OBJECTED" || p.openObjections > 0 || p.hasConflict || p.paymentDisputed) return "BLOCKED";
  if (p.status === "COMPENSATED") return "PAID";
  return "IN_PROCESS";
}

/** Why a plot is not in hand yet, most serious first. */
/**
 * Why a plot is not in hand, as a code and its values rather than a sentence, so the screen can
 * say it in the reader's language (screens.corridorReason.*) and format the dates in it.
 */
export type CorridorReason =
  | { code: "objectionHeard"; filed: string; hearing: string }
  | { code: "objectionPending"; filed: string }
  | { code: "conflict" | "paymentDisputed" | "paymentFailed" }
  | { code: "status"; status: ParcelStatus };

export interface CorridorPlot {
  id: string;
  fromM: number;
  toM: number;
  readiness: Readiness;
  status: ParcelStatus;
  /** False when the plot lies outside the viewer's jurisdiction — shown by district only. */
  visible: boolean;
  khasraNo: string | null;
  village: string | null;
  district: string;
  reasons: CorridorReason[];
  /** The desk the plot's case is on, and for how long — Saarthi's question. */
  desk: { proposalId: string; referenceNo: string; role: RoleType; days: number; slaDays: number | null } | null;
}

export interface CorridorReadiness extends CorridorAnalysis {
  plots: CorridorPlot[];
  /** Plots with no mapped boundary, which cannot be placed on the route. */
  unplaced: number;
}

const DAY = 86_400_000;

/** Corridor readiness for one project, or null when it has no alignment. */
export async function corridorReadiness(actor: Actor, projectId: string, now = new Date()): Promise<CorridorReadiness | null> {
  const [route] = await prisma.$queryRaw<{ lengthM: number | null }[]>`
    SELECT ST_Length(alignment::geography) AS "lengthM" FROM "Project" WHERE id = ${projectId};
  `;
  if (!route?.lengthM) return null;

  const spans = await prisma.$queryRaw<{ id: string; fromM: number; toM: number }[]>`
    SELECT p.id,
           MIN(ST_LineLocatePoint(pr.alignment, v.geom)) * ${route.lengthM} AS "fromM",
           MAX(ST_LineLocatePoint(pr.alignment, v.geom)) * ${route.lengthM} AS "toM"
      FROM "LandParcel" p
      JOIN "Project" pr ON pr.id = p."projectId",
           LATERAL ST_DumpPoints(p.geom) v
     WHERE pr.id = ${projectId} AND p.geom IS NOT NULL AND p.status <> 'WITHDRAWN'
     GROUP BY p.id;
  `;

  const [parcels, inScope, unplaced] = await Promise.all([
    prisma.landParcel.findMany({
      where: { id: { in: spans.map((s) => s.id) } },
      select: {
        id: true, khasraNo: true, status: true, hasConflict: true,
        village: { select: { name: true } },
        district: { select: { name: true } },
        objections: { where: OPEN_OBJECTION, select: { status: true, filedAt: true, hearingDate: true }, orderBy: { filedAt: "asc" } },
        compensations: { select: { payments: { select: { status: true } } } },
        proposal: {
          select: {
            id: true, referenceNo: true, currentHolderRole: true,
            stages: { where: { exitedAt: null }, orderBy: { enteredAt: "desc" }, take: 1, select: { enteredAt: true, slaDays: true } },
          },
        },
      },
    }),
    prisma.landParcel.findMany({ where: { AND: [scopeForParcel(actor), { projectId }] }, select: { id: true } }),
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "LandParcel" WHERE "projectId" = ${projectId} AND geom IS NULL AND status <> 'WITHDRAWN';
    `,
  ]);
  const visible = new Set(inScope.map((p) => p.id));
  const spanOf = new Map(spans.map((s) => [s.id, s]));

  const plots: CorridorPlot[] = parcels.map((p) => {
    const payments = p.compensations.flatMap((c) => c.payments.map((x) => x.status));
    const paymentDisputed = payments.includes("DISPUTED");
    const readiness = readinessOf({ status: p.status, hasConflict: p.hasConflict, openObjections: p.objections.length, paymentDisputed });

    const reasons: CorridorReason[] = [];
    if (readiness !== "READY") {
      for (const o of p.objections) {
        reasons.push(
          o.hearingDate
            ? { code: "objectionHeard", filed: o.filedAt.toISOString(), hearing: o.hearingDate.toISOString() }
            : { code: "objectionPending", filed: o.filedAt.toISOString() },
        );
      }
      if (p.hasConflict) reasons.push({ code: "conflict" });
      if (paymentDisputed) reasons.push({ code: "paymentDisputed" });
      else if (payments.includes("FAILED")) reasons.push({ code: "paymentFailed" });
      if (!(p.status === "OBJECTED" && p.objections.length)) reasons.push({ code: "status", status: p.status });
    }

    const stage = p.proposal?.stages[0];
    const desk =
      readiness !== "READY" && p.proposal?.currentHolderRole && stage
        ? {
            proposalId: p.proposal.id,
            referenceNo: p.proposal.referenceNo,
            role: p.proposal.currentHolderRole,
            days: Math.max(0, Math.floor((now.getTime() - stage.enteredAt.getTime()) / DAY)),
            slaDays: stage.slaDays,
          }
        : null;

    const seen = visible.has(p.id);
    const span = spanOf.get(p.id)!;
    return {
      id: p.id,
      fromM: span.fromM,
      toM: span.toM,
      readiness,
      status: p.status,
      visible: seen,
      khasraNo: seen ? p.khasraNo : null,
      village: seen ? p.village.name : null,
      district: p.district.name,
      reasons,
      desk: seen ? desk : null,
    };
  });

  const analysis = analyseCorridor(route.lengthM, plots);
  // Spans rounded as the analysis rounded them, so the strip and the table agree.
  for (const p of plots) {
    p.fromM = Math.round(p.fromM);
    p.toM = Math.round(p.toM);
  }
  return { ...analysis, plots, unplaced: unplaced[0]?.n ?? 0 };
}
