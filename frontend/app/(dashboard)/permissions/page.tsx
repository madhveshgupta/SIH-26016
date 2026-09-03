import { requirePermission } from "@backend/rbac/guard";
import { PERMISSIONS, ALL_RESOURCES, type Action } from "@backend/rbac/permissions";
import type { RoleType } from "@prisma/client";
import { PageHeader } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import type { MessageKey } from "@backend/i18n";
import { rich } from "@frontend/lib/rich";

export const dynamic = "force-dynamic";

const ROLES = Object.keys(PERMISSIONS) as RoleType[];
const MARK: Record<Action, string> = {
  create: "C", read: "R", update: "U", delete: "D", approve: "A", export: "E",
};

/** The permission matrix, on one screen. */
export default async function PermissionsPage() {
  await requirePermission("user", "read");
  const { t } = await getTranslator();
  const tk = (key: string) => t(key as MessageKey);

  return (
    <div>
      <PageHeader
        title={t("pages.permissionsTitle")}
        // i18n-ignore — the file name is shown as it is
        description={rich(t("screens.perms.desc"), { file: <code className="font-mono">backend/rbac/permissions.ts</code> })}
      />

      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-muted">
        {(Object.entries(MARK) as [Action, string][]).map(([a, m]) => (
          <span key={a}>
            <span className="mr-1 inline-block rounded bg-neutral-900 px-1 font-mono text-[10px] text-white dark:bg-neutral-100 dark:text-neutral-900">
              {m}
            </span>
            {tk(`screens.perms.a_${a}`)}
          </span>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse bg-surface text-[11px]">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">
                {t("screens.perms.resource")}
              </th>
              {ROLES.map((r) => (
                <th key={r} className="px-2 py-2 text-left font-medium align-bottom">
                  <span className="block max-w-[74px] leading-tight text-muted">
                    {tk(`roles.${r}`)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_RESOURCES.map((res) => (
              <tr key={res} className="border-b border-border last:border-0">
                <td className="sticky left-0 bg-surface px-3 py-1.5 font-medium">
                  {tk(`screens.perms.r_${res}`)}
                </td>
                {ROLES.map((role) => {
                  const actions = PERMISSIONS[role][res] ?? [];
                  return (
                    <td key={role} className="px-2 py-1.5">
                      {actions.length === 0 ? (
                        <span className="text-muted/50">—</span>
                      ) : (
                        <span className="font-mono tracking-tight text-foreground">
                          {actions.map((a) => MARK[a]).join("")}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        {rich(t("screens.perms.note"), {
          approve: <strong>{t("screens.perms.a_approve")}</strong>,
          update: <strong>{t("screens.perms.a_update")}</strong>,
          rows: <em>{t("screens.perms.whichRows")}</em>,
        })}
      </p>
    </div>
  );
}
