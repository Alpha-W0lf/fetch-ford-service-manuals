import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["manuals/**", "node_modules/**"],
    environment: "node",
    testTimeout: 15000,
  },
});
