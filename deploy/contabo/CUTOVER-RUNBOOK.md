# Production cutover runbook — Vercel → Contabo VPS

**Window:** 2026-08-13 00:00 PKT (= 2026-08-12 19:00 UTC)
**Planned duration:** 30 minutes. **Target downtime:** ≤ 10 minutes.

| | From | To |
|---|---|---|
| Compute | Vercel (`fast-socio.vercel.app`) | Contabo VPS `169.58.149.230` |
| Database | Supabase Tokyo `skgphoupbwdexfevgcnn` | Supabase Frankfurt `xnbzenixmgghxsjpektp` |
| Files | Supabase Storage | Contabo Object Storage `fast-socio` |
| Domain | — | `fastsocio.online` (+ `www` → apex) |

Nothing in the old stack is deleted, disabled, or reconfigured by this runbook.
Vercel keeps serving `fast-socio.vercel.app` and Tokyo keeps taking writes until
the moment DNS moves, and both remain fully intact afterwards.

---

## The one genuinely irreversible thing

**Rollback is clean only until users start writing to Frankfurt.**

Everything else here reverses in minutes. But once the domain points at the VPS
and someone posts, sends a message or signs up, that row exists **only** in
Frankfurt. Rolling back to Vercel/Tokyo at that point silently loses it, because
Tokyo has no idea it happened.

Practical consequence:

- **Within the window** (nobody has written yet): rollback is free.
- **After real traffic**: rollback means accepting the loss of everything written
  since cutover, or reverse-syncing Frankfurt → Tokyo by hand. There is no
  script for that direction and I would not write one under time pressure.

This is why the window is at midnight PKT, and why step 9 verifies before the
freeze is lifted. **Decide to roll back early, not late.**

---

## T-60 min — pre-flight (no changes to anything)

Run these and stop if any fails. All are read-only.

```bash
# 1. App, TLS, health on the current test origin
curl -s -o /dev/null -w "health %{http_code}\n" https://169-58-149-230.sslip.io/api/health
curl -s -o /dev/null -w "login  %{http_code}\n" https://169-58-149-230.sslip.io/login

# 2. Containers healthy, Supabase stack untouched
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 \
  'docker compose -f ~/fastsocio-app/docker-compose.yml ps --format "{{.Name}}\t{{.Status}}"'

# 3. Database connectivity + drift snapshot (read-only)
node scripts/sync-frankfurt-data.mjs            # dry run: reports drift, changes nothing

# 4. Storage: every object present on Contabo
node scripts/migrate-storage.mjs                # dry run: expect "skipped" for all

# 5. Stored URLs already point at Contabo
node scripts/rewrite-storage-urls.mjs           # dry run: expect stragglers = 0

# 6. CSP carries the storage host (the bug that only shows in a browser)
curl -s -D - -o /dev/null https://169-58-149-230.sslip.io/login \
  | grep -i content-security-policy | tr ';' '\n' | grep -E 'img-src|connect-src'
```

**Also confirm by hand, in a browser, on the test origin:** log in, load the
feed with images, upload a profile photo, open a chat thread with an attachment.
`curl` cannot verify these — a CSP or CORS fault returns 200 to curl and breaks
every image in a real browser.

**Rollback image is tagged and present:**

```bash
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 \
  'docker images fastsocio-app --format "{{.Tag}}"'   # expect: phase1, pre-contabo-storage
```

---

## T-30 min — DNS records, still pointing nowhere new

Create the records at Spaceship with a **short TTL** so a rollback propagates
fast. Do this before the window: `fastsocio.online` has never resolved to
anything, so this is not user-visible.

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `169.58.149.230` | **300** |
| A | `www` | `169.58.149.230` | **300** |

Leave the TTL at 300 until the cutover is verified; raise it afterwards.

Deploy the Caddy config that knows about the domain. Safe to do early: Caddy
only obtains a certificate once the name resolves here, and the sslip.io origin
keeps serving until then.

```bash
# from the repo, on the workstation
git archive --format=tar infra/contabo-storage | ssh -i ~/.ssh/fastsocio_vps \
  fastsocio@169.58.149.230 'rm -rf ~/fastsocio-app/repo.new && mkdir -p ~/fastsocio-app/repo.new \
   && tar xf - -C ~/fastsocio-app/repo.new && cd ~/fastsocio-app \
   && TS=$(date +%s) && cp Caddyfile Caddyfile.bak-$TS \
   && cp repo.new/deploy/contabo/Caddyfile Caddyfile \
   && mv repo repo.bak-$TS && mv repo.new repo \
   && docker compose up -d caddy'
```

Then wait for the certificate and confirm:

