# 🔍 FAST SOCIO — Post-Development Validation & Change Management

> **Design Doc Reference:** FAST-SOCIO.md v2.0
> **Review Date:** 2026-07-02
> **Reviewer(s):** *(your name)*
> **Build Version Under Review:** v1.0.0-MVP
> **Total UATs:** 14
> **Critical:** 2 · High: 6 · Medium: 6
> **Status:** 🔴 In Progress — Fixes Required Before Any Soft Launch

---

## ⚠️ Executive Summary (Read First)

**UAT-012 (Chat broken) and UAT-005 (Create Event + Community non-functional) are the two critical blockers.** The app cannot be shown to any users until these pass. Everything else is either a navigation restructure, feature enhancement, or quality improvement.

The most architecturally significant UAT is **UAT-011** — community admin approval + chat room — because it requires a new DB table, two new UI flows, and a moderation queue. Plan this as a full feature sprint, not a quick fix.

**UAT-003, 004, 007** are all navigation restructures that should be done together in one pass — they collectively redefine the bottom nav and page layout of the app.

---

## 2. 🗂️ Gap Discovery Log

| Gap ID | UAT | Module | What Was Expected | What Was Delivered | Gap Type | Severity | CR |
|--------|-----|--------|-------------------|-------------------|----------|----------|----|
| GAP-001 | UAT-001 | Profiles | Upload profile picture; all users can view each other's full profiles | Profile pictures missing or not viewable between users | T3 — Implementation | 🟠 High | CR-001 |
| GAP-002 | UAT-002 | Profiles | In-app profile editing: change pfp, name, bio, interests, dept | Profile edit screen missing or non-functional | T3 — Implementation | 🟠 High | CR-002 |
| GAP-003 | UAT-003 | Profiles / Leaderboard | Leaderboard is a standalone page | Leaderboard element embedded inside Profile screen | T4 — Expectation | 🟡 Medium | CR-003 |
| GAP-004 | UAT-004 | Messaging / Communities | One page with three tabs: Messages · Requests · Communities | Communities is a separate page; Requests buried or missing | T4 — Expectation | 🟡 Medium | CR-004 |
| GAP-005 | UAT-005 | Events / Communities | Create Event + Create Community flows are functional | Buttons exist but create flows do nothing or crash | T3 — Implementation | 🔴 Critical | CR-005 |
| GAP-006 | UAT-006 | Events | All RSVP edge cases handled gracefully | Edge cases (double-RSVP, changing status, no events, past events) crash or misbehave | T1 — Specification | 🟡 Medium | CR-006 |
| GAP-007 | UAT-007 | Dept Rivalry / Home Feed | Department Rivalry is at the top of the new Leaderboard page | Dept Rivalry widget lives in Home Feed | T4 — Expectation | 🟡 Medium | CR-007 |
| GAP-008 | UAT-008 | Feed | Post comments work with text + emoji keyboard | Comments section non-functional or missing emoji support | T3 — Implementation | 🟠 High | CR-008 |
| GAP-009 | UAT-009 | Discover | All Tinder-like edge cases handled (empty queue, undo, slow network, already-matched) | Discover crashes or behaves unexpectedly at boundaries | T1 — Specification | 🟠 High | CR-009 |
| GAP-010 | UAT-010 | Feed | Share a post to a specific matched friend via chat | No share functionality exists | T3 — Implementation | 🟡 Medium | CR-010 |
| GAP-011 | UAT-011 | Communities | Community has two zones: (1) admin-approved posts feed + (2) open member chat room | Only one undifferentiated feed exists; no approval queue; no chat room | T4 — Expectation | 🟠 High | CR-011 |
| GAP-012 | UAT-012 | Messaging | Real-time chat works: messages send, deliver, and display | Chat is broken — messages not sending, not arriving, or UI frozen | T3 — Implementation | 🔴 Critical | CR-012 |
| GAP-013 | UAT-013 | Notifications | Multiple notifications from the same user are grouped into one component | Each notification is a separate list item — no grouping | T4 — Expectation | 🟡 Medium | CR-013 |
| GAP-014 | UAT-014 | Admin Dashboard | Admin panel is the single robust tool to control the entire app | Admin panel exists but is incomplete or lacks controls for key areas | T1 — Specification | 🟠 High | CR-014 |

---

## 3. 🔎 Root Cause Analysis

### RCA-001 — Profile Pictures & Mutual Viewing (UAT-001, UAT-002)

```
Gap Summary: Profile pictures cannot be uploaded; users cannot view each other's profiles.

Why 1: Why can users not upload a profile picture?
→ Supabase Storage bucket for avatars may not be set up, or the
  upload call in profile.service.ts is missing/broken.

Why 2: Why can users not view each other's profiles?
→ The RLS policy on the `profiles` table may be too restrictive —
  only allowing users to read their own row (id = auth.uid()),
  blocking reads of other users' profiles.

Why 3: Why was RLS written this way?
→ The default Supabase RLS template restricts all reads to own rows.
  The design doc required "Read: anyone authenticated" but the
  implementation copied the default policy without customizing it.

Root Cause: Two separate issues:
  (1) Supabase Storage avatar bucket not configured + upload function not wired.
  (2) profiles table RLS SELECT policy too restrictive — should be
      "auth.role() = 'authenticated'" not "id = auth.uid()".

Prevention: Always test profile visibility across two different accounts
            as the first act after implementing the profiles module.
```

---

### RCA-002 — Create Event + Create Community Non-Functional (UAT-005)

```
Gap Summary: The "Create Event" and "Create Community" buttons/screens exist
             but submitting the form does nothing or throws an error.

Why 1: Why does form submission do nothing?
→ The onSubmit handler likely calls event.service.ts / community.service.ts
  but either (a) the function is not implemented, (b) it throws an error
  that is swallowed silently, or (c) it calls the wrong table name.

Why 2: Why is the error swallowed?
→ The try/catch in the service has an empty catch block or only logs
  to console, so the UI never shows an error and appears frozen.

Why 3: Why was the Supabase INSERT not working?
→ Either the table doesn't exist (migration not run), the RLS policy
  blocks the INSERT, or the payload has missing required columns.

Root Cause: Form submission handlers exist in UI but the Supabase INSERT
            calls are either unimplemented, misconfigured, or blocked by RLS.
            Error handling is silent, masking the failure.

Prevention: After building any form, immediately test submission in
            Supabase Table Editor to confirm rows are being created.
```

