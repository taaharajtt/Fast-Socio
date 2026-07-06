# 🤖 Claude Code Prompt — FAST SOCIO Performance & Latency Audit

> **Paste this entire prompt into Claude Code.**
> Do not split it. Work through it top to bottom in one session.

---

```
I am building FAST SOCIO — a university social mobile app built with
React Native (Expo), Supabase (PostgreSQL + Realtime), Zustand, TanStack
Query, and React Navigation (Bottom Tabs + Stack).

CRITICAL PROBLEM: The entire app is severely laggy.
  - Moving between pages takes 4–5 seconds
  - Feed takes 3–4 seconds to show any content
  - Discover cards take 3+ seconds to load
  - Chat screen freezes on open
  - Leaderboard + Analytics screens are the slowest
  - Every screen re-fetches everything on every visit

This is a full performance audit and fix session.
Do NOT touch any feature logic or UI design.
ONLY fix performance. Functionality must be identical after all changes.

══════════════════════════════════════════════════════════════
TECH STACK (so you know what files and APIs to look for)
══════════════════════════════════════════════════════════════

  Framework:        React Native + Expo SDK 51
  Navigation:       React Navigation v6 (Bottom Tabs + Native Stack)
  Data fetching:    TanStack Query v5 (@tanstack/react-query)
  State:            Zustand
  Backend:          Supabase (PostgREST + Realtime + Storage)
  Images:           expo-image OR React Native Image
  Lists:            FlatList / ScrollView
  Animations:       React Native Animated / Reanimated
  Notifications:    Expo Notifications

══════════════════════════════════════════════════════════════
STEP 1 — DIAGNOSE FIRST (read before changing anything)
══════════════════════════════════════════════════════════════

Before touching any code, audit these things and report findings:

AUDIT 1 — FIND ALL SUPABASE QUERIES:
  Search every file for: supabase.from(
  List every table queried, what columns are selected, and whether
  .select('*') is used anywhere (that is a performance red flag).

AUDIT 2 — FIND ALL DATA FETCHING ON SCREEN MOUNT:
  Search for useEffect(() => { ... fetch ... }, [])
  and useQuery({ queryKey: ..., queryFn: ... })
  List every screen and what it fetches on mount.
  Identify which screens fetch data EVERY TIME they are focused
  (onFocus subscriptions or isFocused-triggered effects).

AUDIT 3 — FIND ALL FLATLISTS:
  Search every file for <FlatList
  For each one, check:
    □ Does it have keyExtractor? (required for performance)
    □ Does it have getItemLayout? (required if item height is fixed)
    □ Does it have windowSize? (default is 21 — often too high)
    □ Does it have initialNumToRender? (default is 10 — often too many)
    □ Does it have removeClippedSubviews? (must be true on Android)
    □ Does it have maxToRenderPerBatch? (default 10 — often too many)
    □ Is renderItem wrapped in React.memo()?
    □ Is renderItem defined INLINE in JSX? (worst case — redefines on every render)

AUDIT 4 — FIND RE-RENDER CAUSES:
  Search every screen component for:
    □ Functions defined inside the component body not wrapped in useCallback
    □ Objects/arrays defined inline in JSX (new reference every render)
    □ Zustand selectors using object destructuring: const { a, b } = useStore()
      (these cause re-render on any store change — very common bug)
    □ useSelector or Zustand calls that select the ENTIRE store

AUDIT 5 — FIND IMAGE LOADING ISSUES:
  Search for <Image source={{ uri: and check:
    □ Is expo-image being used? (much faster than React Native Image)
    □ Are images using contentFit="cover" and cachePolicy="memory-disk"?
    □ Are profile picture URLs being fetched inside FlatList renderItem?
    □ Are images inside lists resized server-side or loading full-resolution?

AUDIT 6 — FIND NAVIGATION PERFORMANCE ISSUES:
  Check the navigation configuration:
    □ Are all tab screens using lazy: true in the tab navigator?
    □ Are heavy screens (Feed, Discover, Leaderboard) loaded on startup?
    □ Are screens unmounting/remounting on every tab switch?
    □ Does any screen subscribe to Supabase Realtime on mount and forget
      to unsubscribe on unmount? (memory leak + performance drain)

AUDIT 7 — FIND TANSTACK QUERY CONFIGURATION:
  Find the QueryClient configuration:
    □ What is the staleTime? (if 0 or undefined → refetches on every focus)
    □ What is the gcTime / cacheTime? (if low → data discarded too fast)
    □ Is refetchOnWindowFocus: true? (should be false on mobile)
    □ Is refetchOnMount: true? (causes refetch every screen visit)
    □ Are query keys stable? (inline objects as keys cause constant refetches)

AUDIT 8 — FIND SUPABASE CONNECTION ISSUES:
  □ Is a new Supabase client being created in multiple files?
    (Should be ONE singleton imported everywhere)
  □ Are multiple Realtime subscriptions created for the same table/channel?
  □ Are Realtime subscriptions being created inside useEffect without
    proper cleanup? (supabase.removeChannel() in the return function)

Report all findings before making ANY code changes.
Then fix them in the order specified below.

══════════════════════════════════════════════════════════════
STEP 2 — FIX TANSTACK QUERY CONFIGURATION
══════════════════════════════════════════════════════════════

Find the QueryClient instantiation (usually in App.tsx or _layout.tsx).
Replace with this configuration:

  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // CRITICAL: data is fresh for 5 minutes — no refetch on every focus
        staleTime: 5 * 60 * 1000,

        // Keep data in cache for 10 minutes after component unmounts
        gcTime: 10 * 60 * 1000,

        // DO NOT refetch when user switches apps and comes back
        refetchOnWindowFocus: false,

        // DO NOT refetch just because the component mounted again
        refetchOnMount: false,

        // DO refetch when network reconnects (this one is fine)
        refetchOnReconnect: true,

        // Retry failed requests twice with exponential backoff
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      },
    },
  });

IMMEDIATELY this change alone will eliminate most of the 4–5 second
page load times caused by re-fetching data on every navigation.

══════════════════════════════════════════════════════════════
STEP 3 — FIX ALL SUPABASE QUERIES
══════════════════════════════════════════════════════════════

Go through EVERY supabase.from() call found in Audit 1 and apply these rules:

RULE A — NEVER USE .select('*') IN LIST QUERIES:
  Lists (feed, discover, leaderboard, notifications) must only fetch
  the columns they actually display. Example:

  BEFORE (slow — fetches all columns including heavy ones):
    supabase.from('posts').select('*')

  AFTER (fast — only what the card displays):
    supabase.from('posts').select(`
      id, content, post_type, is_anonymous, created_at,
      media_url, author_id,
      profiles!posts_author_id_fkey (
        full_name, profile_picture, aura_score
      )
    `)

  Apply this to: posts, profiles (discover), messages, communities,
  events, leaderboard_snapshots, notifications.

RULE B — ALWAYS PAGINATE LIST QUERIES:
  No list query should ever fetch all rows. Apply .range() to everything:

  BEFORE:
    supabase.from('posts').select(...).order('created_at', { ascending: false })

  AFTER:
    supabase.from('posts')
      .select(...)
      .order('created_at', { ascending: false })
      .range(0, 19)   ← first 20 items; load more on scroll

  For infinite scroll: track the page number in state and pass
  .range(page * 20, page * 20 + 19) for subsequent fetches.

RULE C — ADD MISSING DATABASE INDEXES (run these in Supabase SQL Editor):

  -- Posts feed (most critical — feed is always slow without this)
  CREATE INDEX IF NOT EXISTS idx_posts_created_at
  ON posts (created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_posts_author_id
  ON posts (author_id);

  -- Discover queue
  CREATE INDEX IF NOT EXISTS idx_likes_sender_id
  ON likes (sender_id);

  CREATE INDEX IF NOT EXISTS idx_passes_sender_id
  ON passes (sender_id);

  -- Messages (chat is slow without this)
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_created
  ON messages (conversation_id, created_at DESC);

  -- Aura transactions
  CREATE INDEX IF NOT EXISTS idx_aura_user_id
  ON aura_transactions (user_id, created_at DESC);

  -- Notifications
  CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications (user_id, created_at DESC);

  -- Leaderboard
  CREATE INDEX IF NOT EXISTS idx_leaderboard_week
  ON leaderboard_snapshots (week_number, rank ASC);

  -- Community posts
  CREATE INDEX IF NOT EXISTS idx_community_posts_community_id
  ON community_posts (community_id, created_at DESC);

  -- Event attendees
  CREATE INDEX IF NOT EXISTS idx_event_attendees_event_id
  ON event_attendees (event_id);

  After adding indexes, run ANALYZE on each table:
  ANALYZE posts; ANALYZE messages; ANALYZE likes; ANALYZE notifications;
  ANALYZE aura_transactions; ANALYZE leaderboard_snapshots;

RULE D — BATCH PARALLEL QUERIES (stop sequential awaits):

  BEFORE (sequential — each waits for the previous):
    const courses = await fetchCourses();
    const notifications = await fetchNotifications();
    const matches = await fetchMatches();
    // Total time: 3 × network round trip

  AFTER (parallel — all run simultaneously):
    const [courses, notifications, matches] = await Promise.all([
      fetchCourses(),
      fetchNotifications(),
      fetchMatches(),
    ]);
    // Total time: 1 × network round trip (the slowest of the three)

  Apply this pattern everywhere multiple fetches happen in sequence.

RULE E — FIX THE DISCOVER QUERY (it is almost certainly the slowest):

  The Discover query joins multiple tables to exclude already-seen profiles.
  This is expensive if done naively. Fix it:

  BEFORE (slow — multiple round trips):
    const likes = await supabase.from('likes').select('receiver_id').eq('sender_id', me);
    const passes = await supabase.from('passes').select('receiver_id').eq('sender_id', me);
    const matches = await supabase.from('matches').select('user_one,user_two');
    const profiles = await supabase.from('profiles').select('*')
      .not('user_id', 'in', [...likeIds, ...passIds, ...matchIds]);

  AFTER (fast — single query using Supabase's NOT IN with subquery):
    const { data: profiles } = await supabase
      .from('profiles')
      .select(`
        id, user_id, full_name, department, semester,
        aura_score, profile_picture, bio,
        profile_interests (interests (name))
      `)
      .not('user_id', 'eq', myUserId)
      .not('user_id', 'in',
        `(SELECT receiver_id FROM likes WHERE sender_id = '${myUserId}')`
      )
      .not('user_id', 'in',
        `(SELECT receiver_id FROM passes WHERE sender_id = '${myUserId}')`
      )
      .not('user_id', 'in', `(
        SELECT CASE WHEN user_one = '${myUserId}' THEN user_two
               ELSE user_one END
        FROM matches WHERE user_one = '${myUserId}' OR user_two = '${myUserId}'
      )`)
      .limit(10);   ← only load 10 cards at a time; fetch next 10 as queue depletes

══════════════════════════════════════════════════════════════
STEP 4 — FIX NAVIGATION PERFORMANCE
══════════════════════════════════════════════════════════════

FIX A — ENABLE LAZY LOADING IN TAB NAVIGATOR:
  Find the bottom tab navigator configuration.
  The screens are almost certainly all mounting on app launch.
  Fix this:

  BEFORE:
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Discover" component={DiscoverScreen} />
      ...
    </Tab.Navigator>

  AFTER — add lazy to each screen and use unmountOnBlur wisely:
    <Tab.Navigator
      screenOptions={{
        lazy: true,              // ← screens mount only when first visited
        lazyPreloadDistance: 0,  // ← do not pre-load adjacent tabs
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{ unmountOnBlur: false }}  ← keep swipe state alive
      />
      <Tab.Screen name="Chat" component={ChatScreen} />
      <Tab.Screen name="Leaderboard" component={LeaderboardScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>

FIX B — USE NATIVE STACK INSTEAD OF JS STACK:
  If the stack navigator is using @react-navigation/stack (JS-based):

  BEFORE:
    import { createStackNavigator } from '@react-navigation/stack';

  AFTER (native animations, 60fps, no JS thread involvement):
    import { createNativeStackNavigator } from '@react-navigation/native-stack';

  Replace all createStackNavigator() with createNativeStackNavigator().
  The API is identical — only the import changes.

FIX C — ADD SCREEN TRANSITION CONFIGURATION:
  For the Native Stack, configure fast transitions:

    <Stack.Navigator
      screenOptions={{
        animation: 'slide_from_right',
        animationDuration: 200,   ← default is 350ms — halve it
        gestureEnabled: true,
        headerShown: false,
      }}
    >

FIX D — STOP SCREENS FROM FETCHING ON EVERY FOCUS:
  Search for this pattern and REMOVE IT from every screen:

    REMOVE THIS (causes full refetch every tab switch):
    const isFocused = useIsFocused();
    useEffect(() => {
      if (isFocused) {
        fetchData();  ← this fires every single time the tab is opened
      }
    }, [isFocused]);

  TanStack Query with staleTime (Step 2) already handles this correctly.
  Delete ALL isFocused-based refetch triggers.

══════════════════════════════════════════════════════════════
STEP 5 — FIX FLATLISTS (feed, discover, leaderboard, chat)
══════════════════════════════════════════════════════════════

For every FlatList found in Audit 3, apply ALL of the following:

TEMPLATE — Production-optimized FlatList:

  const renderItem = useCallback(({ item }: { item: PostType }) => (
    <PostCard post={item} />    ← PostCard must be React.memo'd
  ), []);  ← MUST be useCallback — never define inline in JSX

  const keyExtractor = useCallback((item: PostType) => item.id, []);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: ITEM_HEIGHT,        ← measure your item height and put it here
      offset: ITEM_HEIGHT * index,
      index,
    }),
    []
  );  ← Only add this if ALL items have a FIXED, KNOWN height

  <FlatList
    data={posts}
    renderItem={renderItem}
    keyExtractor={keyExtractor}
    getItemLayout={getItemLayout}          ← if fixed height
    windowSize={5}                         ← was 21; render 5 screens worth
    initialNumToRender={8}                 ← was 10; render only 8 on mount
    maxToRenderPerBatch={5}                ← render 5 items per batch
    updateCellsBatchingPeriod={50}         ← batch more aggressively
    removeClippedSubviews={true}           ← CRITICAL for Android performance
    showsVerticalScrollIndicator={false}
    onEndReachedThreshold={0.5}            ← load more when 50% from bottom
    onEndReached={loadMorePosts}
    ListEmptyComponent={<EmptyFeedState />}
    ListFooterComponent={isLoadingMore ? <ActivityIndicator /> : null}
  />

MEMO EVERY LIST ITEM COMPONENT:
  Find PostCard, DiscoverCard, NotificationItem, ChatListItem,
  LeaderboardRow, CommunityCard, EventCard — and wrap each in React.memo:

  BEFORE:
    export function PostCard({ post }: { post: Post }) {
      return <View>...</View>;
    }

  AFTER:
    export const PostCard = React.memo(function PostCard({ post }: { post: Post }) {
      return <View>...</View>;
    });

  For memo to work, also ensure the parent is not passing new object
  references as props on every render:

  BEFORE (breaks memo — new object every render):
    <PostCard post={post} style={{ marginBottom: 12 }} />

  AFTER:
    const cardStyle = { marginBottom: 12 };  ← define outside component
    <PostCard post={post} style={cardStyle} />

══════════════════════════════════════════════════════════════
STEP 6 — FIX IMAGE LOADING
══════════════════════════════════════════════════════════════

FIX A — REPLACE ALL React Native <Image> WITH expo-image:

  Install: npx expo install expo-image

  BEFORE:
    import { Image } from 'react-native';
    <Image source={{ uri: profile.profile_picture }} style={styles.avatar} />

  AFTER:
    import { Image } from 'expo-image';
    <Image
      source={profile.profile_picture}
      style={styles.avatar}
      contentFit="cover"
      cachePolicy="memory-disk"   ← cache in memory AND disk; never re-fetch
      placeholder={blurhash}       ← show while loading (optional but great UX)
      transition={150}             ← 150ms fade in
    />

  expo-image has built-in memory and disk caching, HTTP cache headers respect,
  and blurhash placeholder support. React Native Image has none of these.

FIX B — ADD IMAGE CACHING TO ALL AVATAR URLS:
  Supabase Storage URLs can be transformed for resizing. For avatars shown
  in lists (small circles), request a smaller version:

  function getAvatarUrl(url: string | null, size: number = 100): string {
    if (!url) return '';
    // Supabase image transformation:
    return `${url}?width=${size}&height=${size}&resize=cover&quality=80`;
  }

  Use getAvatarUrl(profile.profile_picture, 80) for list items (80x80px).
  Use getAvatarUrl(profile.profile_picture, 200) for profile screens (200x200px).
  Full resolution only on the image viewer screen.

FIX C — ADD PLACEHOLDER TO ALL IMAGES IN LISTS:
  Blank space while images load is jarring. Add a backgroundColor placeholder:

  <Image
    source={post.media_url}
    style={styles.postImage}
    contentFit="cover"
    cachePolicy="memory-disk"
    placeholder={{ backgroundColor: '#1E1E2E' }}
  />

══════════════════════════════════════════════════════════════
STEP 7 — FIX ZUSTAND STORE SELECTORS (massive re-render source)
══════════════════════════════════════════════════════════════

The most common Zustand performance bug in React Native:

BEFORE (subscribes to ENTIRE store — re-renders on ANY state change):
  const { posts, isLoading, fetchPosts, user } = usePostsStore();

AFTER (subscribes ONLY to the values you need):
  const posts = usePostsStore((state) => state.posts);
  const isLoading = usePostsStore((state) => state.isLoading);
  const fetchPosts = usePostsStore((state) => state.fetchPosts);
  // user comes from a DIFFERENT store call — no cross-contamination

Search EVERY useStore() call in the app and convert all destructuring
to individual selectors like the pattern above.

For multiple values from the same store without causing re-renders,
use the Zustand shallow comparison selector:

  import { useShallow } from 'zustand/react/shallow';

  const { posts, isLoading } = usePostsStore(
    useShallow((state) => ({ posts: state.posts, isLoading: state.isLoading }))
  );

══════════════════════════════════════════════════════════════
STEP 8 — FIX SUPABASE REALTIME (memory leaks killing performance)
══════════════════════════════════════════════════════════════

Every Realtime subscription that does not clean up creates a memory
leak AND adds background CPU load. This accumulates across navigations
and eventually makes the app sluggish system-wide.

Find ALL Supabase Realtime subscriptions:
  Search for: .channel( and .subscribe(

For every single one, ensure this pattern:

  useEffect(() => {
    const channel = supabase
      .channel('unique-channel-name')
      .on('postgres_changes', { ... }, handler)
      .subscribe();

    // THIS RETURN FUNCTION IS MANDATORY — if missing, it's a memory leak
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);  ← empty deps array = subscribe once, clean up on unmount

Additionally, check for duplicate channels:
  If the same channel name is created multiple times (e.g., because a
  component remounts), Supabase creates multiple subscriptions to the
  same data. This multiplies network traffic.

  Fix: use unique, stable channel names:
    WRONG: .channel('messages')           ← creates duplicates
    RIGHT: .channel(`messages:${conversationId}`)  ← unique per conversation

  And check: is the same conversation being subscribed to in multiple
  components simultaneously? Lift the subscription to the parent.

══════════════════════════════════════════════════════════════
STEP 9 — ADD LOADING SKELETONS (perceived performance fix)
══════════════════════════════════════════════════════════════

The 4–5 second wait FEELS longer because there is nothing on screen.
Skeleton screens reduce perceived wait time by 40–60% without changing
actual load time. Build these skeleton components:

  COMPONENTS TO BUILD:
  - PostCardSkeleton    — for feed
  - DiscoverCardSkeleton — for discover
  - ProfileSkeleton     — for profile screens
  - ChatListSkeleton    — for chat list
  - NotificationSkeleton — for notifications
  - LeaderboardSkeleton  — for leaderboard rows

  SKELETON PATTERN (use this for every skeleton):
    import { useEffect, useRef } from 'react';
    import { Animated, View } from 'react-native';

    function SkeletonBox({ width, height, borderRadius = 8 }: SkeletonBoxProps) {
      const opacity = useRef(new Animated.Value(0.3)).current;

      useEffect(() => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.7, duration: 800,
              useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.3, duration: 800,
              useNativeDriver: true }),
          ])
        ).start();
      }, []);

      return (
        <Animated.View style={{
          width, height, borderRadius,
          backgroundColor: '#1E1E2E',
          opacity
        }} />
      );
    }

  USE THEM IN EVERY SCREEN:
    if (isLoading && data.length === 0) {
      return (
        <FlatList
          data={[1, 2, 3, 4, 5]}  ← fake 5 items
          keyExtractor={(i) => String(i)}
          renderItem={() => <PostCardSkeleton />}
        />
      );
    }

══════════════════════════════════════════════════════════════
STEP 10 — FIX SCREEN-SPECIFIC BOTTLENECKS
══════════════════════════════════════════════════════════════

== HOME FEED ==
Problem: Loads all posts at once with all author data.

Fix:
  - Paginate: fetch 15 posts at a time
  - Use the column-specific select from Step 3 Rule A
  - Memoize PostCard
  - Use FlatList config from Step 5
  - Remove any useEffect-on-focus refetch
  - For the "Campus Pulse" aura stats at the top: fetch separately
    with its own useQuery and a 5-minute staleTime — it doesn't need
    to be fresh on every load

== DISCOVER SCREEN ==
Problem: Fetches the entire profile queue + excludes liked/passed in JS.

Fix:
  - Use the single optimized query from Step 3 Rule E
  - Pre-fetch NEXT 10 cards while user is swiping through current 10:
    when queue drops to 3 remaining, trigger background fetch of next 10
  - Profile pictures: load at 200px width (not full resolution)
  - Swipe animations: ensure all Animated values use useNativeDriver: true

== CHAT SCREEN ==
Problem: Loads all messages in a conversation on open.

Fix:
  - Load only the last 30 messages on open:
    .order('created_at', { ascending: false }).limit(30)
    Then reverse array before display (newest at bottom)
  - Load older messages on scroll up (infinite scroll upward)
  - Use FlatList with inverted={true} for natural chat direction
  - Media messages: load thumbnail (100px) in list; full on tap
  - Realtime subscription: only one per conversation, cleaned up on leave

== LEADERBOARD SCREEN ==
Problem: Aggregates all users' Aura scores on load — extremely expensive.

Fix:
  - NEVER compute the leaderboard on the client.
    The leaderboard_snapshots table already exists — read from it directly.
  - If leaderboard_snapshots is empty (not being written), create a
    Supabase Edge Function or scheduled function that populates it nightly.
    The mobile screen only reads pre-computed data.
  - Paginate: show top 50 by default; load more on scroll

== PROFILE SCREEN ==
Problem: Fetches profile + posts + comments + Aura + matches all at once.

Fix:
  - On first load: fetch ONLY the profile card data (name, bio, aura, photo)
  - Load posts LAZILY in a tab below — only when the Posts tab is tapped
  - Split into three separate useQuery calls with different stale times:
    - Profile data: staleTime 5 minutes
    - Posts: staleTime 2 minutes
    - Aura score: staleTime 10 minutes (changes slowly)

== NOTIFICATIONS SCREEN ==
Problem: All notification types loaded together with no grouping query-side.

Fix:
  - Load 30 notifications max, paginated
  - Group them IN the query result (or in a useMemo), not on every render
  - Mark-as-read: batch update (don't update one by one)
    UPDATE notifications SET read = true
    WHERE user_id = ? AND read = false → single call, not N calls

══════════════════════════════════════════════════════════════
STEP 11 — FIX ANIMATIONS (ensure native driver)
══════════════════════════════════════════════════════════════

Every Animated.timing(), Animated.spring(), Animated.decay() call
must use useNativeDriver: true unless animating layout properties.

Search for: useNativeDriver and find any that are false or missing.

COMMON CASES:
  - Swipe card animation (Discover): useNativeDriver: true ✅
  - Fade in/out transitions: useNativeDriver: true ✅
  - Skeleton pulse animation: useNativeDriver: true ✅
  - Width/height animations: useNativeDriver: false (layout — cannot use native)
  - Transform animations: useNativeDriver: true ✅

If any opacity/transform animation has useNativeDriver: false → change to true.
This moves the animation off the JS thread onto the UI thread (zero JS cost).

Also check: is react-native-reanimated being used?
If Reanimated is installed but animations are using the old Animated API,
migrate key animations (swipe card, tab transitions) to Reanimated 2.
Reanimated runs on the UI thread entirely and is significantly faster.

══════════════════════════════════════════════════════════════
STEP 12 — PRELOAD CRITICAL DATA AT APP STARTUP
══════════════════════════════════════════════════════════════

Instead of each screen fetching its own data when first visited,
prefetch the most critical data during the splash screen / startup:

In app/_layout.tsx (root layout), after auth check:

  const queryClient = useQueryClient();

  useEffect(() => {
    async function prefetchCriticalData() {
      // Prefetch in parallel — these run while splash is showing
      await Promise.all([
        // Feed data — so Home tab is instant
        queryClient.prefetchQuery({
          queryKey: ['posts', 'feed'],
          queryFn: fetchFeedPosts,
          staleTime: 5 * 60 * 1000,
        }),
        // User's profile — needed everywhere
        queryClient.prefetchQuery({
          queryKey: ['profile', userId],
          queryFn: () => fetchProfile(userId),
          staleTime: 10 * 60 * 1000,
        }),
        // Upcoming deadlines — shown on multiple screens
        queryClient.prefetchQuery({
          queryKey: ['deadlines'],
          queryFn: fetchDeadlines,
          staleTime: 15 * 60 * 1000,
        }),
        // Notification count — badge on tab bar
        queryClient.prefetchQuery({
          queryKey: ['notifications', 'unread-count'],
          queryFn: fetchUnreadCount,
          staleTime: 2 * 60 * 1000,
        }),
      ]);
    }

    if (userId) {
      prefetchCriticalData();
    }
  }, [userId]);

When the user taps the Home tab or Notifications tab, the data is
ALREADY in cache — screen renders instantly, zero waiting.

══════════════════════════════════════════════════════════════
STEP 13 — VERIFY EACH FIX (acceptance criteria)
══════════════════════════════════════════════════════════════

After completing all steps, test the following and confirm:

NAVIGATION SPEED:
  □ Switching between bottom tabs: under 300ms (was 4–5 seconds)
  □ Opening a profile from feed: under 500ms
  □ Opening a chat conversation: under 400ms
  □ Opening discover: under 500ms

FEED PERFORMANCE:
  □ Feed shows skeleton within 100ms of screen mount
  □ First real posts appear within 1 second
  □ Scroll at 60fps with no jank (test by fast-flinging scroll)

DISCOVER:
  □ Cards load within 800ms on first open
  □ Swipe animation is smooth (no dropped frames)
  □ Queue never shows a blank card (pre-fetching working)

CHAT:
  □ Conversation opens within 500ms
  □ New messages appear within 500ms of being sent
  □ Scrolling through message history is smooth

MEMORY:
  □ Navigate between all 5 tabs 10 times each — app does not slow down
    (if it does, there are still memory leaks in Realtime subscriptions)

IMAGE LOADING:
  □ Profile pictures in FlatList load with placeholder (no blank space)
  □ Switching between tabs does not re-fetch images (cache working)

══════════════════════════════════════════════════════════════
IMPORTANT CONSTRAINTS
══════════════════════════════════════════════════════════════

  ✅ DO: Optimize queries, add indexes, fix re-renders, improve caching
  ✅ DO: Replace Image with expo-image everywhere
  ✅ DO: Add skeleton loading screens
  ✅ DO: Fix Zustand selectors
  ✅ DO: Add missing FlatList performance props
  ✅ DO: Fix Realtime subscription cleanup

  ❌ DO NOT: Change any feature behaviour or business logic
  ❌ DO NOT: Change any UI layout, colors, or design
  ❌ DO NOT: Remove any features or screens
  ❌ DO NOT: Change navigation structure or routes
  ❌ DO NOT: Modify the Supabase schema (only ADD indexes)
  ❌ DO NOT: Change any RLS policies

Start with the Audit (Step 1) and report all findings.
Then fix each step in order. Confirm each fix before moving to next.
```
