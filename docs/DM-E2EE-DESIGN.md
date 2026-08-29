# FAST SOCIO — one-to-one DM end-to-end encryption: design and library gate

**Status: NO-GO on implementation.** Research complete; no cryptography written.
**Researched:** 2026-08-29. Re-evaluate on the schedule in §9.
**Scope:** one-to-one direct messages only.

> FAST SOCIO DMs are **not** end-to-end encrypted today, and nothing in this
> document changes that. Message bodies are plaintext columns in
> `public.messages`. No UI, policy page, marketing copy, or support article may
> claim otherwise until §8's exit criteria are met.

---

## 1. What "E2EE" has to mean here

The target is the full Signal-style stack, in this order:

```
PQXDH / X3DH  →  Double Ratchet  →  AES-256-GCM
key agreement    per-message keys    authenticated payload encryption
```

Each layer does a different job and none is optional:

- **PQXDH / X3DH** establishes a shared secret asynchronously, so A can message
  B while B is offline. PQXDH adds an ML-KEM post-quantum leg so a
  harvest-now-decrypt-later adversary cannot recover today's traffic.
- **Double Ratchet** derives a *unique key per message* and steps the chain
  forward, giving forward secrecy (past messages stay safe if a key leaks) and
  break-in recovery (future messages recover after a compromise).
- **AES-256-GCM** is only the payload cipher at the end.

**AES alone is not E2EE.** A single long-lived AES key per user or per
conversation — however strong the cipher — has no forward secrecy, no break-in
recovery, no per-message key separation, and usually a key the server touched at
some point. If anyone proposes "we'll just AES-encrypt the bodies," that is the
thing this section exists to refuse.

---

## 2. Threat model

**In scope — what E2EE must defeat**

| Adversary | Capability today | Must become |
|---|---|---|
| Curious/rogue moderator | Was able to browse every DM in-product; now removed at the app layer | No decryption capability at all |
| Supabase/database operator, service-role key holder, DBA | Full plaintext read of `messages` | Ciphertext only |
| Backup / replica / export theft | Full plaintext | Ciphertext only |
| Network attacker (TLS stripped or MITM) | TLS-protected | Ciphertext + authenticated |
| Compelled disclosure to the operator | Operator can produce plaintext | Operator can produce only ciphertext + metadata |

**Explicitly out of scope — what E2EE cannot defeat**

- A compromised participant device. E2EE protects data in transit and at rest on
  the server; it cannot protect a device the attacker already controls.
- A malicious or compromised *client build*. In a web app the server ships the
  code that does the encrypting (see §7).
- Screenshots, forwarding, or a participant simply choosing to disclose — which
  is precisely how the reporting flow works, by design.
- Metadata (§6).
- Group surfaces. Community, event, society, announcement, Campus Help and
  Discover room chats are **out of scope** and must never be labelled E2EE.

---

## 3. Library evaluation — the gate

Four requirements, all mandatory: **browser/PWA-capable · actively maintained ·
independently reviewed · implements the §1 stack.** Verified against primary
sources (npm registry, GitHub API, project READMEs, audit reports) on
**2026-08-29**.

