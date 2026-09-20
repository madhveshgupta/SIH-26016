/** The standing MIS report pack. */
import { prisma } from "@backend/db/client";
import { computeKpis, stageDwellTimes } from "@backend/analytics/kpi";
import { geoRows } from "@backend/analytics/geo";
import { reconciliation } from "@backend/compensation/disbursement";
import { EMPTY_FILTER, familyFilter, parcelFilter, projectFilter, proposalFilter, type DashboardFilter } from "@backend/analytics/filters";
import { computeClock } from "@backend/statutory/clock";
import { stageFor } from "@backend/workflow/engine";
import { codeText, columnLabel, english, reportWords, type CodeNs, type CountUnit, type Translate } from "@backend/reports/words";
import { scopeForFamily, scopeForOptionalParcel, scopeForParcel, scopeForProject, scopeForProposal, type Actor } from "@backend/rbac/scope";

export type Cell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  /** Right-aligned and summed where numeric. */
  numeric?: boolean;
  format?: "money" | "area" | "date" | "pct";
  /** The values are codes of this kind, worded in the reader's language (backend/reports/words.ts). */
  code?: CodeNs;
}

/** A row count, printed in the totals line of the given column. */
export interface ReportCount {
  key: string;
  unit: CountUnit;
  n: number;
}

export interface ReportResult {
  key: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, Cell>[];
  /** Column totals, where a total means anything. */
  totals?: Record<string, Cell>;
  generatedAt: Date;
  /** What was asked for — printed on the report so a PDF is self-describing. */
  filterNote: string;
}

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  section: "Progress" | "Money" | "People" | "Compliance";
  run(actor: Actor, filter: DashboardFilter): Promise<{ columns: ReportColumn[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell>; count?: ReportCount }>;
}

const date = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const ha = (v: unknown) => Number(Number(v ?? 0).toFixed(4));

