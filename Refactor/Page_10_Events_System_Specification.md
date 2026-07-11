# Page 10 --- Events System Specification

## Purpose

The Events module is the university's centralized event management
platform, enabling students, societies, departments, clubs, and
administrators to create, discover, manage, and participate in campus
activities. Beyond serving as a calendar, every event contributes to the
campus social graph by strengthening user compatibility, increasing
Aura, encouraging collaboration, and improving community engagement.
Every interaction within the Events system should feed into the
recommendation engine, allowing future event suggestions and Discover
compatibility to improve over time.

## Event Discovery

The Events page should display upcoming, ongoing, and past events in
multiple views including list view, calendar view, and featured
carousel. Events should be ranked using a deterministic recommendation
score based on department relevance, semester, interests, societies
joined, previous attendance history, mutual attendees, organizer
reputation, popularity, and recency. Users should filter events by
category, department, organizer, date, location, price, capacity, and
tags.

## Event Creation

Authorized users may create events by providing a title, detailed
description, banner image, start date, end date, start time, end time,
venue, map location, organizer information, department, societies,
capacity, event category, registration deadline, tags, contact
information, external registration links (optional), attendance rules,
privacy level (Public, University Only, Department Only, Society Only,
Invite Only), and optional ticket pricing. Draft saving, preview mode,
scheduled publishing, and organizer collaboration should be supported.

## Registration System

Students may register, cancel registration, join a waitlist when
capacity is reached, bookmark events, or express interest without
registering. Capacity should automatically update after every
registration. Waitlisted users are promoted automatically when seats
become available. Registration deadlines and eligibility rules should be
strictly enforced.

## Event Details

Each event page displays banner, organizer profile, schedule, venue map,
attendee count, available seats, registration status, countdown timer,
sponsors, agenda, speakers, FAQs, discussions, media gallery,
attachments, rules, announcements, and organizer contact options. Event
organizers may pin important announcements visible to all attendees.

## Check-In

Attendance should be verified using QR codes, organizer approval, NFC,
or geolocation where supported. Successful check-in awards attendance
credit and optional Aura or XP rewards. Duplicate check-ins, fraudulent
attendance, and late arrivals should be detected and logged.

## Event Discussion

Every event contains its own discussion thread allowing attendees to ask
questions, upload photos, share updates, coordinate logistics, and
communicate before, during, and after the event. Discussions inherit the
same moderation and notification systems used throughout the platform.

## Organizer Dashboard

Organizers may edit event information, monitor registrations, manage
waitlists, send announcements, export attendee lists, scan QR codes,
approve attendance, remove participants, upload event photos, review
analytics, and close events after completion.

## Recommendations

Future event recommendations are generated using deterministic ranking
formulas that consider attendance history, mutual participants,
societies, academic interests, departments, semester proximity,
historical engagement, and profile preferences. Attending similar events
increases compatibility between students inside Discover.

## Notifications

Users receive notifications when events are published, registrations
succeed, waitlist positions change, reminders are approaching,
organizers post announcements, schedules change, events are cancelled,
or post-event feedback becomes available.

## Ratings and Feedback

After an event concludes, attendees may rate organization quality,
content, venue, speakers, and overall satisfaction. Written feedback,
anonymous reviews, and photo uploads are supported. Ratings contribute
to organizer reputation and future event recommendations.

## Analytics

Track impressions, registrations, attendance rates, cancellations,
waitlist conversions, check-in success, average ratings, organizer
performance, engagement during discussions, department participation,
and event retention over time.

## Engineering Requirements

-   Deterministic recommendation engine.
-   QR-based attendance verification.
-   Waitlist automation.
-   Calendar integration.
-   Push reminders.
-   Organizer collaboration.
-   Media galleries.
-   Real-time registration counts.
-   Export attendee lists.
-   Offline QR validation.
-   Audit logging.

## Navigation

``` text
Bottom Navigation
      ↓
Events
      ├── Search Events
      ├── Filters
      ├── Calendar View
      ├── Featured Events
      ├── Event Details
      │       ├── Register
      │       ├── Join Waitlist
      │       ├── Bookmark
      │       ├── Share
      │       ├── Discussion
      │       ├── QR Check-In
      │       ├── Feedback
      │       └── Organizer Profile
      └── Create Event
```
