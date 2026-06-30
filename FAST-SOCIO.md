# 🎓 FAST SOCIO — Application Design & Analysis Document

> **Status:** Design Complete → 🟢 Phase 1 (Authentication + Foundation, expanded scope) In Progress — Web/PWA stack
> **Source Documents:** PRD (TAD baseline) · Architecture/TAD v1.0 · `FAST_SOCIO_UI_SPEC_v2.md` (UIspec) · `MASTER_PLAN.docx` v2.1 (authoritative phase plan) · `TASK_LOG.docx` (live task status) · `DECISION_LOG.docx` (10 active decisions) · `PROJECT_STATE.docx` · `SPRINT_PLAN.docx`

---

## 📋 Document Control & Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0 | 2026-06-20 | Initial Design & RE document, derived from PRD v1.0 and TAD v1.0. UI direction was Instagram/WhatsApp/Reddit/TikTok-inspired. Phase tracking followed the TAD's 12-phase MVP build order. |
| 2.0 | 2026-06-30 | Reconciled against **UIspec.md** (new premium glassmorphic Design System — supersedes the v1.0 UI direction), **master_plan_steps.md** (adopted as the authoritative 17-phase [0–16] tracking structure), **tasklog.md** (live build status folded into Section 1), and **decision.md** (architecture decisions formally cross-referenced). See **Reconciliation Notes** at the end of Section 14 for what changed and why. |
| 3.0 | 2026-06-30 | **Platform pivot — React Native (Expo) → Mobile-web-first PWA (Next.js).** Native iOS/Android client dropped; the product ships as an installable Progressive Web App targeting mobile browsers as the primary form factor, scaling up to desktop. The separate Next.js Admin Dashboard collapses into the same repo as `/admin` routes. Sections 1 (Platform), 8 (Architecture), 11 (visual rendering notes), 14 (phase plan reconciled to real `MASTER_PLAN.docx` v2.1), 15 (Tech Stack + decision log), and 17 (new OQ-12, OQ-13) are updated; FRs, NFRs, use cases, data model, RLS policies, and the UIspec design system are unchanged in intent. **Logged as Decision #010 in `DECISION_LOG.docx`** (not #005 — five decisions from the 2026-06-24 kickoff architecture review were already on record before this revision). See **§14.3 Reconciliation Notes** for the full diff. |
| 3.1 | 2026-06-30 | **Doc-consistency fix.** v3.0 was drafted against an outdated view of the tracking documents. On re-reading `MASTER_PLAN.docx`, `DECISION_LOG.docx`, and `TASK_LOG.docx`, three discrepancies were corrected: (1) the phase plan is 12 phases per `MASTER_PLAN.docx` v2.0/v2.1, not the fictitious 17 phases v2.0 of this document referenced; (2) `DECISION_LOG.docx` already contains decisions 005–009 from a 2026-06-24 architecture review, so the web pivot is **Decision #010**, not #005; (3) Tasks #001 and #002 were already marked Complete on 2026-06-17 and are now Superseded by the pivot. Section 1.1 status snapshot, §14 phase tables, and §15 decision-log table are all rewritten to match the real tracking docs. |

**Note on this revision:** v2.0 was additive. v3.0 is a **platform pivot** — the mobile-app stack (React Native + Expo) is replaced with a web/PWA stack (Next.js). The user-facing product, design system, data model, security model, and feature scope are preserved; what changes is how it's rendered, distributed, and notified. Sections that materially changed are flagged in the revision row above.

---

## 1. 📌 Project Overview

| Field | Description |
|-------|-------------|
| **App Name** | FAST SOCIO |
| **Version** | 1.0.0 (MVP) |
| **Date** | Originally 2026-06-20 · Revised 2026-06-30 |
| **Author(s)** | *(your name / team)* |
| **Platform** | Mobile-web-first PWA — Next.js (App Router), installable on Android + iOS, scales up to desktop browsers. Admin dashboard ships as `/admin` routes inside the same Next.js app. |
| **Status** | 🟢 Design Complete → Phase 1 (Foundation) In Progress |

### Modules

| # | Module | Inspired By (Interaction Pattern) | Visual Skin |
|---|--------|------------|------------|
| 1 | **Authentication** | — (FAST email exclusive) | Glass forms, floating cards |
| 2 | **Profiles** | Instagram profile layout | Prestige/identity card, Aura badge |
| 3 | **Discover** | Tinder-style card swiping | Near-full-screen glass profile card |
| 4 | **Matching** | Tinder mutual like model | Full-screen elegant celebration |
| 5 | **Messaging** | WhatsApp chat experience | Apple Messages-style glass bubbles |
| 6 | **Home Feed** | Instagram feed + Reels | "Campus Pulse" — feed + events + communities + rankings |
| 7 | **Anonymous Posting** | Reddit-style confessions | Same glass card, hidden identity |
| 8 | **Communities** | Reddit + Discord | Banner, activity indicator, glass panels |
| 9 | **Events** | Facebook Events | FOMO-driven, attendee avatars prominent |
| 10 | **Aura System** | Reputation / XP engine | Prestige visual treatment, never purchasable |
| 11 | **Leaderboard** | Weekly ranked titles | Elite/aspirational design |
| 12 | **Department Rivalry** | Team-based competition | Sports league table style |
| 13 | **Notifications** | Cross-module push alerts | Floating glass toasts |
| 14 | **Moderation** | Admin content control | — (admin routes, not glass-styled) |
| 15 | **Admin Dashboard** | `/admin` routes in the same Next.js app | Standard web dashboard (not subject to UIspec); role-gated via RLS |

> The "Inspired By" column (from PRD.md) describes **interaction patterns and information architecture** — how each module behaves. The "Visual Skin" column (from UIspec.md) describes **how it looks**. These are not in conflict: FAST SOCIO keeps familiar mechanics (swipe to like, tap to message, pull to refresh) but renders them through the premium glassmorphic design system in Section 11, not through standard Material/iOS defaults. The pivot to Next.js (v3.0) does not change interaction patterns — touch swipe, infinite scroll, pull-to-refresh, and the floating glass dock all carry over to mobile-web with `framer-motion` and CSS, just rendered in the browser instead of on a native canvas.

### Vision Statement

> "Create the most engaging university social ecosystem where FAST NUCES students can meet new people, build friendships, discover communities, participate in events, share experiences, gain social recognition, and stay connected to campus culture — all in one seamless, university-exclusive mobile platform."

UIspec.md sharpens this further: FAST SOCIO is explicitly **not** a university portal, management system, or learning platform — it should feel closer to **Apple Music + Arc Browser + modern dating apps + Instagram** than to a typical campus app, and should read as premium, modern, social-first, addictive (in a positive sense), youthful, fast, elegant, and emotionally engaging.

### Goals & Success Criteria

- [ ] **SC1** — 1,000 registered verified users at launch
- [ ] **SC2** — 500 weekly active users within first month
- [ ] **SC3** — 100 daily active users sustained
- [ ] **SC4** — 70% weekly retention rate
- [ ] **SC5** — Average session length above 10 minutes
- [ ] **SC6** — Average 3+ app opens per user per day
- [ ] **SC7** — Strong community participation (posts per community per week)
- [ ] **SC8** — High event engagement (RSVP and attendance rates)

### Out of Scope (v1)

| ID | Constraint |
|----|-----------|
| NS1 | No native iOS/Android client — the product ships as a mobile-web-first PWA. Desktop browsers are supported as a scaled-up secondary experience, not the primary target. *(Revised in v3.0 — see revision history.)* |
| NS2 | No AI-powered feed recommendations — Claude used for icebreakers, compatibility explanations, and moderation assistance only |
| NS3 | No monetization, ads, or paid tiers in v1 — confirmed by UIspec.md: Discover has *no super likes, no boosts, no paid advantages*, and Aura is explicitly *never purchasable* |
| NS4 | No cross-university federation — FAST NUCES exclusive only |
| NS5 | No video calling or live streaming — text/media messaging only |
| NS6 | No third-party login (Google, Facebook) — FAST email only |

---

### 1.1 🔴 Live Development Status

*Source of truth: `MASTER_PLAN.docx` v2.1 (post web-pivot annotations), `TASK_LOG.docx`, `PROJECT_STATE.docx`, `SPRINT_PLAN.docx` — all dated 2026-06-30.*

