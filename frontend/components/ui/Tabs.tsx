"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@frontend/lib/cn";

export interface TabDef { id: string; label: ReactNode; content: ReactNode; count?: number }

export function Tabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current?.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition",
              t.id === current?.id ? "border-brand font-semibold text-brand" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
            {t.count != null && <span className="rounded-full bg-surface-muted px-1.5 text-[10px] tabular-nums text-muted">{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-4">
        {current?.content}
      </div>
    </div>
  );
}
