# Fast Socio — self-hosted production image (infrastructure migration, Phase 1).
#
# Node 24 LTS. Next 16.2.9 declares engines.node ">=20.9.0", but Node 20 is
# end-of-life, so 20 is a floor rather than a recommendation. 24 is the current
# LTS line and is what the repo is developed against locally (v24.18.0).
#
# Debian slim rather than Alpine: the old migration document specified
# node:20-alpine, but Alpine's musl libc has a track record of subtle breakage
# with Next's SWC native binaries and with sharp. This image is ~40 MB larger
# and removes a whole class of "works locally, segfaults in prod" failures.

# ---------- deps ----------
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` installs devDependencies too — the production build needs webpack,
# typescript and tailwind. None of it survives into the runtime stage.
RUN npm ci

# ---------- build ----------
FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they
# have to be present here, not just at runtime. All four are public by
# definition (the anon key is designed to be shipped to browsers; RLS is the
# actual boundary). Server-only secrets — SUPABASE_SERVICE_ROLE_KEY,
# VAPID_PRIVATE_KEY — are deliberately NOT build args: build args are recorded
# in the image history and would leak to anyone who can read the image.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
# These three must be present AT BUILD TIME, not just at runtime. They are
# inlined into client bundles, and NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL also
# feeds the CSP that next.config.ts emits. Passing it only at runtime produced
# a CSP with no storage host at all — which silently blocks every image and
# every upload in the browser while the server keeps answering 200.
ARG NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_IMGPROXY_URL
ARG NEXT_PUBLIC_SITE_URL
# Version-skew protection. Must be present AT BUILD TIME: next.config.ts reads
# it into `deploymentId`, which inlines the value into the client bundle and
# stamps it onto every static asset URL. Passing it only at runtime would leave
# the server advertising a deployment id that no client ever echoes back, so the
# mismatch could never be detected. Not a secret — it is a commit SHA, and it is
# already published to every browser in the page markup.
#
# Unset is a valid state: the build succeeds and skew protection is simply off,
# which is what a bare `docker build` outside compose does.
ARG NEXT_DEPLOYMENT_ID
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL=$NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL \
    NEXT_PUBLIC_IMGPROXY_URL=$NEXT_PUBLIC_IMGPROXY_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    DOCKER_BUILD=1

# DOCKER_BUILD=1 is what switches next.config.ts to `output: "standalone"`.
# Without it this build would produce a Vercel-shaped output and the runtime
# stage below would have nothing to copy.
#
# SENTRY_AUTH_TOKEN is intentionally absent: source-map upload is skipped and
# the build still succeeds (see the note in next.config.ts). Error reporting
# still works, stack traces are just unminified until Phase 2 wires CI.
RUN npm run build

# ---------- runtime ----------
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# curl is for the container healthcheck. Nothing else is added.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# Re-declared: a build ARG is scoped to ONE stage, so the builder's copy is not
# visible here. The runtime needs it only to name this build's retention marker
# in the shared static volume (see CMD), which is what lets the prune step keep
# "the last N builds" instead of guessing from file timestamps. Not a secret —
# it is a short commit SHA and is already published in every page's markup.
ARG NEXT_DEPLOYMENT_ID
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID

# Pre-create the shared-static mount point AS ROOT, owned by node.
#
# This is load-bearing and was missed the first time: Docker initialises an
# EMPTY named volume from the image's directory at the mount point, copying its
# ownership with it. With no /srv in the image the volume was created
# root:root, the container runs as node (uid 1000), and every mkdir/cp into it
# failed with EACCES — so the static-retention feature was completely inert
# while the app looked perfectly healthy, because each step is `|| true` and
# Caddy's pass_thru quietly served the assets from the app instead.
RUN mkdir -p /srv/_next/static/.builds && chown -R node:node /srv

# Run unprivileged. The node image ships a `node` user (uid 1000) already.
# A container escape is a much smaller problem when the process was never root.
USER node

# standalone bundles a minimal server + pruned node_modules, but does NOT copy
# public/ or .next/static — those must come across explicitly. public/ is copied
# from the BUILDER, not the source tree, because next-pwa generates sw.js and
# workbox-*.js into public/ during the build.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Copied from the SOURCE tree, not the builder: it is a plain runtime script and
# never takes part in the Next build. It sits next to the generated server.js
# because that is what it requires.
COPY --chown=node:node deploy/contabo/cluster.js ./cluster.js

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# standalone emits its own server.js; `next start` is not used (and is not even
# installed in this stage). This is the documented way to run standalone output.
# cluster.js is a thin supervisor around that same server.js — with
# WEB_CONCURRENCY unset or 1 it simply requires it in-process.
#
# The `cp` in front of it publishes THIS build's client assets into the shared
# static volume so Caddy can keep serving the PREVIOUS build's chunks after this
# container replaces it (perf audit 6.3 — see the /_next/static block in the
# Caddyfile). Chunks are content-hashed, so builds accumulate side by side and
# can never collide; pruning is a periodic chore, not a correctness concern.
#
# Every part of it is deliberately non-fatal. `|| true` means a missing mount,
# a read-only volume or a partial copy can never stop the app from booting —
# Caddy's `pass_thru` then just proxies those assets here as it does today. An
# app that refuses to start because a CACHE could not be warmed would be a far
# worse failure than the one this is preventing.
#
# `exec` matters: it replaces the shell so node becomes PID 1 and still receives
# the SIGTERM that cluster.js forwards to its workers for a graceful drain.
# The marker file is what makes retention countable. Plain `cp` (no -p) stamps
# every copied file with the CURRENT time, and chunks shared with the previous
# build are re-copied and so re-stamped on each deploy — so "files older than
# the Nth-newest marker" is precisely "files belonging to builds we no longer
# keep". Pruning by age alone (the earlier `-mtime +7`) was wrong: a quiet week
# with no deploys would have deleted the CURRENT build's assets, and a burst of
# five deploys in an hour would have retained none of the previous ones.
CMD ["sh", "-c", "mkdir -p /srv/_next/static/.builds 2>/dev/null || true; cp -r /app/.next/static/. /srv/_next/static/ 2>/dev/null || true; touch \"/srv/_next/static/.builds/${NEXT_DEPLOYMENT_ID:-unknown}\" 2>/dev/null || true; exec node cluster.js"]
