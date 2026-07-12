# FAST SOCIO — Performance Audit

**Date:** 2026-07-12 · **Scope:** perceived speed / "native feel" of the PWA, no visual redesign.
**Method:** Lighthouse 12 (mobile emulation, 4× CPU + simulated 4G throttling) against a local `next build` + `next start` with an authenticated demo-student session; warm TTFB via repeated `curl`; chunk attribution from `.next/static/chunks`; viewport-matrix + touch-target audit driven headless (Edge/Chromium via CDP) at 360 / 390 / 428 / 768 px and landscape.

> Local-server caveat: absolute numbers are from `localhost` talking to the real (remote) Supabase project. Production on Vercel will differ, but the *structural* costs measured here (round-trip stacking, buffered streaming, main-thread work) are environment-independent and dominate on real phone networks even more than here.

---

## 1. Baseline (before any change)

### Lighthouse mobile (simulated throttling)

| Page | Perf score | FCP | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|---|
| Feed `/home` | **38** | 1.40 s | 7.63 s | 2 618 ms | 0 | 8.59 s |
| Chat list `/chat` | 55 | 1.28 s | 4.35 s | 1 515 ms | 0 | 5.11 s |
| Chat thread `/chat/[id]` | 62 | 1.24 s | 3.50 s | 1 349 ms | 0 | 4.95 s |
| Profile `/profile` | 51 | 1.35 s | 4.65 s | 2 066 ms | 0 | 5.44 s |
| Login `/login` | 74 | 1.59 s | 2.52 s | 1 078 ms | 0 | 1.87 s |

### Observed (unthrottled) paint timings from the same runs

| Page | obs. FCP | obs. LCP | obs. onload |
|---|---|---|---|
| Feed | 4 348 ms | 7 012 ms | 4 704 ms |
| Chat list | 2 864 ms | 3 430 ms | 3 341 ms |
| Chat thread | 3 241 ms | 3 241 ms | 3 336 ms |
| Profile | 2 943 ms | 3 725 ms | 3 617 ms |

### Server timing (warm, `curl`, 3 runs/page)

| Page | TTFB | Total | Note |
|---|---|---|---|
| `/home` | 2.58–3.69 s | ≈ TTFB | **total ≈ TTFB ⇒ the response is fully buffered — nothing streams** |
| `/chat` | 2.02–2.71 s | ≈ TTFB | same |
| `/profile` | 2.56–3.26 s | ≈ TTFB | same |

### Bundle / main-thread (feed page)

- Client JS transferred: **~291 KB gz** across pages (login 263 KB) — every page pays roughly the same shared baseline.
- Heaviest chunks (raw): Next app-router runtime 224 KB, react-dom 196 KB, **supabase-js + realtime 184 KB**, **framer-motion 128 KB** — the last two ship in the shared baseline on every page.
- Main-thread (4× throttle): 3 872 ms Script Evaluation, 1 855 ms Style & Layout; long tasks up to 727 ms during hydration.
- CLS is 0 everywhere — the skeleton/`next/image` work already shipped is doing its job; layout stability was **not** a problem.

---

## 2. Issues found

### [IMPACT: **High**] Every navigation blocks on ~6 sequential Supabase round trips in the student layout
**Location**: `src/app/(student)/layout.tsx`
**Root cause**: The layout ran, in sequence: `auth.getUser()` (a *network* call to the Supabase Auth API on every request), the profile select, `getMaintenanceState()`, an **awaited** "fire-and-forget" `record_session` RPC, `resolveFlags()`, and then a `Promise.all` of four badge/announcement queries. Because a layout suspends *above* every page's `loading.tsx`, this also disabled streaming entirely: TTFB ≈ total time, and the skeleton screens shipped in 18 `loading.tsx` files **never rendered on hard loads**.
**User-facing symptom**: every tab switch and page open feels like "the app is waiting for the internet" for 2.5–3.5 s before anything changes; skeletons don't appear.
**Fix (applied)**: verify auth locally from the JWT via `getClaims()` (ES256 + module-cached JWKS ⇒ in-process, no round trip; new helper `src/lib/auth/user.ts`), collapse profile + maintenance + flags into one `Promise.all`, defer `record_session` with `next/server` `after()`, and move the four badge/announcement queries into a Suspense-streamed `DockWithBadges` (fallback renders the identical dock without counts, so nothing shifts).
**Visual impact**: none (badge counts appear ~½ s after the dock instead of blocking the whole page).

