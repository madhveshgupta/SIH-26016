import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForProposal } from "@backend/rbac/scope";
import { accessHistory } from "@backend/documents/service";
import type { MessageKey } from "@backend/i18n";
import { PageHeader } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import { documentTitle } from "@backend/documents/words";
import { projectCrumbs, type ProjectContext } from "@frontend/lib/project-context";

export default async function DocumentsView({ project }: { project?: ProjectContext }) {
  const s = await requirePermission("document", "read");
  const { t, intl } = await getTranslator();
  const or = (key: string, fallback: string) => {
    const text = t(key as MessageKey);
    return text === key ? fallback : text;
  };

  const docs = await prisma.document.findMany({
    // Inside a project, only its own case files; the general documents that
    // belong to no case stay on the all-projects view.
    where: project
      ? { proposal: { AND: [scopeForProposal(s), { projectId: project.id }] } }
      : { OR: [{ proposal: scopeForProposal(s) }, { proposalId: null }] },
    include: {
      versions: { orderBy: { version: "desc" } },
      proposal: { select: { referenceNo: true } },
      uploadedBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  // Access history for the most recent document, to show the log is real.
  const history = docs[0] ? await accessHistory(docs[0].id, 6) : [];

  return (
    <div>
      <PageHeader
        title={t("pages.documentsTitle")}
        crumbs={project ? projectCrumbs(project, t("nav.projects"), t("nav.documents")) : undefined}
        description={t("screens.docs.desc", { count: docs.length })}
      />

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse bg-surface text-[11px]">
            <thead>
              <tr className="border-b border-border text-left">
                {[
                  t("screens.docs.colDocument"),
                  t("screens.docs.colCategory"),
                  t("screens.docs.colVersions"),
                  t("screens.docs.colVerify"),
                  t("screens.docs.colOpen"),
                ].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="max-w-[260px] truncate">{documentTitle(t, d.title)}</div>
                    <div className="font-mono text-[10px] text-muted">
                      {d.proposal?.referenceNo ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {or(`screens.docs.cat_${d.category}`, d.category)}
                  </td>
                  <td className="px-3 py-2">
                    {/* Re-uploading creates v2; v1 is never destroyed. */}
                    <div className="flex gap-1">
                      {d.versions.map((v) => (
                        <a
                          key={v.id}
                          href={`/api/documents/${d.id}?v=${v.version}`}
                          target="_blank"
                          className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-neutral-200 dark:hover:bg-neutral-700"
                        >
                          v{v.version}
                        </a>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted">
                    {d.verificationCode ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener" className="underline">
                      {t("screens.docs.open")}
                    </a>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted">
                    {t("screens.docs.none")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t("screens.docs.access")}
            </h2>
            <p className="mt-0.5 text-[10px] leading-snug text-muted">
              {t("screens.docs.accessDesc")}
            </p>
            {history.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted">
                {t("screens.docs.noDownloads")}
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {history.map((h, i) => (
                  <li key={i} className="text-[10px]">
                    <span className="font-medium">{h.actor}</span>{" "}
                    <span className="text-muted">
                      {or(`screens.docs.act_${h.action}`, h.action.toLowerCase())} v{h.version} ·{" "}
                      {h.at.toLocaleString(intl, { dateStyle: "medium", timeStyle: "medium" })}
                      {h.ipAddress && ` · ${h.ipAddress}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4 text-[11px] leading-relaxed text-muted">
            <strong className="text-foreground">{t("screens.docs.generated")}</strong>{" "}
            {t("screens.docs.generatedText")}
          </div>
        </div>
      </div>
    </div>
  );
}
