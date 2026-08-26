import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false, // Skip declaration files for CLI
  shims: true, // Add shims for __dirname, __filename in ESM
  // Don't bundle the Copilot SDK - it has ESM issues when bundled
  external: ["@github/copilot-sdk"],
});
