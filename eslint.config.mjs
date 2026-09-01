import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "frontend/.next/**",
    // Cesium's own runtime workers, copied in by scripts/copy-cesium-assets.mjs.
    "frontend/public/cesium/**",
  ]),
  {
    settings: { next: { rootDir: "frontend/" } },
  },
  {
    // These scripts intentionally remain directly executable under Node.
    files: ["scripts/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
