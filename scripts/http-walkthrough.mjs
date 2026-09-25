/** Walk every page a signed-in user can reach, over plain HTTP — no browser. */
const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = "Suraksha@Bhoomi2026";
const ACCOUNTS = [
  "collector.agra@bhoominayan.gov.in",
  "collector.north-goa@bhoominayan.gov.in",
  "cala.jaipur@bhoominayan.gov.in",
  "state.up@bhoominayan.gov.in",
  "rnr.ga@bhoominayan.gov.in",
  "morth@bhoominayan.gov.in",
  "nhai.officer@bhoominayan.gov.in",
  "policy@bhoominayan.gov.in",
  "admin@bhoominayan.gov.in",
  "landowner.agra@example.in",
];
const ERROR_MARKERS = [/Internal Server Error/i, /Application error/i, /Unhandled Runtime Error/i, /__next_error__/];

let pass = 0;
const failures = [];
function check(label, ok, detail = "") {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? `  ${detail}` : ""}`);
}

function jar() {
  const cookies = new Map();
  return {
    take(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
      }
    },
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

/** The dev server's memory guard restarts it now and then; ride through that. */
async function fetchRetry(url, init, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`  (server unavailable — retrying in 15s)`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

async function get(j, path) {
  const res = await fetchRetry(BASE + path, { headers: { cookie: j.header() }, redirect: "manual", signal: AbortSignal.timeout(120_000) });
  j.take(res);
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, location: res.headers.get("location") ?? "", body };
}

const hrefs = (html) =>
  [...html.matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)]
    .map((m) => m[1].replaceAll("&amp;", "&"))
    .filter((h) => h.startsWith("/") && !h.startsWith("/_next") && !h.startsWith("/api/") && !/\.(png|jpg|svg|ico|webmanifest|css|js)$/.test(h));

/** The sidebar's links, read from the <nav data-nav="main"> the shell renders. */
const sidebar = (html) => {
  const nav = /<nav[^>]*data-nav="main"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [...new Set(hrefs(nav))];
};

async function visit(j, who, path, seen) {
  if (seen.has(path)) return null;
  seen.add(path);
  const r = await get(j, path);
  const bad = ERROR_MARKERS.find((m) => m.test(r.body));
  const toLogin = r.status >= 300 && r.status < 400 && r.location.includes("/login");
  // A role sent to its own home by a page it may not use is fine; an error is not.
  const ok = (r.status === 200 && !bad) || (r.status >= 300 && r.status < 400 && !toLogin);
  check(`${who} ${path}`, ok, r.status !== 200 ? `${r.status} ${r.location}` : bad ? `error page (${bad})` : "");
  return r;
}

// FROM=<account prefix> resumes a run part-way through.
const from = process.env.FROM ? ACCOUNTS.findIndex((a) => a.startsWith(process.env.FROM)) : 0;
for (const email of ACCOUNTS.slice(Math.max(0, from))) {
  const who = email.split("@")[0];
  const j = jar();
  const login = () =>
    fetchRetry(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  let r1 = await login();
  // Ten roles in a row trip the sign-in rate limit; wait it out rather than fail.
  if (r1.status === 429) {
    const wait = Number(r1.headers.get("retry-after") ?? 60) + 1;
    console.log(`  (rate limited — waiting ${wait}s)`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    r1 = await login();
  }
  j.take(r1);
  const d1 = await r1.json().catch(() => ({}));
  const r2 = await fetch(`${BASE}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: j.header() },
    body: JSON.stringify({ code: d1.demoCode }),
  });
  j.take(r2);
  if (!r2.ok) {
    check(`${who} sign-in`, false, `${r1.status}/${r2.status}`);
    continue;
  }
  console.log(`\n${who}`);
  const seen = new Set();
  const home = await visit(j, who, email.startsWith("landowner") ? "/my-land" : "/dashboard", seen);
  const links = sidebar(home?.body ?? "");
  check(`${who} sidebar has links`, links.length > 0, `${links.length}`);

  const pages = [];
  for (const l of links) {
    const r = await visit(j, who, l, seen);
    if (r?.status === 200) pages.push(r);
  }

  // Open a project and walk its workspace.
  if (links.includes("/projects")) {
    const list = await get(j, "/projects");
    const id = /href="\/projects\/([a-z0-9]{20,32})"/.exec(list.body)?.[1];
    if (id) {
      const overview = await visit(j, who, `/projects/${id}`, seen);
      const nav = sidebar(overview?.body ?? "");
      const inside = nav.filter((h) => h.startsWith(`/projects/${id}/`) || h === `/field?project=${id}`);
      check(`${who} sidebar shows the project workspace`, nav.includes(`/projects/${id}`) && inside.length > 0, nav.join(" "));
      for (const h of inside) {
        const r = await visit(j, who, h, seen);
        if (r?.status === 200) pages.push(r);
      }
      // Leaving the project folds its sections away.
      const back = await get(j, "/dashboard");
      check(`${who} workspace closes outside the project`, !sidebar(back.body).some((h) => h.startsWith(`/projects/${id}`)));
    } else {
      check(`${who} has a project to open`, false, "no /projects/<id> link on /projects");
    }
  }

  // Every internal link on those pages, once.
  const onward = new Set(pages.flatMap((p) => hrefs(p.body)).filter((h) => !seen.has(h) && !h.startsWith("/login")));
  for (const h of [...onward].slice(0, 120)) await visit(j, who, h, seen);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
