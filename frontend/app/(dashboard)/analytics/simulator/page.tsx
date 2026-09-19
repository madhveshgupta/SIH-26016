import type { Metadata } from "next";
import { requirePermission } from "@backend/rbac/guard";
import { PageHeader } from "@frontend/components/ui";
import Simulator from "./Simulator";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.policySimulator") };
}

export default async function SimulatorPage() {
  await requirePermission("mlPrediction", "read");
  const { t } = await getTranslator();
  return (
    <div className="space-y-5">
      <PageHeader
        title={t("pages.simulatorTitle")}
        description={t("screens.sim.desc")}
        crumbs={[{ label: t("navGroups.analytics") }, { label: t("crumbs.simulator") }]}
      />
      <Simulator />
    </div>
  );
}