---

### RCA-003 — Chat Broken (UAT-012)

```
Gap Summary: Chat is broken — messages not sending, not arriving real-time,
             or chat UI is frozen/crashing.

Why 1: Why are messages not sending?
→ Either the INSERT to `messages` table is failing (RLS blocks it,
  wrong conversation_id, missing required field), or the API call
  is not being awaited correctly.

Why 2: Why are messages not arriving in real-time?
→ The Supabase Realtime subscription may not be active —
  either .subscribe() was never called, the channel filter is wrong
  (watching wrong conversation_id), or Realtime is not enabled
  for the `messages` table in the Supabase dashboard.

Why 3: Why is the UI frozen after send?
→ If an error is thrown during send and the loading/sending state
  is set to true but never reset to false, the input is permanently
  disabled — UI appears frozen.

Root Cause: Likely a combination of:
  (1) Realtime not enabled on `messages` table in Supabase dashboard.
  (2) Channel subscription not started or using wrong filter.
  (3) Send error not caught — UI state stuck in "sending" mode.

Prevention: Chat is the highest-risk Realtime feature — test it between
            two real devices (not simulator) before any other messaging work.
```

---

### RCA-004 — Comments Non-Functional (UAT-008)

```
Gap Summary: Post comments don't work — text can't be submitted and
             emoji input is missing.

Why 1: Why can't comments be submitted?
→ The comment submission handler either doesn't call the Supabase
  INSERT, or the `post_id` foreign key is not being passed correctly.

Why 2: Why is there no emoji support?
→ Native emoji keyboard is not being triggered — the comment
  TextInput likely has keyboard type set to 'ascii-capable' or
  does not allow the emoji keyboard panel to open on Android.

Root Cause: Comment INSERT not wired; emoji input not enabled on TextInput.
```

---

### RCA-005 — Discover Edge Cases (UAT-009)

```
Gap Summary: Discover page crashes or behaves incorrectly at boundary
             conditions (empty queue, already-matched users appearing,
             swipe animation lock, network failure during swipe).

Why 1: Why does the empty queue crash?
→ When the profile array hits index 0 or becomes undefined, the
  card component tries to render undefined.name — crashes.

Why 2: Why do already-matched users appear?
→ The Discover query doesn't exclude user IDs already in `matches`
  table — only excludes IDs in `likes` and `passes`.

Why 3: Why does the swipe lock on slow network?
→ The like/pass action triggers a DB write before advancing the card.
  If the write takes >500ms, the animation completes but the next
  card doesn't load — creating a frozen blank card state.

Root Cause: Missing edge case handling in three areas:
  (1) Empty state render guard, (2) Discover query exclusion filter,
  (3) Optimistic UI — advance card immediately, write DB async.
```

---

## 4. 📋 Change Request Register

| CR ID | Title | UAT(s) | Gap Type | Severity | Effort | Target |
|-------|-------|--------|----------|----------|--------|--------|
| **CR-012** | **Fix real-time chat — messages not sending/arriving** | UAT-012 | T3 | 🔴 Critical | M | v1.0.1 |
| **CR-005** | **Make Create Event + Create Community functional** | UAT-005 | T3 | 🔴 Critical | M | v1.0.1 |
| **CR-001** | **Profile picture upload + mutual profile viewing** | UAT-001 | T3 | 🟠 High | M | v1.0.1 |
| **CR-002** | **Profile edit screen — pfp, name, bio, interests** | UAT-002 | T3 | 🟠 High | S | v1.0.1 |
| **CR-008** | **Post comments — text + emoji input functional** | UAT-008 | T3 | 🟠 High | S | v1.0.1 |
| **CR-009** | **Discover edge cases — empty queue, matched users, slow network** | UAT-009 | T1 | 🟠 High | M | v1.0.1 |
| **CR-011** | **Community dual-zone: admin approval feed + open chat room** | UAT-011 | T4 | 🟠 High | L | v1.0.2 |
| **CR-014** | **Admin dashboard — full control panel for entire app** | UAT-014 | T1 | 🟠 High | L | v1.0.2 |
| **CR-003** | **Extract leaderboard to its own page** | UAT-003 | T4 | 🟡 Medium | S | v1.0.2 |
| **CR-004** | **Merge communities into chat as third tab** | UAT-004 | T4 | 🟡 Medium | S | v1.0.2 |
| **CR-006** | **Event RSVP edge cases** | UAT-006 | T1 | 🟡 Medium | S | v1.0.2 |
| **CR-007** | **Move Dept Rivalry to top of Leaderboard page** | UAT-007 | T4 | 🟡 Medium | XS | v1.0.2 |
| **CR-010** | **Share post to a matched friend** | UAT-010 | T3 | 🟡 Medium | M | v1.0.2 |
| **CR-013** | **Bundle notifications by sender into grouped component** | UAT-013 | T4 | 🟡 Medium | S | v1.0.2 |

---

## 5. 🎯 Fix Priority Order

```
v1.0.1 — CRITICAL & HIGH FIXES (do not ship until these pass UAT)
  1. CR-012  Fix chat (CRITICAL — unblocks core user journey)
  2. CR-005  Create Event + Community functional (CRITICAL — features unusable)
  3. CR-001  Profile picture upload + mutual viewing (HIGH — core social feature)
  4. CR-002  Profile edit screen (HIGH — pairs naturally with CR-001)
  5. CR-008  Post comments with emoji (HIGH — core engagement feature)
  6. CR-009  Discover edge cases (HIGH — crash risk in core feature)

v1.0.2 — NAVIGATION RESTRUCTURE + QUALITY
  7. CR-003 + CR-004 + CR-007  Navigation restructure (do together — one PR)
  8. CR-011  Community dual-zone: approval feed + chat room
  9. CR-014  Admin panel — full control coverage
  10. CR-006  RSVP edge cases
  11. CR-013  Notification grouping
  12. CR-010  Post share to friend
```

---

## 6. 🤖 Claude Code Prompts

---

### 🔴 PROMPT CR-012 — Fix Real-Time Chat

