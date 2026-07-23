# FAST SOCIO — RES / Lighthouse Audit (2026-07-23)

Scope: raise the low RES/Lighthouse scores on the primary pages (`/home`,
`/discover`, `/help`, `/events`, `/map`, `/chat`, `/profile`, `/login`) without
changing features or visual design. This pass **builds on** the prior
`PERFORMANCE_AUDIT.md` (TTFB 3s→0.7s, streaming layout, keyboard fixes) — those
wins are already live and were **not** re-done. This pass targets the remaining
score killer those audits explicitly deferred: the **shared client JS baseline**.

Method: `next build --webpack` (Next 16.2.9), chunk attribution from
`.next/build-manifest.json` `rootMainFiles` (the JS loaded on *every* page) and
`.next/static/chunks`, runtime verification via the production server
(`next start`) + browser (console/network) on `/login`.

---

## 1. Baseline — the actual score killers

### Shared client JS (loaded on EVERY page, before any page-specific code)

| Chunk | Library | Raw | In every-page path? |
|---|---|---|---|
| `7375-*` | **@sentry/nextjs client** | **474 KB** | ✅ `rootMainFiles` |
| `4bd1b696-*` | react-dom | 196 KB | ✅ `rootMainFiles` |
| `polyfills-*` | legacy polyfills | 110 KB | ✅ |
| `6611-*` | framer-motion | 125 KB | ✅ (via root `MotionConfig`) |
| `7183-*` | supabase-js + realtime | 181 KB | on any page with a browser supabase client (incl. `/login`) |
| `framework-*` | react/next runtime | 185 KB | ✅ |

**Headline finding:** the Sentry client SDK (**474 KB raw ≈ 140 KB gz**) was the
single largest chunk in the app **and it shipped on every page** via
`instrumentation-client.ts`. It was the dominant Total-Blocking-Time and
"reduce unused JavaScript" cost across the whole app — and it carried **Session
Replay** code (never used) and **browser performance tracing** (marginal value
for a small campus PWA) that were pure dead weight.

### Perf context inherited from `PERFORMANCE_AUDIT.md` (still valid)
- Lighthouse mobile (4× throttle): Feed **46**, Chat list 53, Chat thread 54,
  Profile 51, Login 74. TBT ~1.5–2.6 s dominated by hydration of the shared JS
  baseline above. CLS **0** everywhere (not a problem). LCP on media pages is a
  remote Supabase-transformed image over the real internet.
- Warm TTFB already ~0.7 s on hot pages (`/home /chat /profile`) after the
  layout/streaming fix. **Cold pages still paid an extra `auth.getUser()` Auth
  API round trip** (Phase B sweep was never finished).

### Not problems (verified healthy — left alone)
- **PWA/installability**: `manifest.ts` has name, short_name, description,
  `standalone`, portrait, theme/background color, and a full icon set (192/512
  **any** + **maskable**) + `apple-touch-icon.png`. Apple splash screens present.
  Service worker (`@ducanh2912/next-pwa`) registers; navigations NetworkFirst.
- **SEO**: root `metadata` has title template + description + manifest + icons;
  `viewport` allows pinch-zoom (WCAG 1.4.4). `robots.ts` **intentionally**
  disallows all — this is a private, auth-gated app (VULN-14). `/login`, `/help`,
  `/map` set their own titles/descriptions.
- **CLS = 0**, `next/image` custom Supabase loader (`image-loader.ts`) already
  serves WebP/AVIF at exact widths, fonts via `next/font` `display:swap`.
- **Accessibility**: icon buttons across feed/discover/help/map/chat already
  carry `aria-label`s; inputs have `aria-label`/labels; touch targets fixed in
  the prior pass. No new violations found in this sweep.

---

## 2. Fixes applied (highest-impact first, low-risk only)

### F1 — Slim the Sentry client bundle (every page) ✅ **biggest win**
`next.config.ts` → `withSentryConfig(..., { bundleSizeOptimizations })`:
tree-shake out **Session Replay** (never initialised — we deliberately don't
record the DOM of an app full of DMs), **browser performance tracing** (kept
server-side; the browser `BrowserTracing` instrumentation was the biggest slice
and buys little here), and debug statements. **Error reporting — the reason
Sentry is here — is unchanged.**

- Sentry chunk **474 KB → 316 KB raw** (**−158 KB, −33%**); **~140 KB → 94 KB gz**.
- Verified in the built chunk: `tracing` hits **0**, `replay` hits **0**, core
  Sentry error SDK intact.
- Reversible in one line (`excludeTracing: false`) if client perf traces are
  wanted back.

### F2 — Finish the `auth.getUser()` → local-JWT sweep on major pages ✅
Replaced the per-request Auth-API round trip with the established local-JWT
helper `getAuthUserId()` (already used by `/home /chat /profile` and RLS-safe)
on the remaining audited pages: `/events`, `/leaderboard`, `/activity`,
`/communities`, `/post/[id]`, `/profile/[id]`. Removes one network round trip
from each cold page's TTFB (feeds FCP/LCP). No behaviour change — RLS remains the
authority; the `(student)` layout has already gated the route.

### F3 — Scope framer-motion out of the every-page bundle ✅
framer-motion (125 KB) was loaded on **every** page — including public/auth
pages that render no motion — because the root `ThemeProvider` wrapped everything
in `<MotionConfig reducedMotion="user">`. Two changes:
1. Moved the reduced-motion policy out of the root provider into a single-source
   `<MotionReduced>` wrapper (`src/components/ui/motion-reduced.tsx`) applied
   inside the only three framer consumers (`glass-sheet`, `swipe-deck`,
   `announcement-modal`). **Reduced-motion (WCAG 2.3.3) behaviour is unchanged**
   wherever framer renders — the same `MotionConfig` value, just co-located.
