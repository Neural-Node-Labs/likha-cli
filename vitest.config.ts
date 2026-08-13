// ronin:version 1 | ronin:task task-b88b43 | ronin:updated 2026-08-13T06:18:09.182Z | ronin:subtask test-st-eaae62
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep vitest's default discovery rules; this file exists so explicit
    // `--config vitest.config.ts` invocations (e.g. the regression gate and
    // the scoped core/tools folder runs) resolve cleanly.
  },
});
