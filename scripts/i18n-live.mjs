/**
 * What a reader actually sees: sign in, switch the language, open pages, and list the English
 * words still on screen.
 */
const [locale = "hi", email = "collector.agra@bhoominayan.gov.in", ...paths] = process.argv.slice(2);
const BASE = "http://localhost:3000";
const r1 = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Suraksha@Bhoomi2026" }) });
const t1 = await r1.text();
if (!r1.ok) { console.log("login", r1.status, t1.slice(0, 120)); process.exit(1); }
const c1 = r1.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const r2 = await fetch(`${BASE}/api/auth/verify-otp`, { method: "POST", headers: { "Content-Type": "application/json", cookie: c1 }, body: JSON.stringify({ code: JSON.parse(t1).demoCode }) });
const cookie = r2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") + `; bhoomi_locale=${locale}`;
const KEEP = /^(Bhoomi|Nayan|LARR|RFCTLARR|CALA|NHAI|PFMS|ULPIN|GIS|SIH|OTP|PDF|CSV|KML|SMS|UTR|IFSC|MoRTH|CAG|OSM|Esri|Bhuvan|ISRO|NIC|WebGL|API|km|ha|AUC|ML|ID|LA|PRJ|NH|UP|AGR|MORTH|Act|s)$/;
for (const path of paths) {
  const html = await (await fetch(BASE + path, { headers: { cookie } })).text();
  const body = (html.split("<body")[1] ?? html)
    .replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
  const phrases = new Map();
  for (const m of body.matchAll(/[A-Za-z][A-Za-z'’\-]*(?:[ ,.:]+[A-Za-z][A-Za-z'’\-]*)*/g)) {
    const words = m[0].split(/[^A-Za-z'’\-]+/).filter((w) => w.length >= 3 && !KEEP.test(w));
    if (!words.length) continue;
    const p = m[0].trim().slice(0, 80);
    phrases.set(p, (phrases.get(p) ?? 0) + 1);
  }
  console.log(`\n${path}  — ${phrases.size} English phrase(s)`);
  for (const [p, n] of [...phrases].slice(0, 60)) console.log(`   ${n > 1 ? `×${n} ` : ""}${p}`);
}
