import type { CompensationBreakdown, CompensationLine } from "@backend/compensation/calculator";
import { formatIndianScale } from "@backend/compensation/calculator";
import type { Locale, MessageKey } from "@backend/i18n";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const BASIS: Record<string, MessageKey> = {
  CIRCLE_RATE: "award.basisCircleRate",
  SALE_DEEDS_TOP_50PCT: "award.basisSaleDeeds",
};

/** A line in the reader's language, from its key and figures; the calculator's English if the key is unknown. */
function lineWords(t: T, l: CompensationLine): { label: string; workings?: string; section?: string } {
  const has = (key: string) => t(key as MessageKey) !== key;
  const vars = { ...l.vars, basis: l.vars?.basis ? t(BASIS[String(l.vars.basis)] ?? "award.basisConsented") : "" };
  const label = has(`screens.comp.l_${l.key}`) ? t(`screens.comp.l_${l.key}` as MessageKey, vars) : l.label;
  const workings = l.workings && has(`screens.comp.l_${l.key}Work`) ? t(`screens.comp.l_${l.key}Work` as MessageKey, vars) : l.workings;
  const section = l.section === "First Schedule" ? t("screens.misc.firstSchedule") : l.section;
  return { label, workings, section };
}

/** The transparent breakdown — the point of the whole feature. */
export default function CompensationBreakdownView({
  breakdown,
  title,
  t,
  intl,
  locale,
}: {
  breakdown: CompensationBreakdown;
  title?: string;
  /** The page's translator: this renders on the server, inside the page that owns it. */
  t: T;
  intl: string;
  locale: Locale;
}) {
  const heading = title ?? t("screens.comp.bdTitle");
  const inr = (n: { toString(): string }) =>
    Number(n.toString()).toLocaleString(intl, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <section
      aria-label={t("screens.comp.bdCalcAria", { title: heading })}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
          <p className="mt-1 text-xs text-muted">
            {t("screens.comp.bdIntro")}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-brand/15 bg-brand-soft px-2.5 py-1 text-[10px] font-semibold tracking-wide text-brand">
          LARR 2013 <span aria-hidden="true" className="mx-1.5 opacity-50">·</span> ss.26–30
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-xs">
          <caption className="sr-only">
            {t("screens.comp.bdCaption")}
          </caption>
          <thead className="bg-surface-muted/70 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left sm:px-5">{t("screens.comp.bdCalc")}</th>
              <th scope="col" className="px-3 py-2.5 text-left">{t("screens.comp.bdLegal")}</th>
              <th scope="col" className="px-4 py-2.5 text-right sm:px-5">{t("screens.plotRecord.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.lines.map((l) => {
              const emphasis =
                l.key === "total" || l.key === "subTotal" || l.key === "landValue";
              const isTotal = l.key === "total";
              const words = lineWords(t, l);
              return (
                <tr
                  key={l.key}
                  className={`border-t border-border/70 transition-colors hover:bg-surface-muted/40 ${
                    isTotal ? "bg-brand-soft/55" : ""
                  }`}
                >
                  <td className="px-4 py-3 align-top sm:px-5">
                    <div className={emphasis ? "font-semibold text-foreground" : "font-medium text-foreground/90"}>
                      {words.label}
                    </div>
                    {words.workings && (
                      <div className="mt-1 max-w-lg text-[11px] leading-relaxed text-muted">
                        {words.workings}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">
                    {words.section ? (
                      <span className="inline-flex whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 font-mono text-[10px] text-muted">
                        {words.section}
                      </span>
                    ) : (
                      <span className="text-muted/60">—</span>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right align-top tabular-nums sm:px-5 ${
                      isTotal
                        ? "font-bold text-brand"
                        : emphasis
                          ? "font-semibold text-foreground"
                          : "text-foreground/90"
                    }`}
                  >
                    ₹{inr(l.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="border-t border-border bg-surface-muted/45 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">{t("screens.comp.bdTotalPayable")}</span>
            <span className="mt-1 block text-xs text-muted">{t("screens.comp.bdFinal")}</span>
          </div>
          <span className="text-xl font-semibold tracking-tight text-brand tabular-nums sm:text-2xl">
            {formatIndianScale(breakdown.payableToOwner, locale)}
          </span>
        </div>
        <p className="mt-3 border-t border-border/70 pt-3 text-[11px] leading-relaxed text-muted">
          {t("screens.comp.bdNote")}
        </p>
      </footer>
    </section>
  );
}
