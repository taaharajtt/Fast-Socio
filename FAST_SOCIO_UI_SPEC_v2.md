# FAST SOCIO — UI Specification v2.0

*Rewritten from v1.0/PRD baseline, incorporating glassmorphism inspiration references (HeartSync, Floxly, premium chat list, event cards).*

---

## 1. Design Philosophy

**Photo First.** People are the product. Every major feature prioritizes people before information, in this order: Photos → Identity → Social context → Actions.

**Emotion Over Utility.** Every screen should provoke curiosity, excitement, FOMO, or social connection — not just complete a task.

**Premium Simplicity.** The interface should feel luxurious: never overcrowd a screen, never expose unnecessary actions, always prioritize clarity.

This explicitly departs from "feel familiar like Instagram/WhatsApp/Reddit." Familiarity comes from interaction patterns (swipe, tap, scroll), not visual mimicry. The app should avoid Material Design, corporate dashboards, enterprise UI, and "flat university portal" aesthetics.

**Inspiration takeaways applied in this revision:**
- From the dating-card reference: oversized hero photo card, minimal floating action row, soft pill category tabs at the top — applied to the Discover screen.
- From the dark chat-list reference: glass status-circle avatars at the top, segmented filter pills (All / Unread / Groups / Pinned), unread badges — applied to Chat List.
- From the gradient auth reference: full-bleed gradient background on auth-only screens, single prominent CTA pill button, social-login row above email/password — applied to Splash/Register/Login.
- From the events reference: warm imagery-led event cards with date badge in the corner, ticket-style detail screen with barcode/QR — applied to Events.

---

## 2. Visual Identity & Design System

### 2.1 Style
Liquid Glass, Glassmorphism, Frosted Blur, Floating Surfaces, Soft Shadows, Ambient Lighting. Dark mode is the primary/default identity; light mode is a required secondary theme with equivalent glass treatment on a light base.

### 2.2 Color System

| Token | Value | Purpose |
|---|---|---|
| Aura Purple (Primary) | `#7C5CFF` | Branding, primary buttons, Aura system |
| Electric Cyan (Secondary) | `#00D4FF` | Highlights, active states, special actions |
| Background Primary Dark | `#0A0B10` | Default app background |
| Background Secondary Dark | `#11131A` | Elevated/secondary surfaces |
| Glass Surface | `rgba(255,255,255,0.08)` | Card/panel fill |
| Glass Border | `rgba(255,255,255,0.12)` | Card/panel border |
| Success | `#00FF88` | Confirmations, positive states |
| Warning | `#FFC857` | Caution states |
| Error | `#FF5E78` | Errors, destructive actions |

**Auth-screen exception:** Splash, Register, Login, and Verification screens may use a full-bleed gradient background (deep blue → cyan, or deep purple → magenta, theme-dependent) instead of flat dark, per the gradient-auth inspiration. This gradient is scoped only to pre-login screens; all post-login screens use the standard dark/light surfaces above.

### 2.3 Typography
Modern sans-serif (SF Pro, Inter).

| Level | Size (px) | Usage |
|---|---|---|
| Hero Title | 36–42 | Splash headlines, match celebration |
| Section Title | 28–32 | Screen headers |
| Card Title | 20–24 | Profile names, event titles |
| Body | 14–16 | Standard copy |
| Caption | 12–13 | Timestamps, metadata |

### 2.4 Layout
8-point spacing system (8, 16, 24, 32, 40). No inconsistent spacing.

### 2.5 Corner Radius

| Element | Radius |
|---|---|
| Small | 16 |
| Medium | 24 |
| Large | 32 |
| Profile Cards | 36 |
| Buttons | 24 (pill-shaped CTAs use full radius/9999) |

### 2.6 Glassmorphism Rules
Every glass element must include: background blur, soft transparency, a subtle border, and a soft shadow. Never heavy opacity, never sharp borders.

### 2.7 Animation Guidelines
200–350ms transitions using fade, scale, slide, or blur. Avoid bouncy or excessive motion. Card swipes (Discover) use spring-eased rotation + translate, capped at natural physical limits — no exaggerated dating-app "fling" effects.

