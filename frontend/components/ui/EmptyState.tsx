import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({ title, description, icon, action }: { title: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden />}
      </span>
      <div className="mt-3 text-sm font-semibold text-foreground">{title}</div>
      {description && <div className="mt-1 max-w-md text-xs text-muted">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
