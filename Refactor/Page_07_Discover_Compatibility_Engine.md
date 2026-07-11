# Page 07 --- Discover & Compatibility Engine Specification

## Purpose

The Discover module is the mathematical heart of the platform. Unlike
traditional swipe-based applications that rely on random ordering or
expensive AI services, this platform uses a deterministic compatibility
engine. Every eligible student receives a continuously updated
Compatibility Score calculated from structured profile attributes,
campus activity, engagement history, and user preferences. The
highest-ranked candidates are presented first while ensuring diversity,
fairness, and freshness. Every swipe, match, skip, message, event
participation, and profile update immediately influences future
recommendations.

## Candidate Eligibility

Before scoring begins, the system filters all users using mandatory
eligibility rules. Profiles are excluded if either user has blocked the
other, one account is suspended, Discover visibility is disabled,
privacy settings prevent discovery, age or relationship preferences do
not match, campus restrictions apply, or the users are already matched.
Users recently skipped beyond the configured cooldown remain hidden
until the cooldown expires. Only verified, active, and eligible profiles
proceed to compatibility scoring.

## Compatibility Engine

Each eligible profile receives a weighted score composed of independent
subscores. Identity similarity includes department, semester proximity,
campus, and graduation year. Interest similarity compares shared
hobbies, clubs, societies, favorite subjects, and career goals. Academic
similarity measures common courses, study preferences, and projects.
Social similarity considers mutual friends, shared events, mutual
societies, common interactions, and profile visits. Activity similarity
evaluates login frequency, event attendance, response rate, profile
completeness, and consistent engagement. Reputation contributes through
Aura using logarithmic scaling to prevent popularity dominance.
Freshness rewards unseen profiles while gradually reducing exposure for
recently skipped users. Penalties reduce scores for reports, moderation
actions, inactivity, incomplete profiles, spam behavior, or repeated
negative feedback.

## Diversity Engine

After ranking, a diversity stage adjusts the recommendation queue to
prevent repetitive results. Consecutive profiles from the same
department, semester, hostel, or social circle are limited. A
configurable exploration percentage introduces newer users or profiles
with limited historical data, ensuring the recommendation system
continuously gathers interaction data and avoids cold-start problems.

## Discover Card

Each profile card displays profile photo, verification badge, display
name, department, semester, Aura level, compatibility percentage, shared
interests, mutual friends, common societies, attended events, profile
prompts, biography, profile completion, and optional featured media.
Compatibility percentages should be derived from normalized
deterministic scores rather than predictive AI.

## Swipe Actions

Users may Like, Super Like, Pass, Undo (premium or limited), View Full
Profile, Report, Block, Hide, or Share a profile. Every swipe
immediately updates backend interaction history and modifies future
compatibility calculations. Mutual Likes automatically create a Match
record and trigger notifications.

## Filters

Users can configure Discover filters including department, semester
range, age range, preferred gender(s), campus, hostel/day scholar
status, societies, interests, languages, verification status, Aura
range, profile completeness, and activity level. Filters are applied
before compatibility calculations to improve efficiency.

## Match Creation

When two users Like each other, the backend creates a Match entity,
initializes a private conversation, generates notifications, updates
compatibility history, increases discovery confidence, and records
analytics. Matches may expire if neither user interacts within
configurable time limits.

## Recommendation Refresh

The recommendation queue refreshes after significant profile updates,
new swipes, completed onboarding changes, event attendance, society
membership changes, or scheduled background recalculations. Frequently
refreshing only affected users minimizes computational cost.

## Abuse Prevention

Daily swipe limits, cooldowns, velocity detection, duplicate account
detection, fake profile detection, repeated mass-swiping penalties, and
abnormal interaction monitoring help maintain recommendation quality and
discourage automated behavior.

## Analytics

Track profile impressions, swipe distribution, acceptance rate, match
rate, message conversion, average compatibility score, filter usage,
profile completion impact, diversity effectiveness, cold-start
performance, and recommendation precision.

## Engineering Requirements

-   Deterministic weighted scoring.
-   No external AI dependency.
-   Cached compatibility scores.
-   Incremental recalculation.
-   Exploration vs exploitation balancing.
-   Diversity constraints.
-   Optimistic swipe updates.
-   Real-time match creation.
-   Configurable scoring weights.
-   Full audit logging.

## Navigation

``` text
Bottom Navigation
      ↓
Discover
      ├── Swipe Left (Pass)
      ├── Swipe Right (Like)
      ├── Super Like
      ├── Undo
      ├── Filters
      ├── View Full Profile
      ├── Report / Block
      ├── Match Created
      │        ↓
      │      Match Screen
      │        ↓
      │      Chat
      └── Continue Discovering
```