```bash
curl -sI https://fastsocio.online/api/health      | head -1   # expect 200
curl -sI https://www.fastsocio.online/            | head -1   # expect 301 -> apex
```

**If the certificate does not issue, STOP.** The app is still on Vercel and
nothing is broken. Debug with `docker compose logs caddy`.

---

## T-0 — cutover

### 1. Freeze writes — freeze the Vercel app, not the database

The freeze is what makes the final sync exact. Any row written to Tokyo after
the sync starts exists nowhere afterwards.

**A database-level freeze was tried and REJECTED.** Setting
`default_transaction_read_only = on` on the `authenticator` role, with all its
connections recycled, did **not** block writes — a rehearsal on Frankfurt showed
an insert still returning `201 Created`. PostgREST appears to set each
transaction's access mode itself, overriding the role default. It looked
applied, reported as applied, and did nothing. **Do not use it, and do not
modify Tokyo's grants or roles as a substitute.**

**Maintenance mode is also NOT a freeze.** `app_settings.maintenance` only
redirects the student layout to `/maintenance`; an already-open tab can still
invoke Server Actions.

**The mechanism: block the Vercel app.** Verified by inspection of the codebase
— every real mutation (posts, comments, messages, uploads, community and society
actions) runs through a Server Action or API route hosted on Vercel. Take Vercel
out of the request path and those writes cannot reach Tokyo at all.

```bash
V=$(grep -m1 '^VERCEL_API_TOKEN=' .env.local | cut -d= -f2- | tr -d '"
')
PRJ=prj_0iHAyTMxqXZd0K3kb9W0lEaLf7JP

# FREEZE — require Vercel authentication for every deployment, including the
# *.vercel.app production alias. Public requests then get 401 and no Server
# Action, API route or RPC-backed mutation can run.
curl -s -X PATCH "https://api.vercel.com/v9/projects/$PRJ"   -H "Authorization: Bearer $V" -H "Content-Type: application/json"   -d '{"ssoProtection":{"deploymentType":"all"}}'
```

**Verify the freeze bit — required, do not assume (this is the step the
database mechanism failed):**

```bash
curl -s -o /dev/null -w "login  %{http_code}  (expect 401)
" https://fast-socio.vercel.app/login
```

Then, in a browser on `fast-socio.vercel.app`, confirm the app is unreachable
and that attempting to post fails.

**UNFREEZE (rollback only — see step 10):**

```bash
curl -s -X PATCH "https://api.vercel.com/v9/projects/$PRJ"   -H "Authorization: Bearer $V" -H "Content-Type: application/json"   -d '{"ssoProtection":{"deploymentType":"all_except_custom_domains"}}'
```

Nothing is deleted or reconfigured: the deployment, its domains and its
environment variables are untouched, and reverting is one call.

**Two residual write paths, documented rather than hidden.** Both only apply to
tabs already open at freeze time, because a paused app serves no new pages:

- `supabase.rpc("touch_last_seen")` — the presence heartbeat
  (`src/components/presence/heartbeat.tsx`) is the ONLY direct browser-to-
  Supabase write in the codebase. It updates `last_seen` metadata; losing a few
  seconds of it is harmless.
- Direct Storage uploads — the OLD code on Vercel uploads straight to Supabase
  Storage with the user's JWT, so an open tab could still push a file. Requires
  deliberate user action mid-window.

Neither can create or modify a post, message, profile or comment. If even that
is unacceptable, the only stronger option is revoking Tokyo's grants — which is
explicitly out of scope by decision.

Note the exact time the freeze went on.

### 2. Final data sync (Tokyo → Frankfurt)

```bash
node scripts/sync-frankfurt-data.mjs --apply
```

Replaces all 75 tables, re-sets every sequence, carries `auth.sessions` and
`auth.refresh_tokens` so **users stay logged in**. Ends with
`VERIFIED: every table matches Tokyo's row count.` — if it does not, stop.

### 3. Copy any new files

```bash
node scripts/migrate-storage.mjs --apply
```

Idempotent: unchanged objects are skipped, only new ones transfer.

### 4. Rewrite stored URLs

```bash
node scripts/rewrite-storage-urls.mjs --apply
```

Must end with `rows still pointing at Supabase after this run: 0`.

### 5. Point Supabase auth at the production domain

```bash
TOKEN=$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2- | tr -d '"\r')
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/xnbzenixmgghxsjpektp/config/auth" \
  -d '{"site_url":"https://fastsocio.online"}'
```

The allow-list already contains `fastsocio.online`, `www.fastsocio.online` and
the sslip.io origin — leave all three until cleanup. **Without this, magic-link
emails point at the sslip.io test origin.**

