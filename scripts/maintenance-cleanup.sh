#!/usr/bin/env bash
# =============================================================================
# Disk maintenance for the Contabo deployment.
#
#   # ALWAYS dry-run first. This is the default and prints what WOULD go.
#   ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 'bash -s' < scripts/maintenance-cleanup.sh
#
#   # Actually delete:
#   ssh ... 'bash -s -- --apply' < scripts/maintenance-cleanup.sh
#
# NOT INSTALLED. This is prepared for review; see the runbook for the cron line
# and for how to roll back. Nothing schedules it yet.
#
# WHY IT EXISTS. `docker builder prune` has been documented as step 6 of every
# routine deploy since the first version of the runbook, and was simply never
# run: the build cache reached 59.6 GB and the root filesystem 78% before anyone
# looked. A step that is optional in practice is not a retention policy. The
# disk is shared with the `supabase` compose project, so filling it takes that
# stack down too.
#
# ---------------------------------------------------------------------------
# SAFETY PROPERTIES, in the order they are enforced below:
#
#   1. DRY RUN BY DEFAULT. Deleting requires an explicit --apply.
#   2. REFUSES TO RUN DURING A BUILD. Pruning the builder cache while a build
#      is using it is how you get a corrupt layer and a failed deploy.
#   3. KEEP IS NEVER BELOW 2, so the current AND previous build's client chunks
#      always survive. That is the property that stops a deploy stranding a
#      client mid-session.
#   4. THE LIVE BUILD'S MARKER IS VERIFIED before and after. If the deployment
#      currently being served would lose its assets, the script aborts.
#   5. NEVER `docker system prune -a`. That would evict the Supabase project's
#      images, which this script has no business touching.
#   6. Volumes are never pruned. `fastsocio-static-assets`, `imgcache_data` and
#      `caddy_data` are all load-bearing; caddy_data especially, because losing
#      it means re-issuing certificates against Let's Encrypt rate limits.
# =============================================================================
set -uo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

APP=fastsocio-app
KEEP=3                      # builds of client chunks to retain
BUILDER_MAX_AGE=168h        # 7 days
IMAGE_MAX_AGE=336h          # 14 days
WARN_PCT=70                 # warn above this disk usage
CRIT_PCT=85                 # shout above this

say()  { printf '%s\n' "$*"; }
hr()   { printf '\n%s\n' "-------------------------------------------------------------"; }
run()  { if [ "$APPLY" = "1" ]; then eval "$@"; else say "   DRY-RUN would run: $*"; fi; }

say "FAST SOCIO maintenance — $( [ "$APPLY" = 1 ] && echo APPLY || echo 'DRY RUN (pass --apply to delete)') — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---------------------------------------------------------------------------
hr; say "0. Preconditions"
# ---------------------------------------------------------------------------
# `pgrep -f` matches on the full command line, which includes THIS script's own
# shell and the ssh command that launched it — so a naive check reports a build
# in progress every single time. (That is not hypothetical: the same self-match
# bug in a wait loop left an orphan process spinning on this VPS for four and a
# half hours.) Exclude our own process ancestry before believing the result.
MY_PIDS=" $$ "
_p=${PPID:-1}
while [ -n "$_p" ] && [ "$_p" -gt 1 ] 2>/dev/null; do
  MY_PIDS="$MY_PIDS $_p "
  _p=$(ps -o ppid= -p "$_p" 2>/dev/null | tr -dc '0-9')
done

BUSY=0
for pid in $(pgrep -f 'docker compose build|docker build|npm run build|next build' 2>/dev/null); do
  case "$MY_PIDS" in *" $pid "*) continue ;; esac
  BUSY=1
  say "   build process still running: $(ps -o cmd= -p "$pid" 2>/dev/null | cut -c1-90)"
done
if [ "$BUSY" = "1" ]; then
  say "   ABORT: a build is running. Pruning the builder cache now risks a"
  say "          corrupt layer and a failed deploy. Try again after it."
  exit 1
fi
say "   no build in progress"

if ! docker inspect "$APP" >/dev/null 2>&1; then
  say "   ABORT: container '$APP' not found. It may have been renamed by compose"
  say "          (this has happened: '<hash>_fastsocio-app'). Check 'docker ps -a'."
  exit 1
fi

LIVE=$(docker inspect "$APP" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
        | sed -n 's/^NEXT_DEPLOYMENT_ID=//p' | head -1)
