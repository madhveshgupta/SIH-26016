"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, GripVertical, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@frontend/components/ui";
import { useToast } from "@frontend/components/ui/Toast";
import { cn } from "@frontend/lib/cn";
import { useT } from "@frontend/components/I18nProvider";

export interface FilterOption {
  id: string;
  name: string;
}

export interface WidgetDef {
  key: string;
  label: string;
  description: string;
}

/**
 * Filters live in the URL, so a filtered dashboard is a link: an officer can
 * send "Maharashtra, highways, last 90 days" to a colleague and they see
 * exactly the same screen, within their own jurisdiction.
 */
export function FilterBar({
  states,
  districts,
  ministries,
  types,
  showState,
  showDistrict,
}: {
  states: FilterOption[];
  districts: FilterOption[];
  ministries: FilterOption[];
  types: { value: string; label: string }[];
  showState: boolean;
  showDistrict: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Choosing a state invalidates a district chosen inside another one.
    if (key === "state") next.delete("district");
    startTransition(() => router.push(next.toString() ? `/dashboard?${next}` : "/dashboard", { scroll: false }));
  };

  const active = ["state", "district", "type", "ministry", "days"].filter((k) => params.get(k));
  const select = "h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground focus:border-brand focus:outline-none";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-60")}>
      <SlidersHorizontal className="h-4 w-4 text-muted" aria-hidden />
      {showState && (
        <select aria-label={t("screens.filters.state")} className={select} value={params.get("state") ?? ""} onChange={(e) => set("state", e.target.value)}>
          <option value="">{t("screens.filters.allStates")}</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      {showDistrict && districts.length > 0 && (
        <select aria-label={t("screens.filters.district")} className={select} value={params.get("district") ?? ""} onChange={(e) => set("district", e.target.value)}>
          <option value="">{t("screens.filters.allDistricts")}</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      )}
      <select aria-label={t("screens.filters.projectType")} className={select} value={params.get("type") ?? ""} onChange={(e) => set("type", e.target.value)}>
        <option value="">{t("screens.filters.allProjectTypes")}</option>
        {types.map((type) => (
          <option key={type.value} value={type.value}>{type.label}</option>
        ))}
      </select>
      <select aria-label={t("screens.filters.ministry")} className={select} value={params.get("ministry") ?? ""} onChange={(e) => set("ministry", e.target.value)}>
        <option value="">{t("screens.filters.allMinistries")}</option>
        {ministries.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <select aria-label={t("screens.filters.period")} className={select} value={params.get("days") ?? ""} onChange={(e) => set("days", e.target.value)}>
        <option value="">{t("screens.filters.anyTime")}</option>
        <option value="30">{t("screens.filters.in30")}</option>
        <option value="90">{t("screens.filters.in90")}</option>
        <option value="365">{t("screens.filters.inYear")}</option>
      </select>
      {active.length > 0 && (
        <button
          onClick={() => startTransition(() => router.push("/dashboard", { scroll: false }))}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <X className="h-3 w-3" aria-hidden />
          {t(active.length === 1 ? "screens.filters.clearOne" : "screens.filters.clearMany", { count: active.length })}
        </button>
      )}
    </div>
  );
}

/** Rearranging the dashboard. */
export function CustomisePanel({ widgets, layout }: { widgets: WidgetDef[]; layout: string[] }) {
  const router = useRouter();
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<string[]>(layout);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hidden = widgets.filter((w) => !order.includes(w.key));
  const byKey = new Map(widgets.map((w) => [w.key, w]));

  const move = (key: string, delta: number) => {
    setOrder((prev) => {
      const i = prev.indexOf(key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const drop = (onKey: string) => {
    if (!dragging || dragging === onKey) return;
    setOrder((prev) => {
      const next = prev.filter((k) => k !== dragging);
      next.splice(next.indexOf(onKey), 0, dragging);
      return next;
    });
    setDragging(null);
  };

  const save = async (reset = false) => {
    setBusy(true);
    const res = await fetch("/api/dashboard/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reset ? { reset: true } : { widgets: order }),
    });
    setBusy(false);
    if (!res.ok) return toast({ tone: "error", title: t("screens.customise.saveFailed") });
    toast({ tone: "success", title: reset ? t("screens.customise.resetDone") : t("screens.customise.saved"), message: t("screens.customise.savedHint") });
    setOpen(false);
    router.refresh();
  };

  if (!open) {
    return (
      <Button variant="secondary" size="sm" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setOpen(true)}>
        {t("screens.customise.open")}
      </Button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t("screens.customise.title")}</h2>
          <p className="text-xs text-muted">{t("screens.customise.hint")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => save(true)}>{t("screens.customise.reset")}</Button>
          <Button variant="secondary" size="sm" onClick={() => { setOrder(layout); setOpen(false); }}>{t("screens.customise.cancel")}</Button>
          <Button size="sm" loading={busy} onClick={() => save()}>{t("screens.customise.save")}</Button>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {order.map((key, i) => {
          const w = byKey.get(key);
          if (!w) return null;
          return (
            <li
              key={key}
              draggable
              onDragStart={() => setDragging(key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(key)}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs",
                dragging === key && "opacity-50",
              )}
            >
              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{w.label}</span>
                <span className="ml-2 text-muted">{w.description}</span>
              </span>
              <button onClick={() => move(key, -1)} disabled={i === 0} aria-label={t("screens.customise.moveUp", { name: w.label })} className="rounded px-1 text-muted hover:text-foreground disabled:opacity-30">↑</button>
              <button onClick={() => move(key, 1)} disabled={i === order.length - 1} aria-label={t("screens.customise.moveDown", { name: w.label })} className="rounded px-1 text-muted hover:text-foreground disabled:opacity-30">↓</button>
              <button onClick={() => setOrder((prev) => prev.filter((k) => k !== key))} aria-label={t("screens.customise.hide", { name: w.label })} className="rounded px-1 text-muted hover:text-danger">
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>

      {hidden.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{t("screens.customise.hidden")}</div>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {hidden.map((w) => (
              <li key={w.key}>
                <button
                  onClick={() => setOrder((prev) => [...prev, w.key])}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-xs text-muted hover:border-brand hover:text-brand"
                >
                  <Eye className="h-3 w-3" aria-hidden />
                  {w.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
