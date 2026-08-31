#!/usr/bin/env bash
# =============================================================================
# Daily performance report for the Contabo deployment.
#
#   ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 'bash -s' < scripts/perf-report.sh
#   ssh ... 'bash -s' < scripts/perf-report.sh -- 1h        # narrower window
#
# READ-ONLY. Every command here inspects logs, cgroup counters or Docker
# metadata. Nothing is pruned, restarted, written or deployed. Safe to run at
# any time, including during an incident.
#
# WHY THIS EXISTS. The performance audit that produced these checks had to
# gather each number by hand, and the cost of that was not effort — it was that
# five separate conclusions went unchecked long enough to be believed. Each
# section below is a number that, at some point, turned a plausible wrong answer
# into a measured right one. Run it daily; run it FIRST when something feels
# slow.
#
# The client-side half of the picture — INP, LCP, CLS, navigation duration,
# stalls, chat delivery latency, realtime recoveries — is in Sentry, tagged by
# sanitized route. This script covers what only the server can see.
# =============================================================================
set -uo pipefail

WINDOW="${1:-24h}"
APP=fastsocio-app
CADDY=fastsocio-caddy
IMGCACHE=fastsocio-imgcache

hr() { printf '\n%s\n' "-------------------------------------------------------------"; }
say() { printf '%s\n' "$*"; }

say "FAST SOCIO performance report — window ${WINDOW} — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---------------------------------------------------------------------------
hr; say "1. CPU THROTTLING — must be 0"
# The app runs with NO cpu quota by design (perf audit Phase 1). Before that was
# removed the container had been frozen 9,716 times for 568 seconds, and that
# was the p99 tail. Average utilisation cannot show this; these counters can.
# A non-zero nr_throttled means a quota has been reintroduced somewhere.
# ---------------------------------------------------------------------------
CID=$(docker inspect -f '{{.Id}}' "$APP" 2>/dev/null)
if [ -n "${CID:-}" ] && [ -r "/sys/fs/cgroup/system.slice/docker-${CID}.scope/cpu.stat" ]; then
  grep -E 'nr_periods|nr_throttled|throttled_usec' \
    "/sys/fs/cgroup/system.slice/docker-${CID}.scope/cpu.stat" | sed 's/^/   /'
  say "   cpu.max: $(cat "/sys/fs/cgroup/system.slice/docker-${CID}.scope/cpu.max")   (expect: max 100000)"
else
  say "   (cgroup path not readable — container may have been renamed; check 'docker ps')"
fi

# ---------------------------------------------------------------------------
hr; say "2. CONTAINER HEALTH — no unexpected restarts, no OOM"
# ---------------------------------------------------------------------------
docker ps --format '   {{.Names}}\t{{.Status}}' | sed 's/\t/  /'
for c in "$APP" "$CADDY" "$IMGCACHE" fastsocio-imgproxy; do
  oom=$(docker inspect -f '{{.State.OOMKilled}}' "$c" 2>/dev/null || echo "?")
  rst=$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null || echo "?")
  say "   $c  oom_killed=$oom  restarts=$rst"
done

# ---------------------------------------------------------------------------
hr; say "3. DISK — target below 70%"
# The build cache reached 59.6GB and the filesystem 78% before this was a
# routine check. Docker build cache grows on every deploy and nothing reclaims
# it automatically.
# ---------------------------------------------------------------------------
df -h / | tail -1 | sed 's/^/   /'
docker system df 2>/dev/null | sed 's/^/   /'

# ---------------------------------------------------------------------------
hr; say "4. HTTP LATENCY AND ERROR RATES (Caddy JSON access log)"
# Thresholds from the performance plan: p95 < 750ms, <3% of requests over 1s,
# zero avoidable 502s.
#
# READ `max` WITH CARE. Long-lived connections (the Realtime websocket, SSE) are
# logged with their FULL held-open duration, so a max in the hundreds of seconds
# is normally one socket that stayed open, not a request anyone waited on. The
# percentiles are the numbers to act on.
# ---------------------------------------------------------------------------
LOG=$(mktemp); trap 'rm -f "$LOG"' EXIT
docker logs "$CADDY" --since "$WINDOW" 2>/dev/null | grep -o '{.*}' > "$LOG" || true

