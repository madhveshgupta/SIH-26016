/** Choosing the land a new project needs. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type AcquisitionAct, type LandUseType, type ProjectType } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { createParcel } from "@backend/gis/parcels";
import { findConflictingParcels, recomputeAllConflicts, refreshConflictFlags, setParcelGeometryFromProjectedRing } from "@backend/gis/postgis";
import { writeVertices } from "@backend/gis/vertices";
import { angularRecordedArea, plotAtPoint } from "@backend/integrations/adapters/cadastral-corridor";
import { fetchPlotBoundary } from "@backend/integrations/adapters/plot-boundary";
import { VILLAGE_PORTALS } from "@backend/integrations/adapters/village-portals";
import { createWithReference, nextProjectReference, nextProposalReference } from "@backend/proposals/reference";
import { can } from "@backend/rbac/permissions";
import { lineString, num } from "@backend/validation/request";
import type { Actor } from "@backend/rbac/scope";

/** Who chooses land: the body that needs it (and the administrator). */
export function mayCreateProjects(role: Actor["role"]): boolean {
  return can(role, "project", "create") && can(role, "parcel", "create");
}

export function mayChangeProjectLand(role: Actor["role"]): boolean {
  return can(role, "project", "update") && can(role, "parcel", "create");
}

/** Proposals whose land can still be changed: not yet before any authority. */
export const EDITABLE_PROPOSAL = ["DRAFT", "RETURNED_FOR_CLARIFICATION"] as const;

/** One cap for a single request, so a stray corridor cannot create thousands of rows. */
export const MAX_PLOTS_PER_REQUEST = 400;

export interface Claim {
  projectId: string;
  referenceNo: string;
  name: string;
  status: string;
}

export interface CandidatePlot {
  /** `rec:<parcelId>` or `live:<gisCode>:<plotId>` */
  key: string;
  source: "RECORD" | "LIVE";
  khasraNo: string;
  village: string;
  district: string;
  geometryKind: string;
  /** Area on the revenue record, where published. */
  recordHa: number | null;
  /** Area measured from the boundary. */
  mapHa: number | null;
  /** Other projects that already take this plot. Empty = free. */
  claimedBy: Claim[];
  /** When editing a project: its own parcel for this plot, if it has one. */
  inProject?: { parcelId: string; editable: boolean };
  /** WGS84 Polygon. */
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  /** LIVE only: the portal's answer and its signature. */
  live?: LivePlot;
  signature?: string;
}

export interface LivePlot {
  gisCode: string;
  plotId: string;
  pniu: string | null;
  khasraNo: string;
  srid: number;
  ringUtm: [number, number][];
  recordedAreaSqm: number | null;
  extentErrorM: number;
}

// ---------------------------------------------------------------------------
// Signing live lookups
// ---------------------------------------------------------------------------

function sign(plot: LivePlot): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return createHmac("sha256", secret).update(JSON.stringify(plot)).digest("hex");
}