export const REPORTS: ReportDefinition[] = [
  // --- Progress -----------------------------------------------------------
  {
    key: "project-status",
    title: "Project status report",
    description: "Every project, its land, and how far acquisition has got.",
    section: "Progress",
    async run(actor, filter) {
      const projects = await prisma.project.findMany({
        where: { AND: [scopeForProject(actor), ...projectFilter(filter)] },
        select: {
          referenceNo: true, name: true, type: true, governingAct: true,
          agency: { select: { code: true } },
          estimatedCostCrore: true,
          parcels: { where: { AND: parcelFilter(filter) }, select: { status: true, declaredAreaHectares: true } },
          proposals: { select: { status: true } },
        },
        orderBy: { referenceNo: "asc" },
      });
      const rows = projects.map((p) => {
        const area = p.parcels.reduce((a, x) => a + Number(x.declaredAreaHectares), 0);
        const possessed = p.parcels.filter((x) => x.status === "POSSESSED");
        return {
          reference: p.referenceNo,
          project: p.name,
          type: p.type,
          act: p.governingAct,
          agency: p.agency.code,
          cases: p.proposals.length,
          parcels: p.parcels.length,
          areaHa: ha(area),
          possessedHa: ha(possessed.reduce((a, x) => a + Number(x.declaredAreaHectares), 0)),
          progressPct: p.parcels.length ? Math.round((possessed.length / p.parcels.length) * 100) : 0,
          costCrore: p.estimatedCostCrore ? Number(p.estimatedCostCrore) : null,
        };
      });
      return {
        columns: [
          { key: "reference", label: "Reference" },
          { key: "project", label: "Project" },
          { key: "type", label: "Type", code: "projectType" },
          { key: "act", label: "Acquired under", code: "act" },
          { key: "agency", label: "Agency" },
          { key: "cases", label: "Cases", numeric: true },
          { key: "parcels", label: "Parcels", numeric: true },
          { key: "areaHa", label: "Area (ha)", numeric: true, format: "area" },
          { key: "possessedHa", label: "Possessed (ha)", numeric: true, format: "area" },
          { key: "progressPct", label: "Progress", numeric: true, format: "pct" },
          { key: "costCrore", label: "Cost (₹ crore)", numeric: true },
        ],
        rows,
        count: { key: "project", unit: "projects", n: rows.length },
        totals: {
          parcels: rows.reduce((a, r) => a + r.parcels, 0),
          areaHa: ha(rows.reduce((a, r) => a + r.areaHa, 0)),
          possessedHa: ha(rows.reduce((a, r) => a + r.possessedHa, 0)),
        },
      };
    },
  },
  {
    key: "state-progress",
    title: "State-wise progress",
    description: "Land, possession and money by state — the national review sheet.",
    section: "Progress",
    async run(actor, filter) {
      const rows = (await geoRows(actor, null, filter)).map((r) => ({
        state: r.name,
        projects: r.projects,
        parcels: r.parcels,
        areaProposedHa: r.areaProposedHa,
        areaAcquiredHa: r.areaAcquiredHa,
        possessedPct: r.possessedPct,
        compensationPaid: Math.round(r.compensationPaid),
        compensationOutstanding: Math.round(r.compensationOutstanding),
        families: r.affectedFamilies,
        atRisk: r.casesAtRisk,
      }));
      return {
        columns: [
          { key: "state", label: "State / UT" },
          { key: "projects", label: "Projects", numeric: true },
          { key: "parcels", label: "Parcels", numeric: true },
          { key: "areaProposedHa", label: "Proposed (ha)", numeric: true, format: "area" },
          { key: "areaAcquiredHa", label: "Acquired (ha)", numeric: true, format: "area" },
          { key: "possessedPct", label: "Possessed", numeric: true, format: "pct" },
          { key: "compensationPaid", label: "Paid", numeric: true, format: "money" },
          { key: "compensationOutstanding", label: "Outstanding", numeric: true, format: "money" },
          { key: "families", label: "Families", numeric: true },
          { key: "atRisk", label: "At risk", numeric: true },
        ],
        rows,
        count: { key: "state", unit: "states", n: rows.length },
        totals: {
          parcels: rows.reduce((a, r) => a + r.parcels, 0),
          areaProposedHa: ha(rows.reduce((a, r) => a + r.areaProposedHa, 0)),
          areaAcquiredHa: ha(rows.reduce((a, r) => a + r.areaAcquiredHa, 0)),
          compensationPaid: rows.reduce((a, r) => a + r.compensationPaid, 0),
          compensationOutstanding: rows.reduce((a, r) => a + r.compensationOutstanding, 0),
        },
      };
    },
  },
  {
    key: "district-ranking",
    title: "District performance ranking",
    description: "Districts ranked by how much of their notified land they have actually taken possession of.",
    section: "Progress",
    async run(actor, filter) {
      const parcels = await prisma.landParcel.findMany({
        where: { AND: [scopeForParcel(actor), ...parcelFilter(filter)] },
        select: { status: true, declaredAreaHectares: true, district: { select: { id: true, name: true, state: { select: { name: true } } } } },
      });
      const by = new Map<string, { district: string; state: string; parcels: number; areaHa: number; possessed: number; objected: number }>();
      for (const p of parcels) {
        const row = by.get(p.district.id) ?? { district: p.district.name, state: p.district.state.name, parcels: 0, areaHa: 0, possessed: 0, objected: 0 };
        row.parcels++;
        row.areaHa += Number(p.declaredAreaHectares);
        if (p.status === "POSSESSED") row.possessed++;
        if (p.status === "OBJECTED") row.objected++;
        by.set(p.district.id, row);
      }
      const rows = [...by.values()]
        .map((r) => ({ ...r, areaHa: ha(r.areaHa), possessedPct: r.parcels ? Math.round((r.possessed / r.parcels) * 100) : 0 }))
        .sort((a, b) => b.possessedPct - a.possessedPct || b.parcels - a.parcels)
        .map((r, i) => ({ rank: i + 1, ...r }));
      return {
        columns: [
          { key: "rank", label: "Rank", numeric: true },
          { key: "district", label: "District" },
          { key: "state", label: "State" },
          { key: "parcels", label: "Parcels", numeric: true },
          { key: "areaHa", label: "Area (ha)", numeric: true, format: "area" },
          { key: "possessedPct", label: "Possession", numeric: true, format: "pct" },
          { key: "objected", label: "Under objection", numeric: true },
        ],
        rows,
      };
    },
  },
  {
    key: "possession-status",
    title: "Possession status report",
    description: "Plot by plot: what has been taken, what is paid for, and what is still blocked.",
    section: "Progress",
    async run(actor, filter) {
      const parcels = await prisma.landParcel.findMany({
        where: { AND: [scopeForParcel(actor), ...parcelFilter(filter)] },
        take: 5000,
        select: {
          khasraNo: true, status: true, declaredAreaHectares: true, hasConflict: true,
          village: { select: { name: true } }, district: { select: { name: true } },
          project: { select: { name: true } },
          possession: { select: { takenOn: true } },
          compensations: { select: { payableToOwner: true, payments: { select: { amount: true, status: true } } } },
        },
        orderBy: [{ district: { name: "asc" } }, { khasraNo: "asc" }],
      });
      const rows = parcels.map((p) => {
        const assessed = p.compensations.reduce((a, c) => a + Number(c.payableToOwner), 0);
        const paid = p.compensations.reduce(
          (a, c) => a + c.payments.filter((x) => x.status === "PAID" || x.status === "DEPOSITED_WITH_AUTHORITY").reduce((b, x) => b + Number(x.amount), 0),
          0,
        );
        return {
          khasra: p.khasraNo,
          village: p.village.name,
          district: p.district.name,
          project: p.project.name,
          areaHa: ha(p.declaredAreaHectares),
          status: p.status,
          possessionTaken: date(p.possession?.takenOn),
          compensationAssessed: Math.round(assessed),
          compensationPaid: Math.round(paid),
          // s.38: possession is unlawful until compensation is paid in full.
          blockedByPayment: p.status !== "POSSESSED" && assessed > 0 && paid < assessed ? "YES" : "NO",
          claimedTwice: p.hasConflict ? "YES" : "NO",
        };
      });
      return {
        columns: [
          { key: "khasra", label: "Khasra" },
          { key: "village", label: "Village" },
          { key: "district", label: "District" },
          { key: "project", label: "Project" },
          { key: "areaHa", label: "Area (ha)", numeric: true, format: "area" },
          { key: "status", label: "Status", code: "parcelStatus" },
          { key: "possessionTaken", label: "Possession taken", format: "date" },
          { key: "compensationAssessed", label: "Assessed", numeric: true, format: "money" },
          { key: "compensationPaid", label: "Paid", numeric: true, format: "money" },
          { key: "blockedByPayment", label: "Blocked by payment", code: "yesNo" },
          { key: "claimedTwice", label: "Claimed twice", code: "yesNo" },
        ],
        rows,
        count: { key: "khasra", unit: "plots", n: rows.length },
        totals: {
          areaHa: ha(rows.reduce((a, r) => a + r.areaHa, 0)),
          compensationAssessed: rows.reduce((a, r) => a + r.compensationAssessed, 0),
          compensationPaid: rows.reduce((a, r) => a + r.compensationPaid, 0),
        },
      };
    },
  },
  {
    key: "land-bank",
    title: "Land bank summary",
    description: "Land already in government possession, by district and land use.",
    section: "Progress",
    async run(actor, filter) {
      const parcels = await prisma.landParcel.findMany({
        where: { AND: [scopeForParcel(actor), ...parcelFilter(filter), { status: "POSSESSED" }] },
        select: { landUse: true, declaredAreaHectares: true, district: { select: { name: true, state: { select: { name: true } } } } },
      });
      const by = new Map<string, { district: string; state: string; landUse: string; parcels: number; areaHa: number }>();
      for (const p of parcels) {
        const k = `${p.district.name}|${p.landUse}`;
        const row = by.get(k) ?? { district: p.district.name, state: p.district.state.name, landUse: p.landUse as string, parcels: 0, areaHa: 0 };
        row.parcels++;
        row.areaHa += Number(p.declaredAreaHectares);
        by.set(k, row);
      }
      const rows = [...by.values()].map((r) => ({ ...r, areaHa: ha(r.areaHa) })).sort((a, b) => b.areaHa - a.areaHa);
      return {
        columns: [
          { key: "district", label: "District" },
          { key: "state", label: "State" },
          { key: "landUse", label: "Land use", code: "landUse" },
          { key: "parcels", label: "Parcels", numeric: true },
          { key: "areaHa", label: "Area held (ha)", numeric: true, format: "area" },
        ],
        rows,
        count: { key: "district", unit: "rows", n: rows.length },
        totals: { parcels: rows.reduce((a, r) => a + r.parcels, 0), areaHa: ha(rows.reduce((a, r) => a + r.areaHa, 0)) },
      };
    },
  },

  // --- Money ---------------------------------------------------------------
  {
    key: "disbursement-statement",
    title: "Compensation disbursement statement",
    description: "Owner by owner: assessed, paid, how, and what is still owed.",
    section: "Money",
    async run(actor, filter) {
      const records = await prisma.compensationRecord.findMany({
        where: { parcel: { AND: [scopeForParcel(actor), ...parcelFilter(filter)] } },
        take: 5000,
        select: {
          payableToOwner: true, assessedAt: true,
          owner: { select: { fullName: true, bankAccountMasked: true } },
          award: { select: { awardNo: true } },
          parcel: { select: { khasraNo: true, district: { select: { name: true } }, project: { select: { name: true } } } },
          payments: { select: { amount: true, status: true, utrNumber: true, paidAt: true }, orderBy: { createdAt: "desc" } },
        },
        orderBy: { assessedAt: "asc" },
      });
      const rows = records.map((r) => {
        const latest = r.payments[0];
        const credited = r.payments
          .filter((p) => p.status === "PAID" || p.status === "DEPOSITED_WITH_AUTHORITY")
          .reduce((a, p) => a + Number(p.amount), 0);
        return {
          owner: r.owner.fullName,
          account: r.owner.bankAccountMasked ?? "NOT_ON_RECORD",
          khasra: r.parcel.khasraNo,
          district: r.parcel.district.name,
          project: r.parcel.project.name,
          award: r.award?.awardNo ?? null,
          assessed: Math.round(Number(r.payableToOwner)),
          paid: Math.round(credited),
          outstanding: Math.round(Math.max(0, Number(r.payableToOwner) - credited)),
          status: latest?.status ?? "PENDING",
          utr: latest?.utrNumber ?? null,
          paidOn: date(latest?.paidAt),
        };
      });
      return {
        columns: [
          { key: "owner", label: "Owner" },
          { key: "account", label: "Account", code: "account" },
          { key: "khasra", label: "Khasra" },
          { key: "district", label: "District" },
          { key: "project", label: "Project" },
          { key: "award", label: "Award" },
          { key: "assessed", label: "Assessed", numeric: true, format: "money" },
          { key: "paid", label: "Paid", numeric: true, format: "money" },
          { key: "outstanding", label: "Outstanding", numeric: true, format: "money" },
          { key: "status", label: "Status", code: "paymentStatus" },
          { key: "utr", label: "UTR" },
          { key: "paidOn", label: "Paid on", format: "date" },
        ],
        rows,
        count: { key: "owner", unit: "records", n: rows.length },
        totals: {
          assessed: rows.reduce((a, r) => a + r.assessed, 0),
          paid: rows.reduce((a, r) => a + r.paid, 0),
          outstanding: rows.reduce((a, r) => a + r.outstanding, 0),
        },
      };
    },
  },
  {
    key: "outstanding-by-district",
    title: "Outstanding compensation by district",
    description: "Where the unpaid money is — the queue that blocks possession under s.38.",
    section: "Money",
    async run(actor) {
      const rec = await reconciliation(actor);
      const rows = rec.byDistrict.map((d) => ({
        district: d.district,
        state: d.state,
        records: d.records,
        assessed: Math.round(d.assessed),
        paid: Math.round(d.paid),
        outstanding: Math.round(d.outstanding),
        paidPct: d.assessed ? Math.round((d.paid / d.assessed) * 100) : 0,
      }));
      return {
        columns: [
          { key: "district", label: "District" },
          { key: "state", label: "State" },
          { key: "records", label: "Records", numeric: true },
          { key: "assessed", label: "Assessed", numeric: true, format: "money" },
          { key: "paid", label: "Paid", numeric: true, format: "money" },
          { key: "outstanding", label: "Outstanding", numeric: true, format: "money" },
          { key: "paidPct", label: "Paid", numeric: true, format: "pct" },
        ],
        rows,
        count: { key: "district", unit: "districts", n: rows.length },
        totals: {
          assessed: rows.reduce((a, r) => a + r.assessed, 0),
          paid: rows.reduce((a, r) => a + r.paid, 0),
          outstanding: rows.reduce((a, r) => a + r.outstanding, 0),
        },
      };
    },
  },

  // --- People --------------------------------------------------------------
  {
    key: "affected-families",
    title: "Affected families register",
    description: "Every family recorded as affected, their category and where their entitlement has got to.",
    section: "People",
    async run(actor, filter) {
      const families = await prisma.affectedFamily.findMany({
        where: { AND: [scopeForFamily(actor), ...familyFilter(filter)] },
        take: 5000,
        select: {
          familyHeadName: true, category: true, memberCount: true, isDisplaced: true, status: true,
          village: { select: { name: true, tehsil: { select: { district: { select: { name: true } } } } } },
        },
        orderBy: { familyHeadName: "asc" },
      });
      const rows = families.map((f) => ({
        family: f.familyHeadName,
        village: f.village.name,
        district: f.village.tehsil.district.name,
        category: f.category as string,
        members: f.memberCount,
        displaced: f.isDisplaced ? "YES" : "NO",
        status: f.status as string,
      }));
      return {
        columns: [
          { key: "family", label: "Family head" },
          { key: "village", label: "Village" },
          { key: "district", label: "District" },
          { key: "category", label: "Category", code: "rnrCategory" },
          { key: "members", label: "Members", numeric: true },
          { key: "displaced", label: "Displaced", code: "yesNo" },
          { key: "status", label: "R&R status", code: "rnrStatus" },
        ],
        rows,
        count: { key: "family", unit: "families", n: rows.length },
        totals: { members: rows.reduce((a, r) => a + r.members, 0) },
      };
    },
  },
  {
    key: "rnr-progress",
    title: "R&R progress report",
    description: "Resettlement by status and category, including the SC/ST families with enhanced entitlements.",
    section: "People",
    async run(actor, filter) {
      const families = await prisma.affectedFamily.findMany({
        where: { AND: [scopeForFamily(actor), ...familyFilter(filter)] },
        select: { status: true, category: true, isDisplaced: true },
      });
      const by = new Map<string, { category: string; families: number; displaced: number; resettled: number; pending: number }>();
      for (const f of families) {
        const key = f.category;
        const row = by.get(key) ?? { category: key as string, families: 0, displaced: 0, resettled: 0, pending: 0 };
        row.families++;
        if (f.isDisplaced) row.displaced++;
        if (f.status === "RESETTLED" || f.status === "LIVELIHOOD_RESTORED") row.resettled++;
        else row.pending++;
        by.set(key, row);
      }
      const rows = [...by.values()]
        .map((r) => ({ ...r, completionPct: r.families ? Math.round((r.resettled / r.families) * 100) : 0 }))
        .sort((a, b) => b.families - a.families);
      return {
        columns: [
          { key: "category", label: "Category", code: "rnrCategory" },
          { key: "families", label: "Families", numeric: true },
          { key: "displaced", label: "Displaced", numeric: true },
          { key: "resettled", label: "Resettled", numeric: true },
          { key: "pending", label: "Pending", numeric: true },
          { key: "completionPct", label: "Complete", numeric: true, format: "pct" },
        ],
        rows,
        count: { key: "category", unit: "categories", n: rows.length },
        totals: {
          families: rows.reduce((a, r) => a + r.families, 0),
          displaced: rows.reduce((a, r) => a + r.displaced, 0),
          resettled: rows.reduce((a, r) => a + r.resettled, 0),
          pending: rows.reduce((a, r) => a + r.pending, 0),
        },
      };
    },
  },

  // --- Compliance ----------------------------------------------------------
  {
    key: "statutory-compliance",
    title: "Statutory compliance report",
    description: "Every open case against its statutory deadline, worst first.",
    section: "Compliance",
    async run(actor, filter) {
      const proposals = await prisma.proposal.findMany({
        where: { AND: [scopeForProposal(actor), ...proposalFilter(filter), { status: { notIn: ["CLOSED", "REJECTED", "LAPSED"] } }] },
        select: {
          referenceNo: true, status: true, createdAt: true,
          project: { select: { name: true, governingAct: true } },
          stages: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
          _count: { select: { objections: true, parcels: true } },
        },
      });
      const rows = proposals
        .map((p) => {
          const open = p.stages[0];
          const clock = computeClock(p.project.governingAct, p.status, open?.enteredAt ?? p.createdAt, open?.statutoryDeadline ?? null);
          const stage = stageFor(p.project.governingAct, p.status);
          return {
            reference: p.referenceNo,
            project: p.project.name,
            stage: `${p.project.governingAct}|${p.status}`,
            section: stage?.section ?? null,
            enteredStage: date(open?.enteredAt ?? p.createdAt),
            deadline: date(clock.deadline),
            daysRemaining: clock.daysRemaining,
            severity: clock.severity,
            consequence: clock.isFatal ? "LAPSE" : "ESCALATION",
            objections: p._count.objections,
            parcels: p._count.parcels,
          };
        })
        .sort((a, b) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9));
      return {
        columns: [
          { key: "reference", label: "Case" },
          { key: "project", label: "Project" },
          { key: "stage", label: "Stage", code: "stage" },
          { key: "section", label: "Section" },
          { key: "enteredStage", label: "At this stage since", format: "date" },
          { key: "deadline", label: "Deadline", format: "date" },
          { key: "daysRemaining", label: "Days left", numeric: true },
          { key: "severity", label: "Risk", code: "severity" },
          { key: "consequence", label: "If missed", code: "consequence" },
          { key: "objections", label: "Objections", numeric: true },
          { key: "parcels", label: "Parcels", numeric: true },
        ],
        rows,
        count: { key: "reference", unit: "openCases", n: rows.length },
      };
    },
  },
  {
    key: "pending-approvals",
    title: "Pending approvals ageing report",
    description: "How long work has been sitting on each desk, by stage.",
    section: "Compliance",
    async run(actor, filter) {
      const dwell = await stageDwellTimes(actor, filter);
      const rows = dwell.map((d) => ({
        stage: `LARR_2013|${d.stage}`,
        cases: Number(d.cases),
        avgDays: Math.round(d.avgDays),
        assessment: d.avgDays > 180 ? "ESCALATE" : d.avgDays > 60 ? "SLOW" : "ON_TARGET",
      }));
      return {
        columns: [
          { key: "stage", label: "Stage", code: "stage" },
          { key: "cases", label: "Times entered", numeric: true },
          { key: "avgDays", label: "Average days held", numeric: true },
          { key: "assessment", label: "Assessment", code: "assessment" },
        ],
        rows,
      };
    },
  },
  {
    key: "objections-register",
    title: "Objections register",
    description: "Objections filed, heard and decided — with the reasons given.",
    section: "Compliance",
    async run(actor, filter) {
      const objections = await prisma.objection.findMany({
        where: { AND: [{ proposal: { AND: [scopeForProposal(actor), ...proposalFilter(filter)] } }, scopeForOptionalParcel(actor)] },
        take: 2000,
        select: {
          objectorName: true, grounds: true, status: true, filedAt: true, hearingDate: true, decidedAt: true,
          decision: true, decisionReasons: true, filedByUserId: true,
          parcel: { select: { khasraNo: true, district: { select: { name: true } } } },
          proposal: { select: { referenceNo: true } },
        },
        orderBy: { filedAt: "desc" },
      });
      const rows = objections.map((o) => ({
        case: o.proposal.referenceNo,
        khasra: o.parcel?.khasraNo ?? null,
        district: o.parcel?.district.name ?? null,
        objector: o.objectorName,
        filedOnline: o.filedByUserId ? "YES" : "NO",
        filed: date(o.filedAt),
        hearing: date(o.hearingDate),
        decided: date(o.decidedAt),
        outcome: o.status as string,
        grounds: o.grounds.slice(0, 300),
        reasons: o.decisionReasons?.slice(0, 300) ?? null,
      }));
      return {
        columns: [
          { key: "case", label: "Case" },
          { key: "khasra", label: "Khasra" },
          { key: "district", label: "District" },
          { key: "objector", label: "Objector" },
          { key: "filedOnline", label: "Filed online", code: "yesNo" },
          { key: "filed", label: "Filed", format: "date" },
          { key: "hearing", label: "Hearing", format: "date" },
          { key: "decided", label: "Decided", format: "date" },
          { key: "outcome", label: "Outcome", code: "objectionStatus" },
          { key: "grounds", label: "Grounds" },
          { key: "reasons", label: "Reasons for the decision" },
        ],
        rows,
        count: { key: "case", unit: "objections", n: rows.length },
      };
    },
  },
  {
    key: "headline-kpis",
    title: "Headline figures",
    description: "The figures the problem statement names, as a one-page statement.",
    section: "Progress",
    async run(actor, filter) {
      const k = await computeKpis(actor, filter);
      const rows = [
        { figure: "AREA_PROPOSED", value: ha(k.areaProposedHa), unit: "HA" },
        { figure: "AREA_NOTIFIED", value: ha(k.areaNotifiedHa), unit: "HA" },
        { figure: "AREA_ACQUIRED", value: ha(k.areaAcquiredHa), unit: "HA" },
        { figure: "PARCELS_POSSESSED", value: k.parcelsPossessed, unit: `OF:${k.parcelsTotal}` },
        { figure: "COMP_ASSESSED", value: Math.round(k.compensationAssessed), unit: "RUPEE" },
        { figure: "COMP_PAID", value: Math.round(k.compensationPaid), unit: "RUPEE" },
        { figure: "COMP_OUTSTANDING", value: Math.round(k.compensationOutstanding), unit: "RUPEE" },
        { figure: "AFFECTED", value: k.affectedFamilies, unit: "" },
        { figure: "DISPLACED", value: k.displacedFamilies, unit: "" },
        { figure: "RNR", value: k.rnrCompletionPct, unit: "PCT" },
        { figure: "PROGRESS", value: k.projectProgressPct, unit: "PCT" },
        { figure: "TIMELINE", value: k.timelineAdherencePct, unit: "PCT" },
        { figure: "NOTIFICATIONS", value: k.notificationsIssued, unit: "" },
        { figure: "AWARDS", value: k.awardsDeclared, unit: "" },
        { figure: "AT_RISK", value: k.casesAtRiskOfLapse, unit: "" },
        { figure: "BREACHED", value: k.casesBreached, unit: "" },
        { figure: "CONFLICTS", value: k.conflictingParcels, unit: "" },
      ];
      return {
        columns: [
          { key: "figure", label: "Figure", code: "figure" },
          { key: "value", label: "Value", numeric: true },
          { key: "unit", label: "Unit", code: "unit" },
        ],
        rows,
      };
    },
  },
];

