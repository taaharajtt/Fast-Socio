# Page 04 --- Home Feed Specification

## Purpose

The Home Feed is the heart of the platform and should function as a
dynamic campus timeline rather than a simple chronological list of
posts. Every item displayed is selected by a deterministic ranking
engine that balances recency, engagement, relevance, relationships,
department affinity, semester affinity, interests, Aura, moderation
quality, and freshness. The goal is to maximize meaningful interactions
instead of passive scrolling while ensuring every user has an
opportunity to be discovered.

## Feed Layout

The page consists of a top navigation bar, search shortcut,
notifications shortcut, create-post shortcut, feed filters,
stories/events carousel (optional), infinite scrolling feed, floating
create button, and bottom navigation. Posts should load incrementally
using pagination or cursor-based loading.

## Feed Ranking

Every post receives a visibility score. Factors include: - Relationship
with author. - Mutual friends. - Same department. - Same semester. -
Shared interests. - Post recency. - Engagement rate. - Save rate. -
Comment quality. - Author Aura. - Reports and moderation penalties. -
User-specific hidden preferences. The backend recalculates visibility
continuously as engagement changes.

## Create Post

Users may publish text, images, videos, GIFs, voice notes, polls,
anonymous discussions, study requests, lost & found, internships, jobs,
marketplace listings, club announcements, achievements, event
promotions, notes, and mixed-media posts. Audience visibility may target
everyone, departments, semesters, societies, or custom groups.

## Post Components

Every post displays author information, verification badge, timestamp,
edited status, visibility scope, content, media gallery, hashtags,
mentions, location (optional), reactions, comments count, share count,
save count, Aura gained, and moderation indicators when necessary.

## Post Actions

Available actions include Like, Love, Laugh, Fire, Aura reaction,
Comment, Reply, Save, Share, Copy Link, Translate, Follow Author, View
Profile, Report, Mute, Block, Hide, Not Interested, Pin (owner/admin),
Edit, Delete, Archive, and Boost where applicable.

## Comments

Comments support nested replies, mentions, GIFs, images, voice notes,
emoji reactions, editing, deletion, pinning, reporting, translation, and
sorting by newest or most relevant. Comment quality contributes toward
Aura calculations.

## Infinite Scroll

As users approach the bottom of the feed, additional posts are fetched
automatically. Duplicate posts are prevented using cursor pagination.
Failed loads should retry gracefully without resetting scroll position.

## Refresh Logic

Pull-to-refresh retrieves newly ranked content, updated engagement
counts, moderation changes, and newly created posts while preserving the
user's current reading position where possible.

## Notifications

Creating a post, reacting, commenting, replying, mentioning users, or
sharing content automatically generates notification events according to
each recipient's preferences.

## Moderation

Every post passes automated moderation before becoming visible. Spam
detection, profanity filtering, duplicate detection, and report
thresholds may reduce visibility or hold content for manual review.

## Caching

Images, videos, avatars, and recently viewed posts should be cached
locally. Feed metadata may be cached with expiration timestamps to
reduce repeated requests.

## Analytics

Track impressions, view duration, scroll depth, engagement rate,
completion rate for videos, saves, shares, hides, reports, click-through
rates, and conversion into profile visits or matches.

## Error States

Handle empty feeds, loading failures, expired content, deleted posts,
blocked users, hidden content, and offline mode gracefully with
contextual retry actions.

## Engineering Requirements

-   Cursor-based pagination.
-   Optimistic UI updates.
-   Real-time engagement counters.
-   Background cache refresh.
-   Lazy media loading.
-   Image compression.
-   Video streaming support.
-   Accessibility compliance.
-   Secure media permissions.
-   Deterministic ranking engine.
-   Offline draft support.

## Navigation

``` text
Home Feed
   ├── Create Post
   ├── Post Detail
   ├── Author Profile
   ├── Comments
   ├── Share Sheet
   ├── Report Flow
   ├── Notifications
   ├── Search
   └── Bottom Navigation
```
