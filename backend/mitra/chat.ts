/** Bhoomi Mitra — the conversation loop, on Groq. */
import Groq, { APIError, APIConnectionError, AuthenticationError, RateLimitError } from "groq-sdk";
import type { Actor } from "@backend/rbac/scope";
import { MITRA_TOOLS, runTool } from "./tools";
import { REFUSAL, systemPrompt } from "./prompt";

/** The Groq model. gpt-oss-120b supports tool calling and streams well. */
export const MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

/** Stop a runaway loop. Five rounds is far more than any real question needs. */
const MAX_ROUNDS = 5;

export interface MitraTurn {
  role: "user" | "assistant";
  content: string;
}

/** One event on the wire to the browser. */
export type MitraEvent =
  | { type: "text"; value: string }
  | { type: "tool"; name: string }
  | { type: "done"; toolsUsed: string[] }
  | { type: "error"; message: string };

let client: Groq | null = null;

function groq(): Groq {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("GROQ_API_KEY is not set");
  // A few retries ride out the free tier's per-minute token limit; the SDK
  // honours Groq's retry-after header between them.
  if (!client) client = new Groq({ apiKey: key, maxRetries: 3 });
  return client;
}

/** What the user sees when Groq fails. */
function friendlyError(err: unknown): string {
  console.error("[mitra] Groq request failed:", err);
  if (err instanceof RateLimitError) {
    return "Bhoomi Mitra is handling too many questions right now. Please try again in a minute.";
  }
  if (err instanceof AuthenticationError) {
    return "Bhoomi Mitra is not configured correctly (the Groq API key was rejected).";
  }
  if (err instanceof APIConnectionError) {
    return "Bhoomi Mitra could not reach its model service. Check the server's internet connection.";
  }
  if (err instanceof APIError && err.status === 404) {
    return `Bhoomi Mitra is not configured correctly (model "${MODEL}" was not found on Groq).`;
  }
  return "Bhoomi Mitra could not answer just now. Please try again.";
}

/** Mitra is ready whenever a Groq key is configured. */
export async function mitraStatus(): Promise<{ ready: boolean; model: string; detail: string }> {
  if (process.env.GROQ_API_KEY?.trim()) {
    return { ready: true, model: MODEL, detail: `${MODEL} on Groq` };
  }
  return {
    ready: false,
    model: MODEL,
    detail: "Bhoomi Mitra is not configured. Set GROQ_API_KEY in .env and restart the server.",
  };
}

/** Our JSON-Schema tool definitions, in the shape the Groq client wants. */
const GROQ_TOOLS: Groq.Chat.ChatCompletionTool[] = MITRA_TOOLS.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

/** Ask Mitra one question, streaming the answer as it is generated. */
export async function* streamMitra(
  actor: Actor,
  question: string,
  history: MitraTurn[] = [],
  signal?: AbortSignal,
  /** The viewer's chosen language, by its English name; replies default to it. */
  viewerLanguage = "English",
): AsyncGenerator<MitraEvent> {
  const status = await mitraStatus();
  if (!status.ready) {
    yield { type: "error", message: status.detail };
    return;
  }

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(viewerLanguage) },
    ...history.map((t): Groq.Chat.ChatCompletionMessageParam => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];

  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) return;

    let text = "";
    // Tool calls stream in fragments, keyed by index; stitch them back together.
    const calls: { id: string; name: string; arguments: string }[] = [];

    try {
      const stream = await groq().chat.completions.create(
        {
          model: MODEL,
          messages,
          tools: GROQ_TOOLS,
          tool_choice: "auto",
          // Low temperature: this assistant quotes statute and deadlines, where
          // invention is the failure mode we care most about.
          temperature: 0.2,
          // Reasoning tokens count against max_completion_tokens; keep them out
          // of the answer stream and leave room for the reply itself.
          reasoning_effort: "low",
          reasoning_format: "hidden",
          max_completion_tokens: 2048,
          stream: true,
        },
        { signal },
      );

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          text += delta.content;
          yield { type: "text", value: delta.content };
        }

        for (const tc of delta.tool_calls ?? []) {
          const slot = (calls[tc.index] ??= { id: "", name: "", arguments: "" });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.arguments += tc.function.arguments;
        }
      }
    } catch (err) {
      // An aborted request throws; that is a disconnect, not a failure.
      if (signal?.aborted) return;
      yield { type: "error", message: friendlyError(err) };
      return;
    }

    const toolCalls = calls.filter(Boolean);
    if (toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        })),
      });

      for (const call of toolCalls) {
        toolsUsed.push(call.name);
        yield { type: "tool", name: call.name };

        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.arguments || "{}");
          if (parsed && typeof parsed === "object") args = parsed;
        } catch {
          args = {};
        }

        const result = await runTool(actor, call.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }

    yield { type: "done", toolsUsed };
    return;
  }

  yield {
    type: "text",
    value:
      "\n\nThat question needed too many lookups. Please ask again with one specific case reference.",
  };
  yield { type: "done", toolsUsed };
}

/**
 * Non-streaming convenience wrapper — used by the smoke test, where the whole
 * answer is what gets asserted on.
 */
export async function askMitra(
  actor: Actor,
  question: string,
  history: MitraTurn[] = [],
): Promise<{ answer: string; toolsUsed: string[] }> {
  let answer = "";
  let toolsUsed: string[] = [];
  for await (const ev of streamMitra(actor, question, history)) {
    if (ev.type === "text") answer += ev.value;
    else if (ev.type === "done") toolsUsed = ev.toolsUsed;
    else if (ev.type === "error") throw new Error(ev.message);
  }
  return { answer: answer.trim() || REFUSAL, toolsUsed };
}
