import { NextResponse } from "next/server";
import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { readDocument } from "@backend/documents/service";
import { apiJson } from "@backend/http/respond";

/** Serve a stored document. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "document", "read")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const version = new URL(req.url).searchParams.get("v");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  try {
    const doc = await readDocument(id, version ? Number(version) : null, s.id, ip);
    return new NextResponse(new Uint8Array(doc.data), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `inline; filename="${doc.fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return await apiJson({ error: (e as Error).message }, { status: 404 });
  }
}