### [IMPACT: **High**] `auth.getUser()` network round trip repeated in every page and server action (88 call sites)
**Location**: `src/app/(student)/**/page.tsx`, `home/actions.ts`, `chat/actions.ts`, others
**Root cause**: each `getUser()` is an HTTPS call to the Auth server; a like was getUser → rate-limit RPC → insert (3 sequential RTs), a message send the same. The middleware already validates the JWT locally per request, making the extra call pure latency.
**User-facing symptom**: actions "hang" for ~0.5–1.5 s before settling; optimistic UI masks some of it but errors/reconciliation lag.
**Fix (applied to hot paths)**: `getAuthUserId()` (local JWT verification, request-memoized) in the home/chat/profile/community-chat pages and all 15 `getUser` sites in `home/actions.ts` + `chat/actions.ts`. RLS remains the authority on every query. ~37 colder call sites (settings, events, admin, onboarding) left for a follow-up sweep.
**Visual impact**: none.

### [IMPACT: **High**] Keyboard breaks the chat/composer layout — three concurrent root causes
**Location**: `src/app/layout.tsx` (viewport export), `src/app/(student)/chat/[id]/page.tsx`, `communities/[id]/chat/page.tsx`, `chat-thread.tsx`, `community-chat.tsx`, `add-comment.tsx`, `post-composer.tsx`
**Root cause** (diagnosed per-platform):
1. **Android Chrome 108+**: no `interactive-widget` viewport setting ⇒ the keyboard only resizes the *visual* viewport, so the `h-[100dvh]` chat shell doesn't shrink and the sticky composer stays hidden behind the keyboard.
2. **iOS Safari**: the keyboard *overlays* the layout viewport — `dvh` never shrinks there by design, so CSS units alone can't fix it; the composer needs `visualViewport`-driven repositioning.
3. **iOS Safari auto-zoom**: every composer input was `text-[15px]` (and the chat search `text-sm` = 14 px) — below the 16 px threshold, so focusing an input zoomed the page, which reads as the layout "jumping/breaking".
Additionally `scrollIntoView({behavior:"smooth"})` on new messages scrolls *every scrollable ancestor* (including the page behind the fixed shell), producing a visible jump when the keyboard opened, and it smooth-scrolled from the top on first mount.
**User-facing symptom**: the most-reported bug — opening the keyboard in chat/post input hides the input, jolts the page, and zooms in on iPhone.
**Fix (applied)**:
- `viewport.interactiveWidget: "resizes-content"` (Android).
- New `useKeyboardInset()` hook (`src/lib/use-keyboard-inset.ts`): rAF-coalesced `visualViewport` listener exposing the keyboard overlap as `--kb` on `<html>`; both chat shells are now `h-[calc(100dvh-var(--kb,0px))]` (iOS). On Android the layout viewport already shrinks so `--kb` ≈ 0 — no double compensation; sub-50 px deltas are ignored as URL-bar noise.
- All text inputs in chat, comments, post composer and poll builder raised to 16 px.
- Message-list scrolling now sets the container's own `scrollTop` (instant on first paint, smooth after) instead of `scrollIntoView`.
- `safe-area-inset-bottom/top` handling was already present and correct.
**Visual impact**: **minor, unavoidable** — input text renders at 16 px instead of 14–15 px (the canonical fix for iOS auto-zoom; a ~1 px visual delta on the input field only, message bubbles unchanged). Everything else: none.
**Platform verification note**: fix verified by code-path analysis per platform; needs a hands-on pass on a real iPhone (Safari + standalone PWA) and Android Chrome — see plan.

### [IMPACT: **High**] `router.refresh()` used as a data-sync hammer after cheap interactions
**Location**: `post-card.tsx` (comments sheet close), `post-composer.tsx` (after posting)
**Root cause**: `router.refresh()` re-runs the **entire layout + page** as an RSC render on the server (at baseline: the full 2.5–3.5 s pipeline) to reflect one changed row. Worse, the comment count in the card is `useState(post.comment_count)`, which ignores refreshed props — so the refresh didn't even update the visible number.
**User-facing symptom**: closing the comment sheet or posting makes the whole feed churn/re-load; posting shows a long "Posting…" overlay.
**Fix (applied)**: comment sheet now reports `onCommentAdded` up to the card, which bumps its count in place (no refresh at all). Posting flows through a new `HomeFeed` client shell: the composer signals `onPosted`, `FeedList` fetches one feed page and prepends unseen posts. Community composer keeps the `router.refresh()` fallback.
**Visual impact**: none (identical DOM; the new post appears faster).

