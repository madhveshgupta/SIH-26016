/** One HTTP client for every government portal. */
import { constants } from "node:crypto";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciInit } from "undici";

export const TLS_EXCEPTIONS = new Set<string>([
  "bhunaksha.cg.nic.in", // certificate expired
  "bhunaksha.utl.gov.in",
  "collabland-tn.gov.in",
  "bhunakshaodisha.nic.in",
  "maps.revenueharyana.gov.in", // serves an incomplete chain (UNABLE_TO_VERIFY_LEAF_SIGNATURE)
  "bhunakshahp.nic.in", // requires legacy TLS renegotiation, refused by OpenSSL 3 by default
]);

const lenient = new Agent({
  connect: { rejectUnauthorized: false, secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT },
  headersTimeout: 150_000,
  bodyTimeout: 150_000,
});
const strict = new Agent({ headersTimeout: 150_000, bodyTimeout: 150_000 });

export const PORTAL_UA = "Mozilla/5.0 (compatible; BhoomiNayan/1.0; land acquisition research)";

/** Session cookies, per host. */
const jars = new Map<string, Map<string, string>>();

function rememberCookies(host: string, setCookie: string[]) {
  if (setCookie.length === 0) return;
  const jar = jars.get(host) ?? new Map<string, string>();
  for (const line of setCookie) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  jars.set(host, jar);
}

function cookieHeader(host: string): string | null {
  const jar = jars.get(host);
  if (!jar || jar.size === 0) return null;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

export interface PortalResponse {
  ok: boolean;
  status: number;
  contentType: string;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  buffer(): Promise<Buffer>;
}

export async function portalFetch(
  url: string,
  init: { method?: string; body?: string; referer?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<PortalResponse> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 20_000);
  try {
    // Redirects are followed by hand so a cookie set on a hop (Maharashtra's
    // JSESSIONID bounce) is held before the next request goes out.
    let target = url;
    let method = init.method ?? (init.body ? "POST" : "GET");
    let body = init.body;
    let res;
    for (let hop = 0; ; hop++) {
      const h = new URL(target).hostname;
      res = await undiciFetch(target, {
        method,
        body,
        signal: ctl.signal,
        dispatcher: TLS_EXCEPTIONS.has(h) ? lenient : strict,
        redirect: "manual",
        headers: {
          "User-Agent": PORTAL_UA,
          ...(cookieHeader(h) ? { Cookie: cookieHeader(h)! } : {}),
          ...(init.referer ? { Referer: init.referer } : {}),
          ...(body && !init.headers?.["Content-Type"] ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...init.headers,
        },
      } as UndiciInit);
      rememberCookies(h, res.headers.getSetCookie?.() ?? []);
      const next = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !next || hop >= 5) break;
      await res.arrayBuffer();
      target = new URL(next, target).toString();
      if (res.status !== 307 && res.status !== 308) {
        method = "GET";
        body = undefined;
      }
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      text: async () => buf.toString("utf8"),
      json: async <T>() => JSON.parse(buf.toString("utf8")) as T,
      buffer: async () => buf,
    };
  } finally {
    clearTimeout(t);
  }
}