| Candidate | Browser? | Maintained | Independently reviewed | License | Verdict |
|---|---|---|---|---|---|
| `@signalapp/libsignal-client` **0.101.2** | ❌ **no** | ✅ published 2026-08-28 | ✅ (Signal production stack) | **AGPL-3.0-only** | **BLOCKED — not browser-capable** |
| `signalapp/libsignal-protocol-javascript` | ✅ | ❌ **archived**, last push 2021-08-04 | historical only | GPL-3.0 | **FORBIDDEN** — archived |
| `@privacyresearch/libsignal-protocol-typescript` 0.0.16 | ✅ | ❌ last push 2023-07-18, still `0.0.x` | ❌ none | GPL-3.0-only | Reject |
| `2key-ratchet` (PeculiarVentures) | ✅ WebCrypto | ❌ **archived**; npm 2022-06 | partial, historical | custom | Reject — archived |
| `pqc-ratchet` (successor named by the above) | ? | **not published to npm** | ❌ | ? | Reject — not distributed |
| `getmaapp/signal-wasm` | ✅ | recent, but 12 stars | ❌ none | unclear | Reject — unreviewed |
| `lukejmann/libsignal-wasm` | ✅ | ❌ 2024-11, 0 stars | ❌ none | AGPL-3.0 | Reject — unreviewed |
| **`ts-mls` 1.6.4** (RFC 9420 MLS) | ✅ browser + Node 20+ | ✅ published 2026-08-28 | ❌ **self-declared unaudited** | MIT | **Closest MLS option; fails the review gate** |
| **`@matrix-org/matrix-sdk-crypto-wasm` 18.7.0** (vodozemac) | ✅ WASM | ✅ published 2026-08-28 | ✅ **Least Authority, 2022** | Apache-2.0 | **Closest audited option; wrong protocol** |

### The two findings that decide this

**1. `@signalapp/libsignal-client` cannot run in a browser.** Not an inference —
the published tarball for 0.101.2 contains only native Node addons:

```
package/prebuilds/darwin-arm64/@signalapp+libsignal-client.node
package/prebuilds/darwin-x64/…   linux-arm64/…   linux-x64/…
package/prebuilds/win32-arm64/…  win32-x64/…
```

