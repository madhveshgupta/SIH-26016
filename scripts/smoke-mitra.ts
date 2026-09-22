/** Bhoomi Mitra smoke test. */
import { prisma } from "@backend/db/client";
import type { Actor } from "@backend/rbac/scope";
import { runTool, MITRA_TOOLS } from "@backend/mitra/tools";
import { mitraStatus, askMitra } from "@backend/mitra/chat";
import { REFUSAL } from "@backend/mitra/prompt";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  \x1b[32mok  \x1b[0m ${label}${detail ? `  ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? `  ${detail}` : ""}`);
  }
}

async function actorFor(email: string): Promise<Actor | null> {
  const u = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, roleId: true, jurisdictionLevel: true, stateId: true, districtId: true,
      tehsilId: true, agencyId: true, role: { select: { type: true } },
      ownerProfile: { select: { id: true } },
    },
  });
  if (!u) return null;
  return {
    id: u.id,
    role: u.role.type,
    jurisdictionLevel: u.jurisdictionLevel,
    stateId: u.stateId,
    districtId: u.districtId,
    tehsilId: u.tehsilId,
    agencyId: u.agencyId,
    ownerId: u.ownerProfile?.id ?? null,
  };
}

async function main() {
  console.log("\nBhoomi Mitra\n");

  console.log("Tool surface:");
  check("five tools are declared", MITRA_TOOLS.length === 5, `${MITRA_TOOLS.length}`);
  check("every tool is strict", MITRA_TOOLS.every((t) => t.strict === true));
  check(
    "every tool forbids extra properties",
    MITRA_TOOLS.every((t) => (t.parameters as Record<string, unknown>).additionalProperties === false),
  );

  // Two collectors in different districts — the classic scope test.
  const collectors = await prisma.user.findMany({
    where: { role: { type: "DISTRICT_COLLECTOR" }, districtId: { not: null } },
    select: { email: true, districtId: true },
    take: 2,
    orderBy: { email: "asc" },
  });

  if (collectors.length < 2) {
    console.log("\n  (skipping scope tests — seed the database first)\n");
  } else {
    const a = await actorFor(collectors[0].email);
    const b = await actorFor(collectors[1].email);
    if (!a || !b) throw new Error("could not build actors");

    console.log("\nJurisdiction scoping:");

    const aCases = (await runTool(a, "find_cases", { query: "LA/" })) as Record<string, unknown>;
    const bCases = (await runTool(b, "find_cases", { query: "LA/" })) as Record<string, unknown>;

    const aRefs = new Set(
      ((aCases.cases as { reference_no: string }[]) ?? []).map((c) => c.reference_no),
    );
    const bRefs = new Set(
      ((bCases.cases as { reference_no: string }[]) ?? []).map((c) => c.reference_no),
    );

    check("collector A sees some cases", aRefs.size > 0 || "not_found" in aCases, `${aRefs.size}`);
    check("collector B sees some cases", bRefs.size > 0 || "not_found" in bCases, `${bRefs.size}`);

    const overlap = [...aRefs].filter((r) => bRefs.has(r));
    check(
      "two collectors' case lists do not overlap",
      overlap.length === 0,
      overlap.length ? `LEAK: ${overlap.join(", ")}` : "(different districts, different worlds)",
    );

    // Ask A for one of B's cases by exact reference — must come back empty.
    const bOnly = [...bRefs].find((r) => !aRefs.has(r));
    if (bOnly) {
      const cross = (await runTool(a, "case_status", { reference_no: bOnly })) as Record<string, unknown>;
      check("a collector cannot read another district's case by reference", "not_found" in cross, bOnly);

      const crossDiag = (await runTool(a, "diagnose_case", { reference_no: bOnly })) as Record<string, unknown>;
      check("…nor diagnose it", "not_found" in crossDiag);

      const crossMoney = (await runTool(a, "compensation_summary", { reference_no: bOnly })) as Record<string, unknown>;
      check("…nor read its compensation", "not_found" in crossMoney);
    }

    console.log("\nTool behaviour:");
    const own = [...aRefs][0];
    if (own) {
      const status = (await runTool(a, "case_status", { reference_no: own })) as Record<string, unknown>;
      check("case_status returns a stage", typeof status.stage === "string", String(status.stage));
      check("case_status carries the compliance clock", "compliance_clock" in status);

      const money = (await runTool(a, "compensation_summary", { reference_no: own })) as Record<string, unknown>;
      check("compensation_summary returns rupee totals", typeof money.assessed_rupees === "number");
      check("…and an s.38 possession note", typeof money.possession_note === "string");
    }

    check("a garbage reference is refused, not guessed", "not_found" in
      ((await runTool(a, "case_status", { reference_no: "LA/XX/NOPE/9999/0001" })) as Record<string, unknown>));
    check("an unknown tool name is rejected", "not_found" in
      ((await runTool(a, "no_such_tool", {})) as Record<string, unknown>));
    check("an empty query is rejected", "not_found" in
      ((await runTool(a, "find_cases", { query: "" })) as Record<string, unknown>));

    // Live model checks, only when a Groq key is configured.
    const status = await mitraStatus();
    if (status.ready) {
      console.log(`
Model — ${status.detail}:`);
      const greeting = await askMitra(a, "hello");
      check(
        "a greeting gets a friendly reply, not a refusal",
        !greeting.answer.includes("don't have the right") && greeting.answer.length > 20,
        greeting.answer.slice(0, 70).replace(/\s+/g, " "),
      );

      const offTopic = await askMitra(a, "Who won the cricket match yesterday?");
      check("an off-topic question is refused", offTopic.answer.includes("don't have the right"));

      if (own) {
        const real = await askMitra(a, `What is the status of ${own}?`);
        check("a real case question is answered", real.answer.length > 40);
        check("the answer is in English", /[a-z]{4,}/i.test(real.answer) && !/^[ऀ-ॿ\s]+$/.test(real.answer));
        check("the answer is grounded in a tool call", real.toolsUsed.length > 0, real.toolsUsed.join(", "));
      }
    } else {
      console.log(`
  (skipping live model checks — ${status.detail})`);
      check("refusal line is defined", REFUSAL.includes("right to answer"));
    }
  }

  console.log(`\n${"=".repeat(54)}`);
  console.log(`PASSED ${passed}   FAILED ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
