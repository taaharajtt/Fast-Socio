/**
 * Environment gates for the dev/demo authentication shortcuts (P1-01 / P1-03).
 *
 * These endpoints exist for local dogfooding and must never be reachable in a
 * real production deployment. Kept as pure functions so the gating logic is
 * unit-testable without a running Next.js server.
 */

type GateEnv = {
  NODE_ENV?: string;
  ALLOW_DEMO_LOGIN?: string;
};

/**
 * The public one-click demo auto-login (`GET /auth/demo`) mints a session for a
 * shared account with no credentials. Allowed outside production always; in
 * production only when explicitly opted in via ALLOW_DEMO_LOGIN=true.
 */
export function isDemoLoginEnabled(env: GateEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  return env.ALLOW_DEMO_LOGIN === "true";
}