```
I am building FAST SOCIO — a university social app built with 
React Native (Expo) + Supabase. This is the HIGHEST PRIORITY fix.

CRITICAL BUG (UAT-012): Chat is broken. Messages are not sending,
not arriving in real-time, or the chat UI freezes after sending.

STEP 1 — DIAGNOSE FIRST. Before changing anything, check these:
  □ In Supabase Dashboard → Database → Replication:
    Is the `messages` table enabled for Realtime? If not, enable it.
  □ Open the browser Supabase client and manually INSERT a message row.
    Does it appear? If not, RLS is blocking it.
  □ Check the chat service file — is .subscribe() actually being called
    and is the return value being stored for cleanup?

STEP 2 — FIX THE SEND FLOW:
  Find the sendMessage function (likely in chat.service.ts or similar).
  It must do exactly this:

    async function sendMessage(conversationId: string, content: string) {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: supabase.auth.getUser().data.user.id,
          message_type: 'text',
          content: content,
          created_at: new Date().toISOString()
        });
      if (error) {
        console.error('[CHAT] Send failed:', error.message);
        throw error; // DO NOT SWALLOW — let UI handle it
      }
      return data;
    }

  In the UI component:
    - Set isSending = true BEFORE the call
    - Always set isSending = false in a finally block
    - Show a visible error toast if send fails
    - Clear the input field ONLY after successful send

STEP 3 — FIX THE REALTIME SUBSCRIPTION:
  In the chat screen component, on mount, subscribe to the conversation:

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        // Append the new message to local state
        setMessages(prev => [...prev, payload.new as Message]);
      })
      .subscribe((status) => {
        console.log('[CHAT] Realtime status:', status);
      });

    // CRITICAL: Clean up on unmount
    return () => { supabase.removeChannel(channel); };

  Place this in useEffect with conversationId as a dependency.

STEP 4 — FIX RLS ON MESSAGES TABLE:
  The messages table needs these two policies:

    -- SELECT: only conversation members can read
    CREATE POLICY "Conversation members can read messages"
    ON messages FOR SELECT TO authenticated
    USING (
      conversation_id IN (
        SELECT conversation_id FROM conversation_members
        WHERE user_id = auth.uid()
      )
    );

    -- INSERT: only conversation members can send
    CREATE POLICY "Conversation members can send messages"
    ON messages FOR INSERT TO authenticated
    WITH CHECK (
      sender_id = auth.uid() AND
      conversation_id IN (
        SELECT conversation_id FROM conversation_members
        WHERE user_id = auth.uid()
      )
    );

ACCEPTANCE CRITERIA:
  - User A sends a message → appears in User B's chat within 500ms.
  - Typing indicator shows when the other user is typing.
  - Sending with no network shows a visible error, not a frozen UI.
  - Switching away and back to the chat screen: no duplicate subscriptions.
  - Messages load in correct chronological order on screen open.
```

---

### 🔴 PROMPT CR-005 — Make Create Event + Create Community Functional

```
I am building FAST SOCIO (React Native + Expo + Supabase).

CRITICAL BUG (UAT-005): "Create Event" and "Create Community" UI exists
but form submission does nothing — no row is created, no error is shown.

== PART A: CREATE EVENT ==

Find the Create Event form and its submit handler.
The handler must call this Supabase INSERT:

  async function createEvent(formData: {
    title: string;
    description: string;
    location: string;
    start_time: string;  // ISO8601
    end_time: string;
    banner_image?: string;
  }) {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('events')
      .insert({
        ...formData,
        created_by: userId
      })
      .select()
      .single();

    if (error) throw error;

    // Trigger Aura: +20 for creating an event
    await supabase.from('aura_transactions').insert({
      user_id: userId,
      action_type: 'event_created',
      points: 20
    });

    return data;
  }

After successful creation:
  - Navigate to the newly created Event Detail screen
  - Show a success toast: "Event created! 🎉"
  - Refresh the Events list

== PART B: CREATE COMMUNITY ==

  async function createCommunity(formData: {
    name: string;
    description: string;
    community_type: string; // dept | society | gaming | sports | etc.
    banner_image?: string;
  }) {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) throw new Error('Not authenticated');

    // 1. Create the community row
    const { data: community, error } = await supabase
      .from('communities')
      .insert({
        ...formData,
        created_by: userId
      })
      .select()
      .single();

    if (error) throw error;

    // 2. Auto-add the creator as admin
    await supabase.from('community_members').insert({
      community_id: community.id,
      user_id: userId,
      role: 'admin'
    });

    return community;
  }

After successful creation:
  - Navigate to the new Community Detail screen
  - Creator is already a member with role: 'admin'
  - Show toast: "Community created!"

== ERROR HANDLING FOR BOTH ==
  Wrap every submission in try/catch.
  In the catch block:
    - Set isSubmitting = false
    - Show a visible error: Alert.alert('Error', error.message)
    - Log: console.error('[CREATE]', error)
  NEVER use an empty catch block.

ACCEPTANCE CRITERIA:
  - Submit Create Event form → row in `events` table + creator gets +20 Aura.
  - Submit Create Community form → row in `communities` table + creator is admin member.
  - Any form error shows a visible alert — not a silent failure.
  - After creation, user is navigated to the new item's detail screen.
```

---

### 🟠 PROMPT CR-001 — Profile Picture Upload + Mutual Profile Viewing