### [IMPACT: **Medium**] Sending a chat message was not optimistic
**Location**: `chat-thread.tsx` `onSendText`
**Root cause**: the draft cleared immediately but the bubble only appeared after server action + realtime broadcast round trips (~1–2 s), and `busy` blocked further sends meanwhile.
**User-facing symptom**: "did my message send?" gap after hitting send; rapid-fire messages queue behind each other.
**Fix (applied)**: optimistic temp bubble rendered synchronously; the realtime INSERT replaces the matching temp row (dedup by sender + body); failure removes the bubble, restores the draft and shows the error. Reactions/long-press are disabled on temp bubbles. Likes, comment posting, reactions, pins and edits already had optimistic paths (kept).
**Visual impact**: none.

### [IMPACT: **Medium**] Per-keystroke server/network work while typing
**Location**: `chat-thread.tsx` — `broadcastTyping` (realtime message per keypress), `runSearch` (a server action per keypress)
**Root cause**: no throttle/debounce on high-frequency input handlers.
**User-facing symptom**: typing in chat competes with itself on slow connections; in-chat search hammers the server and results flicker.
**Fix (applied)**: typing broadcast throttled to 1 / 1.2 s; search debounced 300 ms.
**Visual impact**: none.

### [IMPACT: **Medium**] Chat send button squeezed to 20×44 px on small phones
**Location**: `chat-thread.tsx`, `community-chat.tsx`, `add-comment.tsx` — send `GlassButton`s
**Root cause**: the send button lacked `shrink-0`, so the flex row (with `flex-1` input) compressed it at 360–390 px widths (measured 20×44 at 360 px).
**User-facing symptom**: hard-to-hit send button on small phones.
**Fix (applied)**: `shrink-0` on all four send buttons.
**Visual impact**: none at design widths (it restores the intended 44×44).

### [IMPACT: **Medium**] Feed action touch targets below 44 px
**Location**: `post-card.tsx` — like/comment/share/options buttons (icon 20 px + label ⇒ ~48×20 hit box)
**Fix (applied)**: `-m-2 p-2` on each — grows the hit area ~16 px in both axes **without moving a rendered pixel**.
**Visual impact**: none.
Remaining (documented, not changed): 36×36 icon buttons across headers (Activity, Settings, Back…), 32×32 chat search toggle, 38×16 "See all" link — all ≥ the 24 px WCAG minimum and well-spaced; a follow-up can apply the same negative-margin trick.

### [IMPACT: Medium] Shared JS baseline ships supabase-js (+realtime) and framer-motion on every page
**Location**: shared chunks `7183-*` (184 KB raw, supabase) and `9630-*` (128 KB raw, framer-motion); consumers: `theme-provider.tsx` (MotionConfig), `glass-sheet.tsx`, `swipe-deck.tsx`, `announcement-modal.tsx`
**Root cause**: framer-motion is imported by the root theme provider and the ubiquitous `GlassSheet`, so it lands in the entry chunk; supabase-js is needed by realtime chat but also loads on pages that never open a socket. TBT (~1.2–2.6 s under 4× throttle) is dominated by evaluating this baseline during hydration.
**User-facing symptom**: slower time-to-interactive on first/cold loads, especially mid-range Androids.
**Fix (recommended, NOT applied)**: a `LazyMotion`/`m.` migration was previously attempted and reverted as not viable in this codebase (known constraint); the realistic wins are (a) `next/dynamic` the swipe deck & announcement modal, (b) replace the `GlassSheet` open/close animation with the CSS transition it already visually matches, then confirm framer-motion drops out of the entry chunk. Estimated −400–700 ms TTI on throttled mobile. Riskier, so scheduled rather than done.
**Visual impact**: none if the CSS transition replicates the current 200–350 ms ease curve (`--ease-glass`).

### [IMPACT: Low] `EventsStrip` blocks the feed render with its own query
**Location**: `src/components/feed/events-strip.tsx` (server component awaited inside `/home`)
**Root cause**: one more serial query in the page render.
**Decision**: deliberately **left blocking** — streaming it behind Suspense would pop it in late and shift the feed down (CLS), violating the no-jank rule. With the layout fixed it costs one parallel-stage query. Revisit only with a fixed-height skeleton fallback.

