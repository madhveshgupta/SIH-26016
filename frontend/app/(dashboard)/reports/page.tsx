import type { Metadata } from "next";
import { AlertOctagon, FileText, Info, TriangleAlert } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { REPORTS, reportByKey } from "@backend/reports/registry";
import { ENTITIES, type Entity } from "@backend/reports/builder";
import { executiveBrief } from "@backend/reports/brief";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@frontend/components/ui";
import ReportWorkbench, { type SavedReport, type ScheduleInfo } from "./ReportWorkbench";
import { getTranslator } from "@backend/i18n/locale";
import { EMPTY_FILTER } from "@backend/analytics/filters";
import { columnLabel, reportWords, sectionName } from "@backend/reports/words";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.reports") };
}

const SEVERITY = {
  critical: { icon: AlertOctagon, tone: "danger" as const, label: "screens.reportPack.sev_critical" as const },
  warning: { icon: TriangleAlert, tone: "warning" as const, label: "screens.reportPack.sev_warning" as const },
  note: { icon: Info, tone: "neutral" as const, label: "screens.reportPack.sev_note" as const },
};

export default async function ReportsPage() {
  const s = await requirePermission("report", "read");
  const { t, intl, locale } = await getTranslator();

  const [brief, templates, schedules] = await Promise.all([
    executiveBrief(s, EMPTY_FILTER, t, locale),
    prisma.reportTemplate.findMany({
      where: { OR: [{ ownerId: s.id }, { isShared: true }] },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.reportSchedule.findMany({
      where: { isActive: true, OR: [{ createdById: s.id }, { template: { isShared: true } }] },
      orderBy: { nextRunAt: "asc" },
      take: 50,
      include: { template: { select: { name: true } } },
    }),
  ]);

  const saved: SavedReport[] = templates.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    isShared: tpl.isShared,
    owned: tpl.ownerId === s.id,
    definition: tpl.definition as SavedReport["definition"],
  }));

  const scheduleInfo: ScheduleInfo[] = schedules.map((x) => ({
    id: x.id,
    label: x.template?.name ?? (() => {
      const r = reportByKey(x.reportKey ?? "");
      return r ? reportWords(t, r.key, r).title : t("screens.reportPack.report");
    })(),
    frequency: x.frequency,
    recipients: x.recipients,
    format: x.format,
    nextRunAt: x.nextRunAt.toISOString(),
    lastRunAt: x.lastRunAt?.toISOString() ?? null,
    lastRunNote: x.lastRunNote,
    owned: x.createdById === s.id,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("pages.reportsTitle")}
        description={t("pageDesc.reports")}
        crumbs={[{ label: t("navGroups.records") }, { label: t("nav.reports") }]}
        actions={
          can(s.role, "report", "export") ? (
            <a
              href="/api/reports/export?key=executive-brief&format=PDF"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
            >
              <FileText className="h-4 w-4" />
              {t("screens.reportPack.briefPdf")}
            </a>
          ) : undefined
        }
      />

      {/* The brief itself, on screen — the PDF is the same content. */}
      <Card>
        <CardHeader
          title={brief.title}
          description={`${brief.jurisdiction} · ${brief.generatedAt.toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" })}`}
          icon={<FileText className="h-4 w-4" />}
        />
        <CardBody className="space-y-4">
          <p className="text-sm leading-relaxed text-foreground">{brief.summary}</p>

          <ul className="space-y-2">
            {brief.findings.map((f, i) => {
              const s2 = SEVERITY[f.severity];
              const Icon = s2.icon;
              return (
                <li key={i} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={s2.tone} icon={<Icon className="h-3 w-3" />}>{t(s2.label)}</Badge>
                    <span className="text-sm font-medium text-foreground">{f.headline}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{f.detail}</p>
                  <p className="mt-1 text-xs font-medium text-brand">→ {f.action}</p>
                </li>
              );
            })}
          </ul>

          <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
            {brief.headlines.map((h) => (
              <div key={h.label} className="text-xs">
                <div className="text-muted">{h.label}</div>
                <div className="mt-0.5 font-semibold tabular-nums text-foreground">{h.value}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <ReportWorkbench
        reports={REPORTS.map((r) => ({ key: r.key, ...reportWords(t, r.key, r), section: sectionName(t, r.section) }))}
        entities={(Object.keys(ENTITIES) as Entity[]).map((key) => ({
          key,
          label: t(`screens.reportPack.ent_${key}`),
          description: t(`screens.reportPack.entDesc_${key}`),
          fields: ENTITIES[key].fields.map((f) => ({ key: f.key, label: columnLabel(t, f.label), numeric: f.numeric })),
        }))}
        saved={saved}
        schedules={scheduleInfo}
        mayExport={can(s.role, "report", "export")}
      />
    </div>
  );
}
