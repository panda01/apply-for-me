import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
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
