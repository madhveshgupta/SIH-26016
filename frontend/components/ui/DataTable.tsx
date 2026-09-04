"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@frontend/lib/cn";
import { useT } from "@frontend/components/I18nProvider";

export interface Column<T> {
  key: string;
  header: string;
  /** Value used for sorting and search. */
  value?: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}

/**
 * The one table used across the portal: search, sort, paginate, and — when `rowHref` is given —
 * every row opens its record.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  pageSize = 15,
  searchPlaceholder,
  empty,
  toolbar,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string | null;
  pageSize?: number;
  searchPlaceholder?: string;
  empty?: ReactNode;
  toolbar?: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle
      ? rows.filter((r) => columns.some((c) => String(c.value?.(r) ?? "").toLowerCase().includes(needle)))
      : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.value) {
        out = [...out].sort((a, b) => {
          const va = col.value!(a), vb = col.value!(b);
          if (va == null) return 1;
          if (vb == null) return -1;
          return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
        });
      }
    }
    return out;
  }, [rows, columns, q, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const slice = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder={searchPlaceholder ?? t("screens.ui.searchPlaceholder")}
            aria-label={t("screens.ui.searchTable")}
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <span className="text-xs text-muted">{t(filtered.length === 1 ? "screens.ui.recordOne" : "screens.ui.recordMany", { count: filtered.length })}</span>
        {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted", c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left")}>
                  {c.value ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                    >
                      {c.header}
                      {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const href = rowHref?.(r);
              return (
                <tr
                  key={rowKey(r)}
                  onClick={href ? () => router.push(href) : undefined}
                  className={cn("border-t border-border", href && "cursor-pointer hover:bg-brand-soft/50")}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2.5 align-middle", c.align === "right" && "text-right tabular-nums", c.align === "center" && "text-center", c.className)}>
                      {c.render ? c.render(r) : String(c.value?.(r) ?? "—")}
                    </td>
                  ))}
                </tr>
              );
            })}
            {slice.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-muted">
                  {empty ?? t("screens.ui.nothingToShow")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 pt-3 text-xs text-muted">
          {t("screens.ui.pageOf", { page: safePage + 1, pages })}
          <button aria-label={t("screens.ui.previousPage")} disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="rounded-md border border-border p-1 hover:bg-surface-muted disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button aria-label={t("screens.ui.nextPage")} disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="rounded-md border border-border p-1 hover:bg-surface-muted disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