**Current phase:** Phase 1 — Authentication + Foundation (expanded scope). **Completion:** 5%. **Current sprint:** Sprint 1 (re-scoped 2026-06-30 to absorb Next.js scaffold + PWA shell tasks added by Decision #010).

**Phase 0 — Planning (effectively complete; not a formal phase in `MASTER_PLAN.docx`)**

| Item | Status |
|---|---|
| PRD | ✅ Complete (referenced as TAD baseline in `MASTER_PLAN.docx` §2.1) |
| TAD v1.0 | ✅ Complete; schema superseded by `MASTER_PLAN.docx` v2.0 §4 |
| UX Specification | ✅ Complete — `FAST_SOCIO_UI_SPEC_v2.md` |
| Decision Log | ✅ 10 active decisions in `DECISION_LOG.docx` (001–010, with 001 and 004 superseded by 010) |
| ERD diagram | 🟡 Partial — table structures fully specified in `MASTER_PLAN.docx` §4 and Section 9 of this document; no standalone visual ERD diagram yet. Generate via dbdiagram.io before Phase 2 begins |
| Architecture Approval | ⬜ Sign-off pending — see §16 |

**Phase 1 — Authentication + Foundation (expanded; in progress)**

Per `TASK_LOG.docx`:

| # | Task | Status |
|---|---|---|
| 001 | ~~Create React Native Project~~ | ❌ **Superseded by Decision #010** on 2026-06-30 (RN scaffold discarded) |
| 002 | ~~Configure TypeScript (RN project)~~ | ❌ **Superseded by Decision #010** (absorbed by Next.js template in 001b) |
| 003 | Configure Supabase | 🔄 In Progress — carries over unchanged to Next.js stack |
| 001b | Create Next.js 15 (App Router) project — TS, Tailwind, ESLint, Prettier | ⬜ Upcoming |
| 001c | PWA shell — `next-pwa` (or workbox), manifest, service worker | ⬜ Upcoming |
| 001d | Glass primitives (`GlassCard` / `GlassButton` / `GlassPill` / `GlassSheet`) | ⬜ Upcoming |
| 001e | Floating glass dock navigation component | ⬜ Upcoming |
| 001f | VAPID keypair + service worker push handler stub | ⬜ Upcoming (delivery wired in Phase 10) |
| 001g | Theme provider (next-themes); resolve OQ-10 default | ⬜ Upcoming |
| 003a | Hardened schema design (`blocked_users`, `notification_preferences`, `rate_limit_events`, `moderation_audit_log`, polymorphic `reports`) | ✅ Design complete — see `MASTER_PLAN.docx` §4 |
| 003b | Write RLS policy bodies for all tables | ⬜ Upcoming (Sprint 1) |
| 003c | Apply foreign keys, constraints, and indexes (MASTER_PLAN §4.7) | ⬜ Upcoming (Sprint 1) |
| 003d | Implement `aura_score` trigger (read-only cache, per Decision #007) | ⬜ Upcoming (Sprint 1) |
| 003e | Rate-limit Edge Function helper | ⬜ Upcoming (Sprint 1) |

**Upcoming (Sprint 2 / Phase 1 continuation):** #004 Authentication Database (hardened schema migration) → #005 Auth screens (Next.js `(auth)` route group) → #006 OTP/magic-link verification (per Decision #008) → #007 Session management (refresh tokens, multi-device, Next.js middleware) → #008 Account deletion / data export → #009 `/admin` route shell with role-gated middleware (per Decision #010).

---

## 2. 👥 Stakeholders & Actors

| Actor | Type | Role |
|-------|------|------|
| `Student` | Human — Primary | Core user. All social interactions: discovers, matches, posts, chats, joins communities, attends events. |
| `Society Member` | Human — Student subtype | Participates in society communities; may post community content. |
| `Society Leadership` | Human — Student subtype | Creates events; manages society community; moderates society posts. |
| `Event Organizer` | Human — Student subtype | Creates and manages campus events; posts event updates. |
| `Admin` | Human — Secondary | Uses web admin dashboard to manage users, content, reports, events, communities, and analytics. |
| `Supabase` | External System | BaaS platform providing Auth, PostgreSQL, Realtime, Storage, Edge Functions. |
| `Claude API` | External AI System | Provides icebreaker suggestions, compatibility explanations, and content moderation assistance. |
| `Expo Notifications` | External System | Delivers push notifications to Android and iOS devices. |

---

## 3. 📖 Use Cases

### Use Case List

| ID | Name | Actor(s) | Priority | Module |
|----|------|----------|----------|--------|
| UC-01 | Register with FAST university email | Student + Supabase | High | Auth |
| UC-02 | Set up profile (bio, department, interests) | Student | High | Profiles |
| UC-03 | Discover and swipe student profiles | Student | High | Discover |
| UC-04 | Send message request to a profile | Student | High | Discover |
| UC-05 | Create a match (mutual like) | Student + Student | High | Matching |
| UC-06 | Send and receive real-time messages | Student + Supabase Realtime | High | Messaging |
| UC-07 | Create and view posts in the feed | Student | High | Feed |
| UC-08 | Post anonymously | Student | Medium | Feed |
| UC-09 | Join and participate in a community | Student | High | Communities |
| UC-10 | Create and RSVP to an event | Society Leadership / Student | High | Events |
| UC-11 | Earn Aura points through activity | Student (system-triggered) | High | Aura |
| UC-12 | View weekly leaderboard and titles | Student | Medium | Leaderboard |
| UC-13 | Participate in department rivalry | Student | Medium | Dept. Rivalry |
| UC-14 | Receive and read notifications | Student | High | Notifications |
| UC-15 | Report a user, post, or message | Student | High | Moderation |
| UC-16 | Admin reviews reports and moderates | Admin | High | Admin Dashboard |

---

### UC-01 — Register with FAST University Email

```
Use Case ID  : UC-01
Name         : Register with FAST University Email
Actor(s)     : Student (initiator), Supabase Auth (external system)
Precondition : Student has a valid @nu.edu.pk or @fastnuces.edu.pk email
Trigger      : Student downloads the app and taps "Sign Up"
Main Flow    :
  1. Student enters their FAST university email and a password
  2. App validates email domain (must be @nu.edu.pk / @fastnuces.edu.pk)
  3. Supabase Auth sends a verification email
  4. Student clicks the verification link in their email
  5. Account is activated — student is redirected to profile setup (UC-02)
Alternative Flow (A1 — Non-university email):
  1. App validates email domain — domain does not match
  2. App shows: "Only FAST university emails are accepted."
  3. Student cannot proceed
Alternative Flow (A2 — Email already registered):
  1. Supabase returns "email already exists"
  2. App shows: "Account already exists. Login instead?"
Postcondition: Verified user record created in `users` table; onboarding begins
```

---

### UC-03 — Discover and Swipe Student Profiles

```
Use Case ID  : UC-03
Name         : Discover and Swipe Student Profiles
Actor(s)     : Student
Precondition : Student is authenticated and has completed profile setup
Trigger      : Student opens the Discover tab
Main Flow    :
  1. App fetches a batch of profiles the student has not yet liked or passed
  2. Profiles are sorted by compatibility percentage (mutual interests)
  3. Student sees a card: Name, Department, Semester, Interests, Aura Score,
     Mutual Interests count, Compatibility %
  4. Student performs one of three actions:
       PASS  → Card dismissed; profile not shown again (saved to `passes`)
       LIKE  → Like recorded in `likes`; check for mutual like (UC-05)
       MSG   → Student types a 100-char intro message → MessageRequest created
  5. Next card loaded; process repeats
Alternative Flow (A1 — No more profiles to show):
  1. App shows: "You've seen everyone for now. Check back later!"
Postcondition: Like/Pass/MessageRequest saved; Aura transaction may be triggered
```

---

### UC-05 — Create a Match (Mutual Like)

```
Use Case ID  : UC-05
Name         : Create a Match
Actor(s)     : Student A, Student B (both)
Precondition : Both students have liked each other
Trigger      : Student B likes Student A — system detects mutual like
Main Flow    :
  1. Student B swipes Like on Student A
  2. System checks `likes` table: does Student A already like Student B?
  3. YES → Mutual like confirmed
  4. System creates a record in `matches` table
  5. System creates a `conversation` and `conversation_members` for both
  6. Both students receive a push notification: "It's a match! 🎉"
  7. Chat is now unlocked for both — appears in their Chat list
Postcondition: `matches` row created; conversation created; both users get +10 Aura
```

---

### UC-06 — Real-Time Messaging

```
Use Case ID  : UC-06
Name         : Send and Receive Real-Time Messages
Actor(s)     : Student (sender), Student (receiver), Supabase Realtime
Precondition : A match exists between the two students OR a message request was accepted
Trigger      : Student opens a conversation and types a message
Main Flow    :
  1. Student opens a conversation from the Chat list
  2. Student types a message and taps Send
  3. Message is inserted into `messages` table
  4. Supabase Realtime broadcasts the message to the receiver's client
  5. Receiver sees the message appear in real-time with typing indicator
  6. Receiver opens the conversation → message marked as read
  7. Read receipt visible to sender
Alternative Flow (A1 — Media message):
  1. Student taps the media button → selects image/video/voice
  2. Media uploaded to Supabase Storage (chat-media bucket)
  3. Message inserted with message_type = 'image'/'video'/'voice' + media_url
Postcondition: Message persisted; read status tracked; conversation active
```

---

### UC-08 — Post Anonymously

```
Use Case ID  : UC-08
Name         : Post Anonymously
Actor(s)     : Student
Precondition : Student is authenticated
Trigger      : Student creates a post and selects "Post Anonymously"
Main Flow    :
  1. Student composes a post (text, image, etc.)
  2. Student toggles "Post Anonymously" switch → selects a category
     (Confessions / Opinions / Questions / Campus Stories / Discussions)
  3. Post created in `posts` table with is_anonymous = TRUE
     and author_id set to the student's actual user_id (hidden from public)
  4. Post appears in feed with "Anonymous" as display name and no avatar
  5. Other students see the content but not the author's identity
Alternative Flow (A1 — Admin review):
  1. Admin can query any post's author_id regardless of is_anonymous flag
  2. Admin can take action on the author if content violates policies
Postcondition: Post visible publicly as anonymous; author traceable to admins only
```

---

### UC-11 — Earn Aura Points

```
Use Case ID  : UC-11
Name         : Earn Aura Points Through Activity
Actor(s)     : Student (activity trigger), System (Aura engine)
Precondition : Student is active in the app
Trigger      : Any aura-earning action occurs (match, post, event, etc.)
Main Flow    :
  1. A trackable event occurs (e.g., student attends an event)
  2. System inserts a record into `aura_transactions`:
       user_id = student_id
       action_type = 'event_attend'
       points = +15
  3. System updates `profiles.aura_score` by summing all transactions for that user
  4. If the student crosses a leaderboard ranking threshold → notify them
  5. Department score is also updated for the weekly rivalry tally
Postcondition: aura_transactions updated; profiles.aura_score recalculated
```

---

### Use Case Diagram

```
[Student] ─────────────────────────────────────────────────────────
  │
  ├── (UC-01: Register) ──────────────────────── [Supabase Auth]
  │         <<include>> (Email Verification)
  │
  ├── (UC-02: Setup Profile)
  │
  ├── (UC-03: Discover Profiles)
  │         <<include>> (UC-04: Message Request)
  │         <<include>> (UC-05: Match Creation) ←─ mutual trigger
  │
  ├── (UC-06: Real-Time Messaging) ─────────────[Supabase Realtime]
  │
  ├── (UC-07: Create Feed Post)
  ├── (UC-08: Post Anonymously) <<extend>> (UC-07)
  │
  ├── (UC-09: Join Community)
  │
  ├── (UC-10: RSVP to Event)
  │
  ├── (UC-11: Earn Aura) ← system-triggered by all above
  ├── (UC-12: View Leaderboard)
  ├── (UC-13: Department Rivalry)
  │
  ├── (UC-14: Receive Notifications) ──────────[Expo Notifications]
  └── (UC-15: Report Content)

[Admin] ────────────────────────────────────────────────────────────
  └── (UC-16: Moderate via Admin Dashboard)

[Claude API] ───────────────────────────────────────────────────────
  ├── <<extends>> UC-03 (Compatibility Explanations)
  ├── <<extends>> UC-06 (Icebreaker Suggestions)
  └── <<extends>> UC-16 (Moderation Assistance)
```

---

## 4. 📋 Requirements

### Functional Requirements

| ID | Requirement | Priority | Use Case |
|----|-------------|----------|----------|
| FR-01 | Only FAST university email addresses (@nu.edu.pk) may register | High | UC-01 |
| FR-02 | Users must complete profile (name, dept, semester, interests, bio) before accessing the app | High | UC-02 |
| FR-03 | Discover cards must show: name, dept, semester, interests, Aura score, mutual interests, compatibility % | High | UC-03 |
| FR-04 | Discover supports exactly 3 actions: Pass, Like, Message Request (max 100 chars) — no super likes, no boosts, no paid advantages (UIspec.md) | High | UC-03, UC-04 |
| FR-05 | A mutual like between two students creates a match and unlocks their conversation | High | UC-05 |
| FR-06 | Real-time messaging must support: text, images, videos, voice notes, emoji reactions, read receipts, typing indicators, reply, pin, search | High | UC-06 |
| FR-07 | Feed supports post types: image, video, text, reel, poll — with like reactions, comments, replies, save, share, infinite scroll | High | UC-07 |
| FR-08 | Anonymous posts hide author from public view; author identity must remain traceable to admins | High | UC-08 |
| FR-09 | Communities support discussion threads, polls, announcements, media, and moderation roles (member/moderator/admin) | High | UC-09 |
| FR-10 | Events support creation (by Society Leadership), RSVP (interested/going), friend attendance view, reminders | High | UC-10 |
| FR-11 | Aura system records all transactions with point values and recalculates profile score after each event; Aura is never purchasable (UIspec.md) | High | UC-11 |
| FR-12 | Weekly leaderboard ranks users by Aura score; top 3 receive titles: Main Character / Campus Celebrity / Aura Farmer; resets weekly | Medium | UC-12 |
| FR-13 | Department rivalry aggregates all member activity weekly; winning department receives trophy + badge + recognition | Medium | UC-13 |
| FR-14 | Push notifications sent for: matches, messages, requests, reactions, comments, mentions, replies, events, leaderboard, department updates | High | UC-14 |
| FR-15 | Users can report profiles, posts, messages, and communities | High | UC-15 |
| FR-16 | Admin web dashboard (Next.js) for: user management, post moderation, community management, event management, report review, analytics | High | UC-16 |
| FR-17 | Claude API used for: icebreaker message suggestions, compatibility explanations in Discover, moderation assistance | Medium | UC-03, UC-06, UC-16 |
| FR-18 | App must support both dark mode and light mode, with dark as the primary/default visual identity (UIspec.md) | High | — |

### Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-01 | Performance | First Contentful Paint under 1.8s and Largest Contentful Paint under 2.5s on a mid-range Android phone over 4G; PWA shell cached for instant subsequent loads |
| NFR-02 | Performance | Feed scroll must be smooth (60fps) on mobile Chrome and iOS Safari; media lazy-loaded; backdrop-filter usage budgeted to avoid scroll jank on long lists |
| NFR-03 | Reliability | Real-time messaging must deliver messages within 500ms under normal load |
| NFR-04 | Scalability | System must support thousands of concurrent users (Supabase Realtime channels) |
| NFR-05 | Security | Every Supabase table must implement Row-Level Security (RLS) policies |
| NFR-06 | Security | FAST email verification required before any app access is granted |
| NFR-07 | Security | All messaging transport encrypted (TLS via Supabase) |
| NFR-08 | Security | Rate limiting enforced on all write operations; spam prevention active |
| NFR-09 | Privacy | Anonymous post author must be hidden from all non-admin queries |
| NFR-10 | Reliability | Push notification delivery confirmed via Expo Notifications receipts |
| NFR-11 | Usability | Every major action achievable within 1–2 taps from bottom nav |
| NFR-12 | Maintainability | Feature-based service structure — one service file per feature module |
| NFR-13 | Accessibility | Readable contrast, scalable typography, touch-friendly tap targets in both light and dark themes (UIspec.md) |
| NFR-14 | Usability | UI animations must run 200–350ms using fade/scale/slide/blur transitions only — no bouncy or excessive motion (UIspec.md) |

---

## 5. 🗃️ Domain Model & Class Diagram

### Entities

| Entity | Description |
|--------|-------------|
| `User` | Auth record — email, password, session (managed by Supabase Auth) |
| `Profile` | Public user data — name, bio, dept, interests, aura score |
| `Interest` | A tag (Football, Gaming, Finance, etc.) |
| `Like` | A student expressing interest in another student in Discover |
| `Pass` | A skip — prevents the same profile from appearing again |
| `MessageRequest` | A 100-char intro message sent before a match exists |
| `Match` | Created when two students mutually like each other |
| `Conversation` | A chat session between two matched users |
| `Message` | A single chat message (text, image, video, voice) |
| `Post` | A feed post (image, video, text, reel, poll) — may be anonymous |
| `Comment` | A reply to a post or nested comment |
| `Reaction` | An emoji reaction on a post (like, fire, funny, smart, wholesome) |
| `Community` | A Reddit-style group (dept, society, gaming, etc.) |
| `CommunityMember` | Membership record with role (member/moderator/admin) |
| `CommunityPost` | A post within a community thread |
| `Event` | A campus event with RSVP |
| `EventAttendee` | Student RSVP record (interested/going) |
| `AuraTransaction` | An atomic +/- points event for a user |
| `LeaderboardSnapshot` | Weekly rank snapshot per user |
| `Department` | A university department (CS, SE, AI, DS, EE, FinTech) |
| `DepartmentScore` | Weekly aggregate score for a department |
| `Notification` | A push/in-app notification record |
| `Report` | A user-submitted report on content or another user |

---

### Class Diagram

```
+-------------------+           +---------------------+
|      User         |1        1 |       Profile       |
+-------------------+---------->+---------------------+
| - id: UUID (PK)   |           | - id: UUID (PK)     |
| - email: TEXT     |           | - user_id: UUID (FK)|
| - created_at      |           | - full_name: TEXT   |
| - last_active     |           | - bio: TEXT         |
+-------------------+           | - department: TEXT  |
                                 | - semester: INT     |
                                 | - profile_picture   |
                                 | - personality_type  |
                                 | - favorite_music    |
                                 | - favorite_shows    |
                                 | - aura_score: INT   |
                                 +---------------------+
                                         |*
                                         | profile_interests (M:M)
                                         |*
                                 +---------------------+
                                 |     Interest        |
                                 +---------------------+
                                 | - id: UUID (PK)     |
                                 | - name: TEXT UNIQUE |
                                 +---------------------+

[Profile] ──1──SENDS──*──> [Like]
[Profile] ──1──SENDS──*──> [Pass]
[Profile] ──1──SENDS──*──> [MessageRequest]
[Like A] + [Like B mutual] ──────────────> [Match]
[Match]  ────────────────────────────────> [Conversation]

+-------------------+           +---------------------+
|     Match         |1        1 |   Conversation      |
+-------------------+---------->+---------------------+
| - id: UUID        |           | - id: UUID          |
| - user_one: UUID  |           | - created_at        |
| - user_two: UUID  |           +---------------------+
| - created_at      |                    |1
+-------------------+                    |
                                         |*
                                 +---------------------+
                                 |     Message         |
                                 +---------------------+
                                 | - id: UUID          |
                                 | - conversation_id   |
                                 | - sender_id: UUID   |
                                 | - message_type      |
                                 |   (text/img/vid/vce)|
                                 | - content: TEXT     |
                                 | - media_url: TEXT   |
                                 | - created_at        |
                                 +---------------------+

+-------------------+
|      Post         |
+-------------------+
| - id: UUID        |
| - author_id: UUID |
| - content: TEXT   |
| - media_url: TEXT |
| - post_type       |
|  (text/img/vid/   |
|   reel/poll)      |
| - is_anonymous    |
| - created_at      |
+-------------------+
    |1         |1
    |*         |*
[Comment]  [Reaction]
                (like/fire/funny/
                 smart/wholesome)

+-------------------+           +---------------------+
|   Community       |1        * |  CommunityMember    |
+-------------------+---------->+---------------------+
| - id: UUID        |           | - community_id      |
| - name: TEXT      |           | - user_id: UUID     |
| - description     |           | - role              |
| - community_type  |           |  (member/mod/admin) |
| - created_by      |           +---------------------+
+-------------------+
        |1
        |*
[CommunityPost]

+-------------------+           +---------------------+
|      Event        |1        * |   EventAttendee     |
+-------------------+---------->+---------------------+
| - id: UUID        |           | - event_id: UUID    |
| - title: TEXT     |           | - user_id: UUID     |
| - location        |           | - status            |
| - start_time      |           |  (interested/going) |
| - end_time        |           +---------------------+
| - created_by      |
+-------------------+

+---------------------+
|   AuraTransaction   |
+---------------------+
| - id: UUID          |
| - user_id: UUID     |
| - action_type: TEXT |
| - points: INT       |
| - created_at        |
+---------------------+

+---------------------+
|  LeaderboardSnapshot|
+---------------------+
| - user_id: UUID     |
| - aura_score: INT   |
| - rank: INT         |
| - week_number: INT  |
+---------------------+

+---------------------+       +---------------------+
|    Department       |1    * |  DepartmentScore    |
+---------------------+------>+---------------------+
| - id: UUID          |       | - department_id     |
| - name: TEXT        |       | - score: INT        |
+---------------------+       | - week_number: INT  |
                               +---------------------+
```

### Enumerations

```
PostType         : text | image | video | reel | poll
MessageType      : text | image | video | voice
ReactionType     : like | fire | funny | smart | wholesome
MemberRole       : member | moderator | admin
AttendeeStatus   : interested | going
MessageReqStatus : pending | accepted | rejected
ReportStatus     : pending | reviewed | dismissed | action_taken
NotificationType : match | chat | post | event | community | leaderboard
CommunityType    : department | society | gaming | sports | anime | entrepreneurship | photography
AuraActionType   : match_created | msg_request_accepted | conversation_active |
                   post_created | post_liked | post_commented | community_post |
                   community_engagement | event_attended | event_created |
                   report_confirmed | spam | harassment
```

---

## 6. 🔄 Sequence Diagrams

### SD-01: Registration + Email Verification

```
Student      App         SupabaseAuth    EmailService
  |           |               |               |
  |--register->|              |               |
  |           |--signUp()---->|               |
  |           |               |--sendEmail()->|
  |           |<--"Check email"|              |
  |           |               |      [student clicks link]
  |           |               |<--verify()----|
  |           |               |               |
  |           |<--session-----|               |
  |--profile setup screen-----|               |
```

---

### SD-02: Mutual Like → Match → Chat Unlock

```
StudentA    App        Database    StudentB    Notifications
  |          |             |           |             |
  |--Like B->|             |           |             |
  |          |--insert like->          |             |
  |          |--checkMutual()--------->|             |
  |          |<--"B already liked A"---|             |
  |          |--createMatch()--------->|             |
  |          |--createConversation()-->|             |
  |          |--auraTransaction(+10)-->|             |
  |          |--notify(A)-------------------------->|
  |          |--notify(B)-------------------------->|
  |<-- "It's a match! 🎉"                           |
                                   |<-- "It's a match! 🎉"
```

---

### SD-03: Anonymous Post Flow

```
Student    App       Database     FeedService    Admin
  |         |            |             |           |
  |-compose->|           |             |           |
  |-toggle anon->|       |             |           |
  |         |--insertPost(is_anon=true,author_id=X)->|
  |         |            |             |           |
  |         |<--post_id--|             |           |
  [post appears publicly as "Anonymous"]          |
  |                                               |
  [Admin queries]                                 |
                              |<--getPostAuthor(post_id)
                              |-->returns author_id=X--|
```

---

### SD-04: Aura Transaction Flow

```
System      App        AuraService    Database    LeaderboardService
  |          |               |            |              |
[Event: Student attends event]
  |          |--logAura()-->|            |              |
  |          |              |--insert(+15)-->           |
  |          |              |--updateScore()-->         |
  |          |              |            |--checkRank()->|
  |          |              |            |              |--updateSnapshot()
  |          |<--new aura_score displayed|              |
  |          |--notify("Your Aura grew!")|              |
```

---

### SD-05: Real-Time Message Delivery

```
StudentA      App-A       Supabase Realtime    App-B        StudentB
  |            |                  |              |              |
  |--type msg->|                  |              |              |
  |            |--insert message->|              |              |
  |            |                  |--broadcast-->|              |
  |            |                  |              |--display msg->|
  |            |<--read_receipt---|<-------------|              |
  |  ✓✓ shown  |                  |              |              |
```

---

## 7. 🗺️ State Diagrams

### Message Request Lifecycle

```
[Student sends intro message]
          |
          v
       [PENDING]
       /        \
[Receiver accepts] [Receiver rejects]
       |                 |
       v                 v
   [ACCEPTED]        [REJECTED]
       |
[Chat unlocked]
```

---

### User Account Lifecycle

```
[Registers with FAST email]
         |
         v
    [UNVERIFIED]
         |
  [Clicks email link]
         |
         v
      [ACTIVE] ←──────────────────────────────────────┐
         |                                              │
  [Report confirmed / violation]               [Appeal accepted]
         |                                              │
         v                                              │
    [SUSPENDED] ──────────────────────────────────────►│
         |
  [Severe violation]
         |
         v
      [BANNED]
```

---

### Post Lifecycle

```
[Student creates post]
         |
         v
     [PUBLISHED] ←─────────────────────┐
         |                              │
  [User files report]          [Admin clears report]
         |                              │
         v                              │
     [FLAGGED] ────────────────────────►│
         |
  [Admin confirms violation]
         |
         v
     [REMOVED]
```

---

### Aura Score Lifecycle (Weekly Leaderboard)

```
[Week begins — scores carried over]
         |
         v
[Aura transactions accumulate all week]
         |
         v
[Sunday 11:59 PM — snapshot taken]
         |
         v
[Leaderboard updated — titles assigned]
  Rank 1 → "Main Character"
  Rank 2 → "Campus Celebrity"
  Rank 3 → "Aura Farmer"
         |
         v
[Leaderboard RESETS — lifetime score preserved]
         |
         v
[New week begins]
```

---

## 8. 🏗️ System Architecture

### Architecture Pattern
**Web PWA + BaaS** — Next.js (App Router) frontend installable as a Progressive Web App + Supabase as the full backend platform. Serverless Edge Functions for custom business logic. Supabase Realtime for live features. The Admin Dashboard ships as `/admin` routes inside the same Next.js app, gated by role-based RLS (no separate codebase).

```
┌──────────────────────────────────────────────────────────┐
│                  NEXT.JS APP (PWA)                        │
│   Mobile-web-first, installable to home screen            │
│   App Router · React Server Components · Tailwind         │
│   Zustand (client state) + TanStack Query (server state)  │
│   framer-motion (UIspec animations) · CSS backdrop-filter │
│   Service Worker (offline shell + Web Push receiver)      │
│   Routes:  /  (student app)   /admin  (role-gated)        │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTPS / WSS
┌────────────────────────▼─────────────────────────────────┐
│                 SUPABASE API LAYER                         │
│         PostgREST (auto-generated REST from schema)        │
│         Row-Level Security enforced on every table         │
└──────┬────────────┬────────────────┬──────────────────────┘
       │            │                │
  ┌────▼───┐  ┌─────▼────┐   ┌─────▼────────┐
  │  Auth   │  │PostgreSQL│   │   Storage     │
  │(sessions│  │(all data │   │ (avatars,     │
  │ tokens) │  │  + RLS)  │   │  posts,reels, │
  └─────────┘  └─────┬────┘   │  chat-media)  │
                     │        └──────────────┘
               ┌─────▼────────┐
               │   Realtime   │
               │ (chat, notif,│
               │  online stat)│
               └─────┬────────┘
                     │
               ┌─────▼────────┐        ┌──────────────┐
               │Edge Functions│◄───────►│  Claude API  │
               │(aura engine, │        │(icebreakers, │
               │ match logic, │        │ compat expls,│
               │ dept rivalry,│        │ moderation)  │
               │ web-push fan-│        └──────────────┘
               │ out via VAPID│
               └─────┬────────┘
                     │
               ┌─────▼────────┐
               │  Web Push    │
               │ (browser push│
               │  services —  │
               │  FCM/APNs    │
               │  transparent)│
               └──────────────┘
```

### Component Responsibilities

| Component | Technology | Responsibility |
|-----------|-----------|---------------|
| Web App (PWA) | Next.js 15 (App Router) + TypeScript + Tailwind | All student UI, routing, state management, media playback, installable shell |
| Admin Routes | Next.js `/admin` (same app) | Content moderation, user management, analytics, event management — role-gated via RLS + middleware |
| Service Worker | Workbox / next-pwa | Offline shell cache, push notification receiver, install prompt orchestration |
| Auth | Supabase Auth | FAST email signup, verification, session management, JWT |
| Database | Supabase PostgreSQL + RLS | All persistent data; security enforced at DB level |
| Realtime | Supabase Realtime | Messages, typing indicators, online status, live notifications |
| Storage | Supabase Storage | Avatars, post media, reels, event images, chat media |
| Edge Functions | Supabase Edge Functions (Deno) | Aura transactions, match logic, leaderboard reset, dept scoring, web-push dispatch |
| AI Layer | Claude API | Icebreakers, compatibility explanations, moderation suggestions |
| Push | Web Push API + VAPID keys | Browser-delivered push to Android Chrome and installed iOS PWAs (iOS 16.4+); the browser handles FCM/APNs transparently |

---

## 9. 🗄️ Data Model (PostgreSQL via Supabase)

### Table: `users` *(Supabase Auth managed)*

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Supabase Auth user ID |
| `email` | TEXT | UNIQUE, NOT NULL | Must match FAST domain |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |
| `last_active` | TIMESTAMP | | Updated on each session |

---

### Table: `profiles`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users.id, UNIQUE | |
| `full_name` | TEXT | NOT NULL | |
| `bio` | TEXT | | |
| `department` | TEXT | NOT NULL | CS / SE / AI / DS / EE / FinTech |
| `semester` | INT | NOT NULL | 1–8 |
| `profile_picture` | TEXT | | URL in Supabase Storage |
| `personality_type` | TEXT | | MBTI or custom |
| `favorite_music` | TEXT | | |
| `favorite_shows` | TEXT | | |
| `aura_score` | INT | DEFAULT 0 | Sum of all aura_transactions |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |

---

### Table: `interests`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |

*Seed data: Football, Gaming, Finance, Startups, Movies, Photography, Anime, Music, Coding, Sports, Reading, Art*

---

### Table: `profile_interests` *(M:M join)*

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `profile_id` | UUID | FK → profiles.id |
| `interest_id` | UUID | FK → interests.id |

---

### Table: `likes`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `sender_id` | UUID | FK → profiles.id |
| `receiver_id` | UUID | FK → profiles.id |
| `created_at` | TIMESTAMP | DEFAULT NOW() |

---

### Table: `passes`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `sender_id` | UUID | FK → profiles.id | |
| `receiver_id` | UUID | FK → profiles.id | |
| `created_at` | TIMESTAMP | | |

*Purpose: Prevents showing the same profile twice in Discover*

---

### Table: `message_requests`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `sender_id` | UUID | FK → profiles.id |
| `receiver_id` | UUID | FK → profiles.id |
| `message` | TEXT | MAX 100 chars |
| `status` | TEXT | ENUM(pending, accepted, rejected) |
| `created_at` | TIMESTAMP | |

---

### Table: `matches`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `user_one` | UUID | FK → profiles.id |
| `user_two` | UUID | FK → profiles.id |
| `created_at` | TIMESTAMP | |

---

### Table: `conversations` + `conversation_members`

| Column | Type | Notes |
|--------|------|-------|
| conversations.id | UUID PK | |
| conversations.created_at | TIMESTAMP | |
| conversation_members.conversation_id | UUID FK | |
| conversation_members.user_id | UUID FK | |

---

### Table: `messages`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `conversation_id` | UUID | FK → conversations.id |
| `sender_id` | UUID | FK → profiles.id |
| `message_type` | TEXT | ENUM(text, image, video, voice) |
| `content` | TEXT | |
| `media_url` | TEXT | Supabase Storage URL |
| `created_at` | TIMESTAMP | |

---

### Table: `posts`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `author_id` | UUID | FK → profiles.id |
| `content` | TEXT | |
| `media_url` | TEXT | |
| `post_type` | TEXT | ENUM(text, image, video, reel, poll) |
| `is_anonymous` | BOOLEAN | DEFAULT FALSE |
| `created_at` | TIMESTAMP | |

---

### Tables: `comments`, `reactions`, `communities`, `community_members`, `community_posts`, `events`, `event_attendees`
*(As specified in TAD — relationships follow domain model in Section 5)*

---

### Table: `aura_transactions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `user_id` | UUID FK | |
| `action_type` | TEXT | See AuraActionType enum |
| `points` | INT | Positive or negative |
| `created_at` | TIMESTAMP | |

### Aura Point Values

| Action | Points |
|--------|--------|
| Match created | +10 |
| Message request accepted | +5 |
| Conversation exceeds 20 messages | +10 |
| Create post | +2 |
| Receive like | +1 |
| Receive comment | +2 |
| Community post | +3 |
| Community engagement | +2 |
| Attend event | +15 |
| Create event | +20 |
| Confirmed report against user | -20 |
| Spam | -50 |
| Harassment | -100 |

> 🔒 **Confirmed rule (UIspec.md + PRD.md NS3):** Aura can never be bought, boosted, or otherwise influenced by money. There is no monetized path to a higher Aura score, anywhere in the product.

---

## 10. 🔐 Security & Access Control

### Authentication Strategy
- Supabase Auth — email + password
- FAST university email domain validation on signup
- JWT-based sessions managed by Supabase
- Session expiry and refresh handled automatically

### Row-Level Security (RLS) — Key Policies

| Table | Policy |
|-------|--------|
| `profiles` | Read: anyone authenticated. Write: only own profile |
| `posts` | Read: anyone authenticated. Write: own posts only. is_anonymous author hidden via RLS to non-admins |
| `messages` | Read: only conversation members. Write: only conversation members |
| `likes` | Read: own only. Write: own only. No viewing who liked whom |
| `matches` | Read: only matched users. Write: system only (Edge Function) |
| `aura_transactions` | Read: own only. Write: Edge Functions only (not client) |
| `reports` | Write: any authenticated user. Read: admins only |

### Feature Access Matrix

| Feature | Unverified | Student | Society Leadership | Admin |
|---------|-----------|---------|-------------------|-------|
| Register | ✅ | — | — | — |
| View feed | ❌ | ✅ | ✅ | ✅ |
| Discover | ❌ | ✅ | ✅ | ✅ |
| Message | ❌ | ✅ (matched only) | ✅ | ✅ |
| Create post | ❌ | ✅ | ✅ | ✅ |
| Create event | ❌ | ❌ | ✅ | ✅ |
| Moderate content | ❌ | ❌ | ❌ (own community) | ✅ |
| View anonymous post author | ❌ | ❌ | ❌ | ✅ |
| Ban users | ❌ | ❌ | ❌ | ✅ |

### Security Checklist
- [ ] Email domain validation on signup (@nu.edu.pk enforced)
- [ ] RLS enabled and tested on every table
- [ ] Anonymous post author field hidden in all non-admin queries
- [ ] Aura transactions only writable via Edge Functions (not client)
- [ ] Rate limiting on: signup, post creation, message sending, like actions
- [ ] Media upload size limits enforced in Supabase Storage
- [ ] Admin dashboard uses Supabase service role key (server-side only)
- [ ] Claude API key stored server-side in Edge Functions only

---

# 11.0 FAST SOCIO — UI Specification v2.0

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

**Web rendering notes (v3.0):** glass surfaces are implemented with CSS `backdrop-filter: blur(…)` plus a translucent `background-color` and a 1px translucent border. Two practical constraints follow:
- `backdrop-filter` is supported in Safari (with `-webkit-` prefix), Chrome, and Firefox (since 103), but Firefox's implementation is slower — verify §5.3 ("Campus Pulse") and §5.4 (Feed) scroll perf on Firefox during Phase 7.
- Many simultaneously blurred surfaces on screen cause measurable scroll jank on mid-range Android. Budget: no more than ~6 actively blurred surfaces visible at once on feed-style screens. Cards scrolled off-screen should drop their blur layer (use `content-visibility: auto` and/or virtualization for long lists per NFR-02).

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


## 12. 🔌 API Design

### Service Files (Feature-Based — from TAD)

| Service File | Key Operations |
|-------------|----------------|
| `auth.service.ts` | signUp, signIn, signOut, resetPassword, verifyEmail |
| `profile.service.ts` | getProfile, updateProfile, setInterests, getCompatibility |
| `discover.service.ts` | getDiscoverQueue, likeProfile, passProfile |
| `match.service.ts` | checkMutualLike, createMatch, getMatches |
| `chat.service.ts` | getConversations, getMessages, sendMessage, subscribeToConversation |
| `feed.service.ts` | getFeed, createPost, likePost, commentPost, getReels |
| `community.service.ts` | getCommunities, joinCommunity, getCommunityPosts, createCommunityPost |
| `event.service.ts` | getEvents, createEvent, rsvpEvent, getEventAttendees |
| `aura.service.ts` | logAuraTransaction, getAuraHistory, getUserAuraScore |
| `leaderboard.service.ts` | getWeeklyLeaderboard, getLifetimeLeaderboard, getUserRank |
| `notification.service.ts` | getNotifications, markAsRead, subscribeToPushNotifications |

### Claude API Integration Points

| Integration | Trigger | Prompt Purpose |
|-------------|---------|---------------|
| Icebreaker suggestions | User opens a new chat after match | Suggest 3 opening lines based on mutual interests |
| Compatibility explanation | Discover card expanded | "Why are you compatible?" natural language explanation |
| Moderation assistance | Admin reviewing a flagged post | Assess severity and suggest action |

---

## 13. ⚠️ Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Low adoption — students don't make the switch | Medium | Critical | Seed with society leaders and influencers; launch during fresher week |
| Aura system encourages unhealthy usage | Medium | High | Aura penalties; daily limits on certain actions; wellbeing messaging |
| Anonymous posts used for harassment | High | High | Admin traceability; active moderation; one-strike policy for serious violations |
| Supabase Realtime hitting concurrent connection limits | Medium | High | Monitor usage; upgrade Supabase plan; implement connection pooling |
| FAST email domain change invalidates registrations | Low | High | Make domain list configurable; plan for domain migration |
| Claude API cost scaling with moderation volume | Medium | Medium | Rate limit moderation calls; cache common responses; use batch processing |
| Discover algorithm surfacing inappropriate profiles | Medium | High | Pre-launch profile review; strong RLS; swift report handling |
| App store rejection (content policy) | Low | High | Review Apple/Google content guidelines; content filters in place before submission |
| Data breach exposing anonymous post authors | Low | Critical | Admin-only queries; audit logs; RLS on is_anonymous filtering |
| iOS PWA push limitations weaken retention loop (v3.0) | High | High | iOS Safari only delivers push to *installed* PWAs (16.4+). Onboarding must nudge install at the right moment (see OQ-12); fall back to in-app notification feed (§5.15) for users who decline install; consider scheduled re-engagement emails for high-value triggers (new match) |
| `backdrop-filter` perf jank on long feeds (v3.0) | Medium | Medium | Budget at most ~6 simultaneously blurred surfaces; virtualize feed and chat lists; benchmark on a mid-range Android during Phase 7 (NFR-02); have a "reduced glass" fallback for low-end devices |
| No app-store discovery (v3.0) | Low | Low | Mitigated by FAST-exclusivity — distribution is via direct URL share within a captive university audience, not organic search. Plan a campus-wide launch push (society leaders, fresher week) per existing §13 row |

---

## 14. 📅 Project Phases & Milestones

> **Authoritative source: `MASTER_PLAN.docx` v2.1** (post web-pivot annotations, 2026-06-30). The plan retains the original 12-phase TAD structure (Decision #006, reaffirmed in the v3.0 pivot review). v2.1 updates per-phase scope notes to reflect the Next.js/PWA stack; phase count and ordering are unchanged. The schema and security additions from v2.0 (RLS, FKs, `blocked_users`, `moderation_audit_log`, rate limiting, polymorphic `reports`, aura single-source-of-truth, scheduled snapshots) are framework-agnostic and carry over unchanged.

### 14.1 Authoritative Phase Plan (`MASTER_PLAN.docx` v2.1, 12 phases)

| Phase | Scope | Status |
|---|---|---|
| 1 | **Authentication + Foundation (expanded).** Hardened schema migration (all TAD tables + `blocked_users`, `notification_preferences`, `rate_limit_events`, `moderation_audit_log`, polymorphic `reports`), FKs/indexes per MASTER_PLAN §4.7, RLS policy bodies, `aura_score` trigger, OTP/magic-link verification, session/refresh-token strategy, account deletion. **v2.1 additions:** Next.js + TypeScript + Tailwind project, PWA shell (`next-pwa`, manifest, service worker), glass primitives, floating dock layout, VAPID keypair, `/admin` route shell with role-gated middleware. | 🔄 In Progress (Sprint 1) |
| 2 | **Discover, Likes, Matches, Message Requests.** + `blocked_users` enforcement in candidate query, + rate-limit checks. v2.1: framer-motion drag for swipe, keyboard fallback per OQ-13, per-feature admin slice `/admin/reports?type=profile`. | ⬜ |
| 3 | **Chat (Real-time).** + `blocked_users` enforcement, + per-conversation Realtime channel partitioning. v2.1: MediaRecorder API voice notes (webm/Opus with iOS Safari mp4 fallback), per-feature admin slice `/admin/reports?type=message`. | ⬜ |
| 4 | **Feed, Comments, Reactions.** + cursor-based pagination from day one, + media pipeline (thumbnailing/transcoding) decision finalized here. v2.1: `next/image`, backdrop-filter perf budget validation (NFR-02), per-feature admin slice `/admin/moderation/posts` with deanonymization audit-log writes. | ⬜ |
| 5 | **Communities.** v2.1: community-creation request flow per OQ-5; per-feature admin slice `/admin/communities`. | ⬜ |
| 6 | **Events.** v2.1: QR ticket card at `/events/[id]` post-RSVP; per-feature admin slice `/admin/events`. | ⬜ |
| 7 | **Aura System.** Validates the trigger-based read-only `aura_score` built in Phase 1 (per Decision #007). v2.1: per-feature admin slice `/admin/users/[id]/aura` with manual adjustment (mandatory reason, writes to `moderation_audit_log`). | ⬜ |
| 8 | **Leaderboard.** + pg_cron + Edge Function scheduled snapshot job (Decision #009), Monday 00:00 PKT per OQ-4. Never live aggregation. | ⬜ |
| 9 | **Department Rivalry.** + same scheduled-snapshot pattern (extend the Phase 8 cron Edge Function; don't add a second cron). Per-capita scoring per OQ-7. | ⬜ |
| 10 | **Notifications.** + `notification_preferences` UI (schema exists from Phase 1). **v2.1 stack change:** Web Push API + VAPID + `web-push` library replace Expo Notifications entirely. Permission gated on PWA install per OQ-12 (after first match or community join). `push_subscriptions` table added (one row per user × device endpoint). iOS Web Push requires installed PWA (16.4+). | ⬜ |
| 11 | **Admin Shell** (cross-feature). + `moderation_audit_log` reviewable + de-anonymization access via logged SECURITY DEFINER function (Decision #006/§6). v2.1: most admin views ship in Phases 2–10 as per-feature slices; only landing dashboard (KPIs), analytics aggregation (Supabase materialized views), audit-log viewer, and RBAC middleware audit remain here. | ⬜ |
| 12 | **Production Testing & Launch.** + load testing the indexing and pagination strategy; + RLS policy test suite (every table, every role) before beta. v2.1: Lighthouse audit (PWA installable, perf ≥90 mobile, a11y ≥95); NFR-01 (LCP < 2.5s on 4G); iOS PWA install flow user-tested; Vercel deploy + Supabase production project + VAPID rotation + Sentry + web-vitals. 100+ student beta. | ⬜ |

### 14.2 v2.0 Schema-Hardening Items (from Kickoff Architecture Review, 2026-06-24)

These items, introduced in `MASTER_PLAN.docx` v2.0, are absorbed into the phases above:

| Requirement | Injected Into Phase |
|---|---|
| `blocked_users` + enforcement | Phase 1 (schema) / enforced in Phases 2 + 3 |
| `notification_preferences` | Phase 1 (schema) / UI in Phase 10 |
| Rate limiting infrastructure (`rate_limit_events` + Edge Function helper) | Phase 1 |
| `moderation_audit_log` | Phase 1 (schema) / used starting Phase 11 |
| Account deletion / data export | Phase 1 |
| Analytics / event-tracking schema | Phase 1 (minimal); expanded in Phase 12 |
| RLS policy bodies (not just principles) for every table | Phase 1 (and the relevant feature phase's exit criteria) |
| FKs, constraints, indexes per MASTER_PLAN §4.7 | Phase 1 |
| `aura_score` as read-only cache from `aura_transactions` (Decision #007) | Phase 1 (trigger) / validated Phase 7 |
| OTP/magic-link email verification (Decision #008) | Phase 1 |
| Scheduled snapshots for leaderboard + dept rivalry (Decision #009) | Phases 8 + 9 |

### Definition of Launch-Ready (from TAD)

- [ ] Authentication stable
- [ ] Matching works reliably
- [ ] Chat is real-time
- [ ] Feed loads efficiently
- [ ] Communities functional
- [ ] Events functional
- [ ] Aura updates correctly
- [ ] Leaderboard updates weekly
- [ ] Department rivalry auto-updates
- [ ] Push notifications working
- [ ] Admin moderation tools working
- [ ] Security rules fully enforced (RLS on all tables)
- [ ] Beta tested with 100+ active students

### 14.3 Reconciliation Notes

**v2.0 — schema hardening (2026-06-24):**

1. **No conflicts found in scope or requirements** between `MASTER_PLAN.docx` v2.0's phase list and the FR/NFR or data model in this document — the v2.0 changes were scope-injection and security hardening, not feature changes.
2. **Phase structure preserved.** Decision #006 explicitly retained the original 12-phase TAD structure. Schema/RLS/security additions were injected into existing phases (mostly Phase 1) rather than creating new phases.
3. **Aura source-of-truth corrected.** Decision #007 demoted `profiles.aura_score` to a read-only cache; the trigger ships in Phase 1.

**v3.0 — web/PWA pivot (2026-06-30):**

4. **Stack pivot is client-only.** Decision #010 swaps the client framework (React Native + Expo → Next.js + Tailwind + framer-motion + next-pwa + Web Push). Supabase / RLS / schema / scalability decisions (Decisions #002, #005, #006, #007, #008, #009) all carry over without modification. The pivot does not touch any FR/NFR, use case, data model entity, or RLS policy in this document.
5. **Phase 1 absorbs the Next.js scaffold + PWA shell.** Tasks #001 and #002 (React Native scaffold + TypeScript config) are marked Superseded in `TASK_LOG.docx`. New tasks 001b–001g (Next.js project, PWA shell, glass primitives, floating dock, VAPID keypair, theme provider) join the existing schema-hardening Sprint 1.
6. **Phase 10 (Notifications) re-scoped for Web Push.** Expo Notifications removed. New stack: VAPID keys, service worker push handler, `push_subscriptions` table, `web-push` library in the dispatch Edge Function. Permission request gated on PWA install moment per OQ-12 (first match or community join). iOS Web Push requires installed PWA (16.4+).
7. **Standalone admin codebase eliminated.** Originally Phase 11 was "build the separate Next.js admin app". v2.1 collapses this into the main app as `/admin` routes. Per-feature admin views ship inside the relevant feature phase (`/admin/users` in Phase 1, `/admin/reports?type=profile` in Phase 2, `/admin/moderation/posts` in Phase 4, etc.). Phase 11 retains only the cross-feature shell (landing dashboard KPIs, analytics aggregation, audit-log viewer, RBAC middleware audit).
8. **Earlier doc-consistency error.** FAST-SOCIO.md v2.0 described a "17-phase (0–16) master_plan_steps.md" as authoritative. No such document exists — the real `MASTER_PLAN.docx` has 12 phases. v3.1 corrected this. The 17-phase numbering should not be referenced going forward.

---

## 15. 📦 Tech Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| **Web Framework** | Next.js 15 (App Router) | ✅ Decided (v3.0) |
| **Language** | TypeScript | ✅ Decided |
| **Styling** | Tailwind CSS + CSS Modules for glass primitives | ✅ Decided (v3.0) |
| **Animation** | framer-motion (UIspec §2.7 transitions, Discover swipe gestures) | ✅ Decided (v3.0) |
| **State Management** | Zustand | ✅ Decided |
| **Server State** | TanStack Query (React Query) | ✅ Decided |
| **Routing** | Next.js App Router | ✅ Decided (v3.0 — replaces React Navigation) |
| **Forms** | React Hook Form + Zod | ✅ Decided |
| **Media** | `next/image`, native HTML5 `<video>`, MediaRecorder API for voice notes | ✅ Decided (v3.0 — replaces Expo Image/Video) |
| **PWA Shell** | next-pwa (or workbox directly) — service worker, offline cache, web manifest | ✅ Decided (v3.0) |
| **Push Notifications** | Web Push API + VAPID keys; dispatch via `web-push` from Edge Functions | ✅ Decided (v3.0 — replaces Expo Notifications) |
| **Backend** | Supabase (Auth, DB, Realtime, Storage, Edge Functions) | ✅ Decided |
| **Database** | PostgreSQL (via Supabase) | ✅ Decided |
| **AI Layer** | Claude API (Anthropic) | ✅ Decided |
| **Admin Surface** | `/admin` routes inside the same Next.js app, RLS-gated | ✅ Decided (v3.0 — replaces separate Next.js admin codebase) |

### Decision Log Cross-Reference (`DECISION_LOG.docx`)

Ten decisions are on record. The table below mirrors `DECISION_LOG.docx` as of 2026-06-30; treat that file as authoritative if this table drifts.

| # | Topic / Choice | Reason | Date | Status |
|---|---|---|---|---|
| 001 | ~~React Native + Expo (Frontend)~~ | Single codebase for Android and iOS | 2026-06-17 | **Superseded by #010 on 2026-06-30** |
| 002 | Supabase (Backend) | Auth, Database, Storage, Realtime, Notifications | 2026-06-17 | Active |
| 003 | Zustand (State Management) | Simple and scalable | 2026-06-17 | Active |
| 004 | ~~React Navigation~~ | Industry standard | 2026-06-17 | **Superseded by #010 (Next.js App Router)** |
| 005 | Schema/architecture gap remediation timing | Fix all identified gaps (RLS bodies, FKs, `blocked_users`, audit log, rate limiting, polymorphic reports) before Phase 1 build-out continues | 2026-06-24 | Active — framework-agnostic, unchanged by v3.0 pivot |
| 006 | Retain the original 12-phase TAD structure | Preserves the team's mental model; gaps injected into existing phases rather than creating new ones | 2026-06-24 | Active — reaffirmed during v3.0 pivot review |
| 007 | `profiles.aura_score` becomes a read-only cache | TAD had a dual source of truth between the column and `aura_transactions`; trigger-based recalculation eliminates drift and exploitation | 2026-06-24 | Active |
| 008 | OTP/magic-link email verification | Domain match alone is spoofable; not a real verification mechanism | 2026-06-24 | Active |
| 009 | Scheduled snapshots for leaderboard + dept rivalry | Live aggregation doesn't scale; pg_cron + Edge Function writes to `leaderboard_snapshots` / `department_scores` | 2026-06-24 | Active |
| 010 | **Pivot client to Next.js mobile-web-first PWA** | FAST-exclusive distribution doesn't benefit from app stores; one Next.js codebase covers student app + admin; faster iteration than RN+Expo for a small team; PWA preserves installable shell + push retention loop on Android and installed iOS PWAs | 2026-06-30 | Active — supersedes #001 and #004; #002 and #003 carry over |

> Future architecture decisions (final compatibility-score formula, leaderboard reset timing, etc. — see §17 open questions) should be added to `DECISION_LOG.docx` in the same format. This document mirrors that file; it does not own it.

---

## 16. ✅ Design Review Checklist

### Completeness
- [x] Vision statement written
- [x] All actors identified (Student, Society Leadership, Admin, Supabase, Claude API, Expo Notifications)
- [x] All 16 use cases documented
- [x] Functional requirements listed (FR-01 → FR-18)
- [x] Non-functional requirements listed (NFR-01 → NFR-14)
- [x] Complete class diagram with all 22 entities
- [x] Key sequence diagrams (registration, match, anonymous post, aura, messaging)
- [x] State diagrams (message request, user account, post, leaderboard cycle)
- [x] Full data model (all tables with columns, types, constraints)
- [x] All screens listed in UI inventory
- [x] Claude API integration points specified
- [x] RLS policy summary documented
- [x] Visual Design System specified — colors, typography, spacing, corner radius, glassmorphism, animation (UIspec.md)
- [x] Live development status captured and reconciled with `TASK_LOG.docx` / `MASTER_PLAN.docx` v2.1

### Quality
- [x] No conflicting requirements
- [x] Aura values fully specified (from TAD); Aura non-purchasability explicitly confirmed
- [x] Anonymous post privacy model clearly defined
- [x] Match creation logic clearly specified
- [x] Admin dashboard separated from mobile app architecture
- [x] UI design direction reconciled — UIspec.md's glassmorphic system supersedes v1.0's UI direction; interaction patterns from PRD retained (Section 11)
- [x] Phase/milestone tracking reconciled — `MASTER_PLAN.docx` v2.1 adopted as authoritative (12 phases, Decision #006 reaffirmed in v3.0; see Section 14)
- [ ] RLS policies written and tested in Supabase (development task)
- [ ] Claude prompts finalized for each AI integration point

### Sign-off
- [ ] PRD reviewed and approved by all stakeholders
- [ ] TAD reviewed by technical lead
- [ ] UX Specification (UIspec.md) reviewed and approved
- [ ] Beta tester list prepared (aim: 100 students for Phase 16)

---

## 17. ❓ Open Questions & Decisions Log

| # | Question | Status | Recommendation |
|---|----------|--------|----------------|
| OQ-1 | How is **compatibility %** calculated? Mutual interests count / total interests? | ❓ Open | Start with: (mutual interests / max(A_interests, B_interests)) × 100 |
| OQ-2 | Does a **Message Request** count toward Aura before it is accepted? | ❓ Open | No — award +5 Aura only on acceptance, not on send |
| OQ-3 | Can a student **un-match**? What happens to the conversation? | ❓ Open | Allow un-match; archive conversation; remove from Discover queue |
| OQ-4 | **Leaderboard reset** — does it reset at midnight Sunday, or Monday 00:00? How are ties handled? | ❓ Open | Monday 00:00 PKT; ties share the lower rank |
| OQ-5 | Who can **create a Community**? Any student or only admins/society leadership? | ❓ Open | Recommendation: Admin-approved creation; students can request |
| OQ-6 | **Reel storage** — video length limit? Supabase Storage 50MB per file limit applies | ❓ Open | Cap reels at 30 seconds / 20MB; compress client-side before upload |
| OQ-7 | **Department Rivalry score** — is it absolute sum or per-capita (divided by dept size)? | ❓ Open | Per-capita fairer for smaller departments like FinTech vs CS |
| OQ-8 | **Claude API icebreakers** — called on every new chat open, or only on first open? | ❓ Open | First open only; cache suggestions; don't call on every re-open |
| OQ-9 | **FAST email domains** — is it @nu.edu.pk only, or also @fastnuces.edu.pk, @campus.nu.edu.pk? | ❓ Open | Confirm all valid FAST campus email domains before auth build |
| OQ-10 | **Light mode default behavior** — UIspec.md requires both dark and light mode, with dark as primary. Should the app default to system theme, or always launch in dark mode regardless of device setting? | ❓ Open (new) | Default to system theme on first launch; remember user override in Settings |
| OQ-11 | **Which phase-tracking document is authoritative?** | ✅ Resolved | `MASTER_PLAN.docx` v2.1 — 12 phases, Decision #006 (retained 2026-06-24, reaffirmed 2026-06-30). The "17-phase (0–16)" structure referenced in earlier drafts of this document was an error; no such document exists. |
| OQ-12 | **When should we prompt PWA install?** (new in v3.0) iOS only delivers push to *installed* PWAs, and install rate is the main lever for the retention loop. Prompting too early feels pushy; too late and users never get push for the high-value triggers (match, message). | ❓ Open (new) | Soft-prompt after the first match or the first community join — both are emotional peaks where "save this to your home screen" is welcome. Hard-block push permission request until install is confirmed on iOS Safari. Track install-rate as a Phase 16 launch metric. |
| OQ-13 | **Discover swipe on desktop browsers?** (new in v3.0) Touch-drag works fine on mobile-web; desktop needs an equivalent. | ❓ Open (new) | Recommendation: keep mouse-drag (framer-motion `drag` works with mouse) and add keyboard shortcuts — ← Pass, → Like, M Message. No UI rework needed; only an a11y hint shown on hover. |

---

## 18. 📝 Glossary

| Term | Definition |
|------|------------|
| FAST SOCIO | The app name — a university-exclusive social platform for FAST NUCES students |
| FAST / NUCES | National University of Computer and Emerging Sciences — the target university |
| Aura | The primary reputation and engagement metric; earned through all social actions, never purchasable |
| Main Character | Title awarded to the #1 ranked student on the weekly leaderboard |
| Campus Celebrity | Title awarded to the #2 ranked student |
| Aura Farmer | Title awarded to the #3 ranked student |
| Department Rivalry | A weekly competition between university departments based on aggregate student activity |
| Discover | The profile-swiping module for meeting new students |
| Match | Created when two students mutually like each other; unlocks their conversation |
| Message Request | A 100-character intro message sent from Discover before a match exists |
| Pass | A Discover action that skips a profile and prevents it from appearing again |
| Anonymous Post | A post whose author is hidden from public view but traceable by admins |
| Icebreaker | A Claude-generated conversation starter suggestion shown when a new chat opens |
| Compatibility % | A percentage score based on mutual interests between two students in Discover |
| RLS | Row-Level Security — Supabase/PostgreSQL feature enforcing data access rules at the DB level |
| BaaS | Backend-as-a-Service — using Supabase as a full backend without writing a custom server |
| Liquid Glass / Glassmorphism | The app's core visual style — frosted blur, soft transparency, subtle borders, soft shadows on floating surfaces |
| Campus Pulse | The concept name for the Home screen — combines trending posts, events, communities, suggested people, and department rankings in one view |
| Floating Glass Dock | The bottom navigation style — a glass-styled nav bar that floats above content rather than sitting flush with the screen edge |
| Aura Purple | The app's primary brand color (`#7C5CFF`) |
| Electric Cyan | The app's secondary accent color (`#00D4FF`) |

---

## 19. 📚 Reference Library

| Reference | Relevant Sections |
|-----------|------------------|
| *Software Requirements* (Wiegers & Beatty) | Sections 3, 4 — Use cases and FR/NFR structure |
| *Writing Effective Use Cases* (Cockburn) | Section 3 — UC format (preconditions, flows, postconditions) |
| *UML Distilled* (Fowler) | Sections 5, 6, 7 — Class, Sequence, State diagrams |
| *Domain-Driven Design Distilled* (Vernon) | Section 5 — Entity boundaries and aggregate design |
| *Clean Architecture* (Martin) | Section 8 — Feature-based service layer separation |
| **Supabase Documentation** — supabase.com/docs | Section 8, 9, 10 — RLS policies, Realtime, Storage |
| **Expo Documentation** — docs.expo.dev | Section 8, 15 — Notifications, media, navigation |
| **React Native Documentation** | Section 15 — Framework reference |
| **Claude API Documentation** — docs.anthropic.com | Section 12 — Icebreaker and moderation integrations |
| **PlantUML** — plantuml.com | Sections 5–7 — Convert text diagrams to visuals |
| **dbdiagram.io** — dbdiagram.io | Section 9 — Visualize the full PostgreSQL schema as ERD (still outstanding — see Section 1.1) |
| **PRD** (TAD baseline) | Sections 1, 3, 4, 11 — Product requirements source |
| **Architecture / TAD v1.0** | Sections 8, 9, 12, 14 — Original technical architecture (schema superseded by `MASTER_PLAN.docx` v2.0 §4; stack superseded by Decision #010) |
| **`FAST_SOCIO_UI_SPEC_v2.md`** | Section 11 — Authoritative visual design system |
| **`MASTER_PLAN.docx`** v2.1 | Section 14 — Authoritative phase plan (12 phases) and schema-hardening additions |
| **`TASK_LOG.docx`** | Section 1.1 — Live task-level progress |
| **`DECISION_LOG.docx`** | Section 15 — Authoritative architecture decision log (10 entries) |
| **`PROJECT_STATE.docx`** | Section 1.1 — Project state snapshot |
| **`SPRINT_PLAN.docx`** | Section 1.1 — Sprint-level Phase 1 breakdown |

---

*Last updated: 2026-06-30 | Version: 3.1 | Status: 🟢 Design Complete — Phase 1 (Authentication + Foundation, expanded scope per `MASTER_PLAN.docx` v2.1) In Progress on Next.js/PWA stack*
