import { getSession } from "@backend/auth/session";
import { streamMitra, mitraStatus, type MitraTurn } from "@backend/mitra/chat";
import { currentLocale } from "@backend/i18n/locale";
import { LOCALE_INFO } from "@backend/i18n";
import { getTranslator } from "@backend/i18n/locale";
import { apiText } from "@backend/i18n/api-text";
import { apiJson } from "@backend/http/respond";

export const dynamic = "force-dynamic";
/** Node runtime: the Groq client and Prisma both need it. */
export const runtime = "nodejs";

/** Keep a conversation short enough that the model's context stays usable. */
const MAX_HISTORY = 10;

function parseHistory(v: unknown): MitraTurn[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (t): t is MitraTurn =>
        typeof t === "object" &&
        t !== null &&
        ["user", "assistant"].includes((t as MitraTurn).role) &&
        typeof (t as MitraTurn).content === "string",
    )
    .slice(-MAX_HISTORY);
}

/** Is Mitra configured? Lets the widget explain itself before anyone types. */
export async function GET() {
  const session = await getSession();
  if (!session) return await apiJson({ error: "Sign in to use Bhoomi Mitra." }, { status: 401 });
  return await apiJson(await mitraStatus());
}

/** Ask Bhoomi Mitra. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return await apiJson({ error: "Sign in to use Bhoomi Mitra." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return await apiJson({ error: "Malformed request." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return await apiJson({ error: "Ask a question." }, { status: 400 });
  if (question.length > 1000) {
    return await apiJson({ error: "That question is too long." }, { status: 400 });
  }

  const history = parseHistory(body.history);
  const viewerLanguage = LOCALE_INFO[await currentLocale()].english;
  const { t } = await getTranslator();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // The client hung up between our abort check and this write.
          closed = true;
        }
      };

      try {
        for await (const ev of streamMitra(session, question, history, req.signal, viewerLanguage)) {
          if (req.signal.aborted) break;
          // Errors are written in English; the streamed answer itself is already in the reader's language.
          send(ev.type === "error" ? { ...ev, message: apiText(t, ev.message) } : ev);
        }
      } catch (err) {
        // A disconnect surfaces as an abort, and is not worth logging as a fault.
        if (!req.signal.aborted) {
          console.error("[mitra] stream failed:", err);
          send({ type: "error", message: apiText(t, "Bhoomi Mitra could not answer just now.") });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the disconnect */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
