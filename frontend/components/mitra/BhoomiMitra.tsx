"use client";

/** Bhoomi Mitra — the chat panel. */
import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2, Square, ShieldCheck } from "lucide-react";
import { useT } from "@frontend/components/I18nProvider";
import type { MessageKey } from "@backend/i18n/types";

interface Turn {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
}

const OPENERS = ["screens.mitra.open1", "screens.mitra.open2", "screens.mitra.open3"] as const;

/** The model marks key facts with **bold**; render that, and nothing else, as markup. */
function withBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

export default function BhoomiMitra() {
  const t = useT();
  /** A tool's plain name; the tool's own identifier if the dictionary has none. */
  const toolName = (name: string) => {
    const key = `screens.mitra.tool_${name}`;
    return t(key as MessageKey) === key ? name : t(key as MessageKey);
  };
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ready: boolean; detail: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, open, busy]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 60);
    fetch("/api/mitra")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStatus({ ready: s.ready, detail: s.detail }))
      .catch(() => {});
  }, [open]);

  // Abort any in-flight generation when the widget unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDraft("");
    setError(null);
    setBusy(true);

    const history = turns.map((turn) => ({ role: turn.role, content: turn.content }));
    // Push the question and an empty assistant turn we stream into.
    setTurns((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "", tools: [] }]);

    const appendToLast = (patch: (t: Turn) => Turn) =>
      setTurns((prev) => {
        const next = [...prev];
        const i = next.length - 1;
        if (i >= 0 && next[i].role === "assistant") next[i] = patch(next[i]);
        return next;
      });

    try {
      const res = await fetch("/api/mitra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t("screens.mitra.noAnswer"));
        setTurns((prev) => prev.slice(0, -1)); // drop the empty assistant turn
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Newline-delimited JSON: a chunk may split an event, so keep the tail.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { type: string; value?: string; name?: string; toolsUsed?: string[]; message?: string };
          try {
            ev = JSON.parse(line);
          } catch {
            continue; // a torn line; the tail will carry it
          }

          if (ev.type === "text" && ev.value) {
            appendToLast((turn) => ({ ...turn, content: turn.content + ev.value }));
          } else if (ev.type === "tool" && ev.name) {
            appendToLast((turn) => ({ ...turn, tools: [...(turn.tools ?? []), ev.name!] }));
          } else if (ev.type === "done") {
            appendToLast((turn) => ({ ...turn, tools: ev.toolsUsed ?? turn.tools }));
          } else if (ev.type === "error") {
            setError(ev.message ?? t("screens.mitra.noAnswer"));
          }
        }
      }

      // Drop the assistant turn if nothing ever arrived.
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === "assistant" && !last.content.trim() ? prev.slice(0, -1) : prev;
      });
    } catch (err) {
      // An abort is a deliberate stop, not a failure.
      if ((err as Error).name !== "AbortError") setError(t("screens.mitra.noServer"));
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === "assistant" && !last.content.trim() ? prev.slice(0, -1) : prev;
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("screens.mitra.openAria")}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
      >
        <MessageCircle className="h-5 w-5" />
        {t("screens.mitra.name")}
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[min(34rem,calc(100vh-3rem))] w-[min(26rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{t("screens.mitra.name")}</h2>
          <p className="flex items-center gap-1 text-[11px] text-muted">
            <ShieldCheck className="h-3 w-3" />
            {t("screens.mitra.readsOnly")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            stop();
            setOpen(false);
          }}
          aria-label={t("screens.mitra.closeAria")}
          className="rounded-lg p-1.5 text-muted transition hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              {t("screens.mitra.intro")}
            </p>
            {status && !status.ready && (
              <p className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-[11px] leading-relaxed">
                {status.detail}
              </p>
            )}
            <div className="space-y-1.5">
              {OPENERS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => ask(t(o))}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs transition hover:border-brand hover:text-brand"
                >
                  {t(o)}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                turn.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white"
                  : "max-w-full rounded-2xl rounded-bl-sm bg-surface-muted px-3 py-2 text-sm"
              }
            >
              <div className="whitespace-pre-wrap leading-relaxed">
                {turn.role === "assistant" ? withBold(turn.content) : turn.content}
                {/* Caret while this turn is still streaming. */}
                {busy && i === turns.length - 1 && turn.role === "assistant" && (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-middle" />
                )}
              </div>
              {turn.tools && turn.tools.length > 0 && (
                <p className="mt-2 border-t border-border pt-1.5 text-[10px] text-muted">
                  {t("screens.mitra.readFrom", { tools: [...new Set(turn.tools)].map(toolName).join(", ") })}
                </p>
              )}
            </div>
          </div>
        ))}

        {busy && turns[turns.length - 1]?.content === "" && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("screens.mitra.thinking")}
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs leading-relaxed">{error}</p>
        )}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
        className="flex items-end gap-2 border-t border-border p-3"
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
          placeholder={t("screens.mitra.placeholder")}
          className="max-h-24 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label={t("screens.mitra.stop")}
            className="rounded-lg border border-border p-2 text-muted transition hover:text-foreground"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label={t("screens.mitra.send")}
            className="rounded-lg bg-brand p-2 text-white transition hover:opacity-90 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </form>
    </div>
  );
}
