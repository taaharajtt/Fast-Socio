# Page 09 --- Aura Ranking System Specification

## Purpose

The Aura Ranking System replaces traditional follower counts with a
dynamic reputation model that measures a student's positive contribution
to the university community. Aura is designed to reward meaningful
engagement, academic collaboration, leadership, consistency, creativity,
and healthy social behavior instead of popularity alone. Every
interaction performed across the application contributes positively or
negatively to a user's Aura score. The ranking system should update
continuously and provide transparent progression through levels, badges,
achievements, and leaderboards.

## Aura Calculation

Aura is calculated using a deterministic weighted scoring engine.
Positive actions include creating high-quality posts, receiving
meaningful reactions, helpful comments, accepted answers, event
attendance, event organization, society participation, successful
matches, conversation quality, profile completeness, daily activity
streaks, verification, and community recognition. Negative actions
include spam reports, confirmed moderation actions, abusive behavior,
fake engagement, repeated post deletions, excessive inactivity, blocked
accounts, and policy violations. Scores should be normalized and
logarithmically scaled where necessary to prevent runaway popularity.

## XP and Levels

Every Aura-generating activity also contributes Experience Points (XP).
XP determines user level while Aura determines reputation. Higher levels
unlock cosmetic profile frames, badges, exclusive themes, seasonal
rewards, and special campus titles. Level progression should become
progressively more difficult using configurable XP curves.

## Leaderboards

Leaderboards should exist at multiple scopes including University,
Campus, Department, Semester, Society, Club, Sports, Academic Category,
Weekly, Monthly, Semester, and All-Time. Users may switch between views
without leaving the Rankings module. Rankings update automatically
whenever Aura changes.

## Achievements

Achievements reward milestones such as First Post, Top Contributor,
Campus Legend, Study Mentor, Society Leader, Event Organizer, Volunteer,
Consistent Contributor, Rising Star, Social Butterfly, Photographer,
Athlete, Hackathon Winner, Debate Champion, Coding Expert, and Community
Helper. Each achievement contains a title, icon, description, unlock
condition, date earned, and optional Aura or XP reward.

## Badges

Badges visually identify verified students, moderators, society leaders,
class representatives, ambassadors, event organizers, mentors,
top-ranked students, seasonal champions, and special recognition
recipients. Badge visibility should be configurable within profile
privacy settings.

## Seasons

Optional seasonal ranking periods reset competitive leaderboards while
preserving historical records. Seasonal rewards may include exclusive
profile decorations, badges, titles, Aura bonuses, or recognition
certificates. Historical seasons remain viewable for archival purposes.

## Anti-Abuse

The system must detect abnormal engagement patterns such as
self-promotion rings, reciprocal spam liking, fake accounts, rapid
interaction farming, duplicate accounts, automated behavior, and
suspicious Aura inflation. Detected abuse should reduce or invalidate
earned Aura until moderator review.

## Recalculation

Aura should update immediately after qualifying actions using
incremental recalculation. Periodic background verification jobs
recompute scores to guarantee long-term consistency. Ranking caches
refresh automatically after score changes.

## Notifications

Users receive notifications when leveling up, entering a leaderboard,
losing a leaderboard position, unlocking achievements, earning badges,
maintaining streaks, or reaching milestone Aura values.

## Analytics

Track Aura growth, leaderboard movement, XP progression, achievement
completion, season participation, engagement quality, moderation
penalties, and reputation distribution across departments and campuses.

## Engineering Requirements

-   Deterministic scoring formulas.
-   Incremental score updates.
-   Configurable scoring weights.
-   Cached leaderboard queries.
-   Real-time leaderboard synchronization.
-   Anti-cheat detection.
-   Historical ranking archive.
-   Achievement engine.
-   Badge management.
-   Seasonal support.
-   Full audit logging.

## Navigation

``` text
Bottom Navigation
      ↓
Aura Rankings
      ├── University Leaderboard
      ├── Department Rankings
      ├── Semester Rankings
      ├── Society Rankings
      ├── Weekly Rankings
      ├── Monthly Rankings
      ├── Achievements
      ├── Badges
      ├── Profile
      └── Leaderboard History
```
