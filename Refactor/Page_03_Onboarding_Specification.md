# Page 03 --- Onboarding Specification

## Purpose

The Onboarding module transforms a newly registered student into a fully
configured member of the university ecosystem. Rather than simply
collecting profile information, onboarding builds the user's identity
vector that powers Discover compatibility, Home Feed ranking, event
recommendations, Aura calculations, search relevance, privacy defaults,
and community personalization. Every answer collected during onboarding
becomes structured data used throughout the application.

## Step 1 --- Welcome

Introduce the platform, explain the purpose of the application, outline
privacy expectations, and request permission for notifications. Users
may continue or exit. Progress is saved automatically.

## Step 2 --- Basic Information

Collect full name, preferred display name, unique username, date of
birth, gender, pronouns (optional), relationship preference for
Discover, department, degree program, semester, section, campus,
expected graduation year, hostel/day scholar status, languages spoken,
hometown (optional), and profile visibility preference. Every field is
validated before continuing.

## Step 3 --- Profile Media

Users upload a profile picture, optional cover image, additional gallery
photos, and an optional profile introduction video. Photos can be
cropped, reordered, removed, or replaced. The first image becomes the
default avatar. Profile completeness updates after every upload.

## Step 4 --- Interests

Users select interests from categories such as sports, gaming, anime,
movies, music, finance, AI, blockchain, entrepreneurship, photography,
fashion, travel, food, reading, volunteering, research, coding,
hackathons, startups, clubs, gym, coffee, memes, and more. Multiple
selections are allowed. Every selected interest contributes to the
compatibility and recommendation engine.

## Step 5 --- Personality

Users choose personality descriptors including Introvert, Extrovert,
Competitive, Creative, Calm, Funny, Leader, Night Owl, Morning Person,
Book Lover, Cat Person, Dog Person, Gym Enthusiast, Coffee Lover,
Adventurous, and similar traits. Contradictory selections may be
prevented where appropriate.

## Step 6 --- Academic Information

Select current courses, societies, clubs, favorite subjects, technical
skills, career interests, and study preferences. This information
improves study partner recommendations and academic communities.

## Step 7 --- Discover Preferences

Configure who should appear in Discover by selecting preferred
gender(s), age range, department preferences, semester range, maximum
distance if location is supported, and whether only verified users
should be shown. These preferences directly influence the deterministic
compatibility algorithm.

## Step 8 --- Privacy

Choose whether the profile is searchable, visible in Discover, visible
outside department, allows direct messages, displays online status, read
receipts, attended events, and Aura score.

## Step 9 --- Notifications

Select notification preferences for messages, matches, comments,
mentions, event reminders, society announcements, leaderboard updates,
achievements, and system alerts.

## Completion Logic

The onboarding process calculates a profile completeness percentage.
Completion above 90% awards a profile completion badge and an initial
Aura bonus. Users may edit every onboarding choice later from Settings
or Edit Profile.

## Engineering Requirements

-   Auto-save progress after every step.
-   Resume onboarding after interruption.
-   Validation before proceeding.
-   Dynamic progress indicator.
-   Profile completeness calculation.
-   Secure media uploads.
-   Compression before upload.
-   Accessibility support.
-   Analytics for onboarding completion and drop-off.
-   Backend synchronization after every completed step.

## Navigation

``` text
Registration
      ↓
Welcome
      ↓
Basic Information
      ↓
Profile Media
      ↓
Interests
      ↓
Personality
      ↓
Academic Information
      ↓
Discover Preferences
      ↓
Privacy
      ↓
Notifications
      ↓
Profile Completion
      ↓
Home Feed
```
