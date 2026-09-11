import { NextResponse } from "next/server";
import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { appendAudit, verifyChain } from "@backend/audit/chain";
import { LIMITS, rateLimit } from "@backend/security/rate-limit";
import { apiError, num } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** The audit trail, as a file an auditor can take away. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "auditLog", "export")) return await apiJson({ error: "Not permitted" }, { status: 403 });
  const limit = rateLimit(`audit-export:${s.id}`, LIMITS.export);
  if (!limit.ok) {
    return await apiJson({ error: "Wait a moment and try again." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  const url = new URL(req.url);
  const take = num(url.searchParams.get("limit"), { min: 1, max: 50_000, int: true }) ?? 5000;

  try {
    const [verification, rows] = await Promise.all([
      verifyChain(),
      prisma.auditLog.findMany({
        orderBy: { sequence: "desc" },
        take,
        select: {
          sequence: true, createdAt: true, action: true, entityType: true, entityId: true,
          ipAddress: true, prevHash: true, hash: true,
          actor: { select: { email: true, fullName: true, role: { select: { type: true } } } },
        },
      }),
    ]);

    const cell = (v: unknown) => {
      const text = v == null ? "" : String(v);
      const safe = /^[=+@-]/.test(text) ? `'${text}` : text;
      return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
    };

    const header = [
      `# Bhoomi Nayan audit trail — ${rows.length} records, newest first`,
      `# Chain verification: ${verification.intact ? "INTACT" : `BROKEN at sequence ${verification.brokenAtSequence} — ${verification.reason}`}`,
      `# ${verification.recordsChecked} records checked · exported ${new Date().toISOString()} by ${s.email}`,
      "sequence,when,actor,role,action,entityType,entityId,ipAddress,prevHash,hash",
    ];
    const body = rows.map((r) =>
      [
        r.sequence, r.createdAt.toISOString(), r.actor?.email ?? "system", r.actor?.role.type ?? "",
        r.action, r.entityType, r.entityId, r.ipAddress ?? "", r.prevHash ?? "", r.hash,
      ].map(cell).join(","),
    );

    await appendAudit({
      actorId: s.id, action: "DOWNLOAD", entityType: "AuditLog", entityId: "export",
      afterJson: { records: rows.length, chainIntact: verification.intact },
    });

    return new NextResponse([...header, ...body].join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bhoomi-nayan-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const { status, error } = apiError(e, "audit export");
    return await apiJson({ error }, { status });
  }
}
