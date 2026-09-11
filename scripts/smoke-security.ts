/** The security pass, checked rather than claimed. */
import { prisma } from "@backend/db/client";
import { verifyChain } from "@backend/audit/chain";
import { LIMITS, rateLimit, resetRateLimits } from "@backend/security/rate-limit";
import { contentSecurityPolicy, securityHeaders } from "@backend/security/headers";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = "Suraksha@Bhoomi2026";

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? `  ${d}` : ""}`);
  if (ok) pass++;
  else { fail++; failures.push(`${l}${d ? ` — ${d}` : ""}`); }
};

/** Its own address, so this suite's logins do not share a bucket with the app's own traffic. */
const TEST_ADDRESS = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

async function login(email: string): Promise<string> {
  const jar: string[] = [];
  const call = async (path: string, body: unknown) => {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: jar.join("; "), "x-forwarded-for": TEST_ADDRESS },
      body: JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) jar.push(c.split(";")[0]);
    return res.json().catch(() => ({}));
  };
  const first = (await call("/api/auth/login", { email, password: PASSWORD })) as { demoCode?: string };
  if (!first.demoCode) throw new Error(`could not sign in as ${email}`);
  await call("/api/auth/verify-otp", { code: first.demoCode });
  return jar.join("; ");
}

async function main() {
  console.log(`\nSECURITY SMOKE TEST — ${BASE}\n======================================================`);

  console.log("\nSecurity headers on a real response:");
  const page = await fetch(`${BASE}/login`);
  const headers = page.headers;
  const csp = headers.get("content-security-policy") ?? "";
  check("Content-Security-Policy is set", csp.length > 0);
  check("it forbids framing", csp.includes("frame-ancestors 'none'"), "clickjacking an approve button");
  check("it restricts object and base", csp.includes("object-src 'none'") && csp.includes("base-uri 'self'"));
  check("it allows the map tiles the app actually uses", csp.includes("server.arcgisonline.com") && csp.includes("tile.openstreetmap.org"));
  check("scripts are not wide open", !csp.includes("script-src *") && !csp.includes("script-src 'unsafe-hashes' *"));
  check("X-Frame-Options is set for older proxies", headers.get("x-frame-options") === "DENY");
  check("MIME sniffing is off", headers.get("x-content-type-options") === "nosniff");
  check("Referrer-Policy is strict", (headers.get("referrer-policy") ?? "").includes("strict-origin"));
  const permissions = headers.get("permissions-policy") ?? "";
  check("the camera and GPS are allowed only to this origin", permissions.includes("geolocation=(self)") && permissions.includes("camera=(self)"));
  check("microphone and payment are denied outright", permissions.includes("microphone=()") && permissions.includes("payment=()"));
  check("HSTS is not sent over plain HTTP", !headers.get("strict-transport-security"), "(it would be meaningless, and wrong in development)");
  check("HSTS is sent when the deployment is HTTPS", Boolean(securityHeaders({ https: true })["Strict-Transport-Security"]));
  check("a nonce replaces inline-script permission when supplied", contentSecurityPolicy({ nonce: "abc123" }).includes("'nonce-abc123'"));

  console.log("\nSessions and cookies:");
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": TEST_ADDRESS },
    body: JSON.stringify({ email: "collector.agra@bhoominayan.gov.in", password: PASSWORD }),
  });
  const setCookies = loginRes.headers.getSetCookie();
  const challenge = setCookies.find((c) => c.startsWith("bhoomi_otp"));
  check("the password step issues a challenge, not a session", Boolean(challenge) && !setCookies.some((c) => c.startsWith("bhoomi_session")),
    "a password alone is never enough");
  check("the challenge cookie is HttpOnly", (challenge ?? "").toLowerCase().includes("httponly"));
  check("it is SameSite-restricted", (challenge ?? "").toLowerCase().includes("samesite"));
  check("it is scoped to the auth endpoints", (challenge ?? "").includes("Path=/api/auth"));

  const badPassword = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": TEST_ADDRESS },
    body: JSON.stringify({ email: "collector.agra@bhoominayan.gov.in", password: "not-the-password" }),
  });
  const badBody = (await badPassword.json()) as { error?: string };
  check("a wrong password does not say whether the account exists", !/no such|unknown user|not found/i.test(badBody.error ?? ""), badBody.error);
  const noSuchUser = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": TEST_ADDRESS },
    body: JSON.stringify({ email: "nobody@example.invalid", password: "whatever" }),
  });
  const unknownBody = (await noSuchUser.json()) as { error?: string };
  check("an unknown account gives the same answer", (unknownBody.error ?? "") === (badBody.error ?? ""), "no account enumeration");

  console.log("\nRate limiting:");
  resetRateLimits();
  const burst = Array.from({ length: LIMITS.login.max + 4 }, () => rateLimit("probe:same-key", LIMITS.login));
  check("a burst is cut off at the limit", burst.filter((b) => b.ok).length === LIMITS.login.max, `${burst.filter((b) => b.ok).length} of ${burst.length} allowed`);
  check("it says when to try again", burst[burst.length - 1].retryAfterSeconds > 0);
  check("a different key is unaffected", rateLimit("probe:other-key", LIMITS.login).ok, "one attacker does not lock out everyone");
  resetRateLimits();

  // The real endpoint, not just the helper.
  const attempts = await Promise.all(
    Array.from({ length: 14 }, () =>
      fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.42" },
        body: JSON.stringify({ email: "brute.force@example.invalid", password: "guess" }),
      }).then((r) => r.status),
    ),
  );
  check("the login endpoint itself rate-limits", attempts.includes(429), `statuses: ${[...new Set(attempts)].join(", ")}`);

  console.log("\nAuthorisation, over HTTP:");
  const anonymous = await fetch(`${BASE}/api/reports/export?key=state-progress&format=CSV`);
  check("an anonymous export is refused", anonymous.status === 401, `HTTP ${anonymous.status}`);
  const citizen = await login("landowner.agra@example.in");
  const citizenAudit = await fetch(`${BASE}/api/audit/export`, { headers: { cookie: citizen } });
  check("a citizen cannot export the audit trail", citizenAudit.status === 403, `HTTP ${citizenAudit.status}`);
  const citizenReports = await fetch(`${BASE}/api/reports/run`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: citizen },
    body: JSON.stringify({ key: "disbursement-statement" }),
  });
  check("a citizen cannot run an officer's report", citizenReports.status === 403, `HTTP ${citizenReports.status}`);

  const admin = await login("admin@bhoominayan.gov.in");
  const auditExport = await fetch(`${BASE}/api/audit/export?limit=50`, { headers: { cookie: admin } });
  const auditText = await auditExport.text();
  check("an administrator can export it", auditExport.status === 200 && auditText.includes("Chain verification"));
  check("the export states whether the chain is intact", /Chain verification: (INTACT|BROKEN)/.test(auditText));
  check("it is served as a download", (auditExport.headers.get("content-disposition") ?? "").includes("attachment"));

  console.log("\nThe audit chain itself:");
  const verification = await verifyChain();
  check("the chain verifies end to end", verification.intact, verification.intact ? `${verification.recordsChecked} records` : String(verification.reason));

  console.log("\nPersonal data:");
  const owners = await prisma.owner.findMany({ take: 200, select: { aadhaarLast4: true, bankAccountMasked: true } });
  check("no full Aadhaar number is stored", owners.every((o) => !o.aadhaarLast4 || o.aadhaarLast4.length <= 4), "only the last four digits exist in the schema");
  check("bank accounts are stored masked", owners.every((o) => !o.bankAccountMasked || o.bankAccountMasked.startsWith("X")));
  const logs = await prisma.integrationLog.findMany({ take: 200, select: { requestJson: true } });
  const serialised = JSON.stringify(logs);
  check("integration logs carry no account numbers", !/\b\d{9,18}\b/.test(serialised.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "")));

  console.log("\nInput handling (the adversarial suite covers this in depth):");
  const sqlInName = await fetch(`${BASE}/api/reports/run`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: admin },
    body: JSON.stringify({ key: "state-progress'; DROP TABLE \"Project\"; --" }),
  });
  check("SQL in a parameter is refused, not executed", sqlInName.status === 400 && (await prisma.project.count()) > 0, `HTTP ${sqlInName.status}`);
  const badJson = await fetch(`${BASE}/api/objections`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: citizen }, body: "{not json",
  });
  check("malformed JSON does not crash the route", badJson.status < 500, `HTTP ${badJson.status}`);

  console.log("\n======================================================");
  if (failures.length) console.log("FAILURES:\n" + failures.map((f) => `  · ${f}`).join("\n"));
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