2. Found the real reason framer still loaded on `/login`: the public/auth pages
   imported UI atoms from the **`@/components/ui` barrel**, which re-exports
   `GlassSheet` (→ framer), and the barrel isn't tree-shaken here. Pointed those
   imports (`GlassButton`/`GlassInput`/`GlassCard`) at their source files on
   `login`, `signup`, `forgot-password`, `set-password`, `banned`, `maintenance`,
   `onboarding`.

Result (verified in the browser via the network panel): **`/login` (and the
other public/auth pages) no longer download the 127 KB framer chunk** — it now
loads only on pages that actually render motion. Student pages still carry framer
via layout-level `InstallPrompt`/`AnnouncementModal` (see TODO #2).

---

## 3. After — measurements

### Shared every-page JS (`rootMainFiles`)

| | Before | After | Δ |
|---|---|---|---|
| Sentry chunk (raw) | 474 KB | **316 KB** | **−158 KB (−33%)** |
| Sentry chunk (gz) | ~140 KB | **94 KB** | ~**−46 KB** |
| `rootMainFiles` total (raw, excl. polyfills) | ~680 KB | **521 KB** | **−159 KB** |

This −159 KB comes off **the initial download + parse of every single page**, so
it lowers TBT / "unused JS" uniformly across `/home /discover /help /events /map
/chat /profile /login`.

### framer-motion removed from public/auth pages (F3)

| Page | framer chunk before | after |
|---|---|---|
| `/login`, `/signup`, `/forgot-password`, `/set-password` | 127 KB (~41 KB gz) | **0** |
| `/banned`, `/maintenance`, `/onboarding` | 127 KB | **0** |

On top of F1, `/login` now ships **~285 KB less raw JS** than at baseline
(Sentry −158 KB + framer −127 KB). Student pages get the Sentry win now and the
framer win once TODO #2 (layout-level dynamic import) lands.

### Regression checks
- `npm run build` — clean (TypeScript passes in 24 s).
- `npm run test` — **179/179 pass** (20 files).
- `npm run lint` — 8 errors, **all pre-existing React-Compiler baseline** in
  files this pass did not touch (`glass-sheet.tsx`, `login/page.tsx`,
  `admin/aura/page.tsx`, `events-browser.tsx`, `activity-list.tsx`). **No new
  lint failures introduced.**
- Runtime: prod `next start` → `/login` HTTP 200, TTFB 0.66 s, **no console
  errors**, all chunks 200, Sentry initialises fine with tracing tree-shaken.

---

## 4. Remaining bottlenecks / TODOs (deferred — higher risk or needs tooling)

1. **`/map` `public/map.png` is 6.2 MB.** It's the /map LCP and is a deliberate
   raw `<img>` for exact-pixel sharpness (per product constraint) and is **not**
   preloaded on other pages (it lives only in the `/map` client island), so it
   doesn't hurt other routes. Win available: export a visually-lossless WebP at
   high quality (~1/3 size) — needs image tooling and a quality sign-off, so left
   as a TODO rather than degrading the source.
2. **framer-motion still on every *student* page.** F3 removed it from public/auth
   pages, but student pages still load the 127 KB framer chunk because the
   `(student)` layout statically renders `InstallPrompt` (uses `GlassSheet`) and
   `AnnouncementModal` — both framer. To drop framer from student pages that have
   no visible motion surface, `next/dynamic` those two layout components and only
   mount `AnnouncementModal` when `announcements.length > 0`. Medium risk
   (`ssr:false` isn't allowed from the async server layout, so this needs a small
   client wrapper); deferred.
3. **supabase-js + realtime (181 KB) on `/login`** and other auth-client pages.
   `@supabase/supabase-js` always bundles the realtime client even when only
   `auth` is used; there is no supported flag to exclude it. Needs an upstream
   modular build to fix — documented, not actionable cleanly here.
4. **Sentry core still 316 KB.** Further wins would require lazy-loading the SDK
   off the critical path (risk: miss the earliest client errors) — deferred.
5. **Finish the `auth.getUser()` sweep** on the remaining ~27 colder call sites
   (settings/*, communities actions, events actions, onboarding). Mechanical,
   same pattern as F2.

---

## 5. Files changed
- `next.config.ts` — Sentry `bundleSizeOptimizations` (F1).
- `src/app/(student)/events/page.tsx`, `leaderboard/page.tsx`,
  `activity/page.tsx`, `communities/page.tsx`, `post/[id]/page.tsx`,
  `profile/[id]/page.tsx` — `getAuthUserId()` sweep (F2).
- `src/components/theme-provider.tsx` — drop root `MotionConfig` (F3).
- `src/components/ui/motion-reduced.tsx` — **new** single-source reduced-motion
  wrapper (F3).
- `src/components/ui/glass-sheet.tsx`, `discover/swipe-deck.tsx`,
  `notifications/announcement-modal.tsx` — self-scope `<MotionReduced>` (F3).
- `src/app/(auth)/login/page.tsx`, `signup/page.tsx`, `forgot-password/page.tsx`,
  `set-password/set-password-form.tsx`, `banned/page.tsx`, `maintenance/page.tsx`,
  `onboarding/wizard.tsx` — import UI atoms from source, not the framer-pulling
  barrel (F3).
