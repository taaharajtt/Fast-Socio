# DM realtime — two-user Playwright test plan

Status: **plan, not yet implemented.** This repo has no `playwright.config.ts`
today (only stale `playwright-report/` and `test-results/` output directories),
so this document specifies the suite rather than adding a half-wired harness.
The pure-logic half of the same coverage IS implemented and running, in
`src/lib/chat/message-merge.test.ts`, `src/lib/chat/inbox-freshness.test.ts`,
`src/lib/chat/inbox-store.test.ts` and `src/lib/realtime/poll-backoff.test.ts`.

## Harness

Two browser contexts in one test, each signed in as a different seeded student
who is already **matched** with the other (a conversation must be creatable —
see `get_or_create_conversation`). Call them **A** (sender) and **B** (observer).

```ts
const a = await browser.newContext({ storageState: "e2e/.auth/student-a.json" });
const b = await browser.newContext({ storageState: "e2e/.auth/student-b.json" });
```

Rules for every scenario below:

- **Never reload B.** A `page.reload()` anywhere in an assertion path invalidates
  the test — the whole point is that no refresh is needed. Use
  `page.goBack()` / `page.goForward()` where navigation is called for.
- Assert with `expect(locator).toHaveText(...)` (auto-retrying), not a manual
  sleep, so the pass/fail is about arrival, not about a fixed delay.
- Budgets, asserted via the assertion timeout:
  **foreground receipt p95 < 1s**, **resume/reconnect catch-up < 2s**.
- Seed each run with a unique message body (`crypto.randomUUID()`), so a test
  can never pass on a message left behind by a previous run.

## Scenarios

| # | Scenario | Setup | Action | Assertion |
|---|---|---|---|---|
| 1 | Same conversation, both foreground | A and B both on `/chat/{conv}` | A sends `m1` | B's thread shows `m1` within 1s, exactly once. B's read receipt fires at most once in 3s (throttle). |
| 2 | B in a DIFFERENT conversation | B on `/chat/{other}`, A on `/chat/{conv}` | A sends `m2` | B's dock badge increments within 1s. B navigates to `/chat` (push nav) and the `{conv}` row previews `m2` with unread ≥ 1 — no reload. |
| 3 | B on another student page | B on `/home` | A sends `m3` | B's dock badge increments within 1s. This is the regression test for the layout-level `<InboxRealtime/>`: with the old page-scoped channel, nothing was listening. |
| 4 | Browser BACK to a stale inbox | B opens `/chat`, taps into `{conv}`, stays | A sends `m4` while B is inside the thread; then B presses browser back | The `{conv}` row previews `m4`. **The core R1+R2 regression test**: back/forward replays the cached RSC payload, so this passes only because the store snapshot outranks it via `pickFreshestInbox`. |
| 5 | Offline → online catch-up | B on `/chat/{conv}` | `bContext.setOffline(true)`; A sends `m5`; wait 3s; `bContext.setOffline(false)` | `m5` appears in B's thread within 2s of coming back online, without a reload. Driven by the `online` listener + `fetchNewerMessages`. |
| 6 | Background / resume (PWA) | B on `/chat/{conv}` | Emulate hidden: `bPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))` with `Page.setWebLifecycleState`, or simply front another tab in the same context; A sends `m6`; return to B | `m6` appears within 2s of resume. Covers both paths: the channel resubscribing (SUBSCRIBED → catch-up) and a socket that survived (visibility → catch-up). |
| 7 | WebSocket blocked, polling recovers | Route-block the realtime socket for B's context before navigating: `bContext.route("**/realtime/v1/**", r => r.abort())` | A sends `m7` | `m7` appears in B's thread within ~6s (first poll at 5s). Then unblock the route and assert the next message arrives in <1s, proving polling **stops** once realtime returns. |
| 8 | Burst of messages | Both on `/chat/{conv}` | A sends `b1..b8` as fast as the composer allows | B shows exactly 8 new bubbles, no duplicates (`toHaveCount`), in send order. Guards ordering (equal-timestamp tiebreak) and dedupe (INSERT + catch-up overlap). |
| 9 | Two identical messages | A on `/chat/{conv}` | A sends the same text twice within ~200ms | **A's own** thread shows two bubbles, not one and not three; both settle to real ids (no `temp-` row survives). B likewise shows two. This is the body-text-matching regression. |
| 10 | Badge + preview without reload | B on `/chat` (Messages panel) | A sends `m10` | The `{conv}` row's preview text, unread badge and dock badge all update within 1s, with no navigation and no reload. Then B opens the thread and the unread badge clears. |

## Additional assertions worth wiring once the harness exists

- **No cross-user leakage.** Sign B out and sign C in **in the same context**;
  assert `/chat` never renders one of B's threads, not even transiently
  (`expect(page.getByText(bOnlyThreadName)).toHaveCount(0)` immediately after
  the redirect).
- **No `router.refresh()` storm.** Count RSC requests
  (`page.on("request", ...)` filtered on `?_rsc=`) while A sends 10 messages;
  assert the count stays in single digits. The whole architecture exists to keep
  a message from costing a full server-tree render.
- **Optimistic failure is recoverable.** Force `sendMessage` to fail
  (`context.route` on the action endpoint); assert the bubble shows
  "Failed to send" with Retry/Discard, and that Discard leaves no `temp-` row.

## Why these ten

Each maps to a specific defect this work fixed:

- 1, 8, 9 → merge/dedupe/ordering and id-based optimistic reconciliation.
- 2, 3, 4, 10 → the inbox channel dying on navigation, plus Next 16's Client
  Cache replaying a stale page segment on back/forward.
- 5, 6, 7 → `postgres_changes` having no replay: catch-up on online, on resume,
  and the polling floor under a channel that will not establish.