### 6. Rebuild the app for the production origin

`NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_IMGPROXY_URL` are baked into the client
bundle at build time, so changing them requires a rebuild, not a restart.

```bash
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 \
 'cd ~/fastsocio-app \
  && cp .env .env.bak-$(date +%s) \
  && sed -i "s|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=https://fastsocio.online|" .env \
  && sed -i "s|^NEXT_PUBLIC_IMGPROXY_URL=.*|NEXT_PUBLIC_IMGPROXY_URL=https://fastsocio.online/img|" .env \
  && docker compose build app && docker compose up -d app'
```

### 7. DNS is already live — verify the domain end to end

Records were created at T-30. Confirm the app answers on the real domain:

```bash
curl -s -o /dev/null -w "health %{http_code}\n" https://fastsocio.online/api/health
curl -s -D - -o /dev/null https://fastsocio.online/login \
  | grep -i content-security-policy | tr ';' '\n' | grep -E 'img-src|connect-src'
```

### 8. Browser verification on `https://fastsocio.online` — REQUIRED

Do not skip. These are the failures `curl` cannot see:

- [ ] Log in with a **real magic link** (confirms `site_url` + allow-list)
- [ ] Feed renders, images load, no console errors
- [ ] Images are fetched via `/img/...` (not raw storage, not Supabase)
- [ ] Upload a profile photo (presign → PUT → public read)
- [ ] Open a chat thread with an attachment (private presigned GET)
- [ ] Post something — a Server Action write, proving `allowedOrigins`
- [ ] `www.fastsocio.online` redirects to the apex with a valid certificate

### 9. ROLLBACK DECISION POINT — stop and decide before unfreezing

**Everything up to here is reversible. Nothing past here is.**

Tokyo is still read-only and byte-identical to what Frankfurt was loaded from.
No user has written to Frankfurt. Rolling back costs nothing but time.

Go/no-go — every line must be a yes, verified in a browser on
`https://fastsocio.online`, not inferred:

- [ ] Magic-link login completes and lands signed in
- [ ] Feed reads render (database reads)
- [ ] A post/comment succeeds (database write via Server Action → proves
      `allowedOrigins`)
- [ ] Profile-photo upload succeeds (presign → PUT → public read)
- [ ] Pre-existing images load (migrated storage URLs)
- [ ] Images arrive via `/img/...` (imgproxy)
- [ ] Chat attachment opens (private presigned GET)
- [ ] Apex serves valid TLS; `www` redirects to apex with valid TLS
- [ ] Browser console clean — no CSP or CORS errors
- [ ] `docker compose logs app` shows no 5xx burst

**If ANY line fails: roll back now** (see Rollback below). Do not unfreeze and
"fix it live" — once writes land in Frankfurt the cheap exit is gone.

If every line passes, proceed.

### 10. Restore writes on the NEW production only

Only after every box in step 9 is ticked.

Writes on Frankfurt were never frozen — the VPS has been serving them all along.
There is nothing to switch on there beyond clearing the maintenance notice, if
one was set:

```bash
# on FRANKFURT (now the live database)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"   "https://api.supabase.com/v1/projects/xnbzenixmgghxsjpektp/database/query"   -d '{"query":"update app_settings set value = jsonb_build_object('"'"'enabled'"'"', false, '"'"'message'"'"', '"'"''"'"') where key = '"'"'maintenance'"'"'"}'
```

**Leave the Vercel freeze ON.** Vercel and Tokyo remain intact and available as
rollback infrastructure, but must not accept writes now that Frankfurt is
authoritative — two databases both taking writes is the one state from which
there is no clean recovery. Tokyo therefore stays exactly as it was at the
moment of the final sync, which is what makes it a trustworthy snapshot.

**From here, Frankfurt is the source of truth and rolling back to Tokyo means
losing every row written since.**

## Rollback

### Before the freeze is lifted — free, ~5 minutes

Nothing has been written to Frankfurt, so nothing is lost.

1. **Point the domain away from the VPS.** Delete the two A records, or leave
   them and simply tell users to use `https://fast-socio.vercel.app`, which has
   been serving the whole time and is untouched.
2. **Revert Supabase auth config**:
   ```bash
   curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     "https://api.supabase.com/v1/projects/xnbzenixmgghxsjpektp/config/auth" \
     -d '{"site_url":"https://169-58-149-230.sslip.io"}'
   ```
3. **Unfreeze writes on Vercel.** Tokyo is current and never stopped being the
   source of truth.

Vercel + Tokyo + Supabase Storage are all still live and unmodified — rollback is
"stop sending traffic to the VPS", not "restore anything".

### App-level rollback (bad build, not bad data)

