import Link from "next/link";
import Image from "next/image";
import {
  AlarmClock, ArrowRight, Bot, Database, Fingerprint, IndianRupee, Map, MapPin, ScrollText,
  ShieldCheck, Smartphone, Sprout, Users, Workflow,
} from "lucide-react";
import { getSession } from "@backend/auth/session";
import { PUBLIC_GEO_METRICS, publicStats } from "@backend/public/stats";
import { GEO_METRICS } from "@backend/analytics/geo";
import ChoroplethPanel from "@frontend/components/dashboard/ChoroplethPanel";
import { formatIndianScale } from "@backend/compensation/calculator";
import PublicHeader from "@frontend/components/PublicHeader";
import HeroMap from "@frontend/components/HeroMap";
import FlipCard from "@frontend/components/FlipCard";
import RevealWhenWhole from "@frontend/components/RevealWhenWhole";
import { INDIA_PATH, INDIA_VIEWBOX } from "@frontend/lib/india-outline";
import { LinkButton } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import { formatNumber, type MessageKey } from "@backend/i18n";

export const dynamic = "force-dynamic";

/** The four cards that sit across the foot of the hero; words from landing.pillars. */
const PILLARS = [
  { icon: MapPin, key: "maps" },
  { icon: AlarmClock, key: "alerts" },
  { icon: Users, key: "community" },
  { icon: Sprout, key: "fair" },
] as const;

/** What the system does; words from landing.features. */
const FEATURES = [
  { icon: Workflow, key: "workflow" },
  { icon: Map, key: "cadastral" },
  { icon: AlarmClock, key: "clock" },
  { icon: IndianRupee, key: "compensation" },
  { icon: Users, key: "rnr" },
  { icon: ShieldCheck, key: "possession" },
  { icon: Fingerprint, key: "audit" },
  { icon: Bot, key: "predictions" },
  { icon: Smartphone, key: "access" },
] as const;