---

## 3. Navigation Design

**Floating Glass Dock** — inspired by VisionOS, Apple Music, and Arc Browser. The dock floats above content (margin from bottom edge, not flush), with frosted blur and a subtle border, rather than sitting flush like a standard tab bar.

```
Bottom Navigation Bar (Floating Glass Dock)
┌──────┬──────────┬───────────┬────────┬──────┬─────────┐
│ Home │ Discover │Communities│ Events │ Chat │ Profile │
└──────┴──────────┴───────────┴────────┴──────┴─────────┘
```

Active tab indicated by an Aura Purple fill or glow on the icon, not a full-bar color change. Item set is fixed at six: Home, Discover, Communities, Events, Chat, Profile.

---

## 4. Screen Inventory

| Screen | Module | Actor |
|---|---|---|
| Splash / Onboarding | Auth | Guest |
| Register | Auth | Guest |
| Email Verification Pending | Auth | Guest |
| Profile Setup (multi-step) | Profiles | New Student |
| Home Feed ("Campus Pulse") | Feed | Student |
| Create Post | Feed | Student |
| Post Detail (comments) | Feed | Student |
| Reels Viewer | Feed | Student |
| Discover (card swipe) | Discover | Student |
| Message Request Modal | Discover | Student |
| Match Celebration Screen | Matching | Student |
| Chat List | Messaging | Student |
| Chat Room | Messaging | Student |
| Communities Browser | Communities | Student |
| Community Detail | Communities | Student |
| Events Browser | Events | Student |
| Event Detail + RSVP | Events | Student |
| Leaderboard | Leaderboard | Student |
| Department Rivalry | Dept. Rivalry | Student |
| Profile View (own + others) | Profiles | Student |
| Notifications Feed | Notifications | Student |
| Settings (incl. theme toggle) | — | Student |
| Report Modal | Moderation | Student |
| Admin Dashboard (web) | Admin | Admin |

---

## 5. Screen-by-Screen Experience Specs

### 5.1 Splash / Register / Login (Auth)
Full-bleed gradient background per §2.2. Centered logo at top third. Below: a single bold welcome headline ("Find Your Campus Tribe" or similar), then a vertically stacked auth block: social login buttons (Google, Apple) as equal-weight glass-pill buttons, a divider ("Or"), an email field, a password field where relevant, and one large gradient-fill pill CTA ("Continue" / "Log In"). A text link below toggles between Login/Sign Up. Footer holds Terms of Service / Privacy Policy links in caption size. FAST email domain validation is enforced inline on the email field with immediate error styling (Error color, no modal).

### 5.2 Profile Setup (multi-step)
Step indicator as a thin progress bar, not numbered dots. Each step is single-focus (one question/input group per screen): photo upload, department/semester, interests, bio. Primary CTA pinned bottom, full-width pill, disabled state (reduced opacity, no blur) until step is valid.

### 5.3 Home Screen — "Campus Pulse"
Not a single-purpose feed. One scrollable screen combining: trending posts, popular events strip, active communities strip, suggested people strip, and a department ranking snippet — so a student understands campus activity at a glance. Each section is a distinct floating glass module with its own header and "See all" affordance; sections are not visually merged into one continuous list.

### 5.4 Feed / Post Detail / Reels
Visual priority: Media > Content > Actions. Cards float with minimal separation (12–16px gaps), full-bleed media at top, action row (like, comment, share, Aura react) as compact icon row beneath, never overlaid on photos. Supported post types: text, images, videos, reels, polls, anonymous posts (anonymous posts use a muted avatar treatment and a clear "Anonymous" badge).

### 5.5 Discover (card swipe) — *Primary screen, most design weight*
The single most important screen in the app: "premium social discovery, not a Tinder clone."

