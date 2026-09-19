import type { Metadata } from "next";
import { Brain, Database, FlaskConical } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { modelCard } from "@backend/ml/client";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import type { MessageKey } from "@backend/i18n";
import { rich } from "@frontend/lib/rich";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.modelCard") };
}

/** Metric keys worth showing; what each means is screens.modelCard.m_<key>. */
const METRICS = new Set(["auc", "f1", "accuracy", "positiveRate", "mae_days", "mae_rupees", "mape_pct", "r2", "flaggedPct", "contamination"]);

/** The service's calibration notes, as their dictionary entries (unknown ones are shown as the service wrote them). */
const CALIBRATION: Record<string, MessageKey> = {
  "CAG Performance Audit 2021 Table 3.2": "screens.modelCard.cal1",
  "CAG Table 3.3": "screens.modelCard.cal2",
  Parliament: "screens.modelCard.cal3",
  PIB: "screens.modelCard.cal4",
  "LARR Act 2013": "screens.modelCard.cal5",
};

export default async function ModelCardPage() {
  await requirePermission("mlPrediction", "read");
  const { t, intl } = await getTranslator();
  const card = await modelCard();
  /** A dictionary entry, or the service's own wording when the dictionary has none. */
  const or = (key: string, fallback: string) => {
    const text = t(key as MessageKey);
    return text === key ? fallback : text;
  };
  const featureName = (feature: string) => {
    if (feature.startsWith("project_type_")) {
      return t("screens.modelCard.f_projectType", { type: or(`screens.projectType.${feature.slice(13)}`, feature.slice(13)) });
    }
    if (feature.startsWith("act_")) return t("screens.modelCard.f_act", { act: or(`screens.act.${feature.slice(4)}`, feature.slice(4)) });
    return or(`screens.modelCard.f_${feature}`, feature.replaceAll("_", " "));
  };

  if (!card) {
    return (
      <div>
        <PageHeader title={t("pages.modelCardTitle")} description={t("pageDesc.modelCard")} crumbs={[{ label: t("navGroups.analytics") }, { label: t("crumbs.models") }]} />
        <EmptyState
          icon={<Brain className="h-5 w-5" />}
          title={t("screens.modelCard.notRunning")}
          // i18n-ignore — the command is typed as is
          description={rich(t("screens.modelCard.notRunningDesc"), { cmd: <code className="font-mono">npm run ml:serve</code> })}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("pages.modelCardTitle")}
        description={t("pageDesc.modelCard")}
        crumbs={[{ label: t("navGroups.analytics") }, { label: t("crumbs.models") }]}
        badge={<Badge tone="brand">{t("screens.modelCard.version", { v: card.version })}</Badge>}
      />

      <Card>
        <CardHeader
          title={t("screens.modelCard.training")}
          description={t("screens.modelCard.trainingDesc", {
            rows: card.rows.toLocaleString(intl),
            when: new Date(card.trainedAt).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" }),
          })} icon={<Database className="h-4 w-4" />} />
        <CardBody className="space-y-3 text-sm">
          <p className="text-foreground">{t("screens.modelCard.source")}</p>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">{t("screens.modelCard.calibrated")}</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
              {card.dataset.calibration.map((c) => {
                const key = CALIBRATION[c.split(" — ")[0]];
                return <li key={c}>{key ? t(key) : c}</li>;
              })}
            </ul>
          </div>
          <p className="rounded-lg bg-surface-muted p-3 text-xs leading-relaxed text-muted">
            <strong className="text-foreground">{t("screens.modelCard.whyTitle")}</strong> {t("screens.modelCard.why")}{" "}
            {t("screens.modelCard.whyMore")}
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(card.models).map(([name, model]) => (
          <Card key={name}>
            <CardHeader
              title={or(`screens.modelCard.task_${name}`, String(model.task ?? name))}
              description={String(model.algorithm ?? "")}
              icon={<FlaskConical className="h-4 w-4" />}
            />
            <CardBody>
              <dl className="space-y-2">
                {Object.entries(model)
                  .filter(([k]) => METRICS.has(k))
                  .map(([k, v]) => (
                    <div key={k}>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-xs text-muted">{t(`screens.modelCard.n_${k}` as MessageKey)}</dt>
                        <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
                          {typeof v === "number" ? (k.includes("pct") || k === "positiveRate" || k === "contamination" ? (k === "positiveRate" || k === "contamination" ? `${Math.round(Number(v) * 100)}%` : `${v}%`) : v.toLocaleString(intl)) : String(v)}
                        </dd>
                      </div>
                      <div className="text-[11px] leading-snug text-muted">{t(`screens.modelCard.m_${k}` as MessageKey)}</div>
                    </div>
                  ))}
              </dl>
              {name === "litigation_risk" && (
                <p className="mt-3 rounded-lg bg-warning-soft p-2 text-[11px] leading-snug text-warning">
                  {t("screens.modelCard.litigationWeak")}
                </p>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title={t("screens.modelCard.importances")} description={t("screens.modelCard.importancesDesc")} icon={<Brain className="h-4 w-4" />} />
        <CardBody className="grid gap-4 md:grid-cols-3">
          {Object.entries(card.importances).map(([model, features]) => (
            <div key={model}>
              <div className="text-xs font-medium text-foreground">{or(`screens.modelCard.task_${model}`, model.replaceAll("_", " "))}</div>
              <ul className="mt-1.5 space-y-1">
                {Object.entries(features).slice(0, 6).map(([feature, weight]) => (
                  <li key={feature} className="text-[11px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-muted">{featureName(feature)}</span>
                      <span className="tabular-nums text-foreground">{Math.round(Number(weight) * 100)}%</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-surface-muted">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Number(weight) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