```
I am building FAST SOCIO (React Native + Expo + Supabase).

BUG (UAT-001): Users cannot upload a profile picture. Users also
cannot view each other's profiles — only their own.

== PART A: PROFILE PICTURE UPLOAD ==

1. Ensure the Supabase Storage bucket exists:
   Bucket name: 'avatars'
   Policy: authenticated users can upload to their own path only.
   In Supabase Dashboard → Storage → New Bucket → 'avatars' → Public: false.

   Add this Storage policy:
     Name: "Users upload their own avatar"
     Allowed operation: INSERT
     Policy: (bucket_id = 'avatars') AND (auth.uid()::text = (storage.foldername(name))[1])

2. In the Profile Edit screen (or profile setup), add an avatar picker:

   import * as ImagePicker from 'expo-image-picker';

   async function pickAndUploadAvatar() {
     const result = await ImagePicker.launchImageLibraryAsync({
       mediaTypes: ImagePicker.MediaTypeOptions.Images,
       allowsEditing: true,
       aspect: [1, 1],
       quality: 0.7,
     });
     if (result.canceled) return;

     const userId = (await supabase.auth.getUser()).data.user.id;
     const fileExt = result.assets[0].uri.split('.').pop();
     const filePath = `${userId}/avatar.${fileExt}`;

     // Convert to blob
     const response = await fetch(result.assets[0].uri);
     const blob = await response.blob();

     const { error: uploadError } = await supabase.storage
       .from('avatars')
       .upload(filePath, blob, { upsert: true });

     if (uploadError) throw uploadError;

     // Get public URL and save to profile
     const { data } = supabase.storage
       .from('avatars')
       .getPublicUrl(filePath);

     await supabase
       .from('profiles')
       .update({ profile_picture: data.publicUrl })
       .eq('user_id', userId);
   }

3. Display avatar everywhere with:
   <Image source={{ uri: profile.profile_picture }} 
          style={{ width: 80, height: 80, borderRadius: 40 }} />
   Fallback: show initials in a colored circle if profile_picture is null.

== PART B: MUTUAL PROFILE VIEWING ==

The `profiles` table RLS SELECT policy must allow any authenticated
user to read any profile. Fix the policy:

  -- DROP the existing restrictive SELECT policy first, then:
  CREATE POLICY "Authenticated users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);  -- any logged-in user can read any profile row

  -- Keep the UPDATE policy restrictive:
  CREATE POLICY "Users can only update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

After this fix, profile.service.ts should be able to fetch any user's
profile by their user_id for the Discover card and profile view screens.

ACCEPTANCE CRITERIA:
  - Tapping a profile avatar/name anywhere in the app navigates to their profile.
  - Profile shows: name, dept, semester, bio, profile picture, Aura score, interests, posts.
  - Profile picture picker opens, selects, crops to 1:1, uploads, and updates immediately.
  - Users without a profile picture see a styled initials fallback.
  - User A can view User B's full profile — not just their own.
```

---

### 🟠 PROMPT CR-002 — Profile Edit Screen

```
I am building FAST SOCIO (React Native + Expo + Supabase).

BUG (UAT-002): Users cannot edit their profile inside the app —
changing pfp, name, bio, department, semester, or interests.

WHAT TO DO:

1. Create (or fix) an EditProfile screen with these editable fields:
     - Profile picture (tap avatar → image picker from CR-001)
     - Full name (TextInput)
     - Bio (TextInput, multiline, max 150 chars with counter)
     - Department (Picker: CS / SE / AI / DS / EE / FinTech)
     - Semester (Picker: 1–8)
     - Interests (multi-select chip grid: Football, Gaming, Finance, etc.)
     - Personality type (TextInput, optional)
     - Favorite music (TextInput, optional)
     - Favorite shows (TextInput, optional)

2. The save handler must UPDATE the profiles table:

   async function saveProfile(updates: Partial<Profile>) {
     const userId = (await supabase.auth.getUser()).data.user.id;

     const { error } = await supabase
       .from('profiles')
       .update(updates)
       .eq('user_id', userId);

     if (error) throw error;
   }

   For interests (stored in profile_interests join table):
     a. DELETE FROM profile_interests WHERE profile_id = myProfileId
     b. INSERT all selected interests as new rows

3. Add an "Edit Profile" button on the own-profile view that navigates
   to EditProfile screen. Pre-populate all fields with current data.

4. On save: navigate back, show success toast, refresh profile view.

5. Cancel button: prompt "Discard changes?" if any field was modified.

ACCEPTANCE CRITERIA:
  - All 9 fields are editable and saved correctly.
  - Changing interests updates the profile_interests join table.
  - Changes reflect immediately on the Profile screen after saving.
  - Cancel with unsaved changes prompts the user before discarding.
```

---

### 🟠 PROMPT CR-008 — Post Comments: Text + Emoji

```
I am building FAST SOCIO (React Native + Expo + Supabase).

BUG (UAT-008): Post comments are non-functional — users cannot submit
text comments and there is no emoji support.

== PART A: COMMENT SUBMISSION ==

Find the comment input component (under a post or in a Post Detail screen).
Wire up the submit handler:

  async function submitComment(postId: string, content: string) {
    if (!content.trim()) return; // block empty comments

    const userId = (await supabase.auth.getUser()).data.user.id;

    const { error } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        author_id: userId,
        content: content.trim(),
        created_at: new Date().toISOString()
      });

    if (error) throw error;

    // Award Aura to post author (+2 for receiving a comment)
    // First get the post's author_id
    const { data: post } = await supabase
      .from('posts')
      .select('author_id')
      .eq('id', postId)
      .single();

    if (post && post.author_id !== userId) {
      await supabase.from('aura_transactions').insert({
        user_id: post.author_id,
        action_type: 'post_commented',
        points: 2
      });
    }
  }

After submit:
  - Clear the input field
  - Append the new comment to the local comments list optimistically
  - Scroll to the new comment

== PART B: EMOJI SUPPORT ==

In React Native, TextInput supports emoji by default on iOS.
On Android, ensure:
  - keyboardType is NOT set to 'ascii-capable' or 'numeric'
  - Remove any filter that strips non-ASCII characters

For a dedicated emoji picker panel (optional but better UX):
  Install: expo install @emoji-mart/react (or use a RN emoji picker)

  Add an emoji button next to the text input:
    <TouchableOpacity onPress={() => setShowEmojiPicker(!showEmojiPicker)}>
      <Text>😊</Text>
    </TouchableOpacity>
    {showEmojiPicker && (
      <EmojiPicker onEmojiClick={(emoji) => {
        setCommentText(prev => prev + emoji.emoji);
        setShowEmojiPicker(false);
      }} />
    )}

== PART C: DISPLAY COMMENTS ==

Load comments for a post:
  const { data: comments } = await supabase
    .from('comments')
    .select('*, profiles(full_name, profile_picture)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

Display each comment with:
  - Author avatar + name
  - Comment text (supports emoji rendering natively)
  - Timestamp (relative: "2m ago")
  - Reply button (nested comment: parent_comment_id)

ACCEPTANCE CRITERIA:
  - Typing a comment and pressing send creates a `comments` row.
  - Comment appears immediately under the post.
  - Emoji can be inserted via keyboard and custom picker.
  - Post author receives +2 Aura (not self-commented).
  - Empty comments are blocked.
```