**Layout reference: dating-card inspiration.**
- Top bar: user's own avatar (left), Aura/notification icon and a grid/filter icon (right) — both as small glass circular buttons.
- Segmented pill tabs directly below top bar: e.g. "For You / Astrology / Double Date / ..." — horizontally scrollable, active pill solid-filled, inactive pills outlined glass.
- The profile card occupies ~75–80% of remaining screen height (oversized, immersive). Card shows: full-bleed photo, gradient scrim at bottom third for text legibility, name + age + verified badge, department/semester line, one-line bio/prompt, distance or mutuals, compatibility % and Aura score as small glass chips overlaid top-right of the card.
- Action row floats just below/over the card bottom edge as circular glass buttons, left to right: **Undo/Rewind, Pass, Super-highlight (optional/star), Like, Message-request**. Per PRD scope, only **Pass / Like / Message** are functionally meaningful — Undo and the star icon, if present, are visual parity with the inspiration but must not introduce paid boosts or super-likes; if not justified by product scope, reduce the row to exactly three actions: Pass, Like, Message.
- No paid advantages, no boosts — this is a hard constraint regardless of visual inspiration.

### 5.6 Message Request Modal
Triggered from the Message action on Discover. Slide-up glass sheet: recipient's photo + name at top, a single text input for the opening message, character counter, send CTA. Lightweight, dismissible by swipe-down.

### 5.7 Match Celebration Screen
Full-screen, elegant — avoid cheesy dating-app effects (no confetti spam, no flashing). Centered overlapping circular photos of both users with a soft glow/pulse animation, "It's a Match" headline, shared interests as small chips, compatibility score, and a single primary CTA "Start Chat." Secondary "Keep Browsing" as a text-only link below.

### 5.8 Chat List — *Layout reference: glass chat-list inspiration*
- Header: "Messages" title (left), search icon + compose icon (right) as glass circular buttons.
- "Active now" row: horizontally scrollable circular avatars with a glass ring/status indicator for recently-active or recently-matched contacts, "+" tile at the start for new message.
- Filter pill row beneath: **All / Unread / Groups / Pinned**, same active/inactive pill treatment as Discover's segmented tabs for visual consistency.
- List below: each row = avatar (left), name + last-message preview (truncated, "Typing…" in Aura Purple when live), timestamp (top-right, caption size), unread-count badge (small filled circle, Aura Purple or Error depending on theme) and pin icon when applicable.

### 5.9 Chat Room
Visual inspiration: Apple Messages + premium glass UI, polished to a WhatsApp standard. Requirements: realtime delivery feel (typing indicators, live status), floating message bubbles (sender bubbles solid Aura Purple gradient, receiver bubbles glass), rich media support (image/video inline, voice notes with waveform), tap-and-hold reactions, read receipts as small checkmarks/avatar thumbnails under the last message. Composer bar: glass pill, attachment icon, emoji icon, text field, send button as filled circle.

### 5.10 Communities Browser / Community Detail
Visual inspiration: Reddit + Discord. Each community card: banner image, name, short description, member count, live-activity indicator (small pulsing dot + "X active now"). Detail screen tabs: Discussions, Polls, Announcements, Members — as the same segmented-pill pattern used elsewhere for consistency. Join button as a pill CTA in the banner area.

### 5.11 Events Browser / Event Detail — *Layout reference: event-card inspiration*
- Browser: greeting header ("Hi, [Name] — What do you want to do?"), search bar (glass, rounded), "Upcoming events" horizontal card carousel — each card is image-led with a date badge chip in the top corner (e.g. "31 OCT") and title/host beneath. "Browse by categories" pill row beneath (Music, Holiday, Food, etc.) leading into a vertical/grid list.
- Detail: large banner image at top with back button overlaid, title + host, then a clean two-column metadata block (Location / Name / Date / Time), attendee avatar stack with "+N going" count for FOMO, RSVP as full-width pill CTA pinned at bottom. A scannable QR/barcode block appears only after RSVP confirmation, styled as a "ticket" card (rounded corners, perforation-line motif optional) — matching the event-ticket inspiration.
- Every event card must generate FOMO: attendee avatars are always visible, never hidden behind a count-only badge.

### 5.12 Leaderboard
Elite, aspirational framing. Top 3 given large featured cards with distinct titles: 🥇 Main Character, 🥈 Campus Celebrity, 🥉 Aura Farmer — gold/silver/bronze glass tinting on each respective card. Remainder of ranking as a compact list: rank number, avatar, name, department, Aura score.

