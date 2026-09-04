"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity, Bell, Brain, ChartColumnBig, ChevronDown, FileText, FlaskConical, FolderOpen, Gauge, Home, IndianRupee, Inbox, KeyRound,
  LayoutGrid, LogOut, Map, Megaphone, Menu, PanelLeftClose, PanelLeftOpen, Scale, Search, SlidersHorizontal, Smartphone,
  ShieldCheck, Sprout, UserRound, Users, X, Database,
} from "lucide-react";
import type { Locale } from "@backend/i18n";
import LanguageSwitcher, { type SwitcherLabels } from "@frontend/components/LanguageSwitcher";
import { ThemeToggle } from "@frontend/components/ui/ThemeToggle";
import Emblem from "@frontend/components/Emblem";
import BhoomiMitra from "@frontend/components/mitra/BhoomiMitra";
import { cn } from "@frontend/lib/cn";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Active only on this exact path (plus `also`), not everything beneath it. */
  exact?: boolean;
  also?: string[];
  /** The page belongs here though its address is elsewhere, e.g. a case opened from the inbox. */
  current?: boolean;
  /** The open project, with its own sections — shown under Projects. */
  workspace?: { id: string; title: string; subtitle: string; switchLabel: string; items: NavItem[] };
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** The chrome's own strings, translated on the server and handed down. */
export interface ShellLabels {
  appName: string;
  appTagline: string;
  /** The search box's placeholder. */
  search: string;
  /** The short label for the search link on narrow screens. */
  searchShort: string;
  mainNav: string;
  openMenu: string;
  closeMenu: string;
  collapseMenu: string;
  expandMenu: string;
  alerts: string;
  initialPassword: string;
  changePassword: string;
  changePasswordMenu: string;
  signOut: string;
  account: string;
  /** The language switcher's own words. */
  language: SwitcherLabels;
}

const ICONS: Record<string, typeof Gauge> = {
  dashboard: Gauge, land: Sprout, bell: Bell, inbox: Inbox, file: FileText, projects: LayoutGrid,
  map: Map, megaphone: Megaphone, scale: Scale, rupee: IndianRupee, home: Home, folder: FolderOpen,
  shield: ShieldCheck, users: Users, activity: Activity, reports: ChartColumnBig,
  brain: Brain, sliders: SlidersHorizontal, flask: FlaskConical, smartphone: Smartphone,
  database: Database,
};

