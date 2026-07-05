# 🤖 Claude Code Prompt — FAST SOCIO Admin Dashboard (Complete Build)

> **Copy this entire prompt into Claude Code.**
> It is self-contained. Everything Claude Code needs to find files, understand the schema, and build the panel is inside it.

---

```
I am building the admin dashboard for FAST SOCIO — a university-exclusive
social platform for FAST NUCES students. The admin panel is a Next.js 14
(App Router) + TypeScript web app connected to a Supabase PostgreSQL backend.
The mobile app is React Native (Expo).

My goal: build a production-grade admin control panel with four complete
modules. I will describe each one in full. Build them in order.

══════════════════════════════════════════════════════════════
TECH STACK
══════════════════════════════════════════════════════════════

Admin Panel:  Next.js 14 (App Router), TypeScript, Tailwind CSS
Backend:      Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions)
Key libs:     @supabase/supabase-js, @supabase/auth-helpers-nextjs
Charts:       Recharts (already in package.json)
Icons:        Lucide React
Notifications: Slack Incoming Webhooks + Resend (email) + Twilio (SMS)
AI Moderation: OpenAI Moderation API (primary), Hive (fallback)

The admin panel uses the Supabase SERVICE ROLE key — server-side only.
NEVER expose the service role key in any client component.
All admin API routes must be in /app/api/ as Route Handlers.
All data fetching must happen in Server Components or Route Handlers.

══════════════════════════════════════════════════════════════
DATABASE SCHEMA (Supabase PostgreSQL)
══════════════════════════════════════════════════════════════

Existing tables (already exist — do not recreate, only ALTER if needed):

  auth.users            — id (UUID), email, created_at [Supabase Auth managed]

  profiles              — id (UUID PK), user_id (FK→auth.users), full_name,
                          bio, department, semester, profile_picture,
                          personality_type, aura_score (INT), created_at

  profile_interests     — profile_id (FK), interest_id (FK)

  posts                 — id, author_id (FK→profiles), content, media_url,
                          post_type (text/image/video/reel/poll),
                          is_anonymous (BOOL), created_at

  comments              — id, post_id (FK→posts), author_id, content, created_at

  reactions             — id, post_id, user_id, reaction_type, created_at

  communities           — id, name, description, community_type, created_by, created_at

  community_members     — id, community_id, user_id, role (member/moderator/admin)

  community_posts       — id, community_id, author_id, content,
                          status (pending/approved/rejected), created_at

  community_chat_messages — id, community_id, sender_id, content, created_at

  messages              — id, conversation_id, sender_id, message_type,
                          content, media_url, shared_post_id, created_at

  conversations         — id, created_at

  conversation_members  — conversation_id, user_id

  matches               — id, user_one, user_two, created_at

  likes                 — id, sender_id, receiver_id, created_at

  events                — id, title, description, location, start_time,
                          end_time, created_by, created_at

  event_attendees       — id, event_id, user_id, status (interested/going)

  aura_transactions     — id, user_id, action_type, points, created_at

  leaderboard_snapshots — user_id, aura_score, rank, week_number

  departments           — id, name

  department_scores     — id, department_id, score, week_number

  notifications         — id, user_id, type, message, created_at

  reports               — id, reporter_id, reported_user_id,
                          content_id (nullable), content_type (post/message/
                          profile/community/comment), reason, status
                          (pending/actioned/dismissed), created_at

New tables to CREATE (run as migrations):

  -- 1. Admin audit trail (legal defensibility)
  CREATE TABLE IF NOT EXISTS admin_actions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id      UUID NOT NULL REFERENCES auth.users(id),
    action_type   TEXT NOT NULL,
    -- e.g. 'ban_user' | 'suspend_user' | 'remove_post' | 'dismiss_report'
    --      'warn_user' | 'force_logout' | 'delete_account' | 'adjust_aura'
    --      'restore_user' | 'feature_event' | 'delete_community'
    target_id     UUID NOT NULL,
    target_type   TEXT NOT NULL,  -- 'user' | 'post' | 'message' | 'community' | 'event'
    reason        TEXT NOT NULL,  -- mandatory; cannot be empty
    metadata      JSONB,          -- additional context (e.g. report_id, old value)
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- 2. Account enforcement (bans and suspensions)
  CREATE TABLE IF NOT EXISTS account_enforcement (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users(id),
    enforcement_type TEXT NOT NULL CHECK (enforcement_type IN ('warning','suspension','ban')),
    reason_code   TEXT NOT NULL,
    -- Reason codes: 'harassment' | 'spam' | 'explicit_content' | 'impersonation'
    --              | 'hate_speech' | 'misinformation' | 'illegal_content' | 'other'
    reason_detail TEXT,           -- free-form detail appended to reason_code
    expires_at    TIMESTAMPTZ,    -- NULL = permanent (for bans)
    created_by    UUID REFERENCES auth.users(id),
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- 3. Auto-flags from classifier APIs
  CREATE TABLE IF NOT EXISTS auto_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id      UUID NOT NULL,
    content_type    TEXT NOT NULL,  -- 'post' | 'comment' | 'message' | 'community_post'
    content_text    TEXT,
    media_url       TEXT,
    classifier      TEXT NOT NULL,  -- 'openai_moderation' | 'hive' | 'aws_rekognition'
    raw_score       JSONB NOT NULL, -- full classifier response stored for audit
    max_score       FLOAT NOT NULL, -- highest category score (0.0–1.0)
    flagged_categories TEXT[],      -- e.g. ['hate', 'sexual', 'violence']
    threshold_used  FLOAT NOT NULL,
    status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'reviewed', 'escalated', 'dismissed')),
    ingested_at     TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ,
    reviewed_by     UUID REFERENCES auth.users(id)
  );

  -- 4. Alert rules
  CREATE TABLE IF NOT EXISTS alert_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name       TEXT NOT NULL,
    metric          TEXT NOT NULL,
    -- 'moderation_queue_depth' | 'signup_spike_pct' | 'auto_flag_rate'
    -- | 'report_rate' | 'message_volume' | 'ban_rate'
    threshold_value FLOAT NOT NULL,
    window_minutes  INT NOT NULL DEFAULT 60,
    channels        TEXT[] NOT NULL,  -- ['slack', 'email', 'sms']
    is_active       BOOLEAN DEFAULT TRUE,
    last_triggered  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- 5. Account state column on profiles
  ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active'
  CHECK (account_status IN ('active', 'suspended', 'banned', 'deleted'));

  ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;  -- GDPR/CCPA soft delete

  -- 6. IP + device metadata (populated by mobile app on login)
  CREATE TABLE IF NOT EXISTS login_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES auth.users(id),
    ip_address  INET,
    device_info JSONB,  -- { platform, os_version, app_version, device_model }
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

══════════════════════════════════════════════════════════════
ENVIRONMENT VARIABLES (add to .env.local)
══════════════════════════════════════════════════════════════

  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_ROLE_KEY=        ← server-side only, never client
  OPENAI_API_KEY=                   ← for OpenAI Moderation API
  HIVE_API_KEY=                     ← for Hive content moderation
  SLACK_WEBHOOK_URL=                ← for alert notifications
  RESEND_API_KEY=                   ← for email alerts
  TWILIO_ACCOUNT_SID=               ← for SMS alerts
  TWILIO_AUTH_TOKEN=
  TWILIO_FROM_NUMBER=
  ALERT_EMAIL_RECIPIENTS=           ← comma-separated
  ALERT_SMS_RECIPIENTS=             ← comma-separated

══════════════════════════════════════════════════════════════
ADMIN AUTH GUARD
══════════════════════════════════════════════════════════════

Before building any module, create a middleware that protects all
/admin/* routes.

File: middleware.ts (root)
  - Use Supabase Auth server-side session check
  - Maintain a hardcoded list of admin user IDs in an env variable:
    ADMIN_USER_IDS=uuid1,uuid2,uuid3
  - If the session user's ID is not in ADMIN_USER_IDS → redirect to /unauthorized
  - All API routes under /api/admin/* must also validate this

Admin Supabase client helper: lib/supabase-admin.ts
  import { createClient } from '@supabase/supabase-js';
  export const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  Never import this file in any client component.

══════════════════════════════════════════════════════════════
SHARED HELPER: logAdminAction()
══════════════════════════════════════════════════════════════

Every destructive or modifying action MUST call this before completing:

  // lib/audit.ts
  export async function logAdminAction({
    adminId,
    actionType,
    targetId,
    targetType,
    reason,
    metadata,
  }: {
    adminId: string;
    actionType: string;
    targetId: string;
    targetType: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    await supabaseAdmin.from('admin_actions').insert({
      admin_id: adminId,
      action_type: actionType,
      target_id: targetId,
      target_type: targetType,
      reason,
      metadata: metadata ?? {},
    });
  }

If logAdminAction() fails, the main action must also be rolled back
(wrap both in a Supabase RPC/transaction where possible).

══════════════════════════════════════════════════════════════
MODULE 1: TRUST & SAFETY
══════════════════════════════════════════════════════════════

Route: /admin/trust-safety
Layout: Split — left sidebar with sub-nav, right content panel

── 1A. REPORTED-CONTENT QUEUE (/admin/trust-safety/reports) ──

Display a paginated table of all reports. Default sort: created_at DESC.
Filter bar at top: [All | Pending | Actioned | Dismissed] tabs.

For each report row show:
  - Reporter: avatar + name (link to their profile)
  - Reported item: content preview (truncated to 120 chars)
    - If content_type = 'post': show post text + thumbnail
    - If content_type = 'message': show message text
    - If content_type = 'profile': show "Profile report" + reported user name
    - If content_type = 'community': show community name
    - If content_type = 'comment': show comment text
  - Reported user: name + current account_status badge
  - Reason: the submitted reason text
  - Timestamp: relative ("2 hours ago") + absolute on hover
  - Status badge: Pending (yellow) / Actioned (green) / Dismissed (grey)
  - If is_anonymous = true on the reported post: show a red "ANON POST"
    badge AND display the real author_id alongside it (admins can see this)

Clicking any row expands an Action Panel (slide-in right drawer):
  Content preview (full text + full-size image if media)
  Reported user's recent history: last 5 reports received, current
  enforcement status, aura_score

  ACTION BUTTONS (each opens a Reason Modal before executing):

  [Remove Content]
    - Soft-delete the post/message/comment
    - Set reports.status = 'actioned' for all reports on this content
    - Log: admin_actions (action_type: 'remove_content', target: content_id)
    - Send in-app notification to reported user: "Your content was removed."

  [Warn User]
    - Insert account_enforcement (type: 'warning', reason_code from dropdown)
    - Log: admin_actions (action_type: 'warn_user')
    - Send notification to user: "You received a warning."

  [Suspend User]
    - Open modal: select duration (1d / 3d / 7d / 14d / 30d / custom)
    - Insert account_enforcement (type: 'suspension', expires_at = now + duration)
    - UPDATE profiles SET account_status = 'suspended' WHERE user_id = X
    - Force-invalidate all sessions: call Supabase Admin API
      supabaseAdmin.auth.admin.signOut(userId, 'global')
    - Log: admin_actions (action_type: 'suspend_user', metadata: { duration })
    - Notify user: "Your account has been suspended."

  [Ban User]
    - Open confirmation modal with double-confirm ("Type BAN to confirm")
    - Insert account_enforcement (type: 'ban', expires_at: NULL)
    - UPDATE profiles SET account_status = 'banned'
    - Force-invalidate all sessions (signOut global)
    - Log: admin_actions (action_type: 'ban_user')
    - Notify user: "Your account has been permanently banned."

  [Dismiss Report]
    - UPDATE reports SET status = 'dismissed'
    - Log: admin_actions (action_type: 'dismiss_report')
    - No notification to reporter

  REASON MODAL (required for all actions above):
    - Dropdown: reason_code (harassment / spam / explicit_content /
      impersonation / hate_speech / misinformation / illegal_content / other)
    - Textarea: additional detail (required if reason_code = 'other')
    - Cannot proceed without selecting a reason_code
    - The reason is saved to both admin_actions and account_enforcement

Query for reports page (Server Component):
  SELECT
    r.*,
    reporter.full_name as reporter_name,
    reporter.profile_picture as reporter_avatar,
    reported.full_name as reported_name,
    reported.account_status,
    reported.aura_score,
    p.content as post_content,
    p.media_url as post_media,
    p.is_anonymous
  FROM reports r
  LEFT JOIN profiles reporter ON r.reporter_id = reporter.user_id
  LEFT JOIN profiles reported ON r.reported_user_id = reported.user_id
  LEFT JOIN posts p ON r.content_id = p.id AND r.content_type = 'post'
  ORDER BY r.created_at DESC
  LIMIT 50 OFFSET ?

── 1B. AUTO-FLAG INGESTION (/admin/trust-safety/auto-flags) ──

Purpose: Automatically classify new content through a third-party API
and surface anything above threshold into a review queue.

INGESTION EDGE FUNCTION (Supabase Edge Function — create this):
File: supabase/functions/classify-content/index.ts

This function is called by a database trigger on INSERT to posts,
comments, community_posts, and messages.

Logic:
  1. Receive content_id, content_type, content_text, media_url
  
  2. Call OpenAI Moderation API:
     const response = await fetch('https://api.openai.com/v1/moderations', {
       method: 'POST',
       headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
       body: JSON.stringify({ input: content_text })
     });
     const result = await response.json();
     const scores = result.results[0].category_scores;
     const maxScore = Math.max(...Object.values(scores));
     const flaggedCategories = Object.entries(scores)
       .filter(([_, v]) => v > 0.5)
       .map(([k]) => k);

  3. THRESHOLD: if maxScore >= 0.75 → INSERT into auto_flags:
     {
       content_id, content_type, content_text, media_url,
       classifier: 'openai_moderation',
       raw_score: result.results[0],
       max_score: maxScore,
       flagged_categories: flaggedCategories,
       threshold_used: 0.75,
       status: 'pending'
     }

  4. For image content (media_url is not null):
     Call Hive API or AWS Rekognition for image classification.
     If image max_score >= 0.80 → also INSERT into auto_flags.

  5. If a new auto_flag is inserted: call the alerting system
     (Module 4) to check if queue depth threshold is exceeded.

AUTO-FLAG QUEUE UI (/admin/trust-safety/auto-flags):
Same layout as the reports queue but filtered from auto_flags table.

Additional columns:
  - Classifier: badge (OpenAI / Hive / Rekognition)
  - Max Score: percentage bar (red if >90%, orange if 75–90%)
  - Flagged Categories: tag chips

Actions:
  [Escalate to Report Queue]
    - INSERT a synthetic report:
      reports (reporter_id: NULL, content_id, content_type,
               reason: 'Auto-flagged by ' + classifier,
               status: 'pending')
    - UPDATE auto_flags SET status = 'escalated'

  [Dismiss Flag]
    - UPDATE auto_flags SET status = 'dismissed', reviewed_at = NOW(),
      reviewed_by = adminId

Make the threshold configurable: show a slider input at the top of
the page (0.50–0.99) that updates a config row in alert_rules where
rule_name = 'auto_flag_threshold'. Default: 0.75.

── 1C. BAN / SUSPENSION LIST (/admin/trust-safety/enforcement) ──

Query:
  SELECT ae.*, p.full_name, p.profile_picture, p.department, p.account_status
  FROM account_enforcement ae
  JOIN profiles p ON ae.user_id = p.user_id
  WHERE ae.is_active = TRUE
  ORDER BY ae.created_at DESC

Display columns:
  - User: avatar + name + department
  - Type: badge (Warning=blue / Suspension=orange / Ban=red)
  - Reason Code: tag chip
  - Reason Detail: text
  - Expires: relative datetime OR "Permanent" if expires_at is null
  - Actioned by: admin name
  - Created at

Actions:
  [Lift Suspension / Warning]
    - UPDATE account_enforcement SET is_active = FALSE
    - UPDATE profiles SET account_status = 'active'
    - Log: admin_actions (action_type: 'restore_user')
    - Reason modal required

  [Convert Warning → Suspension]
    - Insert new enforcement row (type: suspension)
    - Mark old warning as is_active = FALSE

  [Extend Suspension]
    - Duration picker modal
    - UPDATE account_enforcement SET expires_at = new_date

Filter bar: [All | Warnings | Suspensions | Bans | Active | Expired]
Search: by username or email.

A scheduled Supabase Edge Function (cron: every 15 minutes) should:
  UPDATE account_enforcement SET is_active = FALSE
  WHERE expires_at < NOW() AND is_active = TRUE;
  
  Then: UPDATE profiles SET account_status = 'active'
  WHERE user_id IN (
    SELECT user_id FROM account_enforcement
    WHERE is_active = FALSE AND enforcement_type = 'suspension'
    AND NOT EXISTS (
      SELECT 1 FROM account_enforcement
      WHERE user_id = ae.user_id AND is_active = TRUE
    )
  );

── 1D. AUDIT TRAIL (/admin/trust-safety/audit) ──

Read-only. Shows all admin_actions, newest first.

Columns: Admin | Action Type | Target | Target Type | Reason | Timestamp
Filter: by admin, action_type, date range
Export: CSV download button (generates and streams a CSV file)

This page is read-only — no actions can be taken here.

══════════════════════════════════════════════════════════════
MODULE 2: USER & ACCOUNT MANAGEMENT
══════════════════════════════════════════════════════════════

Route: /admin/users

── 2A. USER SEARCH & LIST ──

Search bar at top: searches across full_name, email (auth.users), user_id
Uses debounced input (300ms). On each keypress:

  API Route: GET /api/admin/users/search?q=QUERY

  SELECT
    p.user_id, p.full_name, p.bio, p.department, p.semester,
    p.aura_score, p.account_status, p.created_at, p.profile_picture,
    u.email, u.last_sign_in_at
  FROM profiles p
  JOIN auth.users u ON p.user_id = u.id
  WHERE
    p.full_name ILIKE '%' || QUERY || '%' OR
    u.email ILIKE '%' || QUERY || '%' OR
    p.user_id::text = QUERY
  LIMIT 20

Below search: full paginated user table (default: newest first, 50 per page).

Table columns:
  Avatar | Name | Email | Department | Semester | Aura Score |
  Account Status | Joined | Last Active | Actions

Status badges: Active (green) / Suspended (orange) / Banned (red) / Deleted (grey)

── 2B. USER DETAIL PAGE (/admin/users/[userId]) ──

Fetch everything about this user in parallel. Layout:

LEFT COLUMN — Identity Card:
  - Profile picture (full size)
  - Full name, email, user_id
  - Department, Semester
  - Aura Score + rank
  - Account Status badge
  - Joined: formatted date
  - Last active: relative time (from auth.users.last_sign_in_at)

RIGHT COLUMN — Tabbed detail view:

  Tab: Overview
    - Bio, interests (chips), personality type
    - Stats: total posts, total matches, total comments, communities joined

  Tab: Security / Device Info
    Query login_events for this user (last 20 login events):
    Columns: IP Address | Device Model | OS | App Version | Timestamp
    Flag any IP that appears in a blocklist or that has multiple users
    registered to it (join login_events ON ip_address to find siblings).
    Show: "Other accounts from same IP" — links to those profiles.

  Tab: Content
    Most recent 10 posts (with status — removed/active)
    Most recent 10 comments
    Filter: [Posts | Comments | Community Posts | Anonymous Posts]
    Note: anonymous posts shown here with "ANON" badge — admin can see them

  Tab: Enforcement History
    All account_enforcement rows for this user (active + expired)
    All admin_actions where target_id = this user

  Tab: Reports
    Reports filed BY this user (reporter_id = userId)
    Reports filed AGAINST this user (reported_user_id = userId)

  Tab: Aura History
    All aura_transactions for this user, newest first
    Total: SUM(points) — validate it matches profiles.aura_score
    Columns: Action Type | Points | Timestamp

ACTION BUTTONS (right column header):

  [Force Logout]
    - supabaseAdmin.auth.admin.signOut(userId, 'global')
    - Reason modal required
    - Log: admin_actions (action_type: 'force_logout')

  [Suspend] [Ban] [Warn]  ← same flow as Module 1C

  [Reset Password]
    - supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email })
    - Show the generated link to admin in a modal (admin sends it manually)
    - Log: admin_actions (action_type: 'reset_password')

  [Adjust Aura]
    - Modal: number input (positive or negative), reason textarea
    - INSERT aura_transactions (action_type: 'admin_adjustment', points: value)
    - Recalculate profiles.aura_score
    - Log: admin_actions (action_type: 'adjust_aura', metadata: { delta: value })

  [Delete Account — GDPR/CCPA]
    - This is a hard destructive action. Require DOUBLE CONFIRM:
      Step 1: checkbox "I confirm this is a valid deletion request"
      Step 2: type the user's email to confirm
    - Execution order:
      1. Anonymize PII: UPDATE profiles SET
           full_name = 'Deleted User',
           bio = NULL, profile_picture = NULL,
           personality_type = NULL, favorite_music = NULL,
           favorite_shows = NULL,
           account_status = 'deleted',
           deleted_at = NOW()
         WHERE user_id = userId
      2. Delete profile_interests WHERE profile_id = profileId
      3. Anonymize posts: UPDATE posts SET
           author_id = NULL (or a ghost account), content = '[deleted]'
         WHERE author_id = profileId AND is_anonymous = FALSE
         (anonymous posts: set author_id to NULL — they were already anonymous)
      4. Delete direct messages: DELETE FROM messages WHERE sender_id = profileId
      5. Delete matches: DELETE FROM matches WHERE user_one = profileId OR user_two = profileId
      6. Revoke Supabase Auth: supabaseAdmin.auth.admin.deleteUser(userId)
      7. Log: admin_actions (action_type: 'delete_account_gdpr',
               metadata: { email: originalEmail, requested_at: NOW() })
    - After completion: show "Account deleted and anonymized. Audit log saved."

══════════════════════════════════════════════════════════════
MODULE 3: BUSINESS-LOGIC-SPECIFIC VIEWS
══════════════════════════════════════════════════════════════

Route: /admin/content
Sub-nav: Posts | Matches | Messages | Communities | Events

── 3A. POSTS MODERATION (/admin/content/posts) ──

Query: all posts, newest first, paginated (50/page)

Columns:
  Author (name + avatar — or "Anonymous 🔴" with real author in tooltip)
  | Content preview | Type badge | Media thumbnail | Reactions count
  | Comments count | Created at | Status (active/removed)

Filters at top:
  [Type: All / Text / Image / Video / Reel / Poll / Anonymous]
  [Status: All / Active / Removed]
  Date range picker

Actions (per row):
  [View Full] → expand to show full content + all reactions + comments tree
  [Remove Post] → soft-delete + reason modal + log
  [View Author] → navigate to /admin/users/[userId]
  [Run Classifier] → manually trigger OpenAI Moderation on this content
                     and show the score in a modal

Bulk action: select multiple posts → [Remove Selected] with single shared reason

── 3B. MATCHES VIEW (/admin/content/matches) ──

Purpose: investigate harassment that started in DMs; understand match patterns.

Query:
  SELECT
    m.*,
    p1.full_name as user_one_name, p1.department as dept_one,
    p2.full_name as user_two_name, p2.department as dept_two,
    COUNT(msg.id) as message_count,
    MAX(msg.created_at) as last_message_at
  FROM matches m
  JOIN profiles p1 ON m.user_one = p1.user_id
  JOIN profiles p2 ON m.user_two = p2.user_id
  LEFT JOIN conversation_members cm ON m.id IS NOT NULL  -- join via conversation
  LEFT JOIN messages msg ON msg.conversation_id = cm.conversation_id
  GROUP BY m.id, p1.full_name, p1.department, p2.full_name, p2.department
  ORDER BY m.created_at DESC

Columns: User A | User B | Matched At | Messages Sent | Last Activity

Clicking a match → shows full conversation thread (read-only for admin).
Admin can [Remove Match] (delete match + flag both users for investigation)
or [View User A / User B] profiles.

Stats at top of page:
  - Total matches all time
  - New matches today
  - Avg messages per conversation

── 3C. MESSAGES MODERATION (/admin/content/messages) ──

This view is NOT a general inbox browser — it's for reported messages only.

Show all messages where:
  message.id IN (SELECT content_id FROM reports WHERE content_type = 'message')
  OR message.id IN (SELECT content_id FROM auto_flags WHERE content_type = 'message')

Columns: Sender | Conversation (User A ↔ User B) | Content | Type |
         Flagged by | Timestamp | Status

Actions:
  [Remove Message] → set content = '[removed]', media_url = NULL + log
  [View Conversation] → open full conversation in read-only side panel
  [Action Sender] → jump to /admin/users/[senderId]

── 3D. COMMUNITIES MANAGEMENT (/admin/content/communities) ──

Table: all communities

Columns: Name | Type | Created By | Members | Posts (approved) |
         Pending Posts | Created At | Status

Actions:
  [View Community] → see all approved posts + pending queue + member list
  [Feature Community] → pins it in the Communities discovery list
  [Deactivate] → hidden from app (status = 'inactive') + log
  [Delete Community] → cascades: deletes all posts, members, chat messages
                       double-confirm required + log
  [Transfer Admin Role] → picker: select a member → UPDATE community_members
                          SET role = 'admin' WHERE user_id = newAdmin
                          AND SET old admin role = 'member'

Pending Posts sub-view (for communities with pending approval):
  Show community_posts WHERE status = 'pending'
  Admin can also approve/reject on behalf of absent community admins

── 3E. EVENTS MANAGEMENT (/admin/content/events) ──

Table: all events, sorted by start_time ASC

Columns: Title | Creator | Location | Start | End | Going | Interested |
         Status (upcoming/past/cancelled/featured)

Actions:
  [Feature Event] → pins it at top of Events screen in mobile app
                    (add is_featured BOOLEAN column to events)
  [Cancel Event]  → UPDATE events SET status = 'cancelled'
                    + send push notification to all RSVPs:
                    "Event '[title]' has been cancelled."
                    + reason modal + log
  [Edit Event]    → in-panel form to edit title, description, location, times
  [Delete Event]  → cascades event_attendees + log

══════════════════════════════════════════════════════════════
MODULE 4: ALERTING SYSTEM
══════════════════════════════════════════════════════════════

Route: /admin/alerts

── 4A. ALERT RULES CONFIG UI ──

Show all rows from alert_rules table as a list of configurable cards.

Pre-seed these 6 default rules (INSERT IF NOT EXISTS):
  1. rule_name: 'Moderation Queue Overflow'
     metric: 'moderation_queue_depth'
     threshold_value: 20          ← if pending reports > 20 → alert
     window_minutes: 60
     channels: ['slack', 'email']

  2. rule_name: 'Signup Spike'
     metric: 'signup_spike_pct'
     threshold_value: 50           ← if signups in last hour > 50% above 7-day avg
     window_minutes: 60
     channels: ['slack', 'sms']

  3. rule_name: 'Auto-Flag Rate Spike'
     metric: 'auto_flag_rate'
     threshold_value: 10           ← if >10 auto-flags in last 30 min
     window_minutes: 30
     channels: ['slack']

  4. rule_name: 'Ban Rate Spike'
     metric: 'ban_rate'
     threshold_value: 5            ← if >5 bans in last hour
     window_minutes: 60
     channels: ['slack', 'email']

  5. rule_name: 'Message Volume Drop'
     metric: 'message_volume'
     threshold_value: -50          ← if message volume drops >50% vs avg (Realtime down?)
     window_minutes: 30
     channels: ['slack', 'sms', 'email']

  6. rule_name: 'Report Flood'
     metric: 'report_rate'
     threshold_value: 30           ← if >30 reports in last 60 min
     window_minutes: 60
     channels: ['slack', 'email', 'sms']

Each rule card shows:
  Rule name | Metric | Threshold | Window | Channels | Active toggle
  [Last triggered: X ago] | [Edit] [Delete]

Editing a rule opens an inline form:
  - Threshold value (number input)
  - Window (minutes) (number input)
  - Channels (checkboxes: Slack / Email / SMS)
  - Active toggle
  - [Save Changes] → UPDATE alert_rules

── 4B. ALERT EVALUATION ENGINE ──

Create a Supabase Edge Function: supabase/functions/evaluate-alerts/index.ts
This runs on a cron schedule: every 5 minutes.

For each active alert_rule, evaluate its metric:

METRIC: moderation_queue_depth
  SELECT COUNT(*) FROM reports WHERE status = 'pending'
  If count > threshold_value → fire alert

METRIC: signup_spike_pct
  recent = SELECT COUNT(*) FROM auth.users
           WHERE created_at > NOW() - INTERVAL '1 hour'
  avg_7d = SELECT COUNT(*) / 7 FROM auth.users
           WHERE created_at > NOW() - INTERVAL '7 days'
  spike_pct = ((recent - avg_7d) / avg_7d) * 100
  If spike_pct > threshold_value → fire alert

METRIC: auto_flag_rate
  SELECT COUNT(*) FROM auto_flags
  WHERE ingested_at > NOW() - INTERVAL '? minutes'   ← window_minutes
  If count > threshold_value → fire alert

METRIC: ban_rate
  SELECT COUNT(*) FROM account_enforcement
  WHERE enforcement_type = 'ban'
  AND created_at > NOW() - INTERVAL '? minutes'
  If count > threshold_value → fire alert

METRIC: message_volume
  recent_count = SELECT COUNT(*) FROM messages
                 WHERE created_at > NOW() - INTERVAL '? minutes'
  avg_count = SELECT COUNT(*) / (window_minutes / 30.0) FROM messages
              WHERE created_at > NOW() - INTERVAL '1 day'
  drop_pct = ((recent_count - avg_count) / avg_count) * 100
  If drop_pct < threshold_value (negative = drop) → fire alert

METRIC: report_rate
  SELECT COUNT(*) FROM reports
  WHERE created_at > NOW() - INTERVAL '? minutes'
  If count > threshold_value → fire alert

COOLDOWN: Do not re-fire the same rule within 30 minutes.
  Check: rule.last_triggered < NOW() - INTERVAL '30 minutes' before firing.
  After firing: UPDATE alert_rules SET last_triggered = NOW()

── 4C. ALERT DELIVERY (fireAlert function) ──

  // lib/alerts.ts
  interface AlertPayload {
    ruleName: string;
    metric: string;
    currentValue: number;
    threshold: number;
    channels: string[];
  }

  async function fireAlert(payload: AlertPayload) {
    const message = `🚨 FAST SOCIO ALERT\n` +
      `Rule: ${payload.ruleName}\n` +
      `Metric: ${payload.metric} = ${payload.currentValue} ` +
      `(threshold: ${payload.threshold})\n` +
      `Time: ${new Date().toISOString()}\n` +
      `→ Dashboard: https://your-admin-url.com/admin/trust-safety`;

    if (payload.channels.includes('slack')) {
      await fetch(process.env.SLACK_WEBHOOK_URL!, {
        method: 'POST',
        body: JSON.stringify({ text: message }),
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (payload.channels.includes('email')) {
      const recipients = process.env.ALERT_EMAIL_RECIPIENTS!.split(',');
      await resend.emails.send({
        from: 'alerts@fastsocio.app',
        to: recipients,
        subject: `⚠️ FAST SOCIO: ${payload.ruleName} Triggered`,
        text: message
      });
    }

    if (payload.channels.includes('sms')) {
      const numbers = process.env.ALERT_SMS_RECIPIENTS!.split(',');
      for (const to of numbers) {
        await twilioClient.messages.create({
          from: process.env.TWILIO_FROM_NUMBER!,
          to,
          body: message.slice(0, 160)  // SMS character limit
        });
      }
    }
  }

── 4D. ALERTS HISTORY UI ──

Show a log of all fired alerts (store each in an alert_history table):
  CREATE TABLE IF NOT EXISTS alert_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id      UUID REFERENCES alert_rules(id),
    rule_name    TEXT,
    metric       TEXT,
    value_at_fire FLOAT,
    channels     TEXT[],
    fired_at     TIMESTAMPTZ DEFAULT NOW()
  );

Display: Rule Name | Metric | Value When Fired | Channels | Time Fired
No actions — read-only log.
Show "No alerts fired in the last 7 days" empty state if clean.

══════════════════════════════════════════════════════════════
ANALYTICS OVERVIEW DASHBOARD (/admin)
══════════════════════════════════════════════════════════════

The root /admin page shows a live analytics overview.
All numbers must come from live Supabase queries — NOT hardcoded.

Stat cards (top row):
  Total Users | Active Today | New This Week | Suspended | Banned

Recharts line chart — User Activity (last 14 days):
  X: date | Y: daily active users (from login_events)

Recharts bar chart — Content Created (last 7 days):
  Bars: Posts | Comments | Community Posts | Messages
  Group by DATE(created_at)

Key metrics grid:
  - Total matches all time + today
  - Reports pending / actioned this week
  - Auto-flags ingested today
  - Aura transactions today (SUM of points awarded)
  - Top 5 most active communities (by community_posts.created_at in last 7d)
  - Top 5 most RSVPd events (by event_attendees COUNT)
  - Messages sent today

Alert status widget:
  Shows count of currently active alert_rules that have fired in last 24h.
  Red if any fired, green if clear.
  Link → /admin/alerts

══════════════════════════════════════════════════════════════
NAVIGATION & LAYOUT
══════════════════════════════════════════════════════════════

Global admin layout: dark sidebar + main content area.

Sidebar items:
  📊 Overview          → /admin
  🛡️ Trust & Safety   → /admin/trust-safety (sub: Reports | Auto-Flags | Enforcement | Audit)
  👤 Users             → /admin/users
  📝 Content           → /admin/content (sub: Posts | Matches | Messages | Communities | Events)
  🔔 Alerts            → /admin/alerts

At the top of every page:
  - Admin user name + avatar (from Supabase Auth session)
  - "Logged in as admin" badge

Sidebar badge counts (refresh every 30s):
  Trust & Safety badge: count of pending reports
  Content badge: count of pending community posts

══════════════════════════════════════════════════════════════
IMPLEMENTATION ORDER
══════════════════════════════════════════════════════════════

Build in this exact order:

1. Run all DB migrations (CREATE TABLE statements above)
2. Create lib/supabase-admin.ts and lib/audit.ts
3. Admin auth middleware + /unauthorized page
4. /admin overview dashboard (analytics page)
5. Module 2: Users (search + list + detail page)
6. Module 1A: Reports queue (most critical)
7. Module 1B: Auto-flag ingestion (Edge Function + UI)
8. Module 1C: Enforcement list
9. Module 1D: Audit trail
10. Module 3A–3E: Content views (Posts → Matches → Messages → Communities → Events)
11. Module 4: Alerting system (Edge Function + config UI + history)
12. Add sidebar badge counts last

══════════════════════════════════════════════════════════════
ACCEPTANCE CRITERIA (test each before moving to next)
══════════════════════════════════════════════════════════════

Module 1 (Trust & Safety):
  □ Banning a user blocks them from logging in immediately
  □ Every ban/suspend/remove action has a non-empty reason in admin_actions
  □ Anonymous post: admin sees real author; other pages show "Anonymous"
  □ Auto-flag fires on a test post with OpenAI moderation score > 0.75
  □ Expired suspensions are automatically lifted by the cron function
  □ Audit trail shows every action taken; no action exists without a log entry

Module 2 (Users):
  □ Search by email finds user within 300ms
  □ Device/IP tab shows login history; sibling accounts from same IP shown
  □ GDPR delete: after deletion, profile_picture is null, name is "Deleted User",
    auth record is removed, posts are anonymized
  □ Force logout: user is signed out of all devices immediately

Module 3 (Content):
  □ Anonymous posts in admin view show real author; in feed they do not
  □ Removing a post soft-deletes it; it disappears from the feed
  □ Cancel event sends push notification to all RSVPs

Module 4 (Alerting):
  □ Manually insert 21 pending reports → Slack message fires within 5 minutes
  □ Alert does not re-fire for the same rule within 30 minutes
  □ Disabling a rule stops it from firing even if threshold is exceeded
  □ alert_history table logs all fired alerts

Start with the DB migrations and lib/ setup files.
Confirm each migration runs without error before building the UI.
```