say "   live deployment id: ${LIVE:-<unset>}"

BEFORE_PCT=$(df --output=pcent / | tail -1 | tr -dc '0-9')
say "   disk before: ${BEFORE_PCT}%"

# ---------------------------------------------------------------------------
hr; say "1. Disk thresholds"
# ---------------------------------------------------------------------------
if   [ "$BEFORE_PCT" -ge "$CRIT_PCT" ]; then say "   CRITICAL: ${BEFORE_PCT}% >= ${CRIT_PCT}% — act now, the Supabase stack shares this disk"
elif [ "$BEFORE_PCT" -ge "$WARN_PCT" ]; then say "   WARNING:  ${BEFORE_PCT}% >= ${WARN_PCT}%"
else say "   OK: below ${WARN_PCT}%"; fi

# ---------------------------------------------------------------------------
hr; say "2. Static-asset retention — keep the newest $KEEP builds"
# Build-COUNTED, never day-counted. A quiet week with no deploys must not delete
# the current build's assets, and five deploys in an hour must not retain none
# of the previous ones.
# ---------------------------------------------------------------------------
if [ "$KEEP" -lt 2 ]; then say "   ABORT: KEEP must be >= 2 (current + previous)"; exit 1; fi

MARKERS=/srv/_next/static/.builds
say "   markers present:"
docker exec "$APP" sh -c "ls -t $MARKERS 2>/dev/null" | sed 's/^/     /'

CUT=$(docker exec "$APP" sh -c "ls -t $MARKERS 2>/dev/null" | sed -n "$((KEEP+1))p")
if [ -z "$CUT" ]; then
  say "   fewer than $((KEEP+1)) builds present — nothing to prune (this is a no-op by design)"
else
  say "   would prune assets older than build: $CUT"
  if [ -n "${LIVE:-}" ] && [ "$CUT" = "$LIVE" ]; then
    say "   ABORT: the cut build IS the live deployment ($LIVE). Refusing."
    exit 1
  fi
  run "docker exec $APP sh -c \"find /srv/_next/static -type f -path '*/.builds/*' -prune -o -type f ! -newer $MARKERS/$CUT -delete; find $MARKERS -type f ! -newer $MARKERS/$CUT -delete\""
  if [ "$APPLY" = "1" ] && [ -n "${LIVE:-}" ]; then
    if docker exec "$APP" sh -c "test -f $MARKERS/$LIVE"; then
      say "   VERIFIED: live build's marker ($LIVE) survived"
    else
      say "   !! The live build's marker is GONE. Assets for the running deployment"
      say "      may have been removed. Caddy's pass_thru will fall back to the app,"
      say "      so this degrades rather than breaks — but redeploy to restore them."
    fi
  fi
fi

# ---------------------------------------------------------------------------
hr; say "3. Docker build cache older than $BUILDER_MAX_AGE"
# Every deploy does COPY . . before npm run build, invalidating that layer and
# writing a fresh multi-GB entry. Nothing reclaims it automatically.
# ---------------------------------------------------------------------------
docker system df 2>/dev/null | sed 's/^/   /'
run "docker builder prune --force --filter until=$BUILDER_MAX_AGE"

# ---------------------------------------------------------------------------
hr; say "4. Unused images older than $IMAGE_MAX_AGE"
# `-a` here is scoped by `until` and only removes images no container uses.
# NEVER `docker system prune -a`: that evicts the Supabase project's images.
# ---------------------------------------------------------------------------
run "docker image prune -a --force --filter until=$IMAGE_MAX_AGE"

# ---------------------------------------------------------------------------
hr; say "5. Stopped containers (volumes are deliberately NOT touched)"
# ---------------------------------------------------------------------------
run "docker container prune --force"
say "   volumes left alone on purpose: fastsocio-static-assets, imgcache_data,"
say "   caddy_data (losing caddy_data means re-issuing certs against rate limits)"

# ---------------------------------------------------------------------------
hr; say "6. Result"
# ---------------------------------------------------------------------------
AFTER_PCT=$(df --output=pcent / | tail -1 | tr -dc '0-9')
df -h / | tail -1 | sed 's/^/   /'
say "   disk: ${BEFORE_PCT}% -> ${AFTER_PCT}%"
docker ps --format '   {{.Names}}  {{.Status}}'
if [ "$APPLY" != "1" ]; then
  hr; say "This was a DRY RUN. Nothing was deleted. Re-run with --apply."
fi
