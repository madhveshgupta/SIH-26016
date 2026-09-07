import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel } from "@backend/rbac/scope";
import { prisma } from "@backend/db/client";
import { boundaryPoints } from "@backend/gis/vertices";
import { findConflictingParcels } from "@backend/gis/postgis";
import { apiJson } from "@backend/http/respond";

/** One parcel's full record for the Plot Details drawer on the land map. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "parcel", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });
  const { id } = await params;

  const parcel = await prisma.landParcel.findFirst({
    where: { AND: [{ id }, scopeForParcel(s)] },
    include: {
      project: {
        select: {
          id: true, name: true, referenceNo: true, type: true, governingAct: true,
          rightOfWayM: true, estimatedAreaHectares: true,
          ministry: { select: { name: true } },
          agency: { select: { name: true, code: true } },
        },
      },
      proposal: { select: { id: true, referenceNo: true, status: true } },
      village: { select: { name: true, tehsil: { select: { name: true } } } },
      district: { select: { name: true, state: { select: { name: true } } } },
      owners: { include: { owner: { select: { id: true, fullName: true, fatherName: true, userId: true } } } },
      possession: { select: { takenOn: true, handedOverBy: true, receivedBy: true, remarks: true } },
      awards: { select: { id: true, awardNo: true, declaredOn: true, publishedOn: true, totalAmount: true, isRnRAward: true }, orderBy: { declaredOn: "asc" } },
      objections: {
        select: { id: true, filedAt: true, status: true, grounds: true, objectorName: true, hearingDate: true, decidedAt: true },
        orderBy: { filedAt: "asc" },
      },
      compensations: {
        select: {
          id: true, payableToOwner: true, totalCompensation: true, assessedAt: true,
          owner: { select: { id: true, fullName: true } },
          payments: { select: { amount: true, status: true, paidAt: true, utrNumber: true } },
        },
      },
      fieldSurveys: {
        orderBy: { capturedAt: "desc" }, take: 5,
        select: { id: true, kind: true, capturedAt: true, walkedAreaHectares: true, surveyor: { select: { fullName: true } } },
      },
    },
  });
  if (!parcel) return await apiJson({ error: "Not found" }, { status: 404 });

  // Plots whose boundary touches this one, whichever project claims them —
  // "nearby" on a cadastral map means adjoining, not "within N metres of the
  // centroid", which would list plots across a river.
  const [points, conflicts, nearbyRows, audit, projectTotals, geomRow] = await Promise.all([
    boundaryPoints(id),
    findConflictingParcels(id),
    prisma.$queryRaw<
      { id: string; khasraNo: string; status: string; village: string; project: string; projectId: string;
        mapHa: number | null; metres: number; adjoining: boolean }[]
    >`
      SELECT n.id, n."khasraNo", n.status::text AS status, v.name AS village,
             pr.name AS project, pr.id AS "projectId",
             n."computedAreaHectares"::float8 AS "mapHa",
             ST_Distance(n.geom::geography, p.geom::geography)::float8 AS metres,
             ST_Intersects(n.geom, p.geom) AS adjoining
        FROM "LandParcel" p
        JOIN "LandParcel" n ON n.id <> p.id AND n.geom IS NOT NULL AND n."geometryKind" <> 'ENVELOPE'
        JOIN "Village" v  ON v.id = n."villageId"
        JOIN "Project" pr ON pr.id = n."projectId"
       WHERE p.id = ${id} AND p.geom IS NOT NULL
         AND ST_DWithin(n.geom::geography, p.geom::geography, 750)
       ORDER BY ST_Distance(n.geom::geography, p.geom::geography), n."khasraNo"
       LIMIT 12;
    `,
    prisma.auditLog.findMany({
      where: { entityType: "LandParcel", entityId: id },
      orderBy: { sequence: "desc" },
      take: 25,
      select: { id: true, action: true, createdAt: true, afterJson: true, actor: { select: { fullName: true, role: true } } },
    }),
    prisma.landParcel.groupBy({
      by: ["status"],
      where: { projectId: parcel.projectId },
      _count: { _all: true },
    }),
    // The outline itself, so the drawer can draw its own preview when it was
    // opened from a row rather than from a plot already on the map.
    prisma.$queryRaw<{ geojson: string | null }[]>`
      SELECT ST_AsGeoJSON(geom, 7) AS geojson FROM "LandParcel" WHERE id = ${id}
    `,
  ]);

  // Only the nearby plots this officer is allowed to see get named.
  const visibleNearby = nearbyRows.length
    ? new Set(
        (await prisma.landParcel.findMany({
          where: { AND: [{ id: { in: nearbyRows.map((n) => n.id) } }, scopeForParcel(s)] },
          select: { id: true },
        })).map((p) => p.id),
      )
    : new Set<string>();

  const otherProjects = conflicts.length
    ? await prisma.project.findMany({
        where: { id: { in: conflicts.map((c) => c.projectId) } },
        select: { id: true, name: true, referenceNo: true, type: true },
      })
    : [];

  const record = parcel.areaFromRecord ? Number(parcel.declaredAreaHectares) : null;
  const mapped = parcel.computedAreaHectares == null ? null : Number(parcel.computedAreaHectares);
  const assessed = parcel.compensations.reduce((a, c) => a + Number(c.payableToOwner), 0);
  const paid = parcel.compensations
    .flatMap((c) => c.payments)
    .filter((p) => p.status === "PAID")
    .reduce((a, p) => a + Number(p.amount), 0);
  const totalParcels = projectTotals.reduce((a, g) => a + g._count._all, 0);
  const possessedParcels = projectTotals.find((g) => g.status === "POSSESSED")?._count._all ?? 0;

  return await apiJson({
    id: parcel.id,
    khasraNo: parcel.khasraNo,
    ulpin: parcel.ulpin,
    status: parcel.status,
    landUse: parcel.landUse,
    village: parcel.village.name,
    tehsil: parcel.village.tehsil.name,
    district: parcel.district.name,
    state: parcel.district.state.name,
    chainageM: parcel.chainageM,
    hasConflict: parcel.hasConflict,
    geometry: geomRow[0]?.geojson ? JSON.parse(geomRow[0].geojson) : null,

    area: {
      recordHa: record,
      mapHa: mapped,
      differenceHa: record != null && mapped != null ? Number((mapped - record).toFixed(4)) : null,
      differencePct: record && mapped != null ? ((mapped - record) / record) * 100 : null,
      areaFromRecord: parcel.areaFromRecord,
    },

    boundary: {
      geometryKind: parcel.geometryKind,
      accuracyM: parcel.boundaryAccuracyM == null ? null : Number(parcel.boundaryAccuracyM),
      dataSource: parcel.dataSource,
      sourcePlotId: parcel.sourcePlotId,
      syncedAt: parcel.sourceSyncedAt,
      centroid:
        parcel.centroidLat == null || parcel.centroidLng == null
          ? null
          : { lat: Number(parcel.centroidLat), lng: Number(parcel.centroidLng) },
      points: points.map((p) => ({ seq: p.seq, lat: p.lat, lng: p.lng, sideM: p.sideM, elevationM: p.elevationM })),
    },

    project: {
      id: parcel.project.id,
      name: parcel.project.name,
      referenceNo: parcel.project.referenceNo,
      type: parcel.project.type,
      governingAct: parcel.project.governingAct,
      authority: parcel.project.agency.name,
      ministry: parcel.project.ministry?.name ?? null,
      rightOfWayM: parcel.project.rightOfWayM,
      estimatedAreaHectares:
        parcel.project.estimatedAreaHectares == null ? null : Number(parcel.project.estimatedAreaHectares),
      totalParcels,
      possessedParcels,
    },
    proposal: parcel.proposal,

    owners: parcel.owners.map((o) => ({
      id: o.owner.id,
      fullName: o.owner.fullName,
      fatherName: o.owner.fatherName,
      sharePct: Number(o.sharePct),
      hasPortalLogin: o.owner.userId != null,
    })),

    compensation: {
      assessed,
      paid,
      records: parcel.compensations.map((c) => ({
        id: c.id,
        owner: c.owner.fullName,
        payable: Number(c.payableToOwner),
        total: Number(c.totalCompensation),
        assessedAt: c.assessedAt,
        payments: c.payments.map((p) => ({
          amount: Number(p.amount), status: p.status, paidAt: p.paidAt, utrNumber: p.utrNumber,
        })),
      })),
    },

    awards: parcel.awards.map((a) => ({
      id: a.id, awardNo: a.awardNo, declaredOn: a.declaredOn, publishedOn: a.publishedOn,
      totalAmount: Number(a.totalAmount), isRnRAward: a.isRnRAward,
    })),
    objections: parcel.objections,
    possession: parcel.possession,
    surveys: parcel.fieldSurveys.map((f) => ({
      id: f.id, kind: f.kind, capturedAt: f.capturedAt,
      walkedAreaHectares: f.walkedAreaHectares == null ? null : Number(f.walkedAreaHectares),
      surveyor: f.surveyor.fullName,
    })),

    claimedBy: otherProjects.map((p) => {
      const c = conflicts.find((x) => x.projectId === p.id);
      return {
        projectId: p.id, project: p.name, referenceNo: p.referenceNo, type: p.type,
        parcelId: c?.id ?? null, khasraNo: c?.khasraNo ?? null,
        overlapHa: c?.overlapHectares == null ? null : Number(c.overlapHectares),
      };
    }),

    nearby: nearbyRows.map((n) => ({
      id: n.id,
      khasraNo: n.khasraNo,
      status: n.status,
      village: n.village,
      project: n.project,
      projectId: n.projectId,
      mapHa: n.mapHa,
      metres: Math.round(n.metres),
      adjoining: n.adjoining,
      /** Outside this officer's jurisdiction: counted, not opened. */
      visible: visibleNearby.has(n.id),
    })),

    history: audit.map((a) => ({
      id: a.id,
      action: a.action,
      at: a.createdAt,
      actor: a.actor?.fullName ?? "System",
      actorRole: a.actor?.role ?? null,
      detail: a.afterJson,
    })),
  });
}
