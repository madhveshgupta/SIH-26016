"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Emblem from "@frontend/components/Emblem";
import HeroMap from "@frontend/components/HeroMap";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, BadgeCheck, Building2, Gavel, KeyRound, Landmark, Loader2,
  MapPinned, Scale, ShieldCheck, Tractor, UserCog, Users,
} from "lucide-react";
import type { RoleType } from "@prisma/client";
import { Button, Field, Input, Select, Stepper } from "@frontend/components/ui";
import { cn } from "@frontend/lib/cn";
import type en from "@backend/i18n/locales/en";

/** The sign-in screen's words, translated on the server. */
export type LoginStrings = { [K in keyof typeof en.login]: string } & {
  back: string;
  district: string;
  /** The front page's line, carried onto this screen so the two read as one. */
  eyebrow: string;
  roles: Partial<Record<RoleType, string>>;
  roleDesc: Partial<Record<RoleType, string>>;
};

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

/** Splits a template around one placeholder, so an element can sit in the gap. */
const around = (template: string, name: string): [string, string] => {
  const [before, after = ""] = template.split(`{${name}}`);
  return [before, after];
};

interface Directory {
  roles: { role: RoleType; label: string; description: string; depth: "national" | "state" | "district" }[];
  states: { id: string; name: string; code: string; districts: { id: string; name: string }[] }[];
  accounts: { email: string; fullName: string; designation: string | null; role: RoleType; stateId: string | null; districtId: string | null }[];
}

const ROLE_ICON: Partial<Record<RoleType, typeof Gavel>> = {
  DISTRICT_COLLECTOR: Gavel,
  LAND_ACQUIRING_AUTHORITY: MapPinned,
  STATE_GOVERNMENT: Landmark,
  REHABILITATION_AUTHORITY: Users,
  LAND_REQUIRING_BODY: Building2,
  CENTRAL_MINISTRY: Scale,
  LANDOWNER: Tractor,
  SUPER_ADMIN: UserCog,
};