### 5.13 Department Rivalry
Visual inspiration: sports league tables. Standings table with department crest/icon, weekly score, win/loss trend arrow, and a "current leader" hero banner above the table. Competitive, scoreboard-style typography (bolder numerals).

### 5.14 Profile View (own + others)
Prestigious framing. Large profile image/cover, Aura score prominently displayed as a glass badge near the name, department + semester line, then horizontally scrollable strips for Communities, Events Attended, and Posts. Edit/Message/Follow CTA appropriate to viewer context pinned near the top.

### 5.15 Notifications Feed
Grouped by recency (Today / This Week / Earlier). Each row: actor avatar, action description, timestamp, relevant thumbnail (post/event image) when applicable. Unread notifications carry a left-edge Aura Purple accent bar.

### 5.16 Settings
Standard grouped glass list sections (Account, Notifications, Privacy, Appearance, Support). Appearance section includes the Dark/Light theme toggle as a segmented control, not a plain switch, to match the design system's pill language.

### 5.17 Report Modal
Slide-up glass sheet, minimal: reason list (radio-style glass rows), optional text field, submit CTA in Error color to signal severity without being alarming.

### 5.18 Admin Dashboard (web)
Out of scope for the mobile glass system's strict rules — may use a more data-dense, utilitarian layout, but should still inherit the core color tokens and typography for brand consistency.

---

## 6. Empty States
Every empty state should feel alive — illustration + positive, forward-looking copy, never a dead-end message.

| Context | Avoid | Use Instead |
|---|---|---|
| No matches | "No matches yet" | "Your next campus connection is waiting." |
| No chats | "No messages" | "Start a conversation — someone's waiting to meet you." |
| No events nearby | "No events found" | "Be the first to start something on campus." |
| No posts in community | "No posts" | "This space is just getting started — say hi." |

---

## 7. User Flow (Critical Path)

```
[Download App]
    │
[Register with FAST email] → [Verify email]
    │
[Profile Setup] → [Select interests, dept, semester]
    │
[Home Feed] ←──────────────────────── Daily return loop
    │
[Discover] → [Like/Pass/Msg Request]
    │
[Match! 🎉] → [Chat] → [Active conversation]
    │
[Communities] → [Join] → [Post / React]
    │
[Events] → [RSVP] → [Attend] → [+15 Aura]
    │
[Aura builds] → [Leaderboard climb] → [Title awarded]
```

---

## 8. Accessibility

- Dark mode support (primary/default identity)
- Light mode support (full glass parity required, not an afterthought)
- Readable contrast in both themes (minimum WCAG AA for body text)
- Scalable typography (respect OS-level text scaling)
- Touch-friendly tap targets (minimum 44×44pt)

---

## 9. UX Principles Checklist

Every screen must satisfy all of the following, or it should be redesigned:

- [ ] Can the user understand this screen within 3 seconds?
- [ ] Is the primary action obvious?
- [ ] Is the visual hierarchy clear?
- [ ] Does it feel premium?
- [ ] Does it feel social?

---

## 10. Cross-Screen Consistency Notes (new in v2.0)

To unify the inspiration references into one coherent system rather than three different visual languages:

1. **Segmented pill tabs** (For You/Astrology style, filter pills, community tabs, settings appearance toggle) share one component spec: glass background, active pill solid Aura Purple or Electric Cyan fill, inactive pills outlined/transparent, 9999 radius, 32–40px height.
2. **Card-with-overlay-chip pattern** (Discover compatibility chip, Event date badge) shares one component spec: small glass chip, 12–13px caption text, positioned with 12–16px inset from the card's corner.
3. **Gradient backgrounds are auth-only.** No other screen should adopt the full-bleed gradient — it would dilute the dark-glass identity that defines the rest of the app.
4. **Avatar status rings** (Chat List "active now" strip) reuse the same ring treatment as online/active indicators elsewhere (e.g., Discover, Profile) for one consistent "who's active" visual language across the app.