---

### 🟠 PROMPT CR-009 — Discover Page Edge Cases

```
I am building FAST SOCIO (React Native + Expo + Supabase).

BUG (UAT-009): Discover page crashes or behaves incorrectly at edge
cases. Fix all of the following:

== EDGE CASE 1: EMPTY QUEUE ==
When the profiles array is empty (all swiped or no one left):
  - DO NOT render the card component with undefined data
  - Show a friendly empty state instead:
      <View style={styles.emptyState}>
        <Text>You've met everyone! 🎉</Text>
        <Text>Check back later for new faces.</Text>
      </View>
  Guard: if (!profiles || profiles.length === 0) return <EmptyDiscoverState />;

== EDGE CASE 2: ALREADY-MATCHED USERS APPEARING ==
The Discover query must exclude:
  (a) Users already in `likes` table (sender_id = me)
  (b) Users already in `passes` table (sender_id = me)
  (c) Users already in `matches` table (user_one OR user_two = me)
  (d) The user's own profile

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .not('user_id', 'eq', myUserId)
    .not('user_id', 'in', `(${likedIds.join(',')})`)
    .not('user_id', 'in', `(${passedIds.join(',')})`)
    .not('user_id', 'in', `(${matchedIds.join(',')})`);

  Fetch likedIds, passedIds, matchedIds from their respective tables first.

== EDGE CASE 3: SLOW NETWORK / SWIPE FREEZE ==
Use OPTIMISTIC UI — do not wait for DB write before advancing card:
  
  function handleSwipe(direction: 'like' | 'pass', profile: Profile) {
    // 1. Immediately remove the top card from state (advance UI)
    setProfiles(prev => prev.slice(1));
    
    // 2. Write to DB in background — do not await in the UI thread
    if (direction === 'like') {
      likeProfile(profile.user_id).catch(err => {
        console.error('Like failed:', err);
        // Optionally restore the card on failure
      });
    } else {
      passProfile(profile.user_id).catch(err => {
        console.error('Pass failed:', err);
      });
    }
  }

== EDGE CASE 4: NETWORK ERROR DURING PROFILE LOAD ==
  Add a loading state and error state:
    if (isLoading) return <DiscoverSkeleton />;
    if (error) return (
      <View>
        <Text>Couldn't load profiles</Text>
        <TouchableOpacity onPress={refetch}>
          <Text>Try again</Text>
        </TouchableOpacity>
      </View>
    );

== EDGE CASE 5: UNDO LAST SWIPE ==
Store the last swiped profile in state:
  const [lastSwiped, setLastSwiped] = useState<Profile | null>(null);

On swipe: setLastSwiped(currentProfile)
Show an Undo button for 3 seconds after each swipe:
  - On undo: DELETE the like/pass row, restore the card to front of queue
  - Hide undo button after 3s timeout or when next card is swiped

== EDGE CASE 6: TAPPING A CARD TO EXPAND ==
Single tap on card → expand to show full profile details:
  - All interests as chips
  - Bio
  - Compatibility % breakdown
  - Claude icebreaker suggestion
Swipe gestures still work on the expanded card.

ACCEPTANCE CRITERIA:
  - App does not crash when profile queue is empty.
  - Already-matched/liked/passed users never reappear in Discover.
  - Swiping feels instant regardless of network speed.
  - Network error shows retry option, not crash.
  - Undo button appears briefly after each swipe.
```

---

### 🟠 PROMPT CR-011 — Community Dual Zone: Admin Approval Feed + Open Chat Room

```
I am building FAST SOCIO (React Native + Expo + Supabase).

NEW FEATURE (UAT-011): Communities need two distinct zones:
  ZONE 1 — Posts Feed: Posts submitted by members require approval
            from the community ADMIN (the person who created the community)
            before appearing publicly.
  ZONE 2 — Chat Room: An open real-time chat where ALL members can send
            messages without any approval. Instant, free-flowing.
  
  The community admin here is the community CREATOR, not us (the app admin).

== PART A: DB CHANGES ==

1. Add a `status` column to community_posts:
   ALTER TABLE community_posts 
   ADD COLUMN status TEXT DEFAULT 'pending' 
   CHECK (status IN ('pending', 'approved', 'rejected'));

2. Create a community_chat_messages table (separate from posts):
   CREATE TABLE community_chat_messages (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     community_id UUID REFERENCES communities(id) ON DELETE CASCADE,
     sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
     content TEXT NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   Enable Realtime on this table in Supabase Dashboard.

   RLS for community_chat_messages:
     SELECT: user must be a community_member
     INSERT: sender_id = auth.uid() AND must be a community_member

== PART B: COMMUNITY DETAIL SCREEN — TWO TABS ==

Add two tabs inside the Community Detail screen:
  Tab 1: "Posts" — approved posts feed + "Submit Post" button
  Tab 2: "Chat" — real-time chat room (like a group chat)

== PART C: POST SUBMISSION FLOW (Zone 1) ==

When a member submits a post:
  INSERT INTO community_posts (community_id, author_id, content, status)
  VALUES (communityId, userId, content, 'pending');

The post is NOT shown in the feed yet. Show: "Post submitted for review."

== PART D: ADMIN APPROVAL QUEUE ==

Show a "Review Posts" button ONLY for users whose community_members.role = 'admin'
for this community.

Tapping it opens a pending posts list:
  SELECT * FROM community_posts 
  WHERE community_id = ? AND status = 'pending'
  ORDER BY created_at ASC;

Admin sees each pending post with two buttons:
  ✅ Approve → UPDATE community_posts SET status = 'approved' WHERE id = ?
  ❌ Reject  → UPDATE community_posts SET status = 'rejected' WHERE id = ?

The Posts feed only shows: WHERE status = 'approved'
Notify the post author when their post is approved or rejected.

== PART E: COMMUNITY CHAT ROOM (Zone 2) ==

In the Chat tab, implement exactly like direct messaging (CR-012) but
for a community channel:

  const channel = supabase
    .channel(`community-chat:${communityId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'community_chat_messages',
      filter: `community_id=eq.${communityId}`
    }, (payload) => {
      setMessages(prev => [...prev, payload.new]);
    })
    .subscribe();

No approval needed here. Messages appear instantly for all members.

