import { NextResponse } from "next/server";

/**
 * Liveness probe for the self-hosted (Contabo) deployment — added for the
 * infrastructure migration, Phase 1.
 *
 * Deliberately minimal. It proves exactly two things: the Node process is
 * alive and the HTTP server is answering. It does NOT touch Supabase, the
 * database, or any user data — a health check that depends on a remote service
 * turns someone else's outage into our restart loop, and Docker would kill a
 * perfectly healthy container because Tokyo was slow.
 *
 * Nothing here is sensitive: no env values, no versions, no build IDs, no
 * request echo. It is reachable unauthenticated (see the /api/health entry in
 * lib/supabase/middleware.ts), so it must stay that way.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
