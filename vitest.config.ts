import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: [
        "src/analyzer/core.ts",
        "src/scanner/index.ts",
        "src/registry/index.ts",
        "src/utils/license.ts",
        "src/utils/git.ts",
        "src/generator/index.ts",
        "src/github/index.ts",
      ],
    },
  },
});
