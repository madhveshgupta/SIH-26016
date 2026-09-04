"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from "lucide-react";
import { cn } from "@frontend/lib/cn";
import { useT } from "@frontend/components/I18nProvider";

type ToastTone = "success" | "error" | "info" | "warning";
interface ToastItem { id: number; tone: ToastTone; title: string; message?: string }

const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});

/** Feedback for every action: nothing a user does should happen silently. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const tr = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  const value = useMemo(() => push, [push]);

  const icon = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const tone = {
    success: "border-success/30 text-success",
    error: "border-danger/30 text-danger",
    info: "border-info/30 text-info",
    warning: "border-warning/30 text-warning",
  };

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[2000] flex w-80 flex-col gap-2">
        {items.map((t) => {
          const Icon = icon[t.tone];
          return (
            <div key={t.id} role="status" className={cn("pointer-events-auto animate-fade-in rounded-xl border bg-surface p-3 shadow-lg", tone[t.tone])}>
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{t.title}</div>
                  {t.message && <div className="mt-0.5 text-xs text-muted">{t.message}</div>}
                </div>
                <button aria-label={tr("screens.ui.dismiss")} onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} className="text-muted hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
