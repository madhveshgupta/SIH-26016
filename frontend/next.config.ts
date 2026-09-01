import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { updateInitialEnv } from "@next/env";
import type { NextConfig } from "next";

// The app lives in frontend/, so Next looks for .env there — but the project's .env is at the root,
// beside prisma/ and the scripts.
const root = path.basename(process.cwd()) === "frontend" ? path.resolve(process.cwd(), "..") : process.cwd();
const rootEnv = path.join(root, ".env");
if (existsSync(rootEnv)) {
  const added: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnv, "utf8")))) {
    if (process.env[key] === undefined && value !== undefined) added[key] = process.env[key] = value;
  }
  updateInitialEnv(added);
}

const nextConfig: NextConfig = {
  // Keep Next.js from generating extra rule files at the repo root on every dev
  // run; README.md is the only .md at root.
  agentRules: false,
  experimental: {
    // Long dev sessions grew to ~8 GB.
    turbopackMemoryEviction: "full",
    // Run loaders (PostCSS etc.) in worker threads instead of a pool of child
    // Node processes — each child is a separate ~100 MB+ process.
    turbopackPluginRuntimeStrategy: "workerThreads",
  },
};

export default nextConfig;