ACCEPTANCE CRITERIA:
  - Member submits post → goes to pending, not visible in feed.
  - Admin sees pending queue; approves → post appears in feed.
  - Admin rejects → post removed from queue, author notified.
  - Non-admin members do not see the "Review Posts" button.
  - Community Chat tab shows real-time messages from all members.
  - Chat messages need no approval — appear instantly.
```

---

### 🟠 PROMPT CR-014 — Admin Panel: Full Application Control

```
I am building FAST SOCIO (React Native + Expo + Supabase).
The admin panel is a Next.js web app using Supabase service-role key.

GAP (UAT-014): The admin panel exists but is incomplete — it doesn't
give admins full control over the application.

The admin panel must be the SINGLE tool to control everything.
Here is what each section must have:

== SECTION 1: USER MANAGEMENT ==
  Table: all users with columns: name, email, dept, aura_score, status, joined_at
  Actions per user:
    - View full profile (all fields including anon post authorship)
    - Suspend (sets a `status` flag; user blocked from login)
    - Ban (permanent; user cannot create a new account with same email)
    - Restore (undo suspension/ban)
    - Adjust Aura manually (with reason field — logged in aura_transactions)
    - View all their posts, comments, reports filed and received

== SECTION 2: CONTENT MODERATION ==
  Show all reports (status = 'pending') with:
    - Reported item (post/message/profile/community)
    - Reported by (who filed it)
    - Report reason
    - The actual content
    - For anonymous posts: show the real author_id
  Actions:
    - Dismiss report → status = 'dismissed'
    - Remove content → delete the post/message
    - Take action on user → link to User Management section
    - Flag for AI review → call Claude API for severity assessment

== SECTION 3: COMMUNITY MANAGEMENT ==
  Table: all communities with member count, post count, created_by, status
  Actions:
    - View community (all posts, all members)
    - Deactivate community (hidden from app)
    - Delete community (with cascade confirmation)
    - Transfer admin role to another member
    - Approve community creation requests (if creation requires admin approval)

== SECTION 4: EVENT MANAGEMENT ==
  Table: all events with title, creator, RSVP counts, date, status
  Actions:
    - Feature an event (pin to top of Events page)
    - Cancel an event (notify all RSVPs)
    - Delete an event
    - Edit event details

== SECTION 5: LEADERBOARD & AURA CONTROL ==
  - View current weekly leaderboard
  - Manually trigger weekly reset (for testing or emergency)
  - View all aura_transactions for any user
  - Manually award or deduct Aura with a logged reason

== SECTION 6: ANALYTICS DASHBOARD ==
  - Total users (and verified count)
  - Daily/weekly active users (from last_active timestamps)
  - Top 5 most active communities
  - Top 5 most RSVPd events
  - Messages sent today (count from messages table)
  - New matches today (count from matches table)
  - Reports filed this week

== IMPLEMENTATION NOTES ==
  - All admin queries must use the Supabase SERVICE ROLE key (server-side only).
  - Never expose the service role key in the mobile app bundle.
  - Every destructive admin action (ban, delete, Aura adjust) must:
      a. Require a confirmation modal ("Are you sure? This cannot be undone.")
      b. Log the action to an `admin_actions` audit table:
         (admin_id, action_type, target_id, target_type, reason, created_at)

ACCEPTANCE CRITERIA:
  - Admin can suspend/ban a user and that user is immediately blocked from login.
  - Admin can view the real author of any anonymous post.
  - Admin can dismiss or act on any report without leaving the dashboard.
  - Admin can delete or deactivate any community or event.
  - All destructive actions are logged in admin_actions table.
  - Analytics section shows real numbers from the DB, not hardcoded values.
```

---

### 🟡 PROMPT CR-003 + CR-004 + CR-007 — Navigation Restructure (Do Together)

```
I am building FAST SOCIO (React Native + Expo + Supabase).
This prompt restructures 3 navigation/layout changes at once.

CHANGE 1 (UAT-003): Extract Leaderboard to its own standalone page.
CHANGE 2 (UAT-004): Merge Communities into the Chat page as a 3rd tab.
CHANGE 3 (UAT-007): Move Department Rivalry section to the TOP of the 
                     new Leaderboard page.

== STEP 1: UPDATE BOTTOM NAVIGATION ==

Current tabs (likely): Home | Discover | Chat | Communities | Profile
New tabs:              Home | Discover | Chat | Leaderboard | Profile

Remove Communities from bottom nav — it moves inside Chat.
Add Leaderboard as its own bottom nav tab.

In your navigation config (React Navigation — Tab Navigator):
  <Tab.Screen name="Home" component={HomeScreen} />
  <Tab.Screen name="Discover" component={DiscoverScreen} />
  <Tab.Screen name="Chat" component={ChatScreen} />       ← now has 3 tabs inside
  <Tab.Screen name="Leaderboard" component={LeaderboardScreen} />  ← new
  <Tab.Screen name="Profile" component={ProfileScreen} />

== STEP 2: CHAT SCREEN — 3 INNER TABS ==

Wrap the Chat screen in a top Tab Navigator with 3 tabs:

  <TopTab.Navigator>
    <TopTab.Screen name="Messages" component={MessagesTab} />
    <TopTab.Screen name="Requests" component={RequestsTab} />
    <TopTab.Screen name="Communities" component={CommunitiesTab} />
  </TopTab.Navigator>

  Messages tab: existing direct message conversations list
  Requests tab: incoming message requests (pending status from message_requests table)
  Communities tab: list of communities the user is a member of + "Discover Communities"

== STEP 3: LEADERBOARD PAGE ==

Build the new Leaderboard screen with this VERTICAL layout:

  ┌─────────────────────────────────────┐
  │  🏆 DEPARTMENT RIVALRY              │  ← TOP (moved from Home)
  │  CS [████████] 1,240 pts  #1        │
  │  SE [███████ ] 1,180 pts  #2        │
  │  AI [██████  ] 980 pts   #3         │
  │  (full sports-league table)         │
  ├─────────────────────────────────────┤
  │  ⚡ WEEKLY LEADERBOARD              │
  │  1. [Avatar] Ahmed K.  2,340 Aura  │
  │     👑 Main Character               │
  │  2. [Avatar] Sara M.   2,100 Aura  │
  │     ⭐ Campus Celebrity             │
  │  3. [Avatar] Ali R.    1,890 Aura  │
  │     🌟 Aura Farmer                  │
  │  4–20. rest of list...              │
  ├─────────────────────────────────────┤
  │  📊 YOUR RANK                       │
  │  #42 this week · 320 Aura          │
  └─────────────────────────────────────┘

