import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { Download } from "lucide-react";
import VerifyChainButton from "@frontend/components/VerifyChainButton";
import { PageHeader } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import type { MessageKey } from "@backend/i18n";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requirePermission("auditLog", "read");
  const { t } = await getTranslator();
  // A code the dictionary has no word for yet is shown as logged.
  const word = (ns: string, code: string) => {
    const key = `screens.${ns}.${code}` as MessageKey;
    const text = t(key);
    return text === key ? code : text;
  };

  const rows = await prisma.auditLog.findMany({
    orderBy: { sequence: "desc" },
    take: 60,
    include: { actor: { select: { fullName: true, email: true } } },
  });

  return (
    <div>
      <PageHeader
        title={t("pages.auditTitle")}
        description={t("screens.audit.desc")}
        actions={
          <>
          <VerifyChainButton />
          {/* An auditor needs to take the trail away, with its verification. */}
          <a
            href="/api/audit/export"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t("screens.audit.export")}
          </a>
          </>
        }
      />

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse bg-surface text-[11px]">
          <thead>
            <tr className="border-b border-border text-left">
              {["#", t("screens.audit.colWhen"), t("screens.audit.colActor"), t("screens.audit.colAction"), t("screens.audit.colEntity"), "IP", t("screens.audit.colHash")].map((h) => (
                <th key={h} className="px-3 py-2 font-medium text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  {t("screens.audit.empty")}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5 font-mono tabular-nums text-muted">
                  {r.sequence.toString()}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                  {r.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td className="px-3 py-1.5">{r.actor?.fullName ?? "—"}</td>
                <td className="px-3 py-1.5">
                  {/* The logged code is on hover: it is what an auditor searches the export for. */}
                  <span
                    title={r.action}
                    className={
                      r.action === "LOGIN_FAILED"
                        ? "rounded bg-red-50 px-1.5 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "rounded bg-surface-muted px-1.5 py-0.5"
                    }
                  >
                    {word("auditAction", r.action)}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-muted" title={r.entityType}>
                  {word("auditEntity", r.entityType)}
                </td>
                <td className="px-3 py-1.5 font-mono text-muted">{r.ipAddress ?? "—"}</td>
                <td className="px-3 py-1.5 font-mono text-neutral-400">{r.hash.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