export default function ShellFrame({
  groups,
  user,
  unreadAlerts,
  mustChangePassword,
  locale,
  translatedLocales,
  localeCoverage,
  strings,
  children,
}: {
  groups: NavGroup[];
  user: { fullName: string; designation: string; jurisdiction: string; isCitizen: boolean };
  unreadAlerts: number;
  mustChangePassword: boolean;
  locale: Locale;
  /** Languages with a translation, so the switcher can mark the rest. */
  translatedLocales: Locale[];
  /** How much of the interface each language covers, 0–1. */
  localeCoverage: Record<Locale, number>;
  /** Chrome text, translated on the server where the language is known. */
  strings: ShellLabels;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  // The address as the workspace sees it: the field app names its project in the query.
  const here = query ? `${pathname}?${query}` : pathname;
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer and user menu on navigation.
  useEffect(() => {
    const t = setTimeout(() => {
      setMobileOpen(false);
      setMenuOpen(false);
    }, 0);
    return () => clearTimeout(t);
  }, [pathname]);

  // The project workspace under Projects.
  const initialWorkspace = groups.flatMap((g) => g.items).find((i) => i.href === "/projects")?.workspace ?? null;
  const [workspace, setWorkspace] = useState<{ value: NavItem["workspace"] | null; forPath: string }>({
    value: initialWorkspace,
    forPath: here,
  });
  useEffect(() => {
    if (!/^\/(projects|proposals|parcels)\/[a-z0-9]{20,32}([/?]|$)|^\/field\?(.*&)?project=/.test(here)) return;
    let cancelled = false;
    fetch(`/api/nav/workspace?path=${encodeURIComponent(here)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.workspace) setWorkspace({ value: d.workspace, forPath: here });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [here]);

  // Open only while the page belongs to the project: its own pages, or a case or plot page the
  // server placed in it.
  const open =
    workspace.value &&
    (pathname === `/projects/${workspace.value.id}` ||
      pathname.startsWith(`/projects/${workspace.value.id}/`) ||
      workspace.forPath === here)
      ? workspace.value
      : null;

  const isActive = (item: NavItem) => {
    // "This page belongs here" holds only for the page it was worked out for.
    if (item.current && workspace.forPath === here) return true;
    const path = item.href.split("?")[0];
    if (item.exact) return pathname === path || (item.also ?? []).includes(pathname);
    return pathname === path || pathname.startsWith(`${path}/`);
  };
  const link = (item: NavItem, nested = false) => {
    const Icon = ICONS[item.icon] ?? FileText;
    const active = isActive(item);
    return (
      <Link
        href={item.href}
        title={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-2.5 text-sm transition",
          nested ? "py-1.5" : "py-2",
          active ? "bg-brand text-white shadow-sm" : "text-foreground/80 hover:bg-surface-muted hover:text-foreground",
          collapsed && "lg:justify-center lg:px-0",
        )}
      >
        <Icon className={cn("shrink-0", nested ? "h-3.5 w-3.5" : "h-4 w-4")} />
        <span className={cn("truncate", nested && "text-[13px]", collapsed && "lg:hidden")}>{item.label}</span>
        {item.href === "/alerts" && unreadAlerts > 0 && (
          <span className={cn("ml-auto rounded-full px-1.5 text-[10px] font-semibold tabular-nums", active ? "bg-surface text-brand" : "bg-danger text-white", collapsed && "lg:hidden")}>
            {unreadAlerts}
          </span>
        )}
      </Link>
    );
  };
  const home = user.isCitizen ? "/my-land" : "/dashboard";

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <nav data-nav="main" aria-label={strings.mainNav} className="flex h-full flex-col">
      <Link href={home} className={cn("flex items-center gap-2.5 px-4 py-4", collapsed && "lg:justify-center lg:px-0")}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
          <Emblem variant="mono" className="h-7 w-7" />
        </span>
        <span className={cn("min-w-0", collapsed && "lg:hidden")}>
          <span className="block text-sm font-semibold leading-tight text-foreground">{strings.appName}</span>
          <span className="block text-[10px] leading-tight text-muted">{strings.appTagline}</span>
        </span>
      </Link>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.group}>
            <div className={cn("px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/80", collapsed && "lg:hidden")}>{g.group}</div>
            <ul className="space-y-0.5">
              {g.items.map((listed) => {
                const item = listed.href === "/projects" ? { ...listed, workspace: open ?? undefined } : listed;
                return (
                <li key={item.href}>
                  {link(item)}
                  {item.workspace && (
                    <div className={cn("ml-3 mt-1 border-l border-border pl-2", collapsed && "lg:ml-0 lg:border-l-0 lg:pl-0")}>
                      <div className={cn("px-2 pb-1 pt-0.5", collapsed && "lg:hidden")}>
                        <div className="truncate text-xs font-semibold text-foreground" title={item.workspace.title}>{item.workspace.title}</div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[10px] text-muted">{item.workspace.subtitle}</span>
                          <Link href="/projects" className="shrink-0 text-[10px] text-brand hover:underline">{item.workspace.switchLabel}</Link>
                        </div>
                      </div>
                      <ul className="space-y-0.5">
                        {item.workspace.items.map((sub) => (
                          <li key={sub.href}>{link(sub, true)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? strings.expandMenu : strings.collapseMenu}
        className="hidden items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted hover:text-foreground lg:flex"
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        <span className={cn(collapsed && "hidden")}>{strings.collapseMenu}</span>
      </button>
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="tricolour fixed inset-x-0 top-0 z-50 h-[3px]" />

      {/* Desktop sidebar */}
      <aside className={cn("fixed inset-y-0 left-0 z-30 hidden border-r border-border bg-surface pt-[3px] transition-[width] lg:block", collapsed ? "w-[72px]" : "w-64")}>
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label={strings.closeMenu} className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface pt-[3px] shadow-xl">
            <button aria-label={strings.closeMenu} onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-md p-1 text-muted hover:bg-surface-muted">
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className={cn("transition-[padding]", collapsed ? "lg:pl-[72px]" : "lg:pl-64")}>
        <header className="sticky top-[3px] z-20 border-b border-border bg-surface/90 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button aria-label={strings.openMenu} onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-surface-muted lg:hidden">
              <Menu className="h-5 w-5" />
            </button>

            <form action="/search" className="relative hidden w-full max-w-md sm:block" role="search">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
              <input
                name="q"
                placeholder={strings.search}
                aria-label={strings.search}
                className="h-9 w-full rounded-lg border border-border bg-surface-muted pl-9 pr-3 text-sm focus:border-brand focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </form>

            <div className="ml-auto flex items-center gap-1">
              <Link href="/search" aria-label={strings.searchShort} className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground sm:hidden">
                <Search className="h-4 w-4" />
              </Link>
              <Link href="/alerts" aria-label={`${strings.alerts} (${unreadAlerts})`} className="relative rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground">
                <Bell className="h-4 w-4" />
                {unreadAlerts > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                    {unreadAlerts > 99 ? "99+" : unreadAlerts}
                  </span>
                )}
              </Link>
              <LanguageSwitcher current={locale} translated={translatedLocales} coverage={localeCoverage} labels={strings.language} compact />
              <ThemeToggle />

              <div className="relative ml-1">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-muted"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                    {user.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </span>
                  <span className="hidden text-left md:block">
                    <span className="block max-w-[220px] truncate text-xs font-medium leading-tight text-foreground">{user.fullName}</span>
                    <span className="block max-w-[220px] truncate text-[11px] leading-tight text-muted">{user.jurisdiction}</span>
                  </span>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-muted md:block" />
                </button>
                {menuOpen && (
                  <div role="menu" className="absolute right-0 mt-1 w-64 animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                    <div className="border-b border-border px-2.5 pb-2 pt-1.5">
                      <div className="text-sm font-medium text-foreground">{user.fullName}</div>
                      <div className="text-xs text-muted">{user.designation}</div>
                      <div className="mt-0.5 text-[11px] text-brand">{user.jurisdiction}</div>
                    </div>
                    <Link role="menuitem" href="/account" className="mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted">
                      <UserRound className="h-4 w-4 text-muted" /> {strings.account}
                    </Link>
                    <Link role="menuitem" href="/account#password" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted">
                      <KeyRound className="h-4 w-4 text-muted" /> {strings.changePasswordMenu}
                    </Link>
                    <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-danger hover:bg-danger-soft">
                      <LogOut className="h-4 w-4" /> {strings.signOut}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {mustChangePassword && (
          <div className="border-b border-accent/30 bg-accent-soft px-4 py-2 text-center text-xs text-foreground">
            {strings.initialPassword}{" "}
            <Link href="/account#password" className="font-semibold text-brand underline">
              {strings.changePassword}
            </Link>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>

        {/* Bhoomi Mitra rides above every signed-in page; it reads only what
            this session is allowed to see. */}
        <BhoomiMitra />
      </div>
    </div>
  );
}
