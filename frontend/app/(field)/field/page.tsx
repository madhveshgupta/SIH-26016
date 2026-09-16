import { redirect } from "next/navigation";
import { requireSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { assignedParcels } from "@backend/field/surveys";
import FieldApp, { type FieldParcel } from "@frontend/components/field/FieldApp";

export const dynamic = "force-dynamic";

/** The field app. */
export default async function FieldPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const s = await requireSession();
  // Recording a survey changes what the record says about a plot.
  if (!can(s.role, "parcel", "update")) redirect("/dashboard");

  // Opened from a project workspace: that project's plots only.
  const { project } = await searchParams;
  const parcels = await assignedParcels(s, 200, project || undefined);
  const forDevice: FieldParcel[] = parcels.map((p) => ({
    id: p.id,
    khasraNo: p.khasraNo,
    status: p.status,
    hasConflict: p.hasConflict,
    recordedHa: Number(p.declaredAreaHectares),
    mappedHa: p.computedAreaHectares == null ? null : Number(p.computedAreaHectares),
    lat: p.centroidLat == null ? null : Number(p.centroidLat),
    lng: p.centroidLng == null ? null : Number(p.centroidLng),
    village: p.village.name,
    district: p.district.name,
    project: p.project.name,
    owners: p.owners.map((o) => o.owner.fullName),
    lastSurveyedAt: p.fieldSurveys[0]?.capturedAt.toISOString() ?? null,
  }));

  return <FieldApp parcels={forDevice} surveyorName={s.fullName} />;
}
