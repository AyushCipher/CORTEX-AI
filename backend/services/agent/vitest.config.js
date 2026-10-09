import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      pino: require.resolve("pino"),
    },
  },
});
