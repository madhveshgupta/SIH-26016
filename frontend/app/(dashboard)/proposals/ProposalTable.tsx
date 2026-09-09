"use client";

import { DataTable } from "@frontend/components/ui/DataTable";
import { Badge } from "@frontend/components/ui";
import type { Tone } from "@frontend/components/ui/Badge";
import type { MessageKey } from "@backend/i18n/types";
import { useT, useLocale } from "@frontend/components/I18nProvider";

export interface ProposalRow {
  id: string;
  referenceNo: string;
  project: string;
  projectId: string;
  act: string;
  stage: string;
  section: string | null;
  areaHa: number;
  parcels: number;
  severity: "SAFE" | "WATCH" | "URGENT" | "CRITICAL" | "BREACHED";
  daysRemaining: number | null;
  hasDeadline: boolean;
  isFatal: boolean;
}

const TONE: Record<ProposalRow["severity"], Tone> = { SAFE: "success", WATCH: "warning", URGENT: "warning", CRITICAL: "danger", BREACHED: "danger" };

export default function ProposalTable({ rows }: { rows: ProposalRow[] }) {
  const t = useT();
  const { intl } = useLocale();
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      rowHref={(r) => `/proposals/${r.id}`}
      searchPlaceholder={t("screens.proposalTable.search")}
      empty={t("screens.proposalTable.empty")}
      columns={[
        { key: "ref", header: t("screens.proposalTable.colRef"), value: (r) => r.referenceNo, render: (r) => <span className="font-mono text-xs text-brand">{r.referenceNo}</span> },
        { key: "project", header: t("common.project"), value: (r) => r.project, render: (r) => <div><div className="font-medium">{r.project}</div><div className="text-xs text-muted">{r.act}</div></div> },
        { key: "stage", header: t("screens.proposalTable.colStage"), value: (r) => r.stage, render: (r) => <span>{r.stage} {r.section && <span className="font-mono text-xs text-muted">{r.section}</span>}</span> },
        { key: "parcels", header: t("screens.geoMetric.parcels"), value: (r) => r.parcels, align: "right" },
        { key: "area", header: t("screens.proposalTable.colArea"), value: (r) => r.areaHa, align: "right", render: (r) => r.areaHa.toLocaleString(intl, { maximumFractionDigits: 2 }) },
        {
          key: "deadline",
          header: t("screens.proposalTable.colClock"),
          value: (r) => (r.hasDeadline ? r.daysRemaining : null),
          render: (r) =>
            r.hasDeadline ? (
              <Badge tone={TONE[r.severity]}>
                {t(`screens.severity.${r.severity}` as MessageKey)} ·{" "}
                {r.daysRemaining! < 0
                  ? t("screens.units.daysOverdue", { days: Math.abs(r.daysRemaining!) })
                  : t("screens.units.daysLeft", { days: r.daysRemaining! })}
                {r.isFatal && ` · ${t("screens.clock.lapseTag")}`}
              </Badge>
            ) : (
              <span className="text-xs text-muted">{t("screens.units.noDeadline")}</span>
            ),
        },
      ]}
    />
  );
}
