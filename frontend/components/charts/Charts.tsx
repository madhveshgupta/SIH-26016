"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatIndianScale } from "@backend/compensation/format";
import { useLocale, useT } from "@frontend/components/I18nProvider";

export interface Slice {
  key: string;
  label: string;
  value: number;
  colour: string;
  href?: string;
}

const tooltipStyle = {
  contentStyle: { borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 12 },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
};

/** Donut with a clickable legend — each slice leads to the filtered records. */
export function DonutChart({ data, centreLabel, centreValue }: { data: Slice[]; centreLabel: string; centreValue: string }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
              {data.map((d) => (
                <Cell key={d.key} fill={d.colour} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums text-foreground">{centreValue}</span>
          <span className="text-[11px] text-muted">{centreLabel}</span>
        </div>
      </div>
      <ul className="w-full space-y-1.5">
        {data.map((d) => {
          const row = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.colour }} />
              <span className="flex-1 truncate text-foreground">{d.label}</span>
              <span className="tabular-nums text-muted">{d.value}</span>
              <span className="w-10 text-right tabular-nums text-muted">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            </>
          );
          return (
            <li key={d.key}>
              {d.href ? (
                <Link href={d.href} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-surface-muted">{row}</Link>
              ) : (
                <div className="flex items-center gap-2 px-1.5 py-1 text-xs">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Horizontal bars — stage funnels and bottleneck charts. */
export function HBarChart({ data, unit = "", height }: { data: Slice[]; unit?: string; height?: number }) {
  const t = useT();
  if (data.length === 0) return <p className="py-6 text-center text-xs text-muted">{t("screens.charts.noData")}</p>;
  return (
    <div style={{ height: height ?? Math.max(120, data.length * 34) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 24, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipStyle} formatter={(v) => [`${v}${unit}`, ""]} cursor={{ fill: "var(--surface-muted)" }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16} label={{ position: "right", fontSize: 11, fill: "var(--muted)", formatter: (v: unknown) => `${v}${unit}` }}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.colour} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Series colours, validated for colour-vision deficiency in both themes (globals.css). */
export const SERIES = ["var(--chart-1)", "var(--chart-2)"];

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mo) - 1]} ${y.slice(2)}`;
};

/**
 * Two measures over time on ONE axis — compensation assessed against compensation actually paid.
 */
export function TrendChart({
  data,
  series,
  format = "count",
  height = 240,
}: {
  data: Record<string, string | number>[];
  series: { key: string; label: string }[];
  /** A name, not a function: a server component cannot hand a function across. */
  format?: "money" | "count";
  height?: number;
}) {
  const t = useT();
  const { locale, intl } = useLocale();
  const fmt = format === "money" ? (v: number) => formatIndianScale(v, locale) : (v: number) => v.toLocaleString(intl);
  if (data.every((d) => series.every((s) => !Number(d[s.key])))) {
    return <p className="py-10 text-center text-xs text-muted">{t("screens.charts.nothingInPeriod")}</p>;
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => fmt(Number(v))} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={64} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(l) => monthLabel(String(l))}
            formatter={(v, name) => [fmt(Number(v)), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted)" }} iconType="plainline" iconSize={14} />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={SERIES[i % SERIES.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bars for a distribution — one series, so no legend. */
export function VBarChart({ data, height = 200, unit = "" }: { data: Slice[]; height?: number; unit?: string }) {
  const t = useT();
  if (data.every((d) => d.value === 0)) return <p className="py-10 text-center text-xs text-muted">{t("screens.charts.noOpenCases")}</p>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 16, bottom: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-muted)" }} formatter={(v) => [`${v}${unit}`, "cases"]} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48} label={{ position: "top", fontSize: 11, fill: "var(--muted)" }}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.colour} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