```bash
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 \
 'cd ~/fastsocio-app \
  && docker tag fastsocio-app:pre-contabo-storage fastsocio-app:phase1 \
  && docker compose up -d app'
```

Config and code backups on the VPS: `repo.bak-*`, `docker-compose.yml.bak-*`,
`Caddyfile.bak-*`, `.env.bak-*`.

> **Do NOT roll back a service-worker change this way.** An installed service
> worker is client-side state: reverting the image does not un-install it, it
> just means the next SW the browser fetches is the old one, and clients that
> already activated the new one sit on it until then. A bad `workboxOptions`
> change is **forward-fix only** — ship a corrected worker, never a revert.

## Routine deploy (post-cutover)

This is the standard "ship a new build" procedure. It replaces the bare
`docker compose build app && docker compose up -d app` used during cutover.

Run the steps individually and read the output of each — do not paste the whole
thing as one chain. Step 3 is the point of no return for live clients.

**1. Fetch and pin the deployment id.**

```bash
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230
cd ~/fastsocio-app && git -C repo pull --ff-only
export GIT_SHA=$(git -C repo rev-parse --short HEAD) && echo "deploying $GIT_SHA"
```

`export GIT_SHA` is **required and now enforced in two places** — it is no
longer possible to build without it. `docker-compose.yml` declares
`${GIT_SHA:?...}`, so compose refuses to build, and `next.config.ts` throws when
`DOCKER_BUILD=1` and the id is empty, which also covers a bare `docker build`
that bypasses compose. It feeds `deploymentId`: `?dpl=` on asset URLs and a hard
reload when a client's build no longer matches the server's. It previously
defaulted to empty, which disabled skew protection *silently* — the failure only
showed up one deploy later, stranding live clients on 404ing chunks and stale
Server Action ids.

**2. Build.** Nothing is serving this yet; a failure here is free.

```bash
docker compose build app
```

**3. Switch traffic.** This replaces the container. The previous build's chunks
remain served from the shared volume (see retention below), so clients mid-
session keep working until they next reload.

```bash
docker compose up -d app
```

**4. Health-check before believing it.** All three must pass.

```bash
# a) container is up and the healthcheck is green (not "starting"/"unhealthy")
docker compose ps app

# b) the app answers its liveness probe from inside the container
docker compose exec app curl -fsS http://127.0.0.1:3000/api/health

# c) the deployment id actually took effect — must echo the SHA from step 1
curl -s https://fastsocio.online/login | grep -o 'data-dpl-id="[^"]*"'
```

**5. Confirm the previous build is still retained.** This is what protects
clients who have not reloaded yet. Expect at least two entries, newest first:

```bash
docker compose exec app sh -c 'ls -t /srv/_next/static/.builds'
```

**6. Reclaim disk.** Safe at any time; see the dedicated section below. **Do
not skip this step.** It was documented from the first version of this runbook
and simply never run: by 31 Aug 2026 the build cache had reached 59.6 GB with
57.3 GB reclaimable and the root filesystem was 78% full. A deploy step that is
optional in practice is not a retention policy — if it is being skipped again,
move it to cron (see the retention section).

```bash
docker builder prune  --filter until=168h --force
docker image prune -a --filter until=336h --force
docker system df                       # confirm it actually came back
df -h /                                # target: below 70%
```

### Static-asset retention — keep the last 3 builds

`fastsocio-static-assets` accumulates each deploy's client chunks so a deploy
cannot strand a client mid-session. Each container start drops a marker at
`/srv/_next/static/.builds/<deployment-id>`, and `cp` (deliberately without
`-p`) re-stamps every file it copies — so a file's mtime is the last deploy that
shipped it, and "older than the Nth-newest marker" is exactly "belongs to a build
we no longer keep".

Retention is **counted in builds, never in days**. An earlier draft of this
runbook pruned with `-mtime +7`, which is wrong in both directions: a quiet week
with no deploys would delete the *current* build's assets, and five deploys in
one hour would retain none of the previous ones.

```bash
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 \
 'cd ~/fastsocio-app && docker compose exec -T app sh -s' <<"EOF"
set -e
KEEP=3
MARKERS=/srv/_next/static/.builds
# The (KEEP+1)-th newest marker is the newest build we are NOT keeping.
CUT=$(ls -t "$MARKERS" 2>/dev/null | sed -n "$((KEEP+1))p")
if [ -z "$CUT" ]; then
  echo "only $(ls "$MARKERS" 2>/dev/null | wc -l) build(s) present; keeping all"
  exit 0
fi
echo "pruning assets older than build $CUT (keeping newest $KEEP)"
find /srv/_next/static -type f -path '*/.builds/*' -prune -o \
     -type f ! -newer "$MARKERS/$CUT" -print -delete
find "$MARKERS" -type f ! -newer "$MARKERS/$CUT" -delete
EOF
```

