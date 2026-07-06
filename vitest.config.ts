import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal unit-test setup (audit fix phase). Pure-logic tests only — no Next.js
// server, no DB. DB-level behaviour (RLS, triggers) is verified with the SQL
// scripts under supabase/tests/ when Supabase access is available.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
