# Page 06 --- Post Details Specification

## Purpose

The Post Details page is the complete interaction hub for an individual
post. While the Home Feed provides a summarized view, this page exposes
the full content, media, engagement history, discussion threads,
moderation state, and every available interaction. It must support
real-time updates so likes, comments, reactions, and edits appear
instantly without requiring a page refresh.

## Layout

The page displays the author's profile picture, verification badge,
display name, username, department, semester, Aura badge, timestamp,
visibility scope, edit history, and optional location. Below this, the
full post content and attached media are displayed using an adaptive
layout optimized for text, images, videos, GIFs, polls, documents, voice
notes, and mixed-media posts.

## Media Viewer

Images should open in a full-screen gallery with zoom, swipe navigation,
download (if allowed), share, and save options. Videos support adaptive
streaming, playback speed controls, subtitles (if available), fullscreen
mode, picture-in-picture where supported, and playback resume.

## Engagement

Users may react using configurable reactions (Like, Love, Laugh, Fire,
Aura, etc.), comment, reply, save, share, report, translate, copy link,
hide, mute the author, follow the author, block the author, or mark the
content as "Not Interested." Engagement counters update in real time and
optimistic UI should immediately reflect user actions.

## Comments

Comments are displayed using nested threading. Users can sort comments
by Top, Newest, Oldest, or Most Relevant. Each comment supports
reactions, replies, mentions, media attachments, editing, deletion,
reporting, translation, pinning (owner/moderator), and copying.
Collapsible threads should reduce clutter for long discussions.

## Polls

If the post contains a poll, users may vote once unless poll settings
allow changes. Results become visible according to poll configuration.
Poll creators may define duration, anonymity, multiple-choice rules, and
result visibility.

## Sharing

The Share sheet allows internal sharing to chats, events, societies, or
users, along with external sharing via generated deep links. Privacy
settings determine whether external sharing is permitted.

## Author Actions

Post owners may edit text, replace media (before engagement threshold if
configured), archive, pin (where supported), schedule deletion, disable
comments, or permanently delete the post. Editing history should be
visible when appropriate.

## Moderation

Reported posts display status indicators for moderators. Hidden,
removed, or restricted content should explain the reason to the author
while remaining inaccessible to other users when required. Moderation
events are logged for auditing.

## Notifications

Every interaction---including reactions, comments, replies, mentions,
poll votes, saves, and shares---may generate notifications according to
recipient preferences and platform rules.

## Analytics

Record impressions, unique viewers, engagement rate, average read time,
media completion, comment depth, shares, saves, click-throughs to author
profile, and moderation outcomes.

## Engineering Requirements

-   Real-time synchronization.
-   Optimistic updates.
-   Infinite comment loading.
-   Media caching.
-   Deep-link support.
-   Adaptive layouts.
-   Accessibility compliance.
-   Offline viewing for cached posts.
-   Secure permission enforcement.
-   Automatic engagement recalculation.

## Navigation

``` text
Home Feed
    ↓
Post Details
    ├── Author Profile
    ├── Media Viewer
    ├── Comments
    │      └── Replies
    ├── Share Sheet
    ├── Report Flow
    ├── Translation
    ├── Edit Post (Owner)
    ├── Delete / Archive
    └── Back to Feed
```
