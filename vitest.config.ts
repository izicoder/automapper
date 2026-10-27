import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    reporters: "default",
    // Windows CI runners scan every file write with Defender, so the same
    // suite that takes seconds locally can take several times longer there.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