It is a no-op until a 4th build exists, so **the current and immediately
previous builds can never be deleted**, which is the property that matters.
Even a mistake here degrades rather than breaks: anything removed that the live
build still references falls through Caddy's `pass_thru` to the app, so the
worst case is a slower asset, not a 404.

`docker builder prune` is separate and safe to run any time. The builder stage
does `COPY . .` before `npm run build`, so every deploy invalidates that layer
and writes a fresh multi-GB cache entry; nothing reclaims it. It reached 51 GB
(49 GB reclaimable) before this was added, and the disk is shared with the
`supabase` project — filling it takes that stack down too. **Never** use
`docker system prune -a` here: it would evict the Supabase project's images too.

### Rolling back a deploy

```bash
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230
cd ~/fastsocio-app
export GIT_SHA=<previous-sha> && git -C repo checkout $GIT_SHA
docker compose build app && docker compose up -d app
# then re-run the step 4 health checks; data-dpl-id must echo <previous-sha>
```

Rolling back is an ordinary deploy of an older commit, so it gets a real
deployment id and the same client-skew protection. Do **not** roll back by
re-tagging an old image without rebuilding — the id would not match the assets.

> **SERVICE WORKERS ARE FORWARD-FIX ONLY.** If the bad deploy changed anything
> under `workboxOptions` / `runtimeCaching` in `next.config.ts`, reverting the
> image does **not** undo it. An installed service worker is client-side state:
> browsers that already activated the new worker keep it until they fetch a
> newer one. Ship a corrected worker forward; never rely on a revert. The rest
> of a rollback (server code, RSC payloads, Server Actions) *is* immediate,
> because Phase 1 made RSC and navigation responses `NetworkOnly` — nothing
> replays a stale payload across the rollback.

### Changing the Caddyfile — validate FIRST, always

A Caddyfile syntax error does not degrade anything gracefully: Caddy refuses to
start and **the entire site goes down**, TLS included. Never `restart caddy` on
an unvalidated config. Validate in a throwaway container that cannot touch the
running one:

```bash
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 \
 'cd ~/fastsocio-app \
  && docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
       caddy validate --config /etc/caddy/Caddyfile'
```

Only if that prints `Valid configuration`:

```bash
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 \
 'cd ~/fastsocio-app && docker compose up -d caddy'
```

### After enabling JSON access logs — confirm no credentials are logged

Caddy redacts `Cookie` / `Set-Cookie` / `Authorization` from access logs unless
the `servers { log_credentials }` global option is set, and it is deliberately
not set. Confirm that on the real deployment rather than trusting it — this must
print **nothing**:

```bash
docker compose logs --since 5m caddy | grep -iE '"(cookie|authorization)":\s*\[?"[^R]' | head
```

If it ever prints a real value, revert to `format console` immediately and treat
it as a credential exposure: auth cookies and magic-link tokens travel in those
headers.

### Measurement 0 — CPU throttling (read this BEFORE blaming a query)

The app container carries **no cpu quota** (perf audit Phase 1). Before it was
removed, a `cpus: "3.0"` ceiling had frozen the container 9,716 times for a
cumulative 568 seconds, and that — not query time — was the p99 tail. Average
utilisation cannot show this; the same container reported 7.8% mean CPU
throughout. These counters can:

```bash
cat /sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' fastsocio-app).scope/cpu.stat
```

*Threshold:* `nr_throttled` must stay at **0** and never advance. If it is
climbing, a quota has been reintroduced somewhere — check `docker inspect
fastsocio-app --format '{{.HostConfig.CpuQuota}}'`, which must print `0`.

The counters are cumulative and reset only when the container is recreated, so
compare deltas across a window rather than reading the absolute number. Do this
check first whenever latency regresses: it is one command, and if it is dirty
then no amount of query work will fix what you are seeing.

### Realtime cost — why it is 57% and what does NOT fix it

`realtime.apply_rls` is the single largest consumer of this database, ahead of
every query the product runs. It is worth knowing what that number is before
anyone spends a week trying to move it.

It is **not** proportional to how many people are online. Two windows on the
same instance:

| window | live subscriptions | call rate | mean cost |
|---|---|---|---|
| idle | 0 | 6,917 / hour | 7.93 ms |
| real traffic | up to 13 | 6,920 / hour | 8.34 ms |

The call rate is flat to within 0.04% between nobody connected and thirteen
live subscriptions. That is a timer-driven poll of the replication slot, about
one every 520ms, running whether the app has users on it or not. Only the ~5%
rise in mean cost is per-subscriber work.

