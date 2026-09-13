import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import * as Icons from "lucide-react";
import type { GrievanceCategory } from "@prisma/client";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForParcel } from "@backend/rbac/scope";
import { CATEGORIES, categoryFor } from "@backend/grievances/catalogue";
import { objectionWindow } from "@backend/statutory/notifications";
import { getTranslator } from "@backend/i18n/locale";
import { grievanceText } from "@backend/grievances/localise";
import { PageHeader } from "@frontend/components/ui";
import GrievanceForm, { type PlotOption } from "./GrievanceForm";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("screens.tab.raiseObjection") };
}

const KEYS = new Set<string>(CATEGORIES.map((c) => c.key));

/** The catalogue's icon name, resolved against lucide. */
function Icon({ name, className }: { name: string; className?: string }) {
  const C = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  return C ? <C className={className} /> : <Icons.FileText className={className} />;
}

/**
 * The citizen's route into the system: say what is wrong, in their own terms, and let the
 * platform work out which statute that is and who has to answer.
 */
export default async function RaisePage({
  searchParams,
}: {
  searchParams: Promise<{ issue?: string; plot?: string }>;
}) {
  const s = await requirePermission("grievance", "create");
  const { issue, plot } = await searchParams;
  const { t } = await getTranslator();
  const g = grievanceText(t);
  const crumbs = [
    { label: t("navGroups.land") },
    { label: t("nav.objections"), href: "/objections" },
  ];

  const parcels = await prisma.landParcel.findMany({
    where: scopeForParcel(s),
    select: {
      id: true,
      khasraNo: true,
      status: true,
      proposalId: true,
      village: { select: { name: true } },
      district: { select: { name: true } },
      project: { select: { name: true, governingAct: true } },
    },
    orderBy: { khasraNo: "asc" },
    take: 50,
  });

  if (parcels.length === 0) {
    return (
      <div>
        <PageHeader title={t("grievance.title")} crumbs={[...crumbs, { label: t("grievance.title") }]} />
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          {t("grievance.noLand")}
        </div>
      </div>
    );
  }

  // ---- Step 2: one issue chosen ----
  if (issue) {
    if (!KEYS.has(issue)) notFound();
    const def = categoryFor(issue as GrievanceCategory);

    const options: PlotOption[] = await Promise.all(
      parcels.map(async (p) => {
        const route = g.route(def.route(p.project.governingAct));
        const window = p.proposalId ? await objectionWindow(p.proposalId) : null;
        return {
          id: p.id,
          label: t("grievance.plotLabel", { khasra: p.khasraNo, village: p.village.name, district: p.district.name }),
          project: p.project.name,
          section: route.section,
          authorityLabel: route.authorityLabel,
          note: route.note,
          // Only says something where the answer changes what happens.
          objectionWindow: def.statutoryObjection
            ? window?.open
              ? { open: true, message: t("grievance.windowOpen") }
              : { open: false, message: t("grievance.windowShut") }
            : null,
        };
      }),
    );

    return (
      <div>
        <PageHeader
          title={g.title(def)}
          description={g.blurb(def)}
          crumbs={[...crumbs, { label: t("grievance.title"), href: "/objections/raise" }]}
        />
        <GrievanceForm
          category={def.key}
          fields={g.fields(def.fields)}
          labels={{
            whichPlot: t("grievance.whichPlot"),
            chooseOne: t("grievance.chooseOne"),
            submitTo: t("grievance.submitTo"),
            stillNeeded: t("grievance.stillNeeded"),
            cancel: t("common.cancel"),
            whereItGoes: t("grievance.whereItGoes"),
            authority: t("grievance.authority"),
            filedUnder: t("grievance.filedUnder"),
            acquisition: t("grievance.acquisition"),
            submittedTo: t("grievance.submittedTo"),
            yourReference: t("grievance.yourReference"),
            reached: t("grievance.reached"),
            alsoObjection: t("grievance.alsoObjection"),
            representation: t("grievance.representation"),
            seeProgress: t("grievance.seeProgress"),
            raiseAnother: t("grievance.raiseAnother"),
            couldNotSubmit: t("grievance.couldNotSubmit"),
          }}
          plots={options}
          initialPlotId={plot && options.some((o) => o.id === plot) ? plot : options[0].id}
        />
      </div>
    );
  }

  // ---- Step 1: what is wrong? ----
  return (
    <div>
      <PageHeader
        title={t("grievance.title")}
        description={t("grievance.intro")}
        crumbs={[...crumbs, { label: t("grievance.title") }]}
      />

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CATEGORIES.map((c) => {
          // Someone holding land under two different Acts would be told two different authorities
          // for the same card, so the card names one only when every plot agrees.
          const acts = new Set(parcels.map((p) => p.project.governingAct));
          const route = acts.size === 1 ? g.route(c.route([...acts][0])) : null;
          return (
            <li key={c.key}>
              <Link
                href={`/objections/raise?issue=${c.key}${plot ? `&plot=${plot}` : ""}`}
                className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 transition hover:border-brand/40 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <Icon name={c.icon} className="h-4.5 w-4.5" />
                </span>
                <span className="mt-3 text-sm font-semibold leading-snug">
                  {g.title(c)}
                </span>
                <span className="mt-1 text-xs leading-relaxed text-muted">
                  {g.blurb(c)}
                </span>
                <span className="mt-3 flex items-center gap-1.5 border-t border-border pt-2 text-[11px] text-muted">
                  <Icons.Landmark className="h-3 w-3 shrink-0" aria-hidden />
                  {route ? t("grievance.goesTo", { authority: route.authorityLabel }) : t("grievance.dependsOnPlot")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        {t("grievance.notSure")}
      </p>
    </div>
  );
}
