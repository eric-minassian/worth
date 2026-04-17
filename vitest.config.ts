import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    testTimeout: 10_000,
  },
})
