import { NextResponse } from "next/server";
import { createClient as createAnonClient } from "@supabase/supabase-js";

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
 *
 * No `export const dynamic` here: cacheComponents rejects route-segment config
 * outright.
 *
 * This route used to prerender, because it read nothing request-scoped. Adding
 * the `?probe=db` switch below means reading the URL, so it is now a per-request
 * function (it reports as `ƒ` in the build output rather than `○`). That is a
 * deliberate and cheap trade: the handler still does no I/O on the bare path,
 * and a liveness probe that proves the process is running has to run in the
 * process anyway. Serving it still requires the server to be up and answering,
 * which is all it claims to test.
 *
 * ---------------------------------------------------------------------------
 * `?probe=db` — the Supabase round-trip measurement (audit F14 / H1)
 *
 * The single most consequential number for this app's performance is how long
 * one request from THIS container to Supabase takes. Every screen is built out
 * of several of them in sequence, and it cannot be measured from outside the
 * box: the Supabase hostname resolves to Cloudflare, so an external timing says
 * nothing about where Postgres actually is relative to the VPS.
 *
 * The probe is opt-in via a query parameter and is NOT part of the liveness
 * contract. The container healthcheck calls the bare path, which still never
 * touches the network — a slow or down database must not make Docker start
 * killing healthy containers, which is the whole reason this route was written
 * the way it was.
 *
 * It calls `get_maintenance_state()`, which is granted to `anon` (migration
 * 0081), returns a fixed public-safe shape, and reads one row by primary key.
 * That makes it as close to pure round-trip time as this stack allows: the
 * query itself is trivial, so the number is dominated by network + TLS +
 * PostgREST overhead, which is exactly what we want to isolate. No session is
 * involved and no user data is read or returned — only a duration.
 *
 *   curl -s 'https://fastsocio.online/api/health?probe=db'
 *   # {"status":"ok","db":{"ms":23,"ok":true}}
 *
 * Run it several times and take the median; a single sample includes connection
 * setup. Under ~20ms the app's multi-round-trip query patterns are fine as they
 * are. Above ~50ms they become the dominant cost and the Phase 3/4 work
 * (batching, colocation) is justified by this number rather than by argument.
 */
export async function GET(request: Request) {
  const wantsDbProbe =
    new URL(request.url).searchParams.get("probe") === "db";

  if (!wantsDbProbe) {
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }

  const started = performance.now();
  let ok = false;
  try {
    const supabase = createAnonClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { error } = await supabase.rpc("get_maintenance_state");
    ok = !error;
  } catch {
    ok = false;
  }
  const ms = Math.round(performance.now() - started);

  return NextResponse.json(
    { status: "ok", db: { ms, ok } },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}
