import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    reporters: "default",
    // Tests write real files, and a CI runner's disk is far slower than a dev
    // machine: a pack conversion took 5.7 s there. The default 5 s limit fails
    // for reasons that have nothing to do with the code under test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
