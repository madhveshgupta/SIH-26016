import type { Metadata } from "next";
import { CheckCircle2, CircleDot, FileSearch, MapPin } from "lucide-react";
import { getSession } from "@backend/auth/session";
import { publicTrack } from "@backend/public/stats";
import { prisma } from "@backend/db/client";
import PublicHeader from "@frontend/components/PublicHeader";
import { Badge, Card, CardBody, EmptyState } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import { formatDate, stageKey } from "@backend/i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.track") };
}

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref = "" } = await searchParams;
  const { locale, t } = await getTranslator();
  const fmt = (d: Date | null) => (d ? formatDate(locale, new Date(d)) : "—");
  const [session, result, examples] = await Promise.all([
    getSession(),
    ref ? publicTrack(ref) : null,
    prisma.proposal.findMany({ where: { status: { not: "DRAFT" } }, select: { referenceNo: true }, take: 3, orderBy: { referenceNo: "asc" } }),
  ]);

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader signedIn={Boolean(session)} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("track.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("track.intro")}</p>

        <form className="mt-5 flex gap-2">
          <input
            name="ref"
            defaultValue={ref}
            placeholder="LA/UP/AGR/2026/0003"
            aria-label={t("track.referenceLabel")}
            className="h-11 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-sm uppercase focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <button className="h-11 rounded-lg bg-brand px-5 text-sm font-medium text-white hover:bg-brand-strong">{t("public.trackButton")}</button>
        </form>
        {examples.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {t("track.try")}{" "}
            {examples.map((e, i) => (
              <span key={e.referenceNo}>
                {i > 0 && ", "}
                <a href={`/track?ref=${encodeURIComponent(e.referenceNo)}`} className="font-mono text-brand hover:underline">{e.referenceNo}</a>
              </span>
            ))}
          </p>
        )}

        <div className="mt-8">
          {ref && !result && (
            <EmptyState icon={<FileSearch className="h-5 w-5" />} title={t("track.notFound")} description={t("track.notFoundHint")} />
          )}
          {result && (
            <Card>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-muted">{result.referenceNo}</div>
                    <h2 className="mt-0.5 text-lg font-semibold">{result.project}</h2>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted">
                      <MapPin className="h-3.5 w-3.5" /> {result.states.join(", ")}
                    </div>
                  </div>
                  <Badge tone="brand">{t(stageKey(result.act, result.status))}</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-surface-muted p-3 text-center text-xs">
                  <div><dt className="text-muted">{t("track.parcels")}</dt><dd className="mt-0.5 text-base font-semibold">{result.parcels}</dd></div>
                  <div><dt className="text-muted">{t("track.notifications")}</dt><dd className="mt-0.5 text-base font-semibold">{result.notifications}</dd></div>
                  <div><dt className="text-muted">{t("track.objections")}</dt><dd className="mt-0.5 text-base font-semibold">{result.objections}</dd></div>
                </dl>

                <h3 className="mt-6 text-sm font-semibold">{t("track.progress")}</h3>
                <ol className="mt-3 space-y-0">
                  {result.stages.map((st, i) => {
                    const done = Boolean(st.exitedAt);
                    return (
                      <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
                        {i < result.stages.length - 1 && <span className="absolute start-[9px] top-5 h-full w-px bg-border" />}
                        {done ? <CheckCircle2 className="relative h-5 w-5 shrink-0 text-success" /> : <CircleDot className="relative h-5 w-5 shrink-0 text-brand" />}
                        <div>
                          <div className="text-sm font-medium">
                            {t(stageKey(result.act, st.stage))} {st.section && <span className="font-mono text-xs text-muted">{st.section}</span>}
                          </div>
                          <div className="text-xs text-muted">
                            {fmt(st.enteredAt)}
                            {done ? ` → ${fmt(st.exitedAt)}` : ` · ${t("track.inProgress")}`}
                            {!done && st.deadline && ` · ${t("track.deadline", { date: fmt(st.deadline) })}`}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </CardBody>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
