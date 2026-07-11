# Page 16 --- Moderation Module Engineering Specification

**Version:** 1.0 **Module:** Moderation & Trust and Safety **Priority:**
Critical

# 1. Purpose

The Moderation module is responsible for maintaining a safe, respectful,
and trustworthy university community. Every user-generated
object---including profiles, posts, comments, chats, events, societies,
usernames, profile photos, cover images, and marketplace
listings---passes through moderation rules. The system combines
deterministic rule-based detection, community reporting, moderator
review, and reputation scoring. Every moderation action is logged and
auditable.

# 2. Goals

-   Protect students from harassment.
-   Prevent spam and scams.
-   Detect fake accounts.
-   Remove prohibited content.
-   Protect privacy.
-   Ensure university-only environment.
-   Maintain transparent moderation.

# 3. Moderation Architecture

Content Created ↓ Validation ↓ Automatic Rule Engine ↓ Risk Score
Calculation ↓ Publish / Hold / Reject ↓ Community Reports ↓ Moderator
Queue ↓ Decision ↓ Appeal (optional)

# 4. Moderated Objects

-   Users
-   Profiles
-   Usernames
-   Bios
-   Photos
-   Cover Images
-   Posts
-   Comments
-   Replies
-   Messages
-   Event Titles
-   Event Descriptions
-   Society Pages
-   Marketplace Listings
-   Files
-   Voice Notes
-   Videos
-   Polls

# 5. Automatic Rule Engine

Validate:

-   Empty content
-   Duplicate posts
-   Excessive hashtags
-   Excessive mentions
-   Flood posting
-   Spam links
-   Malware links
-   QR scams
-   Fake university emails
-   Profanity
-   Hate speech
-   Sexual content
-   Violent content
-   Self promotion spam
-   Academic fraud advertisements
-   Impersonation
-   Fake verification attempts

Every rule contributes to a moderation risk score.

# 6. Risk Levels

0-20 Safe

21-40 Publish with reduced distribution.

41-70 Hidden pending review.

71-100 Immediately blocked.

# 7. Community Reporting

Every object contains Report.

Reasons:

Spam

Harassment

Bullying

Hate Speech

Fake Account

Fake Information

Academic Cheating

NSFW

Violence

Threats

Copyright

Scam

Impersonation

Other

Optional description

Optional screenshot

# 8. Report Lifecycle

Report Created

↓

Duplicate merge

↓

Priority calculation

↓

Moderator Assignment

↓

Investigation

↓

Decision

↓

Notify Reporter

↓

Notify Accused

↓

Appeal Window

↓

Archive

# 9. Moderator Dashboard

Queues

High Priority

Medium

Low

Newest

Oldest

Repeated Offenders

Auto Flagged

Appeals

Every report displays

Reason

Reporter

Evidence

History

Previous reports

Risk score

Linked objects

IP history (Admin)

Device history (Admin)

# 10. Moderator Actions

Approve

Reject

Hide

Restore

Delete

Warn User

Mute User

Suspend

Permanent Ban

Shadow Ban

Reduce Aura

Remove Verification

Freeze Account

Delete Content

Lock Comments

Close Reports

Merge Reports

Escalate

# 11. Warning System

Strike 1

Educational warning

Strike 2

Temporary posting restriction

Strike 3

Temporary suspension

Strike 4

Permanent review

Administrators may override.

# 12. Shadow Ban

Hidden from feed.

Removed from Discover.

Messages unaffected.

No visible indication.

Used for spam prevention.

# 13. Appeals

Every punishment may include:

Appeal button

Appeal explanation

Supporting evidence

Appeal review queue

Final decision

Decision history

# 14. Fake Account Detection

Signals

Profile completeness

Verification

Device fingerprint

IP similarity

Duplicate photos

Mass swiping

Mass messaging

Low response quality

Repeated reports

Rapid account creation

# 15. Spam Detection

Repeated text

Repeated links

Repeated images

Posting frequency

Copy paste similarity

Mass tagging

Mass invitations

Bot timing patterns

# 16. Harassment Detection

Repeated unwanted messages

Blocked user bypass

Mass mentions

Threat keywords

Repeated insults

Targeted bullying patterns

# 17. Event Moderation

Validate

Title

Banner

Venue

Organizer

Capacity

Ticket links

External URLs

Rules

Prevent phishing.

# 18. Marketplace Moderation

Duplicate listings

Counterfeit items

Fraud

External payment scams

Price manipulation

Restricted goods

# 19. Chat Moderation

Users may report:

Messages

Images

Voice Notes

Files

Groups

Entire conversations

Reports create evidence snapshots.

# 20. Reputation Impact

Confirmed violations reduce:

Aura

Discover priority

Recommendation score

Leaderboard eligibility

Verification confidence

Repeated violations increase future moderation sensitivity.

# 21. Notifications

Reporter

Report received

Decision available

Appeal result

Accused

Warning

Restriction

Suspension

Ban

Appeal outcome

# 22. Audit Logs

Store

Moderator

Timestamp

Reason

Before state

After state

Evidence

IP

Device

Appeal

Immutable logs retained.

# 23. Database Tables

reports

report_reasons

moderation_actions

moderators

appeals

warnings

bans

shadow_bans

risk_scores

audit_logs

evidence_files

# 24. API Endpoints

POST /reports

GET /reports

GET /reports/{id}

PATCH /reports/{id}

POST /appeals

PATCH /appeals/{id}

POST /moderation/warn

POST /moderation/suspend

POST /moderation/ban

POST /moderation/shadowban

DELETE /moderation/content/{id}

# 25. Analytics

Reports/day

False positives

Moderator response time

Appeal success rate

Spam blocked

Fake accounts detected

Warnings issued

Suspensions

Permanent bans

Repeat offenders

Average resolution time

# 26. Edge Cases

Reporter deletes account

Accused deletes account

Duplicate reports

Appeal after expiry

Offline moderation sync

Evidence deleted

Mass reporting attack

Moderator conflict

# 27. Performance

Priority queues

Indexed reports

Real-time moderation alerts

Background rescanning

Incremental risk calculation

# 28. Security

Role Based Access Control

Student

Society Admin

Moderator

Super Moderator

Administrator

Every moderation action requires permission validation.

Sensitive actions require confirmation.

Every action recorded.

No audit record may be edited or deleted.