== STEP 4: REMOVE FROM HOME FEED ==
Remove the Department Rivalry widget from the Home/Campus Pulse screen.
The Home feed should only show: posts, suggested people, featured events.

ACCEPTANCE CRITERIA:
  - Bottom nav has exactly 5 tabs: Home | Discover | Chat | Leaderboard | Profile.
  - Chat screen shows 3 inner tabs: Messages | Requests | Communities.
  - Leaderboard page shows Dept Rivalry at the top, then weekly leaderboard below.
  - Dept Rivalry widget no longer appears in the Home/Campus Pulse screen.
  - Navigating to Leaderboard tab shows the new combined page.
```

---

### 🟡 PROMPT CR-006 — Event RSVP Edge Cases

```
I am building FAST SOCIO (React Native + Expo + Supabase).

GAP (UAT-006): Event RSVP has unhandled edge cases causing crashes or
incorrect behavior.

Handle ALL of the following:

== EDGE CASE 1: DOUBLE RSVP ==
User taps "Going" twice. Must be idempotent:
  Use UPSERT instead of INSERT:
  await supabase.from('event_attendees').upsert(
    { event_id: eventId, user_id: userId, status: 'going' },
    { onConflict: 'event_id,user_id' }
  );
  Add unique constraint: UNIQUE(event_id, user_id) on event_attendees.

== EDGE CASE 2: CHANGE RSVP STATUS ==
User taps "Interested" then later "Going" (or vice versa):
  Same UPSERT handles this — status column is updated, not duplicated.
  Update the button UI to reflect current status immediately (optimistic).

== EDGE CASE 3: UN-RSVP (REMOVE RSVP) ==
If user is already "Going" and taps "Going" again — toggle it off:
  Check current status first:
    if (currentStatus === 'going') {
      // Remove RSVP
      await supabase.from('event_attendees')
        .delete()
        .eq('event_id', eventId)
        .eq('user_id', userId);
    } else {
      // Set to going
      await upsert...
    }

== EDGE CASE 4: PAST EVENTS ==
Events where end_time < NOW() should:
  - Show "Event Ended" badge instead of RSVP buttons
  - RSVP buttons are disabled/hidden
  - Show final attendee count as read-only
  Filter in query: add a visual indicator, don't block loading past events.

== EDGE CASE 5: NO EVENTS EXIST ==
Show a friendly empty state:
  <View>
    <Text>No upcoming events yet</Text>
    <Text>Check back soon or create one!</Text>
  </View>

== EDGE CASE 6: NETWORK FAILURE DURING RSVP ==
  - Use optimistic update: change button state immediately
  - If DB write fails: revert button state + show error toast
  - Never leave the button in a permanent loading state

== EDGE CASE 7: RSVP COUNT DISPLAY ==
Always show live counts from DB, not cached numbers:
  SELECT COUNT(*) FROM event_attendees 
  WHERE event_id = ? AND status = 'going'

ACCEPTANCE CRITERIA:
  - Tapping RSVP twice doesn't create duplicate rows.
  - Changing from "Interested" to "Going" updates the row, not adds a new one.
  - Tapping active RSVP removes it.
  - Past events show "Ended" state with disabled RSVP buttons.
  - Empty events list shows a friendly UI, not a blank screen.
  - Network failure during RSVP reverts optimistic update and shows error.
```

---

### 🟡 PROMPT CR-010 — Share Post to a Matched Friend

```
I am building FAST SOCIO (React Native + Expo + Supabase).

NEW FEATURE (UAT-010): Users can share a post to one of their matched
friends via direct message.

WHAT TO DO:

1. Add a "Share" button on every post card in the feed (already in FR-07).
   Tapping it opens a Share Sheet — a bottom modal showing the user's
   matched friends as a scrollable list.

2. Load the friends list:
   const { data: matches } = await supabase
     .from('matches')
     .select(`
       id,
       user_one,
       user_two,
       profiles!matches_user_one_fkey(full_name, profile_picture),
       profiles!matches_user_two_fkey(full_name, profile_picture)
     `)
     .or(`user_one.eq.${myId},user_two.eq.${myId}`);
   
   Map results to show the OTHER user in each match (not yourself).

3. User taps a friend in the Share Sheet → sends them a message:
   
   The message content:
   {
     message_type: 'post_share',
     content: `Shared a post`,
     shared_post_id: postId,   ← add this column to messages table
     media_url: null
   }

   Add column: ALTER TABLE messages ADD COLUMN shared_post_id UUID REFERENCES posts(id);

4. In the chat UI, render a shared post message as a mini post preview card:
   - Post thumbnail/content snippet
   - "Tap to view post" → navigates to Post Detail screen
   - Styled differently from regular text messages (a bordered card bubble)

5. The share navigates the user to the chat with that friend after sending:
   navigation.navigate('Chat', { conversationId: match.conversationId });
   Show toast: "Post shared with [Friend Name]!"

ACCEPTANCE CRITERIA:
  - Share button on every post opens friend-selection bottom sheet.
  - Selected friend receives a special post-share message in their chat.
  - Shared post appears as a tappable preview card in the chat.
  - Tapping the preview in chat opens the original post.
  - Share works for both image and text posts.
```

---

### 🟡 PROMPT CR-013 — Bundle Notifications by Sender

```
I am building FAST SOCIO (React Native + Expo + Supabase).

GAP (UAT-013): The notifications screen shows each notification as a
separate item, even when they're from the same user. Bundle them.

EXAMPLE — Current (bad):
  ● Ahmed liked your post
  ● Ahmed commented on your post
  ● Ahmed liked your photo

EXAMPLE — Target (good, Twitter/Instagram-style):
  ● Ahmed liked your post, commented on your post, and 1 other activity

WHAT TO DO:

1. In the notifications query, group by sender_id + time window:
   
   Load notifications sorted by (sender_id, created_at DESC).
   Group consecutive notifications from the same sender that occurred
   within the last 1 hour into one component.

