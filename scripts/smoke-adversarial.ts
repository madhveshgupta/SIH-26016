/** Adversarial pass over the write endpoints: objections and project land. */
import { prisma } from "@backend/db/client";
import { recomputeAllConflicts } from "@backend/gis/postgis";
import { mayHearObjections, objectionWindow } from "@backend/statutory/notifications";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = "Suraksha@Bhoomi2026";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? `  ${detail}` : ""}`);
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Client {
  email: string;
  post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null; text: string }>;
  get(path: string): Promise<{ status: number; json: Record<string, unknown> | null; text: string }>;
}

/** One address per client, as a dozen officers on a dozen machines would be. */
let addressCounter = Math.floor(Math.random() * 100);
function nextTestAddress(): string {
  addressCounter += 1;
  return `198.51.100.${(addressCounter % 200) + 20}`;
}

async function client(email: string | null): Promise<Client> {
  const address = nextTestAddress();
  const jar = new Map<string, string>();
  const call = async (path: string, body?: unknown, method = "POST") => {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        "x-forwarded-for": address,
      },
      // A raw string body is sent as-is, so malformed JSON can be tested too.
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* HTML page or empty body */
    }
    return { status: res.status, json, text };
  };
  if (email) {
    const r1 = await call("/api/auth/login", { email, password: PASSWORD });
    if (!r1.json?.demoCode) throw new Error(`login failed for ${email}: ${r1.text.slice(0, 120)}`);
    await call("/api/auth/verify-otp", { code: r1.json.demoCode });
  }
  return { email: email ?? "anonymous", post: (p, b) => call(p, b), get: (p) => call(p, undefined, "GET") };
}

const ROLES: Record<string, string> = {
  SUPER_ADMIN: "admin@bhoominayan.gov.in",
  LAND_REQUIRING_BODY: "nhai.officer@bhoominayan.gov.in",
  LAND_ACQUIRING_AUTHORITY: "cala.agra@bhoominayan.gov.in",
  DISTRICT_COLLECTOR: "collector.agra@bhoominayan.gov.in",
  STATE_GOVERNMENT: "state.an@bhoominayan.gov.in",
  CENTRAL_MINISTRY: "mojs@bhoominayan.gov.in",
  REHABILITATION_AUTHORITY: "rnr.an@bhoominayan.gov.in",
  LANDOWNER: "landowner.agra@example.in",
};

/** Values no endpoint should ever accept where a string or number is expected. */
const HOSTILE: [string, unknown][] = [
  ["missing", undefined],
  ["null", null],
  ["number", 42],
  ["array", ["a", "b"]],
  ["object", { a: 1 }],
  ["empty string", ""],
  ["whitespace", "   "],
  ["SQL injection", "'; DROP TABLE \"LandParcel\"; --"],
  ["XSS", "<script>alert(1)</script>"],
  ["path traversal", "../../etc/passwd"],
  ["10k characters", "x".repeat(10_000)],
  ["null byte", "abc\u0000def"],
];

const never500 = (status: number) => status !== 500 && status < 500;

/** Every project this test creates is named with this, and swept either side of the run. */
const TEST_PREFIX = "ADVERSARIAL TEST";
async function sweep() {
  const { count } = await prisma.project.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  if (count) await recomputeAllConflicts();
  return count;
}

async function main() {
  console.log(`\nADVERSARIAL SMOKE TEST — ${BASE}\n======================================================`);
  const swept = await sweep();
  if (swept) console.log(`  (swept ${swept} project(s) left by an earlier interrupted run)`);
  const conflictsBefore = await recomputeAllConflicts();
  const projectsBefore = await prisma.project.count();
  const objectionsBefore = await prisma.objection.count();

  const clients: Record<string, Client> = { anonymous: await client(null) };
  for (const [role, email] of Object.entries(ROLES)) clients[role] = await client(email);

  // --- fixtures, straight from the database -------------------------------
  const goa = await prisma.district.findFirstOrThrow({ where: { name: "North Goa" } });
  // A case actually taking objections today, with a plot whose owner has a
  // login, and the officer the Act puts in charge of it.
  let openCase: { id: string; projectId: string } | null = null;
  let openPlot: { id: string; status: "PROPOSED" | "NOTIFIED" } | null = null;
  let authorityEmail = "";
  let ownerEmail = "";
  for (const p of await prisma.proposal.findMany({ where: { status: "OBJECTIONS" }, include: { project: true } })) {
    if (!(await objectionWindow(p.id)).open) continue;
    const plot = await prisma.landParcel.findFirst({
      where: { proposalId: p.id, status: { in: ["NOTIFIED", "PROPOSED"] }, owners: { some: { owner: { user: { isNot: null } } } } },
      include: { owners: { include: { owner: { include: { user: true } } } }, district: true },
    });
    if (!plot) continue;
    const role = mayHearObjections(p.project.governingAct, "DISTRICT_COLLECTOR") ? "DISTRICT_COLLECTOR" : "LAND_ACQUIRING_AUTHORITY";
    const officer = await prisma.user.findFirst({ where: { role: { type: role }, districtId: plot.districtId, isActive: true } });
    const owner = plot.owners.map((o) => o.owner.user).find((u) => u?.isActive);
    if (!officer || !owner) continue;
    openCase = p;
    openPlot = { id: plot.id, status: plot.status as "PROPOSED" | "NOTIFIED" };
    authorityEmail = officer.email;
    ownerEmail = owner.email;
    break;
  }
  if (!openCase || !openPlot) throw new Error("No case is taking objections with an owner who can log in — reseed with npm run db:setup");
  clients.AUTHORITY = await client(authorityEmail);
  clients.OWNER = await client(ownerEmail);
  console.log(`  fixture: case ${openCase.id.slice(-6)} · authority ${authorityEmail} · owner ${ownerEmail}`);
  const candidateRes = await clients.LAND_REQUIRING_BODY.get(`/api/land/candidates?districtId=${goa.id}`);
  const plots = (candidateRes.json?.plots ?? []) as { key: string; geometry: { coordinates: [number, number][][] } }[];
  const someKeys = plots.slice(0, 3).map((p) => p.key);
  const a = plots[0].geometry.coordinates[0][0];
  const b = plots[10].geometry.coordinates[0][0];

  // ------------------------------------------------------------------
  console.log("\n1. Unauthenticated access:");
  for (const [path, body] of [
    ["/api/objections", { parcelId: openPlot.id, grounds: "x".repeat(40) }],
    [`/api/objections/${"x".repeat(25)}/hearing`, { hearingDate: "2026-12-01" }],
    [`/api/objections/${"x".repeat(25)}/decision`, { status: "REJECTED", decision: "x", decisionReasons: "x".repeat(40) }],
    ["/api/land/corridor", { districtId: goa.id, line: [a, b], rightOfWayM: 30 }],
    ["/api/land/lookup", { districtId: goa.id, lat: 15.6, lng: 73.9 }],
    ["/api/projects", { name: "anonymous project", type: "HIGHWAY", governingAct: "LARR_2013", picks: { record: someKeys } }],
    [`/api/projects/${"x".repeat(25)}/land`, { add: { record: someKeys }, remove: [] }],
  ] as [string, unknown][]) {
    const r = await clients.anonymous.post(path, body);
    check(`anonymous POST ${path.replace(/x{25}/, ":id")} is refused`, r.status === 401, `HTTP ${r.status}`);
  }
  const anonCand = await clients.anonymous.get(`/api/land/candidates?districtId=${goa.id}`);
  check("anonymous GET /api/land/candidates is refused", anonCand.status === 401, `HTTP ${anonCand.status}`);

  // ------------------------------------------------------------------
  console.log("\n2. The permission matrix, over HTTP:");
  const MAY_CREATE_PROJECT = ["SUPER_ADMIN", "LAND_REQUIRING_BODY"];
  const MAY_FILE_OBJECTION = ["SUPER_ADMIN", "LAND_ACQUIRING_AUTHORITY", "DISTRICT_COLLECTOR", "LANDOWNER"];
  const MAY_DECIDE = ["SUPER_ADMIN", "LAND_ACQUIRING_AUTHORITY", "DISTRICT_COLLECTOR"];
  for (const role of Object.keys(ROLES)) {
    const c = clients[role];
    const create = await c.post("/api/projects", { name: `${TEST_PREFIX} matrix probe`, type: "HIGHWAY", governingAct: "LARR_2013", picks: { record: [], live: [] } });
    const allowed = MAY_CREATE_PROJECT.includes(role);
    // Allowed roles get past the permission gate and fail on the empty picks.
    check(`${role} create project: ${allowed ? "allowed" : "403"}`, allowed ? create.status === 400 : create.status === 403, `HTTP ${create.status}`);

    const cand = await c.get(`/api/land/candidates?districtId=${goa.id}`);
    check(`${role} land candidates: ${allowed ? "200" : "403"}`, allowed ? cand.status === 200 : cand.status === 403, `HTTP ${cand.status}`);

    const objection = await c.post("/api/objections", { parcelId: openPlot.id, objectorName: "Matrix probe", grounds: "Probing the permission matrix with a long enough ground." });
    const mayFile = MAY_FILE_OBJECTION.includes(role);
    check(
      `${role} file objection: ${mayFile ? "not 403" : "403"}`,
      mayFile ? objection.status !== 403 : objection.status === 403,
      `HTTP ${objection.status}`,
    );
    if (objection.status === 200 && objection.json?.id) await prisma.objection.delete({ where: { id: String(objection.json.id) } });

    const decide = await c.post(`/api/objections/${"z".repeat(25)}/decision`, { status: "REJECTED", decision: "x", decisionReasons: "x".repeat(40) });
    const mayDecide = MAY_DECIDE.includes(role);
    check(`${role} decide objection: ${mayDecide ? "404 (no such objection)" : "403"}`, mayDecide ? decide.status === 404 : decide.status === 403, `HTTP ${decide.status}`);
  }
  await prisma.landParcel.update({ where: { id: openPlot.id }, data: { status: openPlot.status } });

  // ------------------------------------------------------------------
  console.log("\n3. Jurisdiction and ownership escapes:");
  const sehoreCase = await prisma.proposal.findFirst({
    where: { status: "OBJECTIONS", project: { districts: { some: { district: { name: "Sehore" } } } } },
  });
  if (sehoreCase) {
    const sehorePlot = await prisma.landParcel.findFirst({ where: { proposalId: sehoreCase.id } });
    if (sehorePlot) {
      const r = await clients.DISTRICT_COLLECTOR.post("/api/objections", { parcelId: sehorePlot.id, objectorName: "Walk-in", grounds: "Filed from the wrong district entirely." });
      check("Agra collector cannot file on a Sehore plot", r.status === 404, `HTTP ${r.status}`);
    }
  }
  const otherOwner = await prisma.landParcel.findFirst({
    where: { proposalId: openCase.id, owners: { none: { owner: { user: { email: "landowner.agra@example.in" } } } } },
  });
  if (otherOwner) {
    const r = await clients.LANDOWNER.post("/api/objections", { parcelId: otherOwner.id, grounds: "This plot belongs to somebody else entirely." });
    check("landowner cannot object about another's plot", r.status === 404 || r.status === 400, `HTTP ${r.status}`);
  }
  const nhaiProject = await prisma.project.findFirstOrThrow({ where: { agency: { code: "NHAI" } } });
  const rvnl = await client("rvnl.officer@bhoominayan.gov.in");
  const cross = await rvnl.post(`/api/projects/${nhaiProject.id}/land`, { add: { record: someKeys }, remove: [] });
  check("another agency cannot change NHAI's project land", cross.status === 404, `HTTP ${cross.status}`);
  const crossCand = await rvnl.get(`/api/land/candidates?districtId=${goa.id}&projectId=${nhaiProject.id}`);
  check("another agency cannot scope candidates to NHAI's project", crossCand.status === 404, `HTTP ${crossCand.status}`);

  // ------------------------------------------------------------------
  console.log("\n4. Hostile input — objections:");
  const lrb = clients.LAND_REQUIRING_BODY;
  const collector = clients.AUTHORITY;
  const citizen = clients.OWNER;
  for (const [label, value] of HOSTILE) {
    const r = await citizen.post("/api/objections", { parcelId: value, grounds: "A perfectly ordinary set of grounds for objecting." });
    check(`parcelId ${label} is refused, not a 500`, never500(r.status) && r.status !== 200, `HTTP ${r.status}`);
  }
  for (const [label, value] of HOSTILE) {
    const r = await citizen.post("/api/objections", { parcelId: openPlot.id, grounds: value });
    // Grounds are a citizen's own words: an injection string is legitimate
    // text and must be stored verbatim — never executed, never rewritten.
    const freeText = ["SQL injection", "XSS", "path traversal", "10k characters"].includes(label);
    check(`grounds ${label} handled`, never500(r.status) && (freeText || r.status !== 200), `HTTP ${r.status}`);
    if (r.status === 200 && r.json?.id) {
      const stored = await prisma.objection.findUniqueOrThrow({ where: { id: String(r.json.id) } });
      check(`grounds ${label} stored verbatim`, stored.grounds === String(value).trim().slice(0, stored.grounds.length));
      if (label === "XSS") {
        const page = await citizen.get("/my-land");
        check("XSS grounds are escaped on the page", !page.text.includes("<script>alert(1)</script>"), page.text.includes("\\u003cscript") || page.text.includes("&lt;script") ? "escaped" : "not rendered");
      }
      await prisma.objection.delete({ where: { id: String(r.json.id) } });
      await prisma.landParcel.update({ where: { id: openPlot.id }, data: { status: openPlot.status } });
    }
  }
  check("malformed JSON body is refused", never500((await citizen.post("/api/objections", "{not json at all")).status));
  const realObjection = await prisma.objection.create({
    data: { proposalId: openCase.id, parcelId: openPlot.id, objectorName: "Adversarial fixture", grounds: "Fixture objection for the adversarial pass." },
  });
  for (const [label, value] of HOSTILE) {
    const r = await collector.post(`/api/objections/${realObjection.id}/hearing`, { hearingDate: value });
    check(`hearing date ${label} is refused, not a 500`, never500(r.status) && r.status !== 200, `HTTP ${r.status}`);
  }
  for (const bad of ["9999-99-99", "not-a-date", "2026-13-45", "0000-01-01", "+275760-09-13", "2026-12-01T25:99:99"]) {
    const r = await collector.post(`/api/objections/${realObjection.id}/hearing`, { hearingDate: bad });
    check(`hearing date "${bad}" is refused`, r.status === 400, `HTTP ${r.status}`);
  }
  for (const [label, value] of [["invalid status", { status: "APPROVED" }], ["status array", { status: ["ACCEPTED"] }], ["no reasons", { status: "REJECTED", decision: "x" }], ["short reasons", { status: "REJECTED", decision: "x", decisionReasons: "too short" }], ["empty decision", { status: "REJECTED", decision: "", decisionReasons: "x".repeat(40) }]] as [string, object][]) {
    const r = await collector.post(`/api/objections/${realObjection.id}/decision`, value);
    check(`decision ${label} is refused`, r.status === 400, `HTTP ${r.status}`);
  }

  // ------------------------------------------------------------------
  console.log("\n5. Hostile input — land selection:");
  for (const [label, value] of HOSTILE) {
    const r = await lrb.get(`/api/land/candidates?districtId=${encodeURIComponent(String(value))}`);
    check(`candidates districtId ${label} handled`, never500(r.status), `HTTP ${r.status}`);
  }
  const BAD_LINES: [string, unknown][] = [
    ["one point", [a]],
    ["not an array", "line"],
    ["strings", [["a", "b"], ["c", "d"]]],
    ["NaN", [[NaN, NaN], [1, 2]]],
    ["Infinity", [[Infinity, 0], [1, 2]]],
    ["nulls", [null, null]],
    ["off the planet", [[999, 999], [1000, 1000]]],
    ["latitude out of range", [[73.9, 91], [73.95, 92]]],
    ["swapped lat/lng", [[15.6, 73.9], [15.7, 73.95]]],
    ["201 points", Array.from({ length: 201 }, (_, i) => [73.9 + i * 0.0001, 15.6])],
    ["deeply nested", [[[[1]]], [[[2]]]]],
  ];
  for (const [label, line] of BAD_LINES) {
    const r = await lrb.post("/api/land/corridor", { districtId: goa.id, line, rightOfWayM: 30 });
    const ok = label === "swapped lat/lng" ? never500(r.status) : never500(r.status) && r.status !== 200;
    check(`corridor line ${label} handled`, ok, `HTTP ${r.status}`);
  }
  for (const [label, row] of [["zero", 0], ["negative", -30], ["huge", 100000], ["NaN", NaN], ["string", "wide"], ["null", null], ["array", [30]]] as [string, unknown][]) {
    const r = await lrb.post("/api/land/corridor", { districtId: goa.id, line: [a, b], rightOfWayM: row });
    check(`corridor right-of-way ${label} is refused`, r.status === 400, `HTTP ${r.status}`);
  }
  for (const [label, body] of [
    ["latitude 91", { districtId: goa.id, lat: 91, lng: 73.9 }],
    ["longitude 181", { districtId: goa.id, lat: 15.6, lng: 181 }],
    ["NaN", { districtId: goa.id, lat: NaN, lng: NaN }],
    ["Infinity", { districtId: goa.id, lat: Infinity, lng: 0 }],
    ["strings", { districtId: goa.id, lat: "15.6", lng: "73.9" }],
    ["missing district", { lat: 15.6, lng: 73.9 }],
    ["bogus district", { districtId: "no-such-district", lat: 15.6, lng: 73.9 }],
  ] as [string, object][]) {
    const r = await lrb.post("/api/land/lookup", body);
    check(`live lookup ${label} handled`, never500(r.status), `HTTP ${r.status}`);
  }

  // ------------------------------------------------------------------
  console.log("\n6. Hostile input — creating a project:");
  const baseProject = { type: "HIGHWAY", governingAct: "LARR_2013", picks: { record: someKeys, live: [] } };
  const BAD_PROJECTS: [string, object][] = [
    ["no name", { ...baseProject, name: "" }],
    ["short name", { ...baseProject, name: "road" }],
    ["name as object", { ...baseProject, name: { toString: 1 } }],
    ["invalid type", { ...baseProject, name: `${TEST_PREFIX} valid name`, type: "SPACESHIP" }],
    ["invalid act", { ...baseProject, name: `${TEST_PREFIX} valid name`, governingAct: "MAGNA_CARTA" }],
    ["picks as string", { ...baseProject, name: `${TEST_PREFIX} valid name`, picks: "everything" }],
    ["picks null", { ...baseProject, name: `${TEST_PREFIX} valid name`, picks: null }],
    ["unknown plot keys", { ...baseProject, name: `${TEST_PREFIX} valid name`, picks: { record: ["rec:does-not-exist"], live: [] } }],
    ["401 plots", { ...baseProject, name: `${TEST_PREFIX} valid name`, picks: { record: Array.from({ length: 401 }, (_, i) => `rec:plot-${i}`), live: [] } }],
    ["forged live plot", { ...baseProject, name: `${TEST_PREFIX} valid name`, picks: { record: [], live: [{ live: { gisCode: "x", plotId: "y", pniu: null, khasraNo: "1", srid: 32643, ringUtm: [[0, 0], [1, 1], [1, 0], [0, 0]], recordedAreaSqm: 100, extentErrorM: 0 }, signature: "deadbeef" }] } }],
    ["alignment of one point", { ...baseProject, name: `${TEST_PREFIX} valid name`, alignment: [a], rightOfWayM: 30 }],
    ["alignment off the planet", { ...baseProject, name: `${TEST_PREFIX} valid name`, alignment: [[999, 999], [1000, 1000]], rightOfWayM: 30 }],
    ["alignment NaN", { ...baseProject, name: `${TEST_PREFIX} valid name`, alignment: [[NaN, 0], [1, 1]], rightOfWayM: 30 }],
    ["right-of-way 100000", { ...baseProject, name: `${TEST_PREFIX} valid name`, alignment: [a, b], rightOfWayM: 100000 }],
    ["cost as text", { ...baseProject, name: `${TEST_PREFIX} valid name`, estimatedCostCrore: "a lot" }],
    ["cost negative", { ...baseProject, name: `${TEST_PREFIX} valid name`, estimatedCostCrore: -500 }],
    ["cost Infinity as text", { ...baseProject, name: `${TEST_PREFIX} valid name`, estimatedCostCrore: "Infinity" }],
    ["SQL in name", { ...baseProject, name: `${TEST_PREFIX} Road'); DROP TABLE "Project"; --` }],
    ["XSS in name", { ...baseProject, name: `${TEST_PREFIX} <img src=x onerror=alert(1)>` }],
  ];
  const strays: string[] = [];
  for (const [label, body] of BAD_PROJECTS) {
    const r = await lrb.post("/api/projects", body);
    // SQL/XSS names are legitimate text: they may succeed, but must be stored verbatim and never executed.
    const mustFail = !label.includes("SQL") && !label.includes("XSS");
    check(`project ${label} handled`, never500(r.status) && (mustFail ? r.status !== 200 : true), `HTTP ${r.status} ${String(r.json?.error ?? "").slice(0, 60)}`);
    if (r.status === 200 && r.json?.id) strays.push(String(r.json.id));
  }
  check("the Project table survived the injection attempt", (await prisma.project.count()) >= projectsBefore);
  for (const id of strays) await prisma.project.delete({ where: { id } });

  // ------------------------------------------------------------------
  console.log("\n7. No half-made projects:");
  const projectsNow = await prisma.project.count();
  check("a rejected create leaves no project behind", projectsNow === projectsBefore, `${projectsBefore} → ${projectsNow}`);
  const draftsWithoutLand = await prisma.proposal.count({ where: { status: "DRAFT", parcels: { none: {} }, createdAt: { gt: new Date(Date.now() - 600_000) } } });
  check("no empty draft proposals left behind", draftsWithoutLand === 0, `${draftsWithoutLand}`);

  // ------------------------------------------------------------------
  console.log("\n8. Races:");
  const raced = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      lrb.post("/api/projects", { ...baseProject, name: `${TEST_PREFIX} race ${i}`, picks: { record: [someKeys[i % someKeys.length]], live: [] } }),
    ),
  );
  const madeIds = raced.flatMap((r) => (r.status === 200 && r.json?.id ? [String(r.json.id)] : []));
  check("four simultaneous creates all succeed", madeIds.length === 4, raced.map((r) => r.status).join(","));
  const refs = await prisma.project.findMany({ where: { id: { in: madeIds } }, select: { referenceNo: true } });
  check("each gets its own reference number", new Set(refs.map((r) => r.referenceNo)).size === madeIds.length, refs.map((r) => r.referenceNo).join(" "));
  const proposalRefs = await prisma.proposal.findMany({ where: { projectId: { in: madeIds } }, select: { referenceNo: true } });
  check("each draft proposal gets its own reference number", new Set(proposalRefs.map((p) => p.referenceNo)).size === proposalRefs.length, proposalRefs.map((p) => p.referenceNo).join(" "));
  for (const id of madeIds) await prisma.project.delete({ where: { id } });

  await prisma.objection.update({ where: { id: realObjection.id }, data: { status: "HEARD", hearingDate: new Date(Date.now() - 60_000) } });
  const decisionBody = { status: "REJECTED", decision: "Rejected", decisionReasons: "Two officers pressed the button at the same moment; only one decision may stand." };
  const bothDecided = await Promise.all([
    collector.post(`/api/objections/${realObjection.id}/decision`, decisionBody),
    collector.post(`/api/objections/${realObjection.id}/decision`, decisionBody),
  ]);
  check("simultaneous decisions: exactly one is recorded", bothDecided.filter((r) => r.status === 200).length === 1, bothDecided.map((r) => r.status).join(","));
  const audited = await prisma.auditLog.count({ where: { entityType: "Objection", entityId: realObjection.id, action: "UPDATE" } });
  check("only one decision reached the audit chain", audited === 1, `${audited} entries`);

  const filePayload = { parcelId: openPlot.id, grounds: "Two clicks on the same button must not make two objections." };
  const twice = await Promise.all([citizen.post("/api/objections", filePayload), citizen.post("/api/objections", filePayload)]);
  const filedCount = await prisma.objection.count({ where: { parcelId: openPlot.id, filedByUserId: { not: null } } });
  check("double-submitted objection is filed once", filedCount <= 1, `${filedCount} filed, HTTP ${twice.map((r) => r.status).join(",")}`);

  // --- leave the database as we found it ----------------------------------
  await prisma.objection.deleteMany({ where: { OR: [{ id: realObjection.id }, { parcelId: openPlot.id, objectorName: { contains: "Adversarial" } }, { grounds: filePayload.grounds }] } });
  await prisma.landParcel.update({ where: { id: openPlot.id }, data: { status: openPlot.status } });
  await sweep();
  const conflictsAfter = await recomputeAllConflicts();
  check("conflict flags unchanged", conflictsAfter === conflictsBefore, `${conflictsBefore} → ${conflictsAfter}`);
  check("objection count unchanged", (await prisma.objection.count()) === objectionsBefore);
  check("project count unchanged", (await prisma.project.count()) === projectsBefore);

  console.log("\n======================================================");
  if (failures.length) console.log("FAILURES:\n" + failures.map((f) => `  · ${f}`).join("\n"));
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