export default async function Landing() {
  const [session, s, { locale, t }] = await Promise.all([getSession(), publicStats(), getTranslator()]);
  const tk = (key: string) => t(key as MessageKey);

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader signedIn={Boolean(session)} current="Home" />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* The Yamuna Expressway, Delhi–Agra — the corridor this demo's primary district was
            mapped along. */}
        <Image
          src="/hero/expressway.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
          className="pointer-events-none select-none object-cover object-[50%_38%]"
        />
        {/* washes the photograph back so the headline stays readable */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,rgba(246,245,239,0.97)_0%,rgba(246,245,239,0.90)_30%,rgba(246,245,239,0.55)_52%,rgba(246,245,239,0.18)_76%,rgba(246,245,239,0.04)_100%)] dark:bg-[linear-gradient(100deg,rgba(13,22,19,0.97)_0%,rgba(13,22,19,0.90)_30%,rgba(13,22,19,0.62)_52%,rgba(13,22,19,0.30)_76%,rgba(13,22,19,0.12)_100%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent via-background/70 to-background"
        />

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pt-16 pb-10 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-24 lg:pb-16">
          <div>
            <p className="hero-step hero-step-1 text-[13px] uppercase tracking-[0.28em] text-muted">
              {t("landing.eyebrow")}
            </p>

            <h1 className="hero-step hero-step-2 mt-5 font-display text-6xl leading-[0.95] tracking-tight sm:text-7xl">
              <span className="text-brand">Bhoomi</span>{" "}
              <span className="text-accent">Nayan</span>
            </h1>

            <p className="hero-step hero-step-3 mt-5 max-w-xl text-[28px] font-medium leading-[1.2] tracking-tight text-foreground sm:text-[32px]">
              {t("landing.headline")}
            </p>

            <p className="hero-step hero-step-4 mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
              {t("landing.lede")}
            </p>

            <div className="hero-step hero-step-5 mt-8 flex flex-wrap gap-3">
              <LinkButton
                href={session ? "/dashboard" : "/login"}
                size="lg"
                icon={<ArrowRight className="h-4 w-4" />}
              >
                {session ? t("landing.openDashboard") : t("landing.exploreMap")}
              </LinkButton>
              <Link
                href="/track"
                className="inline-flex h-12 items-center rounded-lg border border-border bg-surface px-6 text-sm font-medium text-foreground transition-colors hover:border-brand hover:text-brand"
              >
                {t("landing.trackApplication")}
              </Link>
            </div>
          </div>

          <div className="relative flex items-start justify-center gap-6">
            <div className="map-stage relative w-full max-w-[380px]">
              {/* a shockwave behind the map, timed to where it lands */}
              <span
                aria-hidden="true"
                className="map-burst pointer-events-none absolute inset-[6%] rounded-full bg-accent/30 blur-2xl"
              />
              <div className="map-pop-in">
                <div className="map-float-wrap">
                  <HeroMap className="w-full drop-shadow-xl" />
                </div>
              </div>
            </div>
            <div className="hidden w-32 shrink-0 pt-10 text-end lg:block">
              <p className="text-[12px] uppercase leading-[1.9] tracking-[0.22em] text-muted">
                {t("landing.statesMapped", { states: s.statesWithLand, uts: s.utsWithLand })}
              </p>
              <span className="mt-3 ms-auto block h-px w-10 bg-muted/40" />
            </div>
          </div>
        </div>

        {/* four pillars, floating over the foot of the hero */}
        <div className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* each card waits until it is wholly on screen, so the fold
                never shows half of one */}
            {PILLARS.map((p, i) => (
              <RevealWhenWhole key={p.key} delay={i * 90} className="h-full">
                <FlipCard icon={<p.icon className="h-8 w-8" strokeWidth={1.6} />} title={tk(`landing.pillars.${p.key}Title`)} text={tk(`landing.pillars.${p.key}Text`)} layout="row" />
              </RevealWhenWhole>
            ))}
          </div>
        </div>
      </section>


      {/* ── The map: where land is being acquired ─────────────────────── */}
      {/* Target of the header's "Maps" link. */}
      <section id="map" className="scroll-mt-20 border-t border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-4xl tracking-tight">{t("landing.mapTitle")}</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted">{t("landing.mapIntro")}</p>
            </div>
            <p className="text-xs text-muted">{t("landing.mapNote")}</p>
          </div>
          <div className="mt-8">
            <ChoroplethPanel
              source="/api/public/geo"
              metrics={PUBLIC_GEO_METRICS.map((key) => ({ key, label: t(`screens.geoMetric.${key}` as MessageKey), format: GEO_METRICS[key].format }))}
              initialMetric="areaProposedHa"
              height={500}
            />
          </div>
        </div>
      </section>

      {/* ── What the system does ───────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
        <h2 className="font-display text-4xl tracking-tight">{t("landing.featuresTitle")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">{t("landing.featuresIntro")}</p>
        <div className="reveal-grid mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.key} className="reveal h-full">
              <FlipCard icon={<f.icon className="h-5 w-5" />} title={tk(`landing.features.${f.key}Title`)} text={tk(`landing.features.${f.key}Text`)} layout="col" />
            </div>
          ))}
        </div>
      </section>

      {/* ── Track your own case ────────────────────────────────────────── */}
      <section id="about" className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-12 sm:px-8">
          <div>
            <h2 className="font-display text-2xl">{t("landing.trackTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("landing.trackIntro")}</p>
          </div>
          <form action="/track" className="flex w-full max-w-md gap-2">
            <input
              name="ref"
              placeholder={t("landing.trackExample", { example: "LA/UP/AGR/2026/0003" })}
              aria-label={t("landing.trackLabel")}
              className="h-11 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-sm uppercase focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <button className="h-11 rounded-lg bg-brand px-5 text-sm font-medium text-white hover:bg-brand-strong">
              {t("public.trackButton")}
            </button>
          </form>
        </div>
      </section>

      {/* ── Footer: live figures on the dark ground ────────────────────── */}
      <footer id="progress" className="relative overflow-hidden bg-brand-strong text-white">
        {/* a soft rise of ground behind the figures */}
        <svg
          aria-hidden="true"
          viewBox="0 0 1600 240"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 top-0 h-full w-full"
        >
          <path d="M0 96 C300 44 560 78 860 62 C1140 47 1360 76 1600 52 L1600 240 L0 240 Z" fill="#0f2b1e" opacity="0.5" />
          <path d="M0 140 C340 100 600 128 900 114 C1180 101 1380 128 1600 106 L1600 240 L0 240 Z" fill="#0a2016" opacity="0.55" />
        </svg>

        {/* the country itself, held faintly behind the figures — the same
            outline the hero map is drawn from, so the two agree */}
        <svg
          viewBox={INDIA_VIEWBOX}
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-10 h-[150%] opacity-[0.07] sm:right-10"
        >
          <path d={INDIA_PATH} fill="#ffffff" fillRule="evenodd" />
        </svg>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-accent/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-8">
          {/* A grid, not a wrapping flex row: with flex-wrap the first item of each new row kept
              its left divider, leaving hairlines floating in mid-air. */}
          <div className="grid grid-cols-1 items-center gap-y-9 sm:grid-cols-2 lg:grid-cols-[auto_repeat(4,minmax(0,1fr))] lg:gap-y-0">
            <p className="font-display text-[26px] leading-[1.15] tracking-tight lg:pr-10">
              {t("landing.footerLine1")}
              <br />
              {t("landing.footerLine2")}
            </p>

            {[
              { icon: MapPin, value: formatNumber(locale, s.parcels), label: t("landing.statParcels") },
              { icon: Users, value: formatNumber(locale, s.projects), label: t("landing.statProjects") },
              { icon: Database, value: `${s.statesWithLand} + ${s.utsWithLand}`, label: t("landing.statStates") },
              { icon: IndianRupee, value: formatIndianScale(s.paidRupees, locale), label: t("landing.statPaid") },
            ].map((stat) => (
              <div
                key={stat.label}
                className="flex items-start gap-3.5 border-white/15 lg:border-l lg:pl-7"
              >
                <stat.icon className="mt-1 h-7 w-7 shrink-0 text-white/45" strokeWidth={1.5} />
                <div className="min-w-0">
                  <div className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">
                    {stat.value}
                  </div>
                  <div className="mt-2 text-[13px] leading-snug text-white/60">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* provenance and credits, kept in the footer where they belong */}
          <div className="mt-10 flex flex-wrap items-start justify-between gap-4 border-t border-white/12 pt-6 text-[11px] leading-relaxed text-white/45">
            <span className="flex items-center gap-1.5"><ScrollText className="h-3.5 w-3.5" /> {t("landing.credit")}</span>
            {/* The work's title, its author and the licence stay as given, as CC BY requires. */}
            <span className="max-w-2xl sm:text-end">{t("landing.provenance")} ·{" "}
            {t("screens.heroMap.photoCredit", { work: "Yamuna Expressway, Delhi–Agra", author: "shivvir" })}{" "}
            <a
              href="https://creativecommons.org/licenses/by/2.0"
              className="underline underline-offset-2 hover:text-white"
              rel="noreferrer"
              target="_blank"
            >
              CC BY 2.0
            </a>{" "}
            · {t("screens.heroMap.boundsCredit")}</span>
          </div>

          {/* closing line, flanked by rules */}
          <div className="mt-12 flex items-center justify-center gap-5">
            <span className="h-px w-16 bg-white/20 sm:w-24" />
            <p className="text-center text-[11px] uppercase tracking-[0.25em] text-white/50">
              {t("landing.liveFigures")}
            </p>
            <span className="h-px w-16 bg-white/20 sm:w-24" />
          </div>
        </div>
      </footer>
    </div>
  );
}
