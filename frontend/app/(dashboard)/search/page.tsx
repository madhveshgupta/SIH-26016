import type { Metadata } from "next";
import Link from "next/link";
import { FileText, LayoutGrid, MapPin, Search } from "lucide-react";
import { requireSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel, scopeForProject, scopeForProposal } from "@backend/rbac/scope";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import { stageKey } from "@backend/i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("common.search") };
}

/** One search across the records the caller is allowed to see — never beyond their jurisdiction. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession();
  const { t } = await getTranslator();
  const q = ((await searchParams).q ?? "").trim();
  const contains = { contains: q, mode: "insensitive" as const };

  const [proposals, projects, parcels] = q
    ? await Promise.all([
        can(s.role, "proposal", "read")
          ? prisma.proposal.findMany({
              where: { AND: [scopeForProposal(s), { OR: [{ referenceNo: contains }, { project: { name: contains } }] }] },
              select: { id: true, referenceNo: true, status: true, project: { select: { name: true, governingAct: true } } },
              take: 20,
            })
          : [],
        can(s.role, "project", "read")
          ? prisma.project.findMany({
              where: { AND: [scopeForProject(s), { OR: [{ name: contains }, { referenceNo: contains }] }] },
              select: { id: true, referenceNo: true, name: true, type: true },
              take: 20,
            })
          : [],
        can(s.role, "parcel", "read")
          ? prisma.landParcel.findMany({
              where: { AND: [scopeForParcel(s), { OR: [{ khasraNo: { equals: q } }, { ulpin: contains }, { village: { name: contains } }] }] },
              select: { id: true, khasraNo: true, ulpin: true, status: true, village: { select: { name: true } }, project: { select: { name: true } } },
              take: 40,
            })
          : [],
      ])
    : [[], [], []];

  const total = proposals.length + projects.length + parcels.length;

  return (
    <div>
      <PageHeader title={t("pages.searchTitle")} description={t("pageDesc.search")} crumbs={[{ label: t("pages.searchTitle") }]} />
      <form className="relative mb-6 max-w-2xl">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden />
        <input name="q" defaultValue={q} autoFocus placeholder={t("screens.search.placeholder")} aria-label={t("common.search")} className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
      </form>

      {!q ? (
        <EmptyState icon={<Search className="h-5 w-5" />} title={t("screens.search.empty")} description={t("screens.search.emptyDesc")} />
      ) : total === 0 ? (
        <EmptyState icon={<Search className="h-5 w-5" />} title={t("screens.search.noResults", { q })} description={t("screens.search.noResultsDesc")} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card>
            <CardHeader title={t("nav.proposals")} icon={<FileText className="h-4 w-4" />} description={t("screens.search.found", { count: proposals.length })} />
            <ul className="divide-y divide-border">
              {proposals.map((p) => (
                <li key={p.id}>
                  <Link href={`/proposals/${p.id}`} className="block px-5 py-3 hover:bg-surface-muted">
                    <div className="font-mono text-xs text-brand">{p.referenceNo}</div>
                    <div className="text-sm">{p.project.name}</div>
                    <Badge className="mt-1">{t(stageKey(p.project.governingAct, p.status))}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title={t("nav.projects")} icon={<LayoutGrid className="h-4 w-4" />} description={t("screens.search.found", { count: projects.length })} />
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="block px-5 py-3 hover:bg-surface-muted">
                    <div className="font-mono text-xs text-muted">{p.referenceNo}</div>
                    <div className="text-sm">{p.name}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title={t("screens.reportPack.ent_parcel")} icon={<MapPin className="h-4 w-4" />} description={t("screens.search.found", { count: parcels.length })} />
            <ul className="divide-y divide-border">
              {parcels.map((p) => (
                <li key={p.id}>
                  <Link href={`/parcels/${p.id}`} className="block px-5 py-3 hover:bg-surface-muted">
                    <div className="text-sm font-medium">{t("screens.search.plotLine", { no: p.khasraNo, village: p.village.name })}</div>
                    <div className="text-xs text-muted">{p.project.name}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
