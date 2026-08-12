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

### 1. Freeze writes — TWO layers, both required

The freeze is what makes the final sync exact. Any row written to Tokyo after
the sync starts exists nowhere afterwards.

**Maintenance mode alone is NOT a write freeze.** `app_settings.maintenance`
only makes the student layout redirect to `/maintenance`
(`src/app/(student)/layout.tsx`). A tab that is already open can still invoke
Server Actions, and many writes run through `SECURITY DEFINER` RPCs that ignore
table grants entirely. It is a courtesy notice, not a guarantee.

**Layer 1 — user-facing notice (Tokyo):**

```bash
TOKEN=$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2- | tr -d '"\r')
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/skgphoupbwdexfevgcnn/database/query" \
  -d '{"query":"update app_settings set value = jsonb_build_object('"'"'enabled'"'"', true, '"'"'message'"'"', '"'"'FAST SOCIO is moving to a new home. Back in a few minutes.'"'"') where key = '"'"'maintenance'"'"'"}'
```

**Layer 2 — the actual freeze (Tokyo).** Make every PostgREST connection
read-only. `authenticator` is the login role PostgREST uses; a read-only
transaction blocks writes regardless of role, so this covers `SECURITY DEFINER`
RPCs too — which table-level `REVOKE` would not.

```bash
# FREEZE
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/skgphoupbwdexfevgcnn/database/query" \
  -d '{"query":"alter role authenticator set default_transaction_read_only = on"}'

# Existing pooled connections keep the old setting until recycled, so force it.
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/skgphoupbwdexfevgcnn/database/query" \
  -d '{"query":"select pg_terminate_backend(pid) from pg_stat_activity where usename = '"'"'authenticator'"'"' and pid <> pg_backend_pid()"}'
```

**Verify the freeze actually bit** before continuing — do not assume:

```bash
# Reads must still work; a write must fail with 'read-only transaction'.
curl -s "https://skgphoupbwdexfevgcnn.supabase.co/rest/v1/posts?select=id&limit=1" \
  -H "apikey: $TOKYO_ANON" -H "Authorization: Bearer $TOKYO_ANON" -o /dev/null -w "read  %{http_code}\n"
```

Then confirm in a browser on `fast-socio.vercel.app` that posting fails.

**UNFREEZE (rollback, or after a decision to abort):**

```bash
curl -s -X POST … -d '{"query":"alter role authenticator reset default_transaction_read_only"}'
curl -s -X POST … -d '{"query":"select pg_terminate_backend(pid) from pg_stat_activity where usename = '"'"'authenticator'"'"' and pid <> pg_backend_pid()"}'
# and set app_settings.maintenance back to {"enabled": false, "message": ""}
```

Note the exact time the freeze went on. Tokyo is read-only from here until
either rollback or retirement — it is never written to again on the success
path, which is precisely what makes it a trustworthy rollback target.

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

### 10. Unfreeze

```bash
# Tokyo: lift maintenance notice only. Do NOT lift the read-only freeze —
# Tokyo must stay frozen so it remains a clean rollback snapshot.
# Frankfurt was never frozen; the VPS is already serving writes to it.
```

Set `app_settings.maintenance` to `{"enabled": false, "message": ""}` **on
Frankfurt** (the live database from now on). Leave Tokyo read-only.

**From this moment, Frankfurt is the source of truth and rollback to Tokyo
means losing every row written since.**

---

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
