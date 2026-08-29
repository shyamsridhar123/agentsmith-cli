import { configDefaults, defineConfig } from "vitest/config";

const packagingOnly = process.env.npm_lifecycle_event === "test:packaging";

export default defineConfig({
  test: {
    include: packagingOnly
      ? ["tests/packaging.test.ts"]
      : ["tests/**/*.test.ts"],
    exclude: packagingOnly
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, "tests/packaging.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30000,
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