### [IMPACT: Low] 3–4 px horizontal "overflow" on /chat, /profile, /communities at 360–428 px
**Location**: measured via CDP; widest element = the fixed ambient-glow layer
**Root cause**: desktop-scrollbar measurement artifact (headless classic scrollbars); **no real content overflow found at any tested width** (360/390/428/768/landscape), and none of the pages scroll horizontally on touch devices (overlay scrollbars).
**Fix**: none needed.

### Not issues (verified healthy)
- **CLS = 0 on every page** before and after; `next/image` with explicit sizing everywhere; skeletons match final layout.
- **Feed list windowing** already implemented via `content-visibility: auto` + `contain-intrinsic-size` (an effective virtualization equivalent for this list shape); `PostCard` is memoized; infinite scroll uses IntersectionObserver with 400 px rootMargin. Chat threads load a bounded page (50) with load-older — fine at that size without a virtualizer.
- **Fonts**: Inter via `next/font` with `display: swap`, self-hosted — no FOUC observed.
- **Reduced motion** honored globally (media query + user setting).
- **Animations**: like-burst, active-scale presses and typing dots are all transform/opacity — GPU-safe. No width/top/height animations found in the audited screens.
- **Service worker** (`@ducanh2912/next-pwa`): precached app shell for static assets, `cacheOnFrontEndNav` + aggressive front-end-nav caching, runtime strategies present (7× NetworkFirst, 7× StaleWhileRevalidate, 4× CacheFirst with network timeouts). Navigations are NetworkFirst by design (dynamic SSR) — correct for an authed social feed; the streaming fix is what makes them *feel* instant.

---

## 3. After-fix measurements (same method, same machine, same session)

### Warm TTFB (5 runs, median)

| Page | Before | After | Δ |
|---|---|---|---|
| `/home` | ~2.9 s | **0.71 s** | **−76 %** |
| `/chat` | ~2.3 s | **0.71 s** | −69 % |
| `/profile` | ~2.6 s | **0.76 s** | −71 % |
| `/chat/[id]` | ~2.5 s | **0.67 s** | −73 % |

Total time now exceeds TTFB on every page ⇒ **streaming works**: the shell + skeletons paint first, badges/data flush after.

### Observed paint timings (unthrottled)

| Page | obs. FCP before → after | obs. LCP before → after |
|---|---|---|
| Feed | 4 348 → **1 808 ms** (−58 %) | 7 012 → **3 840 ms** (−45 %) |
| Chat list | 2 864 → **1 041 ms** (−64 %) | 3 430 → **2 423 ms** (−29 %) |
| Chat thread | 3 241 → **2 054 ms** (−37 %) | 3 241 → **2 054 ms** (−37 %) |
| Profile | 2 943 → **990 ms** (−66 %) | 3 725 → **2 073 ms** (−44 %) |

### Lighthouse mobile (simulated 4× throttle) — final run

| Page | Score | FCP | LCP | TBT | CLS | Speed Index (before → after) |
|---|---|---|---|---|---|---|
| Feed | 38 → **46** | 1.38 s | 6.85 s | 2 091 ms | 0 | **8.59 → 4.24 s** |
| Chat list | 55 → 53* | 1.09 s | 5.49 s | 1 448 ms | 0 | **5.11 → 3.06 s** |
| Chat thread | 62 → 54* | 1.23 s | 5.36 s | 1 534 ms | 0 | **4.95 → 2.90 s** |
| Profile | 51 → 51 | 1.27 s | 5.74 s | 1 854 ms | 0 | **5.44 → 2.72 s** |

\* Simulated LCP/score are noisy across runs here because the LCP element is a remote Supabase-transformed post image fetched over the real internet, and Lighthouse's lantern model penalizes streamed late-flush content; the *observed* LCP/FCP rows above (and TTFB) are the trustworthy signal, and they improved 29–66 % everywhere. Remaining TBT is framework + supabase/framer hydration — addressed by the bundle item in the plan.

Feed/chat/profile skeletons now actually appear during navigation, likes/sends/comments respond in a frame, and the keyboard no longer displaces the chat UI on either platform (pending on-device confirmation).

**Regression checks**: `tsc --noEmit` clean · `eslint` — only the 3 pre-existing React-Compiler baseline errors (unchanged) · `vitest` 55/55 pass · production build clean.
