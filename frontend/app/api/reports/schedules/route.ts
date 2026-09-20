import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { createSchedule, FREQUENCIES, runSchedule } from "@backend/reports/schedule";
import { apiError, id } from "@backend/validation/request";
import type { ExportFormat } from "@backend/reports/export";
import { apiJson } from "@backend/http/respond";

/** Create, run now, or stop a scheduled report. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "report", "export")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const body = await req.json().catch(() => null);
  try {
    // Only the officer who created a schedule may run or stop it: it runs with
    // their jurisdiction, so it is their report to control.
    if (body?.runNow) {
      const scheduleId = id(body.runNow);
      const owned = await prisma.reportSchedule.count({ where: { id: scheduleId ?? "", createdById: s.id } });
      if (!owned) return await apiJson({ error: "Schedule not found" }, { status: 404 });
      return await apiJson({ ok: true, ...(await runSchedule(scheduleId!, s)) });
    }
    if (body?.stop) {
      const scheduleId = id(body.stop);
      const { count } = await prisma.reportSchedule.updateMany({ where: { id: scheduleId ?? "", createdById: s.id }, data: { isActive: false } });
      if (!count) return await apiJson({ error: "Schedule not found" }, { status: 404 });
      return await apiJson({ ok: true, stopped: scheduleId });
    }

    const frequency = FREQUENCIES.find((f) => f === body?.frequency);
    if (!frequency) return await apiJson({ error: "Choose daily, weekly or monthly" }, { status: 400 });
    const schedule = await createSchedule({
      actor: s,
      reportKey: body?.reportKey ? String(body.reportKey) : null,
      templateId: body?.templateId ? id(body.templateId) : null,
      frequency,
      recipients: Array.isArray(body?.recipients) ? body.recipients.map(String) : String(body?.recipients ?? "").split(/[,\s]+/),
      format: (["CSV", "EXCEL", "PDF"].find((f) => f === body?.format) ?? "PDF") as ExportFormat,
    });
    return await apiJson({ ok: true, id: schedule.id, nextRunAt: schedule.nextRunAt });
  } catch (e) {
    const { status, error } = apiError(e, "schedule report");
    return await apiJson({ error }, { status });
  }
}