function verified(plot: LivePlot, signature: string): boolean {
  const expected = Buffer.from(sign(plot), "hex");
  const given = Buffer.from(String(signature), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/** Districts a project can take land in, with how much is mapped and whether the cadastre is live. */
export async function selectableDistricts() {
  const rows = await prisma.$queryRaw<
    { id: string; name: string; state: string; stateId: string; plots: number; gisCodes: string[] | null }[]
  >`
    SELECT d.id, d.name, s.name AS state, s.id AS "stateId",
           COUNT(DISTINCT (p."villageId", p."khasraNo"))::int AS plots,
           ARRAY_AGG(DISTINCT v."cadastralGisCode") FILTER (WHERE v."cadastralGisCode" IS NOT NULL) AS "gisCodes"
      FROM "District" d
      JOIN "State" s ON s.id = d."stateId"
      JOIN "LandParcel" p ON p."districtId" = d.id AND p.geom IS NOT NULL AND p."geometryKind" <> 'ENVELOPE'
      JOIN "Village" v ON v.id = p."villageId"
     GROUP BY d.id, d.name, s.name, s.id
     ORDER BY s.name, d.name;
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    stateId: r.stateId,
    plots: r.plots,
    liveCadastre: (r.gisCodes ?? []).some((g) => VILLAGE_PORTALS[g]),
  }));
}

interface RecordRow {
  id: string;
  khasraNo: string;
  villageId: string;
  village: string;
  district: string;
  geometryKind: string;
  declared: number;
  computed: number | null;
  areaFromRecord: boolean;
  status: string;
  projectId: string;
  projectRef: string;
  project: string;
  proposalStatus: string | null;
  geojson: string;
}

/**
 * Every mapped plot in a district, one entry per real plot (a plot two
 * projects both record is listed once, naming both).
 */
export async function recordCandidates(districtId: string, excludeProjectId?: string): Promise<CandidatePlot[]> {
  const rows = await prisma.$queryRaw<RecordRow[]>`
    SELECT p.id, p."khasraNo", p."villageId", v.name AS village, d.name AS district,
           p."geometryKind"::text AS "geometryKind",
           p."declaredAreaHectares"::float8 AS declared, p."computedAreaHectares"::float8 AS computed,
           p."areaFromRecord", p.status::text AS status,
           pr.id AS "projectId", pr."referenceNo" AS "projectRef", pr.name AS project,
           pp.status::text AS "proposalStatus",
           ST_AsGeoJSON(p.geom, 7) AS geojson
      FROM "LandParcel" p
      JOIN "Village" v  ON v.id = p."villageId"
      JOIN "District" d ON d.id = p."districtId"
      JOIN "Project" pr ON pr.id = p."projectId"
      LEFT JOIN "Proposal" pp ON pp.id = p."proposalId"
     WHERE p."districtId" = ${districtId}
       AND p.geom IS NOT NULL AND p."geometryKind" <> 'ENVELOPE'
     ORDER BY v.name, p."khasraNo", p."createdAt";
  `;
  return groupRecords(rows, excludeProjectId);
}

function groupRecords(rows: RecordRow[], excludeProjectId?: string): CandidatePlot[] {
  const byPlot = new Map<string, RecordRow[]>();
  for (const r of rows) {
    const k = `${r.villageId}|${r.khasraNo}`;
    byPlot.set(k, [...(byPlot.get(k) ?? []), r]);
  }
  return [...byPlot.values()].map((group) => {
    const first = group[0];
    const own = excludeProjectId ? group.find((g) => g.projectId === excludeProjectId) : undefined;
    return {
      key: `rec:${first.id}`,
      source: "RECORD" as const,
      khasraNo: first.khasraNo,
      village: first.village,
      district: first.district,
      geometryKind: first.geometryKind,
      recordHa: first.areaFromRecord ? first.declared : null,
      mapHa: first.computed,
      claimedBy: group
        // A plot left out of another acquisition is not claimed by it.
        .filter((g) => g.status !== "WITHDRAWN" && g.projectId !== excludeProjectId)
        .map((g) => ({ projectId: g.projectId, referenceNo: g.projectRef, name: g.project, status: g.status })),
      ...(own && {
        inProject: {
          parcelId: own.id,
          editable: own.proposalStatus === null || (EDITABLE_PROPOSAL as readonly string[]).includes(own.proposalStatus),
        },
      }),
      geometry: JSON.parse(first.geojson),
    };
  });
}

/**
 * The mapped plots a proposed alignment's right-of-way crosses — the first question in any
 * linear acquisition.
 */
export async function recordPlotsInCorridor(districtId: string, line: [number, number][], rightOfWayM: number): Promise<string[]> {
  // Bounded here as well as at the route: PostGIS will buffer nonsense
  // coordinates and only fail much later, inside a projection.
  const clean = lineString(line);
  const width = num(rightOfWayM, { min: 5, max: 500 });
  if (!clean) throw new Error("Draw the alignment inside India, as at least two points");
  if (width == null) throw new Error("Right-of-way must be between 5 and 500 metres");
  const geojson = JSON.stringify({ type: "LineString", coordinates: clean });
  const rows = await prisma.$queryRaw<{ id: string; villageId: string; khasraNo: string }[]>`
    WITH corridor AS (
      SELECT ST_Buffer(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography, ${width / 2}::float8, 'endcap=flat')::geometry AS geom
    )
    SELECT DISTINCT ON (p."villageId", p."khasraNo") p.id, p."villageId", p."khasraNo"
      FROM "LandParcel" p, corridor c
     WHERE p."districtId" = ${districtId}
       AND p.geom IS NOT NULL AND p."geometryKind" <> 'ENVELOPE'
       AND ST_Intersects(p.geom, c.geom)
       -- A sliver clipped by the band edge is not taken; a real bite is.
       AND ST_Area(ST_Intersection(p.geom, c.geom)::geography) >= LEAST(20, 0.05 * ST_Area(p.geom::geography))
     ORDER BY p."villageId", p."khasraNo", p."createdAt";
  `;
  return rows.map((r) => `rec:${r.id}`);
}

/** Look up the plot under a point on the state's live cadastre. */
/** What a lookup found, as a code the screen words in the viewer's language; `message` is the English. */
export type LookupCode = "noCadastre" | "portalDown" | "onRecord" | "untraceable" | "traced" | "none";
export interface LookupResult {
  plot: CandidatePlot | null;
  code: LookupCode;
  khasraNo?: string;
  message: string;
}

export async function lookupLivePlot(
  districtId: string,
  lat: number,
  lng: number,
  excludeProjectId?: string,
): Promise<LookupResult> {
  const villages = await prisma.village.findMany({
    where: { tehsil: { districtId }, cadastralGisCode: { not: null } },
    select: { name: true, cadastralGisCode: true },
  });
  const portals = villages.flatMap((v) => (VILLAGE_PORTALS[v.cadastralGisCode!] ? [{ village: v.name, portal: VILLAGE_PORTALS[v.cadastralGisCode!] }] : []));
  if (portals.length === 0) {
    return { plot: null, code: "noCadastre", message: "This district has no state cadastre connected for live lookup. Choose from the mapped plots." };
  }

  for (const { portal } of portals) {
    const [pt] = await prisma.$queryRaw<{ x: number; y: number }[]>`
      SELECT ST_X(g)::float8 AS x, ST_Y(g)::float8 AS y
        FROM ST_Transform(ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326), ${portal.srid}::integer) g;
    `;
    let hit;
    try {
      hit = await plotAtPoint(portal, pt.x, pt.y);
    } catch {
      return { plot: null, code: "portalDown", message: "The state cadastral portal did not respond. Try again, or choose from the mapped plots." };
    }
    if (!hit) continue;

    const onRecord = await prisma.landParcel.findMany({
      where: { sourcePlotId: hit.plotId, geometryKind: { not: "ENVELOPE" } },
      select: { id: true, districtId: true },
    });
    if (onRecord.length) {
      const ids = new Set(onRecord.map((r) => `rec:${r.id}`));
      const candidate = (await recordCandidates(onRecord[0].districtId, excludeProjectId)).find((c) => ids.has(c.key));
      if (candidate) return { plot: candidate, code: "onRecord", khasraNo: hit.khasraNo, message: `Khasra ${hit.khasraNo} is already on record.` };
    }

    let boundary;
    try {
      boundary = await fetchPlotBoundary(portal, hit.plotId, hit.extent);
    } catch {
      boundary = null;
    }
    if (!boundary) {
      return {
        plot: null,
        code: "untraceable",
        khasraNo: hit.khasraNo,
        message: `Khasra ${hit.khasraNo} was found, but its boundary could not be traced and verified. It cannot be added from here.`,
      };
    }
    let recorded = hit.recordedAreaSqm;
    if (recorded == null && portal.kind === "angular" && hit.khasraNo) {
      recorded = await angularRecordedArea(portal, hit.khasraNo).catch(() => null);
    }

    const live: LivePlot = {
      gisCode: portal.gisCode,
      plotId: hit.plotId,
      pniu: hit.pniu,
      khasraNo: hit.khasraNo,
      srid: portal.srid,
      ringUtm: boundary.ringUtm.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]),
      recordedAreaSqm: recorded,
      extentErrorM: Number(boundary.extentErrorM.toFixed(3)),
    };
    const ring = JSON.stringify({ type: "Polygon", coordinates: [live.ringUtm] });
    const [geo] = await prisma.$queryRaw<{ geojson: string; ha: number }[]>`
      SELECT ST_AsGeoJSON(g, 7) AS geojson, (ST_Area(g::geography) / 10000)::float8 AS ha
        FROM ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${ring}), ${portal.srid}::integer), 4326) g;
    `;
    const village = await prisma.village.findFirst({
      where: { cadastralGisCode: portal.gisCode, tehsil: { districtId } },
      select: { name: true, tehsil: { select: { district: { select: { name: true } } } } },
    });
    return {
      plot: {
        key: `live:${portal.gisCode}:${hit.plotId}`,
        source: "LIVE",
        khasraNo: hit.khasraNo || "unnumbered",
        village: village?.name ?? "",
        district: village?.tehsil.district.name ?? "",
        geometryKind: "TRACED",
        recordHa: recorded ? recorded / 10_000 : null,
        mapHa: geo.ha,
        claimedBy: [],
        geometry: JSON.parse(geo.geojson),
        live,
        signature: sign(live),
      },
      code: "traced",
      khasraNo: hit.khasraNo,
      message: `Khasra ${hit.khasraNo} traced from the state cadastre.`,
    };
  }
  return { plot: null, code: "none", message: "No surveyed plot at that point in the connected village map." };
}

// ---------------------------------------------------------------------------
// Recording the choice
// ---------------------------------------------------------------------------

export interface LandPicks {
  /** Candidate keys of plots on record: `rec:<parcelId>`. */
  record: string[];
  /** Live lookups exactly as returned, with their signatures. */
  live: { live: LivePlot; signature: string }[];
}

/** Picks from an untrusted request body; live picks are verified later by signature. */
export function parsePicks(v: unknown): LandPicks {
  const o = (v ?? {}) as { record?: unknown; live?: unknown };
  return {
    record: Array.isArray(o.record) ? o.record.map(String).filter((k) => k.startsWith("rec:")) : [],
    live: Array.isArray(o.live) ? (o.live as LandPicks["live"]).filter((l) => l && l.live && typeof l.signature === "string") : [],
  };
}

interface ResolvedPlot {
  key: string;
  villageId: string;
  districtId: string;
  stateId: string;
  khasraNo: string;
  declaredHa: number | null;
  sourceParcelId: string | null;
  live: LivePlot | null;
}

async function resolvePicks(picks: LandPicks): Promise<ResolvedPlot[]> {
  const total = picks.record.length + picks.live.length;
  if (total === 0) throw new Error("Choose at least one plot");
  if (total > MAX_PLOTS_PER_REQUEST) throw new Error(`At most ${MAX_PLOTS_PER_REQUEST} plots at a time`);

  const ids = picks.record.map((k) => k.replace(/^rec:/, ""));
  const sources = await prisma.landParcel.findMany({
    where: { id: { in: ids }, geometryKind: { not: "ENVELOPE" } },
    select: { id: true, villageId: true, districtId: true, khasraNo: true, declaredAreaHectares: true, areaFromRecord: true, district: { select: { stateId: true } } },
  });
  if (sources.length !== new Set(ids).size) throw new Error("Some chosen plots are no longer on record — reload the map");

  const out: ResolvedPlot[] = sources.map((s) => ({
    key: `rec:${s.id}`,
    villageId: s.villageId,
    districtId: s.districtId,
    stateId: s.district.stateId,
    khasraNo: s.khasraNo,
    declaredHa: s.areaFromRecord ? Number(s.declaredAreaHectares) : null,
    sourceParcelId: s.id,
    live: null,
  }));

  for (const { live, signature } of picks.live) {
    if (!verified(live, signature)) throw new Error("A looked-up plot failed verification — look it up again");
    const village = await prisma.village.findFirst({
      where: { cadastralGisCode: live.gisCode },
      select: { id: true, tehsil: { select: { districtId: true, district: { select: { stateId: true } } } } },
    });
    if (!village) throw new Error("Unknown village map");
    out.push({
      key: `live:${live.gisCode}:${live.plotId}`,
      villageId: village.id,
      districtId: village.tehsil.districtId,
      stateId: village.tehsil.district.stateId,
      khasraNo: live.khasraNo.startsWith("/") || !live.khasraNo ? `unnumbered${live.khasraNo}` : live.khasraNo,
      declaredHa: live.recordedAreaSqm ? live.recordedAreaSqm / 10_000 : null,
      sourceParcelId: null,
      live,
    });
  }

  // One parcel per real plot, however it was picked.
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${p.villageId}|${p.khasraNo}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

function landUseFor(ha: number | null): LandUseType {
  return ha == null ? "BARREN" : ha >= 0.5 ? "IRRIGATED" : ha >= 0.15 ? "DRY" : "HOMESTEAD";
}

/** Record one plot as a parcel of the project, on the given proposal. */
async function recordPlot(projectId: string, proposalId: string, plot: ResolvedPlot): Promise<string> {
  const claimed = await prisma.landParcel.count({ where: { villageId: plot.villageId, khasraNo: plot.khasraNo } });

  const parcel = await createParcel({
    projectId,
    proposalId,
    villageId: plot.villageId,
    khasraNo: plot.khasraNo,
    declaredAreaHectares: Math.max(plot.declaredHa ?? 0.0001, 0.0001),
    landUse: landUseFor(plot.declaredHa),
    // A ULPIN identifies a plot, so a plot already recorded keeps its one.
    withoutUlpin: claimed > 0 || !plot.live,
    dataSource: "LIVE",
  });

  if (plot.sourceParcelId) {
    // The same real plot: same boundary, same owners.
    await prisma.$executeRaw`
      UPDATE "LandParcel" p
         SET geom = s.geom, "geometryKind" = s."geometryKind", "computedAreaHectares" = s."computedAreaHectares",
             "centroidLat" = s."centroidLat", "centroidLng" = s."centroidLng",
             "boundaryAccuracyM" = s."boundaryAccuracyM", "sourcePlotId" = s."sourcePlotId",
             "areaFromRecord" = s."areaFromRecord", "declaredAreaHectares" = s."declaredAreaHectares",
             "landUse" = s."landUse", "dataSource" = s."dataSource", "sourceSyncedAt" = s."sourceSyncedAt"
        FROM "LandParcel" s
       WHERE p.id = ${parcel.id} AND s.id = ${plot.sourceParcelId};
    `;
    const owners = await prisma.parcelOwner.findMany({ where: { parcelId: plot.sourceParcelId } });
    if (owners.length) {
      await prisma.parcelOwner.createMany({ data: owners.map((o) => ({ parcelId: parcel.id, ownerId: o.ownerId, sharePct: o.sharePct })) });
    }
    const vertices = await prisma.parcelVertex.findMany({ where: { parcelId: plot.sourceParcelId } });
    if (vertices.length) {
      await prisma.parcelVertex.createMany({
        data: vertices.map((v) => ({ parcelId: parcel.id, seq: v.seq, lat: v.lat, lng: v.lng, elevationM: v.elevationM, elevationSource: v.elevationSource })),
      });
    } else {
      await writeVertices(parcel.id);
    }
  } else if (plot.live) {
    const geo = await setParcelGeometryFromProjectedRing(parcel.id, plot.live.ringUtm, plot.live.srid, "TRACED");
    await prisma.landParcel.update({
      where: { id: parcel.id },
      data: {
        ulpin: claimed > 0 ? null : plot.live.pniu ?? parcel.ulpin,
        boundaryAccuracyM: new Prisma.Decimal(plot.live.extentErrorM),
        sourcePlotId: plot.live.plotId,
        areaFromRecord: plot.declaredHa != null,
        // Without a revenue record the mapped area is the only area there is.
        declaredAreaHectares: new Prisma.Decimal((plot.declaredHa ?? geo.computedAreaHectares).toFixed(4)),
        landUse: landUseFor(plot.declaredHa ?? geo.computedAreaHectares),
      },
    });
    // Owners come from the record of rights, entered by the acquiring authority.
    await writeVertices(parcel.id);
  }

  await refreshConflictFlags(parcel.id);
  return parcel.id;
}

/** The draft proposal a district's plots go on, created if there is none. */
async function draftProposalFor(projectId: string, districtId: string, actorId: string, purpose: string) {
  const existing = await prisma.proposal.findFirst({
    where: { projectId, status: { in: [...EDITABLE_PROPOSAL] }, parcels: { some: { districtId } } },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  const proposal = await createWithReference(
    () => nextProposalReference(districtId),
    (referenceNo) => prisma.proposal.create({
    data: {
      referenceNo,
      projectId,
      status: "DRAFT",
      purpose,
      createdById: actorId,
      currentHolderRole: "LAND_REQUIRING_BODY",
    },
  }),
  );
  await prisma.proposalStage.create({
    data: { proposalId: proposal.id, stage: "DRAFT", actorId, actorRole: "LAND_REQUIRING_BODY", slaDays: 30 },
  });
  await prisma.projectDistrict.upsert({
    where: { projectId_districtId: { projectId, districtId } },
    update: {},
    create: { projectId, districtId },
  });
  return proposal;
}

/** Distance along the alignment for every parcel, and the project's area totals. */
async function refreshProjectLand(projectId: string) {
  await prisma.$executeRaw`
    UPDATE "LandParcel" p
       SET "chainageM" = ROUND(ST_LineLocatePoint(pr.alignment, ST_PointOnSurface(p.geom)) * ST_Length(pr.alignment::geography))::int
      FROM "Project" pr
     WHERE pr.id = ${projectId} AND p."projectId" = pr.id AND pr.alignment IS NOT NULL AND p.geom IS NOT NULL;
  `;
  const proposals = await prisma.proposal.findMany({ where: { projectId }, select: { id: true } });
  for (const p of proposals) {
    const sum = await prisma.landParcel.aggregate({ where: { proposalId: p.id, status: { not: "WITHDRAWN" } }, _sum: { declaredAreaHectares: true } });
    await prisma.proposal.update({ where: { id: p.id }, data: { proposedAreaHectares: sum._sum.declaredAreaHectares ?? 0 } });
  }
  const total = await prisma.landParcel.aggregate({ where: { projectId, status: { not: "WITHDRAWN" } }, _sum: { declaredAreaHectares: true } });
  await prisma.project.update({ where: { id: projectId }, data: { estimatedAreaHectares: total._sum.declaredAreaHectares ?? 0 } });
}

export interface NewProjectInput {
  name: string;
  description?: string | null;
  type: ProjectType;
  governingAct: AcquisitionAct;
  agencyId: string;
  estimatedCostCrore?: number | null;
  /** Centreline, [lng, lat] pairs — optional, for linear projects. */
  alignment?: [number, number][] | null;
  rightOfWayM?: number | null;
  picks: LandPicks;
}

/**
 * Create a project with the land it needs: the project, the states and
 * districts it spans, a draft proposal per district, and a parcel per plot.
 */
export async function createProjectWithLand(input: NewProjectInput, actor: Actor) {
  const name = input.name.trim();
  if (name.length < 5) throw new Error("Give the project a descriptive name");
  const alignment = input.alignment == null ? null : lineString(input.alignment);
  if (input.alignment != null && !alignment) {
    throw new Error("Draw the alignment inside India, as at least two points");
  }
  const rightOfWayM = input.rightOfWayM == null ? null : num(input.rightOfWayM, { min: 5, max: 500 });
  if (input.rightOfWayM != null && rightOfWayM == null) {
    throw new Error("Right-of-way must be between 5 and 500 metres");
  }
  const agency = await prisma.agency.findUnique({ where: { id: input.agencyId }, include: { ministry: true } });
  if (!agency) throw new Error("Unknown agency");

  const plots = await resolvePicks(input.picks);

  const project = await createWithReference(
    () => nextProjectReference(agency.ministry?.code ?? agency.code),
    (referenceNo) => prisma.project.create({
    data: {
      referenceNo,
      name,
      description: input.description?.trim() || null,
      type: input.type,
      governingAct: input.governingAct,
      agencyId: agency.id,
      ministryId: agency.ministryId,
      estimatedCostCrore: input.estimatedCostCrore ?? null,
      rightOfWayM,
      states: { create: [...new Set(plots.map((p) => p.stateId))].map((stateId) => ({ stateId })) },
    },
  }),
  );

  // Everything after the project row is compensated on failure: a half-made
  // project — a name with no land, or land on no proposal — is worse than no
  // project at all, and the caller cannot tell one from the other.
  const parcelIds: string[] = [];
  let conflicts = 0;
  try {
    if (alignment) {
      const line = JSON.stringify({ type: "LineString", coordinates: alignment });
      await prisma.$executeRaw`UPDATE "Project" SET alignment = ST_SetSRID(ST_GeomFromGeoJSON(${line}), 4326) WHERE id = ${project.id};`;
    }

    for (const districtId of new Set(plots.map((p) => p.districtId))) {
      const proposal = await draftProposalFor(project.id, districtId, actor.id, `Land for ${name}`);
      for (const plot of plots.filter((p) => p.districtId === districtId)) {
        parcelIds.push(await recordPlot(project.id, proposal.id, plot));
      }
    }
    await refreshProjectLand(project.id);
    conflicts = await prisma.landParcel.count({ where: { id: { in: parcelIds }, hasConflict: true } });

    await appendAudit({
      actorId: actor.id,
      action: "CREATE",
      entityType: "Project",
      entityId: project.id,
      afterJson: {
        referenceNo: project.referenceNo,
        name,
        governingAct: input.governingAct,
        parcels: parcelIds.length,
        plots: plots.map((p) => p.key),
        conflicts,
      },
    });
  } catch (e) {
    // Cascades the proposals and parcels with it.
    await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
    if (parcelIds.length) await recomputeAllConflicts().catch(() => 0);
    throw e;
  }
  return { id: project.id, referenceNo: project.referenceNo, parcels: parcelIds.length, conflicts };
}

/** Add plots to, or take plots out of, a project whose land is still at draft. */
export async function changeProjectLand(
  projectId: string,
  change: { add: LandPicks; remove: string[] },
  actor: Actor,
) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) throw new Error("Project not found");

  let removed = 0;
  const emptied = new Set<string>();
  if (change.remove.length) {
    const targets = await prisma.landParcel.findMany({
      where: { id: { in: change.remove }, projectId },
      select: { id: true, khasraNo: true, proposalId: true, proposal: { select: { status: true } } },
    });
    if (targets.length !== new Set(change.remove).size) throw new Error("Some plots to remove are not part of this project");
    const locked = targets.filter((t) => t.proposal && !(EDITABLE_PROPOSAL as readonly string[]).includes(t.proposal.status));
    if (locked.length) {
      throw new Error(`Khasra ${locked.map((l) => l.khasraNo).join(", ")} is on a proposal already submitted — return it for clarification first`);
    }
    // Plots that were flagged only because of these parcels must be cleared.
    const neighbours = new Set<string>();
    for (const t of targets) for (const c of await findConflictingParcels(t.id)) neighbours.add(c.id);
    await prisma.landParcel.deleteMany({ where: { id: { in: targets.map((t) => t.id) } } });
    for (const t of targets) if (t.proposalId) emptied.add(t.proposalId);
    for (const n of neighbours) await refreshConflictFlags(n);
    removed = targets.length;
  }

  let added = 0;
  if (change.add.record.length + change.add.live.length > 0) {
    const plots = await resolvePicks(change.add);
    const already = await prisma.landParcel.findMany({ where: { projectId }, select: { villageId: true, khasraNo: true } });
    const have = new Set(already.map((a) => `${a.villageId}|${a.khasraNo}`));
    const fresh = plots.filter((p) => !have.has(`${p.villageId}|${p.khasraNo}`));
    for (const stateId of new Set(fresh.map((p) => p.stateId))) {
      await prisma.projectState.upsert({
        where: { projectId_stateId: { projectId, stateId } },
        update: {},
        create: { projectId, stateId },
      });
    }
    for (const districtId of new Set(fresh.map((p) => p.districtId))) {
      const proposal = await draftProposalFor(projectId, districtId, actor.id, `Land for ${project.name}`);
      for (const plot of fresh.filter((p) => p.districtId === districtId)) {
        await recordPlot(projectId, proposal.id, plot);
        added++;
      }
    }
  }

  // A draft this change left with no land is removed rather than left empty.
  await prisma.proposal.deleteMany({ where: { id: { in: [...emptied] }, status: "DRAFT", parcels: { none: {} } } });
  await refreshProjectLand(projectId);

  await appendAudit({
    actorId: actor.id,
    action: "UPDATE",
    entityType: "Project",
    entityId: projectId,
    afterJson: { landAdded: added, landRemoved: removed, removedParcelIds: change.remove },
  });
  return { added, removed };
}
