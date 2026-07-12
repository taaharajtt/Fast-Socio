# FAST SOCIO — Optimization Plan

Ordered by **felt improvement per unit of effort**, phased for a solo developer. Items marked ✅ were implemented and re-measured in this pass (see `PERFORMANCE_AUDIT.md` §3 for the actual before/after numbers — all deltas below are measured, not estimated).

---

## Phase A — Shipped in this pass (re-measured)

| # | Fix | Files | Measured result |
|---|---|---|---|
| ✅ A1 | Keyboard/viewport: `interactive-widget=resizes-content` (Android), `--kb` visualViewport inset + `calc(100dvh-var(--kb))` shells (iOS), 16 px inputs (iOS auto-zoom), container-scoped scrolling | `app/layout.tsx`, `lib/use-keyboard-inset.ts`, both chat shells, chat/comment/post composers | Root causes removed per platform; **needs a 10-min hands-on pass on a real iPhone + Android** (checklist below) |
| ✅ A2 | Student layout: local JWT auth, one parallel query stage, `after()` for session RPC, Suspense-streamed dock badges | `app/(student)/layout.tsx`, `lib/auth/user.ts` | TTFB **2.5–3.5 s → 0.65–0.75 s** on every page; streaming restored so the existing skeletons finally render |
| ✅ A3 | Local JWT verification in hot pages + all feed/chat server actions (15 sites) | home/chat/profile/community pages, `home/actions.ts`, `chat/actions.ts` | Part of A2's TTFB win; likes/sends settle ~300–600 ms faster |
| ✅ A4 | Kill `router.refresh()` for comments + posting; in-place count bump; targeted one-page feed refetch | `post-card.tsx`, `comments-sheet.tsx`, `comments-section.tsx`, `home-feed.tsx`, `feed-list.tsx`, `post-composer.tsx` | Sheet close is now free (was a full 2.5 s+ RSC re-render); new post appears via one query |
| ✅ A5 | Optimistic chat send with realtime reconciliation + rollback | `chat-thread.tsx` | Bubble renders in the same frame as Send |
| ✅ A6 | Throttle typing broadcast (1.2 s), debounce in-chat search (300 ms) | `chat-thread.tsx` | Eliminates per-keystroke network work |
| ✅ A7 | Touch targets: `shrink-0` on squeezed send buttons (was 20×44 @360 px); `-m-2 p-2` hit-area growth on feed actions | chat/comment composers, `post-card.tsx` | 44×44 restored, zero visual change |

**Net effect (measured):** observed FCP −37…−66 %, observed LCP −29…−45 %, Speed Index −40…−51 % across feed/chat/profile; CLS stays 0.

### On-device verification checklist for A1 (do once, ~10 min)
- iPhone (Safari tab + installed PWA): focus chat input → no zoom, composer rides above keyboard, header stays put, message list stays bottom-anchored; rotate while keyboard open.
- Android Chrome: same, plus confirm the dock/footer isn't doubled-compensated (composer should sit flush on the keyboard).
- Both: post-composer textarea and comment sheet input.

---

## Phase B — Quick wins, this week (low risk, ~½ day total)

1. **Sweep the remaining ~37 `auth.getUser()` call sites** (settings, events, communities actions, activity, onboarding) to `getAuthUserId()`. Mechanical — same pattern as A3. Re-measure: warm TTFB on `/events`, `/settings`, `/communities` should drop to the same ~0.7 s band.
2. **Header icon hit areas**: apply the `-m-2 p-2` trick to the 36×36 / 32×32 icon buttons (Activity, Settings, Back, chat search toggle) and the 38×16 "See all" link.
3. **Deploy-region check (Vercel)**: confirm the function region is colocated with the Supabase project region. Every remaining round trip is multiplied by this distance; it's a dashboard setting, not code. Measure prod TTFB on `fast-socio.vercel.app` before/after.

## Phase C — Medium effort, this month

4. **Trim framer-motion from the entry chunk** (audit §2, bundle item): `next/dynamic` for `swipe-deck` and `announcement-modal`; replace `GlassSheet`'s enter/exit with the equivalent CSS transition (`--ease-glass`, 200–350 ms) and drop its framer dependency; verify with a bundle diff that chunk `9630-*` leaves the shared baseline. Target: −400–700 ms TTI at 4× throttle (re-run Lighthouse TBT to confirm). *A `LazyMotion` migration was already tried and reverted — don't repeat it.*
5. **Feed page-1 payload**: `/home` serializes 50 posts into the RSC payload. Cut `FEED_PAGE_SIZE` for the first paint (e.g. 15, then infinite-scroll as today) — smaller HTML flush, faster hydration, same UX. Measure obs. FCP + document size.
6. **Chat thread initial work**: signed-URL generation for every attachment happens serially-awaited server-side before first byte; sign only the visible page (already bounded at 50) in parallel (done) but consider lazy client-side signing for older media (the pattern already exists in `signAttachment`).
7. **Cold-start `record_session`/`getClaims` JWKS**: first request per server instance fetches JWKS once; on Vercel Fluid Compute instances are reused so this amortizes — nothing to do unless logs show otherwise.

## Phase D — Larger refactors, later

8. **Route-level data streaming**: now that the layout streams, move each heavy page's below-the-fold sections (events strip with a fixed-height skeleton, profile stats) behind Suspense for sub-500 ms shells everywhere. Guard every fallback with exact-height skeletons to keep CLS at 0.
9. **Chat message virtualization**: only needed if threads grow past a few hundred loaded messages (current page size 50 + load-older is fine). If "load earlier" usage grows, add a windowing library or `content-visibility` like the feed.
10. **View Transitions API for route changes**: Next supports experimental `viewTransition`; a 150–200 ms cross-fade would soften tab switches at ~zero JS cost. Try after the framework upgrade path is clear; respect `prefers-reduced-motion`.
11. **Push-based badge updates**: dock badges refetch per navigation; a realtime subscription (or periodic revalidation) could make them live and remove the streamed query entirely.

## Measurement protocol (repeat after every phase)
```
npm run build && npx next start -p 3100
# warm TTFB (5×/page): curl -s -o NUL -w "%{time_starttransfer}\n" -H "Cookie: <session>" http://localhost:3100/home
# Lighthouse mobile: node scratchpad/run-lh.mjs <label> <conversation-id>   (writes lhr-<label>-*.json)
```
Compare: warm TTFB median, observed FCP/LCP, Speed Index, TBT, CLS (must stay 0). Report deltas against `PERFORMANCE_AUDIT.md` §1 baseline. On production, verify with Vercel Speed Insights / real-device Web Vitals rather than local numbers.
