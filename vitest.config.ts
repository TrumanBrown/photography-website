import { defineConfig } from "vitest/config";

// Fast tests for pure application, prebuild, and Azure Function helper logic.
// Browser rendering and live Azure SDK calls remain integration concerns.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "api/**/*.test.cjs", "scripts/**/*.test.mjs"],
  },
});