const DEMO_PASSWORD = "Suraksha@Bhoomi2026";
export default function LoginForm({ strings: S, languageSwitcher }: { strings: LoginStrings; languageSwitcher?: React.ReactNode }) {
  const STEPS = [S.stepRole, S.stepJurisdiction, S.stepPassword, S.stepVerify];
  const router = useRouter();
  const [dir, setDir] = useState<Directory | null>(null);
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<RoleType | null>(null);
  const [stateId, setStateId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [otp, setOtp] = useState("");
  const [otpInfo, setOtpInfo] = useState<{ destination: string; demoCode?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/demo-directory")
      .then((r) => (r.ok ? r.json() : null))
      .then(setDir)
      .catch(() => setDir(null));
  }, []);

  const card = dir?.roles.find((r) => r.role === role) ?? null;

  /** States that have at least one account for the chosen role. */
  const statesForRole = useMemo(() => {
    if (!dir || !role) return [];
    const ids = new Set(dir.accounts.filter((a) => a.role === role).map((a) => a.stateId));
    return dir.states.filter((s) => ids.has(s.id));
  }, [dir, role]);

  const districtsForRole = useMemo(() => {
    if (!dir || !role || !stateId) return [];
    const ids = new Set(dir.accounts.filter((a) => a.role === role && a.stateId === stateId).map((a) => a.districtId));
    return statesForRole.find((s) => s.id === stateId)?.districts.filter((d) => ids.has(d.id)) ?? [];
  }, [dir, role, stateId, statesForRole]);

  const nationalAccounts = useMemo(() => dir?.accounts.filter((a) => a.role === role) ?? [], [dir, role]);

  const resolved = useMemo(() => {
    if (!dir || !card) return null;
    if (card.depth === "national") return nationalAccounts.find((a) => a.email === email) ?? null;
    if (card.depth === "state") return dir.accounts.find((a) => a.role === role && a.stateId === stateId) ?? null;
    return dir.accounts.find((a) => a.role === role && a.districtId === districtId) ?? null;
  }, [dir, card, role, stateId, districtId, email, nationalAccounts]);

  function chooseRole(r: RoleType) {
    setRole(r);
    setStateId("");
    setDistrictId("");
    setEmail(dir?.accounts.find((a) => a.role === r)?.email ?? "");
    setError(null);
    setStep(1);
  }

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    const target = resolved?.email ?? email;
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? S.signInFailed);
        return;
      }
      setOtpInfo({ destination: data.destination, demoCode: data.demoCode });
      setOtp("");
      setStep(3);
      setTimeout(() => otpRef.current?.focus(), 50);
    } catch {
      setError(S.unreachable);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? S.verifyFailed);
        if (data.restart) setStep(2);
        return;
      }
      router.push(data.mustChangePassword ? `/account?first=1&next=${encodeURIComponent(data.home)}` : data.home);
      router.refresh();
    } catch {
      setError(S.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-background lg:h-dvh lg:min-h-0 lg:grid-cols-[1fr_1.15fr] lg:overflow-hidden">
      {/* Brand panel */}
      {/* The front page's scene, carried over in the brand's deep green: the
          same expressway photograph and the same map of India, so signing in
          reads as the next step rather than a different site. */}
      <section className="relative hidden overflow-hidden bg-[#12382a] p-8 text-white lg:flex lg:flex-col xl:p-10">
        <Image
          src="/hero/expressway.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="45vw"
          className="pointer-events-none select-none object-cover object-[50%_40%]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(44,98,71,0.90)_0%,rgba(27,77,54,0.86)_40%,rgba(14,42,29,0.96)_100%)]"
        />
        <div className="tricolour absolute inset-x-0 top-0 h-1" />
        <Link href="/" className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Emblem variant="mono" className="h-8 w-8" />
          </span>
          <span>
            <span className="block font-display text-2xl leading-none tracking-tight">
              Bhoomi <span className="text-[#e5a06f]">Nayan</span>
            </span>
            <span className="mt-1.5 block text-xs text-white/70">{S.systemName}</span>
          </span>
        </Link>
        <div className="relative flex min-h-0 flex-1 items-center justify-center py-4">
          <div className="map-stage relative aspect-[10/13] h-full max-h-[400px]">
            <span aria-hidden="true" className="map-burst pointer-events-none absolute inset-[6%] rounded-full bg-[#e5a06f]/25 blur-2xl" />
            <div className="map-pop-in h-full">
              <div className="map-float-wrap h-full">
                <HeroMap className="h-full w-full drop-shadow-2xl" />
              </div>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <p className="text-[12px] uppercase tracking-[0.28em] text-white/60">{S.eyebrow}</p>
          <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight xl:text-4xl">{S.heroTitle}</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/75">{S.heroText}</p>
          <ul className="mt-6 space-y-2.5 text-sm text-white/85">
            {[
              [ShieldCheck, S.point1],
              [MapPinned, S.point2],
              [BadgeCheck, S.point3],
            ].map(([Icon, text]) => {
              const I = Icon as typeof ShieldCheck;
              return (
                <li key={text as string} className="flex items-center gap-2.5">
                  <I className="h-4 w-4 text-[#e5a06f]" /> {text as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative mt-6 text-[11px] text-white/50">{S.demoNote}</p>
      </section>

      {/* Sign-in flow */}
      <section className="flex justify-center px-4 py-8 sm:px-8 lg:overflow-y-auto lg:py-6">
        <div className="my-auto w-full max-w-xl">
          <div className="mb-6 flex items-start justify-between gap-3 lg:hidden">
            <div>
              <div className="font-display text-2xl text-brand">Bhoomi <span className="text-accent">Nayan</span></div>
              <div className="text-xs text-muted">{S.systemName}</div>
            </div>
            {languageSwitcher}
          </div>
          {/* Title and language on one line, so the whole flow fits one screen. */}
          <div className="flex items-start justify-between gap-3">
            <h2 className="hero-step hero-step-1 font-display text-[30px] leading-tight tracking-tight text-foreground">
              {around(S.title, "brand")[0]}
              <span className="text-brand">Bhoomi</span> <span className="text-accent">Nayan</span>
              {around(S.title, "brand")[1]}
            </h2>
            {languageSwitcher && <div className="hidden shrink-0 pt-1 lg:block">{languageSwitcher}</div>}
          </div>
          <p className="hero-step hero-step-2 mt-1 text-sm text-muted">{S.intro}</p>
          <div className="hero-step hero-step-3 mt-4">
            <Stepper steps={STEPS} current={step} />
          </div>

          <div className="hero-step hero-step-4 mt-5 rounded-2xl border border-border bg-surface p-5 shadow-sm">
            {step === 0 && (
              <div>
                <h3 className="text-sm font-semibold">{S.signingInAs}</h3>
                {!dir ? (
                  <div className="flex items-center gap-2 py-10 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" /> {S.loadingAccounts}
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                    {dir.roles
                      .filter((r) => dir.accounts.some((a) => a.role === r.role))
                      .map((r, i) => {
                        const Icon = ROLE_ICON[r.role] ?? Users;
                        return (
                          <button
                            key={r.role}
                            onClick={() => chooseRole(r.role)}
                            style={{ animationDelay: `${70 + i * 45}ms` }}
                            className="role-card group flex items-start gap-3 rounded-2xl border border-border bg-surface p-3 text-start transition-all duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-[0_10px_28px_-10px_rgba(27,77,54,0.35)] focus-visible:-translate-y-0.5 focus-visible:border-brand focus-visible:shadow-[0_10px_28px_-10px_rgba(27,77,54,0.35)]"
                          >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand transition-colors duration-200 group-hover:bg-brand group-hover:text-white group-focus-visible:bg-brand group-focus-visible:text-white">
                              <Icon className="h-5 w-5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[15px] font-semibold leading-tight text-foreground">{S.roles[r.role] ?? r.label}</span>
                              <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted" title={S.roleDesc[r.role] ?? r.description}>{S.roleDesc[r.role] ?? r.description}</span>
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            {step === 1 && card && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (resolved) setStep(2);
                }}
                className="space-y-4"
              >
                <h3 className="text-sm font-semibold">{fill(S.jurisdictionOf, { role: S.roles[card.role] ?? card.label })}</h3>
                {card.depth === "national" ? (
                  <Field label={S.account}>
                    <Select value={email} onChange={(e) => setEmail(e.target.value)}>
                      {nationalAccounts.map((a) => (
                        <option key={a.email} value={a.email}>
                          {a.designation ?? a.fullName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <>
                    <Field label={S.stateUt} required>
                      <Select
                        value={stateId}
                        onChange={(e) => {
                          setStateId(e.target.value);
                          setDistrictId("");
                        }}
                      >
                        <option value="">{S.selectState}</option>
                        {statesForRole.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {card.depth === "district" && (
                      <Field label={S.district} required>
                        <Select value={districtId} onChange={(e) => setDistrictId(e.target.value)} disabled={!stateId}>
                          <option value="">{stateId ? S.selectDistrict : S.chooseStateFirst}</option>
                          {districtsForRole.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </>
                )}
                {resolved && (
                  <div className="rounded-xl bg-brand-soft/60 p-3 text-sm">
                    <div className="font-medium text-foreground">{resolved.fullName}</div>
                    <div className="text-xs text-muted">{resolved.designation}</div>
                    <div className="mt-1 font-mono text-[11px] text-brand">{resolved.email}</div>
                  </div>
                )}
                <div className="flex justify-between gap-2 pt-1">
                  <Button type="button" variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(0)}>
                    {S.back}
                  </Button>
                  <Button type="submit" disabled={!resolved}>
                    {S.continue}
                  </Button>
                </div>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={signIn} className="space-y-4">
                <h3 className="text-sm font-semibold">{S.enterPassword}</h3>
                <Field label={S.account}>
                  <Input value={resolved?.email ?? email} readOnly className="bg-surface-muted font-mono text-xs" />
                </Field>
                <Field label={S.password} hint={S.passwordHint}>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
                </Field>
                {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
                <div className="flex justify-between gap-2">
                  <Button type="button" variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(1)}>
                    {S.back}
                  </Button>
                  <Button type="submit" loading={busy} icon={<KeyRound className="h-4 w-4" />}>
                    {S.sendCode}
                  </Button>
                </div>
              </form>
            )}

            {step === 3 && otpInfo && (
              <form onSubmit={verify} className="space-y-4">
                <h3 className="text-sm font-semibold">{S.enterCode}</h3>
                <p className="text-xs text-muted">
                  {around(S.sentTo, "destination")[0]}
                  <span className="font-medium text-foreground">{otpInfo.destination}</span>
                  {around(S.sentTo, "destination")[1]}
                </p>
                {otpInfo.demoCode && (
                  <div className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-xs text-foreground">
                    {around(S.demoCode, "code")[0]}
                    <button type="button" className="font-mono text-sm font-semibold tracking-widest text-brand underline" onClick={() => setOtp(otpInfo.demoCode!)}>
                      {otpInfo.demoCode}
                    </button>
                    {around(S.demoCode, "code")[1]}
                  </div>
                )}
                <Input
                  ref={otpRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
                  aria-label={S.codeLabel}
                />
                {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => signIn()} className="text-xs text-brand hover:underline" disabled={busy}>
                    {S.resend}
                  </button>
                  <Button type="submit" loading={busy} disabled={otp.length !== 6} icon={<ShieldCheck className="h-4 w-4" />}>
                    {S.verify}
                  </Button>
                </div>
              </form>
            )}
          </div>

          <p className={cn("mt-4 text-center text-xs text-muted")}>
            {S.trackPrompt}{" "}
            <Link href="/track" className="font-medium text-brand hover:underline">
              {S.trackLink}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
