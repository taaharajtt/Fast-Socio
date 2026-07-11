# Page 05 --- Create Post Specification

## Purpose

The Create Post module is the primary content creation interface of the
platform. It should allow students to publish different forms of content
while maintaining consistency, moderation, audience control, and
high-quality user experience. Every post created contributes to the
campus social graph, Aura calculations, recommendations, trending
algorithms, and user engagement metrics. The interface should be fast,
intuitive, and support saving work at any stage.

## Supported Post Types

The system should support multiple post categories including standard
text posts, image galleries, videos, GIFs, voice notes, polls,
questions, anonymous discussions, achievements, study requests,
internship opportunities, job postings, marketplace listings, lost and
found reports, event promotions, club announcements, lecture notes,
research opportunities, and mixed-media posts. Each post type has
dedicated validation rules and metadata.

## Editor

The editor should provide a rich writing experience with text
formatting, emoji picker, hashtag autocomplete, user mentions, society
tagging, URL previews, media attachment, drag-and-drop uploads on web,
character counter, autosave drafts, undo/redo, and live preview. Users
may schedule posts, save as drafts, or publish immediately.

## Media Uploads

Users can upload multiple images, videos, PDFs, audio files, or
documents within configurable limits. Images should be compressed before
upload, videos transcoded into streaming formats, and all files scanned
for security risks. Media should display upload progress, cancellation,
retry, and preview options before publishing.

## Audience Controls

Every post includes visibility settings allowing publication to the
entire university, specific departments, semesters, societies, clubs,
selected friends, private groups, or only the author. Users may enable
or disable comments, sharing, downloads, remixing, or reposting
depending on permissions.

## Publishing Workflow

When Publish is selected, the client validates all required fields,
uploads media, creates database records, triggers moderation checks,
updates recommendation indexes, awards Aura where applicable, generates
notifications for mentions, and inserts the post into the Home Feed
ranking engine. If moderation flags the content, the post may enter a
pending review state instead of becoming immediately visible.

## Drafts

Drafts should synchronize across devices. Every edit is automatically
saved locally and periodically synchronized with the backend. Drafts may
contain media, scheduled publishing times, hashtags, and audience
selections.

## Validation

Posts must respect configurable limits for text length, media count,
file size, supported formats, hashtag count, mention count, and poll
options. Invalid inputs should produce immediate user feedback before
submission.

## Notifications

Mentions notify tagged users. Society tags notify administrators when
appropriate. Scheduled posts trigger reminders before publishing.
Followers may receive notifications depending on their notification
preferences.

## Analytics

Track post creation time, abandoned drafts, publish success rate, upload
duration, media types used, engagement generated, and moderation
outcomes.

## Engineering Requirements

-   Autosave drafts.
-   Secure media uploads.
-   Upload retry support.
-   Offline draft creation.
-   Rich text editor.
-   Hashtag indexing.
-   Mention resolution.
-   URL preview generation.
-   Background media processing.
-   Moderation pipeline integration.
-   Optimistic publishing.
-   Accessibility support.

## Navigation

``` text
Home Feed
    ↓
Create Post
    ├── Media Picker
    ├── Camera
    ├── Gallery
    ├── Drafts
    ├── Audience Selector
    ├── Schedule Post
    ├── Publish
    └── Post Successfully Created
             ↓
        Home Feed
```
