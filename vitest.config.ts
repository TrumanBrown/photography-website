import { defineConfig } from "vitest/config";

// Unit tests for the pure, dependency-free logic: stocking math, session sort,
// blob URL building, and the privacy-preserving visitor hash. The canvas
// engines and Azure SDK calls are intentionally out of scope here.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "api/**/*.test.cjs"],
  },
});