Consequences:

- **Replacing `postgres_changes` with private Broadcast is not worth it here.**
  It targets the ~5%, i.e. about 3% of database CPU, and costs a security
  boundary (channel topics become authorization) plus new triggers and dedup.
  Rejected on this evidence; the reasoning is recorded next to the code in
  `src/components/chat/chat-realtime.tsx`.
- **Shaving subscription counts is not worth it either**, for the same reason.
- The levers that WOULD move it are the Realtime poll interval and the instance
  size, both on Supabase's side. Raising the poll interval trades delivery
  latency for CPU; that is a product decision, not a tuning one.

Re-check by taking this twice at different concurrency and comparing the call
RATE, not the total:

```sql
select (select count(*) from realtime.subscription) as subs,
       sum(calls) as calls,
       round((sum(total_exec_time)/sum(calls))::numeric, 2) as mean_ms
  from pg_stat_statements where query like '%wal->>%';
```

If the rate ever starts tracking concurrency, the conclusion above is stale.

### Maintenance automation — PREPARED, NOT INSTALLED

Two things are ready in the repo and deliberately not switched on. Both need a
decision, not just a deploy.

**1. `scripts/maintenance-cleanup.sh` — scheduled disk reclaim.**

`docker builder prune` has been step 6 of every routine deploy since the first
version of this runbook and was never actually run; the cache reached 59.6 GB
and the disk 78%. A step that is optional in practice is not a retention policy.

```bash
# ALWAYS dry-run first. This is the default; it deletes nothing.
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 'bash -s' < scripts/maintenance-cleanup.sh

# Apply, once the dry run looks right:
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 'bash -s -- --apply' < scripts/maintenance-cleanup.sh
```

To schedule it (weekly, Sunday 04:00 UTC — deliberately not during a deploy
window), copy the script to the VPS and add ONE crontab line:

```bash
scp -i ~/.ssh/fastsocio_vps scripts/maintenance-cleanup.sh fastsocio@169.58.149.230:~/maintenance-cleanup.sh
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230   '(crontab -l 2>/dev/null; echo "0 4 * * 0 bash \$HOME/maintenance-cleanup.sh --apply >> \$HOME/maintenance.log 2>&1") | crontab -'
```

**Rollback:** `crontab -e` and delete the line, or
`crontab -l | grep -v maintenance-cleanup | crontab -`. The script itself has no
persistent state, so removing the schedule is the whole rollback.

*What makes it safe to schedule*, and what to re-check if it is ever edited:

- Dry run is the default; deleting needs `--apply`.
- It aborts if a build is running. Note the guard deliberately excludes its own
  process ancestry — `pgrep -f` otherwise matches the ssh command that launched
  it and reports a build every time. The same self-match bug in an ad-hoc wait
  loop left an orphan process spinning on this VPS for four and a half hours.
- Retention is counted in BUILDS and `KEEP` is refused below 2, so the current
  and previous deployments' chunks always survive.
- It refuses to prune if the cut build is the live deployment, and after
  applying it verifies the live build's marker still exists.
