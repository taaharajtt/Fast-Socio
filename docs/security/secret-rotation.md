# Secret rotation

Secret names below are taken directly from `.env.example` (tracked, contains
no values — safe to reference). Do not read `.env.local` or any
`.env.local.bak-*` file to compile this list; `.env.example` alone is
sufficient and was used here.

## Inventory, what each grants, and blast radius

| Variable | Grants | Blast radius if leaked |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Public by design (shipped to the browser). Not a secret. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon-role Postgres access, subject to RLS | Public by design. Safe only as long as RLS policies are correct — this key alone doesn't bypass RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses RLS entirely.** Full read/write on every table. | Total database compromise — read/write/delete any row, any table, any user's data. Highest-value secret in this project. Server-only; must never reach the client bundle. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push public key | Public by design. Not a secret. |
| `VAPID_PRIVATE_KEY` | Signs Web Push messages | Attacker could send push notifications to every subscribed user's device (spam/phishing vector), impersonating the app. |
| `NEXT_PUBLIC_SENTRY_DSN` | Where client/server errors are reported | Public by design (DSNs are meant to be embedded in clients). Worst case with a leaked DSN is quota-abuse (someone spams your Sentry project with fake events), not data exposure. |
| `SENTRY_AUTH_TOKEN` | Uploads source maps / manages the Sentry project at build time | Could let an attacker read unminified source maps for the app, or tamper with the Sentry project (delete issues, change settings) depending on token scope. |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Identifiers, not credentials | Low risk alone; only useful paired with a valid token. |
| `CONTABO_S3_ACCESS_KEY_ID` / `CONTABO_S3_SECRET_ACCESS_KEY` | Full S3 API access to the `fast-socio` bucket (per `src/lib/s3/sign.ts` usage — presigning is done with these) | Read/write/delete on every object in the bucket: avatars, post media, and **private chat-media attachments**. This is the object-storage equivalent of the service role key. |
| `NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL` | Public base URL for reading public prefixes | Public by design. Not a secret. |
| `NEXT_PUBLIC_IMGPROXY_URL` | imgproxy base URL | Public by design. Not a secret. |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin, used in redirect URLs | Public by design. Not a secret — but if this is wrong/hijacked, auth redirect URLs (magic links, password resets) could point somewhere attacker-controlled. Treat changes to this value as security-relevant even though it isn't secret. |

The real secrets to protect (server-only, no `NEXT_PUBLIC_` prefix, high
blast radius) are: `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`,
`SENTRY_AUTH_TOKEN`, `CONTABO_S3_ACCESS_KEY_ID`, `CONTABO_S3_SECRET_ACCESS_KEY`.

## Rotation order and steps

Rotate in this order when responding to a suspected leak — highest blast
radius first, since an attacker with the service role key can act while
you're still rotating other things:

1. **`SUPABASE_SERVICE_ROLE_KEY`**
   - Supabase Dashboard → Project Settings → API → reset/regenerate the
     service role key.
   - Immediately update the value in Vercel (Project Settings → Environment
     Variables) for all environments (Production/Preview/Development as
     applicable) and redeploy.
   - Old key stops working the moment it's regenerated — expect a brief
     outage window for any in-flight server code until the new key is
     deployed. Plan for a deploy immediately after rotation, not "later."

2. **`CONTABO_S3_ACCESS_KEY_ID` / `CONTABO_S3_SECRET_ACCESS_KEY`**
   - Contabo control panel → Object Storage → credentials → issue a new
     key pair, revoke the old one.
   - Update both values in Vercel env vars, redeploy.
   - Any presigned URLs already issued under the old key remain valid until
     their TTL expires (presign TTLs in this app are short — 300s for
     uploads per `presign/route.ts`, `CHAT_MEDIA_TTL_SECONDS` for chat
     downloads) — so exposure window for outstanding URLs is small, but the
     access key itself must still be revoked to stop new signing.

3. **`VAPID_PRIVATE_KEY`**
   - Regenerate with `node -e "console.log(require('web-push').generateVAPIDKeys())"`
     (same command documented in `.env.example`).
   - Update `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` together in
     Vercel — they're a matched pair.
   - Note: rotating this invalidates all existing push subscriptions (they
     were registered against the old public key) — users will need to
     re-subscribe. Not an emergency-only rotation; plan for the UX impact.

4. **`SENTRY_AUTH_TOKEN`**
   - Sentry → Settings → Auth Tokens → revoke the old token, create a new
     one scoped to the minimum needed (source map upload / release
     management).
   - Update in Vercel (used at build time, so also update CI if source maps
     are uploaded from a separate CI pipeline).

For all of the above: after rotating, confirm the old value truly stops
working (e.g., a request signed with the old S3 key should now fail) before
considering the incident closed.

## `.env.local.bak-*` files

These are local backup copies of the real env file and carry the same
secrets as `.env.local`. Verified in `.gitignore`:

```
# env files (can opt-in for committing if needed)
.env*
!.env.example
```

`.env*` covers `.env.local.bak-20260812-153806` and any similarly-named
backup — they are ignored by git the same as `.env.local` itself, with the
sole carve-out being `.env.example`. That said:

- **Delete them once they're no longer needed.** An ignored file is still a
  plaintext copy of production secrets sitting on disk; it doesn't need to be
  committed to be a liability if the machine itself is compromised or the
  directory is ever zipped/synced somewhere else.
- **Never `git add -f` one of these.** The `!.env.example` negation exists
  specifically so only the template gets committed — force-adding a `.bak`
  file defeats that intentionally.

## "Was it ever committed?" verification

Run these before assuming a secret is safe just because the file is
gitignored today — gitignore only prevents *future* commits, not past ones
made before the rule existed or via a force-add.

Check whether a specific path was ever committed, even if later removed:

```
git log --all --full-history -- .env.local
git log --all --full-history -- ".env.local.bak-*"
```

If either returns any commits, inspect them:

```
git log --all --full-history -p -- .env.local
```

Search the entire history's file contents for a specific known secret value
(useful if you suspect one exact key was pasted somewhere it shouldn't have
been — replace `SOME_KNOWN_FRAGMENT` with a distinctive substring of the
secret, never the full production value in a shared terminal):

```
git rev-list --all | xargs -I{} git grep -l "SOME_KNOWN_FRAGMENT" {}
```

If any of the above turn up a hit, treat the secret as compromised and
rotate it (per the steps above) regardless of whether the commit was later
removed — history rewriting (`git filter-repo`, BFG) only helps for repos
that haven't been cloned/forked/mirrored elsewhere, and this repo is public,
so assume any historically-committed secret is unrecoverable and must be
rotated rather than scrubbed.
