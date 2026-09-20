/** Scheduled reports. */
import type { ReportFrequency } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { sendMessage } from "@backend/integrations/adapters/notify";
import { exportReport, type ExportFormat } from "@backend/reports/export";
import { runReport, reportByKey } from "@backend/reports/registry";
import { runBuilder, validateDefinition } from "@backend/reports/builder";
import type { Actor } from "@backend/rbac/scope";

export const FREQUENCIES: ReportFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];

/** The next time a schedule should run, from now. */
export function nextRun(frequency: ReportFrequency, from = new Date()): Date {
  const next = new Date(from);
  next.setHours(7, 0, 0, 0); // before the working day starts
  if (frequency === "DAILY") next.setDate(next.getDate() + 1);
  else if (frequency === "WEEKLY") next.setDate(next.getDate() + ((8 - next.getDay()) % 7 || 7)); // next Monday
  else {
    next.setMonth(next.getMonth() + 1, 1);
  }
  return next;
}

export interface CreateScheduleInput {
  actor: Actor;
  reportKey?: string | null;
  templateId?: string | null;
  frequency: ReportFrequency;
  recipients: string[];
  format: ExportFormat;
}

export async function createSchedule(input: CreateScheduleInput) {
  const recipients = [...new Set(input.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0) throw new Error("Give at least one recipient");
  const bad = recipients.find((r) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r));
  if (bad) throw new Error(`${bad} is not an email address`);
  if (!input.reportKey && !input.templateId) throw new Error("Choose a report to schedule");
  if (input.reportKey && !reportByKey(input.reportKey)) throw new Error("Unknown report");
  if (input.templateId) {
    const template = await prisma.reportTemplate.findFirst({
      where: { id: input.templateId, OR: [{ ownerId: input.actor.id }, { isShared: true }] },
      select: { id: true },
    });
    if (!template) throw new Error("Saved report not found");
  }

  const schedule = await prisma.reportSchedule.create({
    data: {
      reportKey: input.reportKey ?? null,
      templateId: input.templateId ?? null,
      frequency: input.frequency,
      recipients,
      format: input.format,
      nextRunAt: nextRun(input.frequency),
      createdById: input.actor.id,
    },
  });
  await appendAudit({
    actorId: input.actor.id, action: "CREATE", entityType: "ReportSchedule", entityId: schedule.id,
    afterJson: { report: input.reportKey ?? input.templateId, frequency: input.frequency, recipients: recipients.length, format: input.format },
  });
  return schedule;
}

/** Run one schedule now: build the report as its owner, and email it. */
export async function runSchedule(scheduleId: string, actor: Actor & { email?: string; fullName?: string }) {
  const schedule = await prisma.reportSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
    include: { template: true },
  });

  const report = schedule.templateId && schedule.template
    ? await runBuilder(validateDefinition(schedule.template.definition), actor, {}, schedule.template.name)
    : await runReport(schedule.reportKey!, actor, {});

  const file = await exportReport(report, schedule.format as ExportFormat, actor);

  let delivered = 0;
  const failures: string[] = [];
  for (const to of schedule.recipients) {
    const sent = await sendMessage({
      channel: "EMAIL",
      to,
      subject: `${report.title} — ${report.generatedAt.toISOString().slice(0, 10)}`,
      about: `scheduled report ${report.key}`,
      body:
        `${report.title}\n${report.filterNote}\n\n` +
        `${report.rows.length} rows. The full report is attached as ${file.filename} (${Math.round(file.body.length / 1024)} KB).`,
    });
    if (sent.ok) delivered++;
    else failures.push(`${to}: ${sent.error}`);
  }

  const note = `${delivered}/${schedule.recipients.length} delivered${failures.length ? ` · ${failures.join("; ")}` : ""}`;
  await prisma.reportSchedule.update({
    where: { id: schedule.id },
    data: { lastRunAt: new Date(), lastRunNote: note, nextRunAt: nextRun(schedule.frequency) },
  });
  return { delivered, failures, rows: report.rows.length, bytes: file.body.length, note };
}

/** Every schedule that is due. Used by the runner script. */
export async function dueSchedules(now = new Date()) {
  return prisma.reportSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    include: { createdBy: { include: { role: true, ownerProfile: { select: { id: true } } } } },
  });
}