export function reportByKey(key: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.key === key);
}

/** Say in words what the report was filtered to, for the printed page. */
export async function describeFilter(filter: DashboardFilter, t: Translate = english): Promise<string> {
  const none = t("screens.reportPack.filterNone");
  if (filter === EMPTY_FILTER) return none;
  const parts: string[] = [];
  if (filter.stateId) {
    const state = await prisma.state.findUnique({ where: { id: filter.stateId }, select: { name: true } });
    if (state) parts.push(state.name);
  }
  if (filter.districtId) {
    const district = await prisma.district.findUnique({ where: { id: filter.districtId }, select: { name: true } });
    if (district) parts.push(t("screens.reportPack.filterDistrict", { name: district.name }));
  }
  if (filter.projectType) {
    parts.push(t("screens.reportPack.filterType", { type: codeText(t, "projectType", filter.projectType) }));
  }
  if (filter.ministryId) {
    const ministry = await prisma.ministry.findUnique({ where: { id: filter.ministryId }, select: { code: true } });
    if (ministry) parts.push(ministry.code);
  }
  if (filter.since) parts.push(t("screens.reportPack.filterSince", { date: date(filter.since) ?? "" }));
  return parts.length ? parts.join(" · ") : none;
}

/** Put a built report into words: headers, coded cells and the row count. */
export function wordReport(
  raw: { columns: ReportColumn[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell>; count?: ReportCount },
  t: Translate,
): { columns: ReportColumn[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell> } {
  const coded = raw.columns.filter((c) => c.code);
  const rows = coded.length
    ? raw.rows.map((row) => {
        const out = { ...row };
        for (const c of coded) {
          const v = out[c.key];
          if (typeof v === "string" && v) out[c.key] = codeText(t, c.code!, v);
        }
        return out;
      })
    : raw.rows;
  const totals = raw.count
    ? { ...raw.totals, [raw.count.key]: t(`screens.reportPack.count_${raw.count.unit}`, { count: raw.count.n }) }
    : raw.totals;
  return {
    columns: raw.columns.map((c) => ({ key: c.key, label: columnLabel(t, c.label), numeric: c.numeric, format: c.format })),
    rows,
    totals,
  };
}

/** Run a standing report by key, worded in the given language (English by default). */
export async function runReport(key: string, actor: Actor, filter: DashboardFilter = EMPTY_FILTER, t: Translate = english): Promise<ReportResult> {
  const definition = reportByKey(key);
  if (!definition) throw new Error(`Unknown report: ${key}`);
  const { columns, rows, totals } = wordReport(await definition.run(actor, filter), t);
  return {
    key: definition.key,
    ...reportWords(t, definition.key, definition),
    columns,
    rows,
    totals,
    generatedAt: new Date(),
    filterNote: await describeFilter(filter, t),
  };
}