if command -v jq >/dev/null 2>&1 && [ -s "$LOG" ]; then
  jq -c 'select(.duration)' < "$LOG" | jq -s '
    sort_by(.duration) |
    { requests: length,
      p50: (.[(length*0.50|floor)].duration),
      p95: (.[(length*0.95|floor)].duration),
      p99: (.[(length*0.99|floor)].duration),
      over_1s: (map(select(.duration>1))|length),
      over_3s: (map(select(.duration>3))|length),
      over_1s_pct: ((map(select(.duration>1))|length) * 100.0 / length | .*100|round|./100),
      max: (.[length-1].duration) }' 2>/dev/null | sed 's/^/   /'

  say "   status codes:"
  jq -r '.status' < "$LOG" 2>/dev/null | sort | uniq -c | sort -rn | head -8 | sed 's/^/     /'

  say "   RSC / prefetch share (should be high but CHEAP — these hit static shells):"
  total=$(wc -l < "$LOG")
  rsc=$(grep -c '"Rsc":\["1"\]' "$LOG" || true)
  pre=$(grep -c '"Next-Router-Prefetch":\["1"\]' "$LOG" || true)
  say "     total=$total  rsc=$rsc  prefetch=$pre"

  say "   slowest routes (mean duration, n>=5, ids templated):"
  jq -r 'select(.duration) | "\(.request.uri // .uri // "?")\t\(.duration)"' < "$LOG" 2>/dev/null \
    | sed -E 's#\?[^\t]*##; s#/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#/[id]#g' \
    | awk -F'\t' '{n[$1]++; t[$1]+=$2} END{for(r in n) if(n[r]>=5) printf "     %10.3f  n=%-6d %s\n", t[r]/n[r], n[r], r}' \
    | sort -rn | head -8 || true

else
  say "   (jq not installed, or no JSON log lines in the window)"
  say "   install jq, or check that the Caddyfile still uses 'format filter { wrap json }'"
fi

# ---------------------------------------------------------------------------
hr; say "5. DEPLOY HYGIENE — chunk 404s and Server Action mismatches must be 0"
# Both mean a client is running a bundle the server no longer has. A short tail
# right after a deploy is expected while clients migrate; a sustained rate is a
# skew-protection or static-retention failure.
# ---------------------------------------------------------------------------
say "   chunk 404s:            $(grep -c '"status":404' "$LOG" 2>/dev/null || echo 0)"
say "   502s:                  $(grep -c '"status":502' "$LOG" 2>/dev/null || echo 0)"
say "   Failed Server Actions: $(docker logs "$APP" --since "$WINDOW" 2>&1 | grep -c 'Failed to find Server Action' || echo 0)"
say "   PPR invariant (E592):  $(docker logs "$APP" --since "$WINDOW" 2>&1 | grep -c 'postponed state should not be provided' || echo 0)"
say "   builds retained:       $(docker exec "$APP" sh -c 'ls -t /srv/_next/static/.builds 2>/dev/null | tr "\n" " "' 2>/dev/null)"

# ---------------------------------------------------------------------------
hr; say "6. IMAGE CACHE — hit rate and delivered widths"
# deviceSizes is capped at 828 (perf audit Phase 6). A sustained tail of 1080
# requests means clients are stuck on a stale bundle or service-worker page.
# NOTE: the cache key includes the negotiated format, so curl with an explicit
# Accept addresses a different entry than a browser. Read the log, not curl.
# ---------------------------------------------------------------------------
docker logs "$IMGCACHE" --since "$WINDOW" 2>&1 | grep -oE 'cache=[A-Z-]+' | sort | uniq -c | sort -rn | sed 's/^/   /'
say "   delivered widths:"
docker logs "$IMGCACHE" --since "$WINDOW" 2>&1 | grep -oE 'rs:fit:[0-9]+' | sort | uniq -c | sort -rn | head -6 | sed 's/^/     /'

hr
say "Database-side numbers are not in this script — they need the Supabase"
say "connection. See the runbook's weekly operational read for the"
say "pg_stat_statements and realtime queries, including why realtime.apply_rls"
say "is ~57% of database time and what does NOT fix it."
hr