2. Build a NotificationGroup component:

   interface NotificationGroup {
     sender: Profile;         // the person who did things
     actions: Notification[]; // all their recent actions
     latestAt: Date;
   }

   Grouping logic (in JS after fetch):
   function groupNotifications(notifications: Notification[]): NotificationGroup[] {
     const groups: Record<string, NotificationGroup> = {};
     for (const n of notifications) {
       const key = n.sender_id;
       if (!groups[key]) {
         groups[key] = { sender: n.sender, actions: [], latestAt: n.created_at };
       }
       groups[key].actions.push(n);
       if (n.created_at > groups[key].latestAt) groups[key].latestAt = n.created_at;
     }
     return Object.values(groups).sort((a, b) => 
       new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
     );
   }

3. Render each group as one row:
   [Avatar] Ahmed liked your post and 2 others  ·  2m ago
   
   If group has 1 action: "Ahmed liked your post"
   If group has 2 actions: "Ahmed liked your post and commented"
   If group has 3+ actions: "Ahmed liked your post and 2 other activities"

4. Different sender = always separate group (no cross-user merging).
   System notifications (match, leaderboard) are never grouped — show individually.

5. Tapping a group → expands to show individual notifications OR
   navigates to the most relevant screen (the post, profile, etc.)

ACCEPTANCE CRITERIA:
  - Multiple actions from the same user in the last hour appear as one grouped row.
  - Text summarizes the actions naturally ("liked and commented").
  - Groups are sorted by most recent activity.
  - System notifications (matches, leaderboard changes) are not grouped.
  - Tapping a group navigates to the correct screen.
```

---

## 7. 🔁 Regression Test Suite

> Run after every CR. The core journey must pass every time.

### Core Journey (Must Pass Every Time)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Register with @nu.edu.pk | Account created, email sent |
| 2 | Verify email | Account active |
| 3 | Upload profile picture | Photo visible on profile |
| 4 | Edit bio + interests | Changes saved and visible to others |
| 5 | Open Discover | Cards load; no crash on empty queue |
| 6 | Like a profile + get liked back | Match created |
| 7 | Open Chat → Messages tab | Match conversation appears |
| 8 | Send a message | Delivered in real-time |
| 9 | Open Chat → Communities tab | Joined communities visible |
| 10 | Submit a community post | Goes to pending (awaiting admin approval) |
| 11 | Admin approves post | Post appears in community feed |
| 12 | Create an event | Event appears in Events screen |
| 13 | RSVP to an event | +15 Aura; status recorded |
| 14 | Open Leaderboard | Dept Rivalry at top; weekly leaderboard below |
| 15 | Like a post → comment with emoji | Comment saved; emoji displays |
| 16 | Share post to a friend | Friend receives post-share message |
| 17 | Check Notifications | Grouped by sender; shows combined activity |
| 18 | Admin: Moderate a report | Action taken; logged in audit table |

---

## 8. ✅ UAT Sign-Off Tracker

| UAT | Module | CR | Implemented | Re-tested | Result | Sign-off |
|-----|--------|----|-------------|-----------|--------|----------|
| UAT-001 | Profiles | CR-001 | ⬜ | ⬜ | | ⬜ |
| UAT-002 | Profiles | CR-002 | ⬜ | ⬜ | | ⬜ |
| UAT-003 | Leaderboard | CR-003 | ⬜ | ⬜ | | ⬜ |
| UAT-004 | Chat/Communities | CR-004 | ⬜ | ⬜ | | ⬜ |
| UAT-005 | Events/Communities | CR-005 | ⬜ | ⬜ | | ⬜ |
| UAT-006 | Events | CR-006 | ⬜ | ⬜ | | ⬜ |
| UAT-007 | Dept Rivalry | CR-007 | ⬜ | ⬜ | | ⬜ |
| UAT-008 | Feed | CR-008 | ⬜ | ⬜ | | ⬜ |
| UAT-009 | Discover | CR-009 | ⬜ | ⬜ | | ⬜ |
| UAT-010 | Feed | CR-010 | ⬜ | ⬜ | | ⬜ |
| UAT-011 | Communities | CR-011 | ⬜ | ⬜ | | ⬜ |
| UAT-012 | Messaging | CR-012 | ⬜ | ⬜ | | ⬜ |
| UAT-013 | Notifications | CR-013 | ⬜ | ⬜ | | ⬜ |
| UAT-014 | Admin Dashboard | CR-014 | ⬜ | ⬜ | | ⬜ |

---

## 9. 📦 Version Gate

```
v1.0.1 — Gate (must all pass before any soft launch):
  ✅ CR-012 Chat working
  ✅ CR-005 Create Event/Community working
  ✅ CR-001 Profile pictures + mutual viewing
  ✅ CR-002 Profile editing
  ✅ CR-008 Comments + emoji
  ✅ CR-009 Discover edge cases handled

v1.0.2 — Gate (before full launch):
  ✅ All v1.0.1 items
  ✅ CR-003/004/007 Navigation restructure complete
  ✅ CR-011 Community dual-zone working
  ✅ CR-014 Admin panel complete
  ✅ CR-006 RSVP edge cases
  ✅ CR-010 Post sharing
  ✅ CR-013 Notification grouping
  ✅ RLS audit: all 14 UAT areas re-tested
  ✅ Core journey (Section 7) completed end-to-end on real device
```

---

## 10. 🔬 Retrospective

### Root Causes Identified

| # | Area | Root Cause | Fix Going Forward |
|---|------|-----------|------------------|
| 1 | Chat | Realtime not enabled on messages table in Supabase dashboard | Enable Realtime as first step in any new table setup |
| 2 | Create flows | Silent catch blocks swallowed INSERT errors | Every catch block must show a visible alert — never empty |
| 3 | Profiles | Default RLS blocked cross-user reads | Test profile visibility with two different accounts immediately after building any read feature |
| 4 | Communities | No approval queue in design — expectation gap | Clarify two-zone community model in design doc before building |
| 5 | Navigation | Community + Chat were separate — expectation gap | Walk through all navigation flows in design review before dev starts |
| 6 | Discover | Edge cases not specified in design doc | Every list-based feature needs an explicit empty state, error state, and loading state in design |

---

*Document: FAST-SOCIO-validation-filled.md | Version: 1.0 | Date: 2026-07-02 | Status: 🔴 14 CRs Open*
