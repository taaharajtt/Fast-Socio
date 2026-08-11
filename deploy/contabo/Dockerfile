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
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
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

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# standalone emits its own server.js; `next start` is not used (and is not even
# installed in this stage). This is the documented way to run standalone output.
CMD ["node", "server.js"]
