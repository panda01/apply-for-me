import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    exclude: ["tests/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 93,
        branches: 93,
        functions: 93,
        lines: 93,
      },
      include: ["client/src/**/*.{ts,tsx}", "server/src/**/*.ts"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "client/src/main.tsx",
        "server/src/index.ts",
        "server/src/scripts/**",
        "server/src/prismaClient.ts",
      ],
    },
    environment: "jsdom",
  },
});