- It never runs `docker system prune -a` (that would evict the Supabase
  project's images) and never prunes volumes (`caddy_data` holds the
  certificates; losing it burns Let's Encrypt rate limit).

**2. Caddy `lb_try_duration` — stop deploys returning 502.**

`deploy/contabo/Caddyfile` now carries `lb_try_duration 15s` /
`lb_try_interval 250ms` on the app upstream. It is in the repo but **not on the
VPS** — the live Caddyfile is a separate file, like `docker-compose.yml`.

Why: `docker compose up -d app` replaces the container and for ~9 seconds
nothing listens on `app:3000`. Measured 2026-08-31, 78 of the day's 502s fell
inside the one hour containing four container recreations, and none outside it.
With a retry the client waits instead of failing. It only affects establishing
the connection, so a request already streaming is never retried and a Server
Action cannot be duplicated.

To apply — **validate first, always**:

```bash
scp -i ~/.ssh/fastsocio_vps deploy/contabo/Caddyfile fastsocio@169.58.149.230:/tmp/Caddyfile.new
ssh -i ~/.ssh/fastsocio_vps fastsocio@169.58.149.230 '
  docker run --rm -v /tmp/Caddyfile.new:/etc/caddy/Caddyfile:ro caddy:2-alpine     caddy validate --config /etc/caddy/Caddyfile || exit 1
  cd ~/fastsocio-app && cp Caddyfile Caddyfile.bak-$(date +%s) && cp /tmp/Caddyfile.new Caddyfile
  docker compose up -d caddy'
```

**Rollback:** `cp Caddyfile.bak-<timestamp> Caddyfile && docker compose up -d caddy`.

### The weekly operational read

Four commands. Run them weekly, and FIRST whenever anything feels slow — every
one of them was, at some point during the performance audit, the thing that
turned a plausible wrong answer into a measured right one.

```bash
# 1. Is the app being frozen by the scheduler? Must stay 0.
cat /sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' fastsocio-app).scope/cpu.stat

# 2. Is the disk filling again? Target below 70%.
df -h / | tail -1 && docker system df

# 3. What is the database actually spending its time on?
#    (Management API, or psql. Read-only.)
#    select calls, round(total_exec_time::numeric/1000,0) total_s,
#           round(mean_exec_time::numeric,1) mean_ms,
#           left(regexp_replace(query,'\s+',' ','g'),90) q
#      from pg_stat_statements order by total_exec_time desc limit 15;

# 4. How much of that is Realtime rather than the product?
#    select round((sum(total_exec_time) filter (where query like '%wal->>%')
#                  / sum(total_exec_time) * 100)::numeric, 1) as realtime_pct
#      from pg_stat_statements;
```

**Known-unexplained, do not re-derive from scratch.** `SELECT name FROM
pg_timezone_names` runs about **84 times a day at ~644 ms each** — 1,073 s of
database CPU over 19.9 days, roughly 4.5% of the total. It is PostgREST
reloading its schema cache, and each reload also stalls PostgREST briefly.
Three explanations have been checked and eliminated:

- the three `pg_cron` jobs contain no DDL (`sweep_event_reminders` and the two
  weekly snapshots are pure inserts), so `pgrst_ddl_watch` is not being fired
  by cron;
- applying four DDL statements by hand in one session moved the counter by
  ~20 in seven hours, i.e. the background rate, so DDL is not the driver;
- it is steady rather than bursty, so it does not track deploys.

Whatever it is sits on the Supabase side of the boundary. Worth a support
question rather than more guessing from here.

### Measurement 0b — image cache hit rate and delivered widths

`imgcache` logs the cache verdict per request (perf audit Phase 6). Before that
it logged nothing useful and the hit rate could only be guessed at.

```bash
docker logs fastsocio-imgcache --since 24h | grep -oE 'cache=[A-Z-]+' | sort | uniq -c | sort -rn
```

*Threshold:* HIT should dominate once the cache is warm. Expect a MISS-heavy
window right after any `imgcache` restart or purge — the cache is a named
volume, but a config change that alters `$img_fmt` or the cache key invalidates
it by definition.

Delivered widths, which is how you catch a `sizes` regression:

```bash
docker logs fastsocio-imgcache --since 24h | grep -oE 'rs:fit:[0-9]+' | sort | uniq -c | sort -rn
```

*Threshold:* no `rs:fit:1080` from current clients — `images.deviceSizes` is
capped at 828 in next.config.ts. Some 1080 traffic is normal for a few hours
after a deploy while clients on the previous bundle migrate; it should decay to
zero, and if it does not, a client is stuck on a stale service-worker page.

**Do not measure the hit rate with `curl` alone.** The cache key includes the
negotiated format, so `curl -H "Accept: image/webp"` addresses a different
entry than a browser sending `image/avif` — a MISS from curl says nothing about
what browsers get. The `X-Img-Cache` response header is still the right tool
for checking one specific URL.

### Measurements — run these against the JSON access log

Everything below reads `docker compose logs caddy`; nothing writes. Set the
window with `--since` (e.g. `1h`, `24h`). The shared prelude:

```bash
L() { docker compose logs --since "${1:-1h}" caddy | grep -o '{.*}' | jq -c 'select(.duration)'; }
```

**1. Latency p50 / p95 / p99, plus the tail counts.** The console format could
not produce this at all — there was no latency field.

```bash
L 24h | jq -s 'sort_by(.duration) |
  {n: length,
   p50: .[(length*0.50|floor)].duration,
   p95: .[(length*0.95|floor)].duration,
   p99: .[(length*0.99|floor)].duration,
   over_1s: (map(select(.duration>1))|length),
   over_3s: (map(select(.duration>3))|length)}'
```

*Thresholds:* p95 < 1.2s, `over_3s` = 0.

**2. Per-route p95** — finds which route owns the tail.

```bash
L 24h | jq -s 'group_by(.request.uri | split("?")[0]) |
  map({route: .[0].request.uri | split("?")[0], n: length,
       p95: (sort_by(.duration) | .[(length*0.95|floor)].duration)}) |
  sort_by(-.p95) | .[:15]'
```

**3. RSC / prefetch share** — the number the prefetch work targets.

```bash
L 24h | jq -s '{total: length,
  rsc: (map(select(.request.headers.Rsc)) | length),
  prefetch: (map(select(.request.headers["Next-Router-Prefetch"])) | length)} |
  . + {rsc_pct: (.rsc*100/.total|floor), prefetch_pct: (.prefetch*100/.total|floor)}'
```

*Threshold:* `rsc_pct` < 35 (was 50.7).

**4. 404s on build assets** — must be zero once deployment ids and static
retention are live. A non-zero count means a client is stranded on a build whose
chunks are gone.

```bash
L 24h | jq -s 'map(select(.status==404 and (.request.uri|startswith("/_next/static")))) |
  {count: length, sample: (.[0:5] | map(.request.uri))}'
```

*Threshold:* 0.

**5. Missing Server Actions and E592.** Both are application errors, so they come
from the app container, not Caddy:

```bash
# Server Action version skew — expect 0 after deployment ids
docker compose logs --since 24h app | grep -c "Failed to find Server Action"

# E592 PPR invariant — expect 0 after the dynamic-route shell fix
docker compose logs --since 24h app | grep -c "postponed state should not be provided"

# 5xx from the app, by status
L 24h | jq -s 'map(select(.status>=500)) | group_by(.status) |
  map({status: .[0].status, n: length})'
```

*Thresholds:* Server Actions 0, E592 0.

**6. 502s** — Caddy could not reach the app. A burst means a worker died; check
`[cluster] worker … restarting` in the app log.

```bash
L 24h | jq -s 'map(select(.status==502)) | length'
docker compose logs --since 24h app | grep -c "\[cluster\] worker"
```

*Threshold:* 502s in single digits per day; investigate any cluster restarts.

**7. Image cache hit rate** (imgcache adds `X-Img-Cache`):

```bash
L 24h | jq -sr 'map(select(.request.uri|startswith("/img/"))) |
  group_by(.resp_headers["X-Img-Cache"][0]) | map("\(.[0].resp_headers["X-Img-Cache"][0]): \(length)") | .[]'
```

*Threshold:* HIT > 90%.

### After writes are unfrozen — rolling back to Tokyo is NOT recommended

Once Frankfurt has taken real writes, those rows exist nowhere else. Tokyo is a
frozen snapshot from the cutover moment and has no knowledge of them.

**Do not roll back to Tokyo unless a safe data-sync strategy exists.** There is
no Frankfurt → Tokyo script, and writing one during an incident is how data gets
destroyed. In order of preference:

1. **Fix forward.** The stack is verified end to end; nearly every fault is
   faster to repair than to reverse. The app image rolls back independently
   (below) without touching data at all.
2. **Serve a maintenance page** while fixing, so no further divergence
   accumulates: set `app_settings.maintenance.enabled = true` on Frankfurt.
3. **Only with an explicit, reviewed sync plan**: quantify the divergence first
   — `node scripts/sync-frankfurt-data.mjs` (dry run) shows exactly which tables
   and how many rows differ — then decide deliberately, not under pressure.

The app-level rollback above is always available and is usually the right lever:
it reverts code, not data.

---

## Post-cutover monitoring (first 24h)

- Sentry error rate — compare against the pre-cutover baseline
- `docker compose logs -f app` for 5xx bursts
- `docker stats` — app is capped at 2G/2 CPU, imgproxy at 512M/1 CPU
- Confirm the three `pg_cron` jobs actually fire on Frankfurt:
  ```sql
  select jobname, status, start_time from cron.job_run_details order by start_time desc limit 10;
  ```
  `event-reminder-sweep` runs every 15 minutes, so it is the fastest signal.
- Watch for magic-link complaints — the clearest symptom of an auth-config miss

---

## Cleanup — do NOT run until the new stack has been stable for several days

Listed for completeness. Every item requires explicit approval; none is part of
the cutover.

- Remove the `169-58-149-230.sslip.io` site block from the Caddyfile
- Remove the sslip.io origin from `serverActions.allowedOrigins` in
  `next.config.ts` and from the Supabase `uri_allow_list`
- Remove the Vercel-specific entries (`fast-socio.vercel.app`, the preview
  wildcard) from `uri_allow_list`
- Raise the DNS TTL from 300 to something normal (3600+)
- Remove `@vercel/analytics` and `@vercel/speed-insights`
- **Only after all of the above, and a deliberate decision:** pause the Vercel
  project, retire the Tokyo Supabase project, and remove the objects from
  Supabase Storage. Nothing here is reversible; keep them for weeks, not days.
- Stop the now-obsolete self-hosted Supabase stack on the VPS (~1.75 GiB)
