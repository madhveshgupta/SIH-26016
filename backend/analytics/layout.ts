/** Each user's own dashboard arrangement. */
import { prisma } from "@backend/db/client";

export const WIDGETS = [
  { key: "attention", label: "Needs attention", description: "Breached deadlines, conflicts, unpaid compensation" },
  { key: "kpis", label: "Headline figures", description: "The eight figures the problem statement names" },
  { key: "deadlines", label: "Statutory deadlines", description: "Open cases, nearest deadline first" },
  { key: "status", label: "Parcels by status", description: "Where the land itself has got to" },
  { key: "map", label: "Map of India", description: "Any figure, coloured onto the country" },
  { key: "trend", label: "Compensation over time", description: "Assessed against actually paid" },
  { key: "delays", label: "How long cases wait", description: "Distribution of time at the current stage" },
  { key: "funnel", label: "Cases by stage", description: "Where cases are piling up" },
  { key: "bottlenecks", label: "Bottlenecks", description: "Average days spent at each stage" },
  { key: "rollup", label: "Progress one level down", description: "States, districts or projects below you" },
] as const;

export type WidgetKey = (typeof WIDGETS)[number]["key"];

export const DEFAULT_LAYOUT: WidgetKey[] = WIDGETS.map((w) => w.key);

/** The user's layout, or the default. Unknown or removed widgets are dropped. */
export async function layoutFor(userId: string): Promise<WidgetKey[]> {
  const saved = await prisma.dashboardLayout.findUnique({ where: { userId }, select: { widgets: true } });
  if (!saved) return DEFAULT_LAYOUT;
  const known = new Set<string>(DEFAULT_LAYOUT);
  const kept = saved.widgets.filter((w): w is WidgetKey => known.has(w));
  return kept.length ? kept : DEFAULT_LAYOUT;
}

/** Save an arrangement. Order is meaningful; omission means hidden. */
export async function saveLayout(userId: string, widgets: string[]): Promise<WidgetKey[]> {
  const known = new Set<string>(DEFAULT_LAYOUT);
  const cleaned = [...new Set(widgets)].filter((w): w is WidgetKey => known.has(w));
  await prisma.dashboardLayout.upsert({
    where: { userId },
    update: { widgets: cleaned },
    create: { userId, widgets: cleaned },
  });
  return cleaned;
}

export async function resetLayout(userId: string): Promise<void> {
  await prisma.dashboardLayout.deleteMany({ where: { userId } });
}
