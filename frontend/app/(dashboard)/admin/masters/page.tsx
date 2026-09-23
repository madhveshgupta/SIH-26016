import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForDistrict } from "@backend/rbac/scope";
import { mayEditBodies, mayEditDistricts } from "@backend/masters/service";
import { Badge, PageHeader } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import type { MessageKey } from "@backend/i18n";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
import { cn } from "@frontend/lib/cn";
import { AgencyButton, EditDistrictButton, MinistryButton } from "./MasterForms";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("screens.tab.masterData") };
}

const TABS = [
  { id: "districts", label: "screens.masters.tabDistricts" },
  { id: "agencies", label: "screens.masters.tabAgencies" },
  { id: "ministries", label: "screens.masters.tabMinistries" },
  { id: "states", label: "screens.masters.tabStates" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const th = "px-3 py-2 text-left font-medium text-muted";
const td = "px-3 py-2 align-top";

function rupees(v: unknown, intl: string) {
  return v == null ? null : `₹${Number(v).toLocaleString(intl, { maximumFractionDigits: 0 })}`;
}

/**
 * The reference tables every case is built on, in one place, with the same validation and audit
 * trail as case data.
 */
export default async function MastersPage({ searchParams }: { searchParams: Promise<{ tab?: string; state?: string }> }) {
  const s = await requirePermission("masterData", "read");
  const { t, intl } = await getTranslator();
  const sp = await searchParams;
  const tab: Tab = TABS.some((x) => x.id === sp.tab) ? (sp.tab as Tab) : "districts";
  const editDistricts = mayEditDistricts(s.role);
  const editBodies = mayEditBodies(s.role);

  const href = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ tab, state: sp.state, ...next }).filter(([, v]) => v) as [string, string][]);
    return `/admin/masters?${q}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.masterData")}
        crumbs={[{ label: t("crumbs.administration") }, { label: t("nav.masterData") }]}
        description={t("screens.masters.desc")}
      />

      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label={t("screens.masters.tablesAria")}>
        {TABS.map((x) => (
          <Link
            key={x.id}
            href={href({ tab: x.id, state: x.id === "districts" ? sp.state : undefined })}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-xs font-medium",
              x.id === tab ? "border-brand text-foreground" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t(x.label)}
          </Link>
        ))}
      </nav>

      {tab === "districts" && <Districts stateId={sp.state} editable={editDistricts} scope={scopeForDistrict(s)} href={href} t={t} intl={intl} />}
      {tab === "agencies" && <Agencies editable={editBodies} t={t} />}
      {tab === "ministries" && <Ministries editable={editBodies} t={t} />}
      {tab === "states" && <States t={t} />}
    </div>
  );
}

async function Districts({ stateId, editable, scope, href, t, intl }: { stateId?: string; editable: boolean; scope: Record<string, unknown>; href: (n: Record<string, string | undefined>) => string; t: T; intl: string }) {
  const [rows, states] = await Promise.all([
    prisma.district.findMany({
      where: { AND: [scope, stateId ? { stateId } : {}] },
      orderBy: [{ state: { name: "asc" } }, { name: "asc" }],
      include: { state: { select: { name: true } }, _count: { select: { parcels: true, tehsils: true } } },
    }),
    prisma.state.findMany({ where: { districts: { some: scope } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const unset = rows.filter((d) => d.circleRatePerHectare == null).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {states.length > 1 && (
          <>
            <span className="text-muted">{t("screens.masters.stateLabel")}</span>
            <Link href={href({ state: undefined })} className={cn("rounded px-2 py-1", !stateId ? "bg-brand text-white" : "bg-surface-muted hover:text-foreground")}>
              {t("common.all")}
            </Link>
            {states.map((st) => (
              <Link key={st.id} href={href({ state: st.id })} className={cn("rounded px-2 py-1", stateId === st.id ? "bg-brand text-white" : "bg-surface-muted hover:text-foreground")}>
                {st.name}
              </Link>
            ))}
          </>
        )}
        {unset > 0 && <Badge tone="warning">{t("screens.masters.unset", { count: unset })}</Badge>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse bg-surface text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className={th}>{t("common.district")}</th>
              <th className={th}>{t("common.state")}</th>
              <th className={th}>LGD</th>
              <th className={th}>{t("common.area")}</th>
              <th className={cn(th, "text-right")}>{t("screens.masters.multiplier")}</th>
              <th className={cn(th, "text-right")}>{t("screens.masters.circleRate")}</th>
              <th className={cn(th, "text-right")}>{t("screens.integ.colPlots")}</th>
              {editable && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-border last:border-0">
                <td className={td}>
                  <div className="font-medium">{d.name}</div>
                  {d.nameLocal && <div className="text-[11px] text-muted">{d.nameLocal}</div>}
                </td>
                <td className={td}>{d.state.name}</td>
                <td className={cn(td, "font-mono text-[11px] text-muted")}>{d.lgdCode}</td>
                <td className={td}>{d.isUrban ? t("screens.masters.urban") : t("screens.masters.rural")}</td>
                <td className={cn(td, "text-right tabular-nums")}>{Number(d.multiplierFactor).toFixed(2)}</td>
                <td className={cn(td, "text-right tabular-nums")}>
                  {rupees(d.circleRatePerHectare, intl) ?? <Badge tone="warning">{t("screens.masters.notSet")}</Badge>}
                </td>
                <td className={cn(td, "text-right tabular-nums text-muted")}>{d._count.parcels.toLocaleString(intl)}</td>
                {editable && (
                  <td className={cn(td, "text-right")}>
                    <EditDistrictButton
                      d={{
                        id: d.id,
                        name: d.name,
                        nameLocal: d.nameLocal,
                        circleRatePerHectare: d.circleRatePerHectare?.toString() ?? null,
                        multiplierFactor: Number(d.multiplierFactor).toFixed(2),
                        isUrban: d.isUrban,
                      }}
                    />
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted">{t("screens.masters.noDistricts")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function Agencies({ editable, t }: { editable: boolean; t: T }) {
  const [rows, ministries] = await Promise.all([
    prisma.agency.findMany({
      orderBy: { code: "asc" },
      include: { ministry: { select: { code: true } }, _count: { select: { projects: true, users: true } } },
    }),
    prisma.ministry.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  return (
    <div className="space-y-3">
      {editable && (
        <div className="flex justify-end">
          <AgencyButton ministries={ministries} />
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse bg-surface text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className={th}>{t("screens.masters.code")}</th>
              <th className={th}>{t("screens.masters.agency")}</th>
              <th className={th}>{t("screens.plotRecord.ministry")}</th>
              <th className={th}>{t("screens.masters.filesProposals")}</th>
              <th className={cn(th, "text-right")}>{t("nav.projects")}</th>
              <th className={cn(th, "text-right")}>{t("screens.masters.users")}</th>
              {editable && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className={cn(td, "font-mono")}>{a.code}</td>
                <td className={td}>{a.name}</td>
                <td className={cn(td, "font-mono text-muted")}>{a.ministry?.code ?? "—"}</td>
                <td className={td}>{a.isRequiringBody ? <Badge tone="info">{t("screens.masters.requiringBody")}</Badge> : <span className="text-muted">{t("screens.masters.implementingOnly")}</span>}</td>
                <td className={cn(td, "text-right tabular-nums")}>{a._count.projects}</td>
                <td className={cn(td, "text-right tabular-nums")}>{a._count.users}</td>
                {editable && (
                  <td className={cn(td, "text-right")}>
                    <AgencyButton a={{ id: a.id, code: a.code, name: a.name, isRequiringBody: a.isRequiringBody, ministryId: a.ministryId }} ministries={ministries} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function Ministries({ editable, t }: { editable: boolean; t: T }) {
  const rows = await prisma.ministry.findMany({
    orderBy: { code: "asc" },
    include: { _count: { select: { agencies: true, projects: true } } },
  });
  return (
    <div className="space-y-3">
      {editable && (
        <div className="flex justify-end">
          <MinistryButton />
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse bg-surface text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className={th}>{t("screens.masters.code")}</th>
              <th className={th}>{t("screens.plotRecord.ministry")}</th>
              <th className={cn(th, "text-right")}>{t("screens.masters.tabAgencies")}</th>
              <th className={cn(th, "text-right")}>{t("nav.projects")}</th>
              {editable && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className={cn(td, "font-mono")}>{m.code}</td>
                <td className={td}>{m.name}</td>
                <td className={cn(td, "text-right tabular-nums")}>{m._count.agencies}</td>
                <td className={cn(td, "text-right tabular-nums")}>{m._count.projects}</td>
                {editable && (
                  <td className={cn(td, "text-right")}>
                    <MinistryButton m={{ id: m.id, code: m.code, name: m.name }} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function States({ t }: { t: T }) {
  const rows = await prisma.state.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { districts: true } } },
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {t("screens.masters.statesNote")}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse bg-surface text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className={th}>LGD</th>
              <th className={th}>{t("screens.integ.colState")}</th>
              <th className={th}>{t("screens.plotRecord.type")}</th>
              <th className={cn(th, "text-right")}>{t("screens.masters.districtsOnFile")}</th>
              <th className={th}>{t("screens.masters.portal")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((st) => (
              <tr key={st.id} className="border-b border-border last:border-0">
                <td className={cn(td, "font-mono text-muted")}>{st.lgdCode}</td>
                <td className={td}>
                  {st.name}
                  {st.nameLocal && <span className="ms-2 text-muted">{st.nameLocal}</span>}
                </td>
                <td className={td}>{st.isUT ? t("screens.masters.ut") : t("screens.masters.state")}</td>
                <td className={cn(td, "text-right tabular-nums")}>{st._count.districts}</td>
                <td className={td}>{st.cadastralBaseUrl ? <Badge tone="success">{t("screens.masters.connected")}</Badge> : <span className="text-muted">{t("screens.masters.notReachable")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