No `.wasm`, no `browser` field, no browser entry point. And it is getting
*further* away, not closer: on Signal's own WASM-bridge issue
([signalapp/libsignal#350](https://github.com/signalapp/libsignal/issues/350),
closed 2021-09-01), Signal engineer `jrose-signal` wrote on **2024-09-04** that
two of the four candidate approaches are "much more difficult now that we have
`boring` as a dependency, and possibly other C libraries in the indirect
dependency tree that won't just accept a wasm target." The thread has had no
working implementation since. Signal also ships no web client of its own.

Its **AGPL-3.0-only** licence is a second, independent blocker: FAST SOCIO is a
hosted network service, so the AGPL's network clause would reach the whole
application. That needs a deliberate legal decision, not a default.

**2. `ts-mls` says not to use it in production.** Its README states the library
"has not undergone a formal security audit… it may contain undiscovered
vulnerabilities," and advises anyone in a "production or security-critical
context" to "proceed with caution and consider conducting an independent
security review." Taking a library into a security-critical path against its own
maintainers' advice is exactly the failure mode this gate exists to prevent.

### Verdict

> **NO-GO.** No library available on 2026-08-29 satisfies all four gates at once.
> The only *audited, maintained, browser-capable* option (vodozemac) implements
> Olm/Megolm rather than PQXDH, and is coupled to the Matrix protocol and
> homeserver model rather than usable as a standalone ratchet. The only
> *browser-native, maintained, correct-family* option (`ts-mls`) is explicitly
> unaudited.
>
> **Do not write custom cryptography. Do not ship a single AES key and call it
> E2EE. Do not adopt an archived library.**

---

## 4. Paths forward (a decision is required, not a default)

| # | Path | Gets us | Costs | Recommendation |
|---|---|---|---|---|
| **A** | Hold; re-evaluate quarterly (§9) | Nothing yet; zero risk | DMs stay plaintext | Baseline |
| **B** | Adopt **vodozemac** via `matrix-sdk-crypto-wasm` | Real, *audited* Double Ratchet in the browser | Olm/Megolm not PQXDH — **no post-quantum leg**; Matrix-coupled API to be unwrapped; group semantics we don't need | Viable if PQ is deferred **and** stated honestly |
| **C** | Adopt **`ts-mls`** + commission an independent audit | RFC 9420 MLS, MIT, browser-native TS, clean multi-device story | Audit cost and lead time; we own the finding backlog | **Recommended** if E2EE is a real commitment |
| **D** | Native app + official `libsignal` | Full PQXDH parity | Abandons the PWA; AGPL still applies | Only route to true Signal parity |

Recommendation: **C**, with **B** as the fallback if the audit cannot be funded.
The blocker on C is budget and calendar, not architecture.

---

## 5. Design that a go-decision would implement

Recorded now so the eventual implementation is not designed under time pressure.
None of it is built.

**Keys and devices.** Per-user, per-device identity keypair; signed prekey with
rotation; a one-time prekey pool with server-side depletion alerting and a
documented fallback when it is exhausted. Private keys live in IndexedDB as
**non-extractable `CryptoKey`** objects. `localStorage` is never used for key
material or plaintext.

**Multi-device.** Sesame-style per-device sessions: a message is encrypted once
per recipient device. Device add/revoke is an explicit, user-visible event.
Safety-number changes must raise an in-thread warning; silent key change is how
this class of system gets broken.

**Backup and recovery — the honest part.** Clearing browser storage destroys the
keys. Unless encrypted device-linking or a user-passphrase backup is actually
built, the correct behaviour is an explicit *"messages before this point cannot
be decrypted on this device"* state. **Never** silently fall back to plaintext,
and never promise seamless history restore we have not implemented.

**Attachments.** Random per-attachment content key → encrypt locally
(AES-256-GCM) → upload **ciphertext only** → put the content key inside the
encrypted message envelope. Today's signed URLs on a private bucket are *access
control*, not E2EE. No plaintext filenames, captions, or thumbnails in
server-visible metadata. Account deletion must clean up the ciphertext objects.

**Legacy boundary.** Existing plaintext messages stay marked legacy and are
never re-labelled. An in-thread divider marks where encryption begins. The
server must not "re-encrypt" old plaintext and call the result E2EE — the server
saw it, so the property does not hold retroactively.

**Reporting under E2EE.** The schema built in migration 0161 already anticipates
this: `dm_report_messages.evidence_source` flips from `'server_plaintext'` to
`'reporter_disclosed'`, and `dm_report_cases.protocol_version` moves off 0. The
server can no longer copy a body, so the **reporting client** supplies the
decrypted text it chooses to disclose, bound to the immutable
`source_message_id` and the server's own routing metadata. Moderators see only
what the reporter disclosed.

> **Non-negotiable:** no moderator master key, no server key escrow, no recovery
> backdoor, no hidden plaintext copy. If a proposed design gives the operator a
> general decryption capability, it is not E2EE and must not be described as
> such. Reporter-disclosed evidence is moderation evidence — not courtroom-grade
> cryptographic proof of authorship — and documentation must say so plainly
> unless the chosen library ships a reviewed message-franking construction.

---

## 6. Metadata FAST SOCIO still sees, even after E2EE

E2EE hides message *content*. It does not hide:

who is talking to whom · when and how often · message sizes and counts ·
online/last-seen and typing signals · read receipts · attachment existence and
size · device count and registration times · IP and user-agent at the transport
layer · report and moderation records.

This list belongs in the Privacy Policy verbatim when E2EE ships. Claiming E2EE
while implying metadata privacy would be its own misrepresentation.

---

## 7. PWA and browser limitations — state these publicly

- **The server ships the crypto.** Unlike a signed native binary, a web app
  delivers fresh JavaScript on every load, so a compromised or coerced server
  could serve a malicious build. This is the fundamental limit of browser E2EE.
  Subresource integrity, code-signing efforts, and reproducible builds reduce but
  do not remove it.
- **Key storage is best-effort.** IndexedDB can be cleared by the browser under
  storage pressure, by privacy modes, or by the user — taking message history
  with it.
- **Non-extractable `CryptoKey` support varies**, especially in older WebViews
  and in-app browsers.
- **Push notifications** must carry generic wording ("You received a new
  message") unless a participant device decrypts locally in a service worker;
  push providers must never receive plaintext previews.
- **Multi-device is harder here** than on mobile: every browser profile is
  effectively a separate device with separate storage.

---

## 8. Exit criteria — when E2EE may be claimed

All of these, before any UI or policy text says "end-to-end encrypted":

1. A library from §4 adopted, with its audit or commissioned review published.
2. Server stores ciphertext for new DMs; verified by inspecting rows directly.
3. Different plaintexts and repeats produce different ciphertext; tampering
   fails authenticated decryption.
4. No plaintext in push payloads, Sentry, analytics, logs, URLs, object keys,
   realtime payloads, inbox previews, or server-rendered HTML.
5. Key-change warnings, device revocation, and storage-loss states all
   implemented and tested — with **no** plaintext fallback on failure.
6. Attachments encrypted client-side; server holds ciphertext only.
7. Reporting works on the `reporter_disclosed` path.
8. Legacy boundary shipped and honestly labelled.
9. **Independent validation of the deployed system**, not just of the library.

---

## 9. Re-evaluation schedule

Re-run this gate **quarterly** (next: 2026-11-29), or immediately if any of:

- Signal ships an official WASM/browser target for `libsignal`
  (watch [signalapp/libsignal#350](https://github.com/signalapp/libsignal/issues/350)).
- `ts-mls` publishes a completed independent security audit.
- A maintained, audited, browser-capable PQXDH implementation appears.
- Budget is approved for path **C**.

---

## 10. Required policy wording — for when this ships (not now)

Terms and the Privacy Policy are **deliberately unmodified**. The current pages
state that moderators may browse reported conversations; after migrations
0160–0164 that is no longer true, so the wording is now *inaccurate in the
user's favour* — it overstates our access. It still needs correcting.

**Change now (Phase 2/3 accuracy) — pending approval:**

1. Remove any statement that moderators may **browse reported conversations**.
   Replace with: private messages are **not generally accessible** to
   moderators, and no admin tool can open, search, or export a conversation.
2. State that a **reporter may disclose 1–10 selected messages** through a
   report, and that only those messages — with their senders, timestamps and
   selected attachments — are shared.
3. State that disclosed evidence and the associated moderation audit records
   **may be reviewed and retained** for safety enforcement after a case closes.
4. State plainly that DMs are **stored unencrypted** and are accessible to FAST
   SOCIO's infrastructure operators. Do not imply otherwise by omission.

**Do not add until §8 is met:**

5. Any E2EE claim, badge, lock icon, or "only you can read this" phrasing.
6. Any claim covering group/community/event/society/Campus Help/Discover chats —
   they are out of scope permanently unless separately designed.
7. Marketing absolutes: no "military-grade", "unbreakable", "zero-knowledge", or
   "we can never see your messages" while §1's stack is unimplemented.

---

## Sources

- [@signalapp/libsignal-client on npm](https://www.npmjs.com/package/@signalapp/libsignal-client) — v0.101.2, AGPL-3.0-only, published 2026-08-28; tarball inspected for prebuilds
- [signalapp/libsignal#350 — WASM Bridge / Build](https://github.com/signalapp/libsignal/issues/350) — closed 2021-09-01; maintainer comment 2024-09-04
- [signalapp/libsignal-protocol-javascript](https://github.com/signalapp/libsignal-protocol-javascript) — archived, last push 2021-08-04
- [LukaJCB/ts-mls](https://github.com/LukaJCB/ts-mls) — RFC 9420 MLS, MIT, unaudited per its own README
- [matrix-org/vodozemac](https://github.com/matrix-org/vodozemac) and [matrix-sdk-crypto-wasm](https://github.com/matrix-org/matrix-rust-sdk-crypto-wasm)
- [Least Authority — Audit of Matrix vodozemac](https://leastauthority.com/blog/audits/audit-of-matrix-vodozemac) and the [final report PDF](https://matrix.org/media/Least%20Authority%20-%20Matrix%20vodozemac%20Final%20Audit%20Report.pdf)
- [Signal — The Double Ratchet Algorithm specification](https://signal.org/docs/specifications/doubleratchet/)
- [PeculiarVentures/2key-ratchet](https://github.com/PeculiarVentures/2key-ratchet) — archived
