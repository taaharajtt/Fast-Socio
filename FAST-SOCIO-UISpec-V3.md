# 🎨 FAST SOCIO — Complete UI Specification
### Derived from 14 Application Screenshots

> This document is the single source of truth for every visual decision in FAST SOCIO.
> Every screen, component, color, spacing, and interaction is defined here.
> Developers must not deviate from this spec without updating it first.

---

## 1. DESIGN TOKENS

### 1.1 Color Palette

```
── BACKGROUNDS ────────────────────────────────
App Background:       #0D0D12   (root — near black with blue tint)
Card Background:      #1A1A24   (post cards, list items)
Card Elevated:        #1E1E2C   (modals, dropdowns, input fields)
Input Background:     #141420   (text inputs, search bars)
Overlay:              rgba(0, 0, 0, 0.60)

── PRIMARY BRAND ──────────────────────────────
Purple Primary:       #7C3AED   (active tabs, CTA buttons, badges)
Purple Light:         #8B5CF6   (hover states, secondary accents)
Purple Gradient:      linear → #7C3AED to #A855F7  (buttons, own messages)
Purple Subtle:        rgba(124, 58, 237, 0.15)  (unread row backgrounds)

── AURA / GOLD ────────────────────────────────
Gold Primary:         #F59E0B   (Aura scores, leaderboard numbers)
Gold Glow Border:     #D97706   (Top-3 card borders)
Gold Text:            #FBBF24   (large Aura numbers on leaderboard)

── SEMANTIC ───────────────────────────────────
Online Green:         #22C55E   (online dot, positive week change)
Negative Red:         #EF4444   (negative week change ▼)
Trending Orange:      #F97316   (Trending badge gradient start)
Verified Blue:        #3B82F6   (verified checkmark badge)
Unread Badge:         #7C3AED   (unread count circles)

── TEXT ───────────────────────────────────────
Text Primary:         #FFFFFF
Text Secondary:       #9CA3AF   (timestamps, subtitles, muted)
Text Disabled:        #4B5563
Text Purple Link:     #A78BFA   (Create account, See all, links)
Text Gold:            #F59E0B   (aura numbers)

── BORDERS ────────────────────────────────────
Border Default:       rgba(255, 255, 255, 0.06)
Border Focused:       rgba(124, 58, 237, 0.50)
Border Gold:          #D97706   (leaderboard top-3)
Border Unread:        #7C3AED   (left border on unread notification rows)
```

### 1.2 Typography

```
── FONT FAMILY ────────────────────────────────
  iOS:     SF Pro Display (headings) / SF Pro Text (body)
  Android: Roboto (weight-matched)
  Fallback: System font

── SCALE ──────────────────────────────────────
  Hero:        36px / Black (900)     → "Find Your Campus Tribe"
  H1:          28px / Bold (700)      → Screen titles (Leaderboard, Events)
  H2:          22px / Bold (700)      → Card name, profile name
  H3:          18px / SemiBold (600)  → Post author name, section headers
  Body:        15px / Regular (400)   → Post content, bio, descriptions
  Body Small:  13px / Regular (400)   → Timestamps, subtitles, member counts
  Caption:     11px / Regular (400)   → Disclaimer text, labels
  Badge:       12px / SemiBold (600)  → Badge labels, tab labels
  Stat Large:  32px / Black (900)     → "3,100" leaderboard Aura score (gold)
  Stat Medium: 22px / Bold (700)      → "2,840 Aura" on profile
```

### 1.3 Spacing & Radius

```
── BORDER RADIUS ──────────────────────────────
  XS:   6px   (small badges, chips)
  S:    10px  (input fields, notification rows)
  M:    14px  (cards, list items)
  L:    20px  (large cards, modals, featured event cards)
  XL:   28px  (bottom sheet handles, discovery cards)
  Full: 9999px (pill buttons, avatar circles, tab indicators)

── SPACING ────────────────────────────────────
  Page horizontal padding: 16px
  Card inner padding:      14px (vertical) × 16px (horizontal)
  Section gap:             24px (between sections)
  Item gap:                10px (between list rows)
  Icon-to-text gap:        10px (avatar to name in rows)
  Badge inner padding:     4px × 10px

── AVATAR SIZES ───────────────────────────────
  XS:   28px  (stacked mutual friends)
  S:    36px  (notification rows, message list)
  M:    44px  (post author, chat list)
  L:    64px  (community icon on card)
  XL:   80px  (profile page avatar)
  XXL:  110px (profile header avatar)
```

### 1.4 Elevation & Shadow

```
Card shadow:     0px 2px 12px rgba(0, 0, 0, 0.40)
Modal shadow:    0px 8px 32px rgba(0, 0, 0, 0.60)
Gold glow:       0px 0px 16px rgba(217, 119, 6, 0.35)
Purple glow:     0px 0px 12px rgba(124, 58, 237, 0.30)
```

---

## 2. GLOBAL COMPONENTS

### 2.1 Bottom Navigation Bar

```
Structure:         6 tabs — Home | Discover | Ranks | Events | Chat | Me
Position:          Fixed bottom, flush to screen edge (NOT floating)
Height:            83px (including safe area) / 56px visible bar
Background:        #0D0D12 with top border rgba(255,255,255,0.08) 1px
Tab item width:    equal distribution (1/6 each)

Active tab:
  Icon:   filled / bold, color #7C3AED
  Label:  12px SemiBold, color #7C3AED

Inactive tab:
  Icon:   outline / regular, color #9CA3AF
  Label:  12px Regular, color #9CA3AF

Icons (match exactly):
  Home:     house/home icon
  Discover: compass circle / target icon
  Ranks:    trophy icon
  Events:   calendar icon
  Chat:     speech bubble / chat icon
  Me:       person/user icon
```

### 2.2 Purple Pill Tabs (used in Chat, Leaderboard)

```
Container:         flex-row, gap 8px, no background
Active pill:       backgroundColor #7C3AED, borderRadius 999, paddingH 16, paddingV 8
Active label:      14px SemiBold, #FFFFFF
Inactive pill:     backgroundColor #1A1A24, borderRadius 999, paddingH 16, paddingV 8
Inactive label:    14px Regular, #9CA3AF
```

### 2.3 Cards (general)

```
backgroundColor:   #1A1A24
borderRadius:      14px
borderWidth:       1px
borderColor:       rgba(255,255,255,0.06)
padding:           14px 16px
shadow:            card shadow (see 1.4)
```

### 2.4 Input Fields

```
backgroundColor:   #1A1A24
borderRadius:      12px
borderWidth:       1px
borderColor:       rgba(255,255,255,0.08)
height:            52px
paddingHorizontal: 16px
font:              15px Regular #FFFFFF
placeholder:       15px Regular #4B5563
focus border:      rgba(124,58,237,0.50)
```

### 2.5 Primary Button (full-width gradient)

```
backgroundColor:   gradient #7C3AED → #A855F7 (left to right)
borderRadius:      999px
height:            52px
label:             16px Bold #FFFFFF, centered
pressedOpacity:    0.85
```

### 2.6 Pill Button (inline — Join, Joined, Edit, Share)

```
Join (active):     backgroundColor #7C3AED, borderRadius 999, paddingH 16, paddingV 8
                   label: 13px SemiBold #FFFFFF

Joined (inactive): backgroundColor #1E1E2C, borderRadius 999, paddingH 16, paddingV 8
                   label: 13px SemiBold #FFFFFF
                   borderWidth 1, borderColor rgba(255,255,255,0.10)

Edit:              same as Joined style
Share:             same as Joined style
```

### 2.7 Verified Badge

```
Icon:    ✓ checkmark inside circle
Color:   #3B82F6 (blue) on white
Size:    16px diameter
Position: inline after name, 4px gap
```

### 2.8 Online Dot

```
Size:      10px diameter
Color:     #22C55E
Position:  absolute bottom-right of avatar
Border:    2px solid #0D0D12 (to separate from avatar)
```

### 2.9 Unread Count Badge

```
backgroundColor:  #7C3AED
borderRadius:     999px
minWidth:         20px
height:           20px
paddingH:         5px
label:            11px Bold #FFFFFF, centered
```

### 2.10 Skeleton Loader

```
Base color:       #1A1A24
Shimmer color:    #252535
Animation:        opacity pulse 0.3 → 0.7 → 0.3, duration 1800ms, loop
borderRadius:     matches the component being loaded
```

---

## 3. SCREEN SPECIFICATIONS

---

### SCREEN 1 — Login

```
Background:        radial gradient from #2D1B69 (top-center) → #0D0D12 (edges)
                   creates a glowing purple halo from top center

── HEADER ──────────────────────────────────────
App Icon:
  size:            64px × 64px
  borderRadius:    18px
  background:      gradient #7C3AED → #A855F7
  icon:            ⚡ lightning bolt, 28px, #FFFFFF
  marginTop:       64px

App Name:
  "FAST SOCIO"     18px Bold #FFFFFF, marginTop 12px

Tagline:
  "Your campus, alive."  13px Regular #9CA3AF, marginTop 4px

── HERO TEXT ───────────────────────────────────
"Find Your"             36px Black #FFFFFF
"Campus Tribe"          36px Black #FFFFFF
lineHeight:             42px
textAlign:              center
marginTop:              32px

Subtitle:
"Sign in with your FAST University email to get started."
  15px Regular #9CA3AF, textAlign center, marginTop 8px

── FORM ────────────────────────────────────────
marginTop:         32px
gap between inputs: 12px

Email input:
  placeholder:     "you@isb.nu.edu.pk"

Password input:
  right element:   "Show" text, 14px SemiBold #A78BFA, tap to toggle

"Forgot Password?" 
  13px Regular #9CA3AF, textAlign right, marginTop 8px

── CTA ─────────────────────────────────────────
Log In button:     full-width gradient pill, marginTop 24px

Disclaimer:
"• Only @isb.nu.edu.pk addresses are accepted"
  11px Regular #4B5563, textAlign center, marginTop 12px

"New to FAST SOCIO? Create account"
  13px Regular #9CA3AF + "Create account" 13px Bold #A78BFA
  textAlign center, marginTop 20px

"Terms of Service · Privacy Policy"
  11px Regular #4B5563, textAlign center, marginBottom 32px
```

**Skeleton:** 2 input shimmer blocks + 1 button shimmer block

---

### SCREEN 2 — Home Feed

```
── HEADER ──────────────────────────────────────
height:            56px
backgroundColor:   #0D0D12
paddingH:          16px

Left:
  "FAST SOCIO"    20px Black #FFFFFF

Right (row, gap 12px):
  Notification bell:
    Icon:          bell outline, 24px #FFFFFF
    Badge dot:     8px #F97316 (orange), absolute top-right of icon
  Avatar:
    size:          36px circle
    Image:         user's profile picture

── FEED (FlatList) ──────────────────────────────
backgroundColor:   #0D0D12
contentPadding:    0 (cards go edge to edge with their own padding)
itemSeparator:     8px gap between cards

POST CARD:
  backgroundColor: #0D0D12 (no card background — seamless with feed)
  borderBottomWidth: 1px, borderColor rgba(255,255,255,0.06)
  paddingH:        16px
  paddingV:        14px

  Author row:
    Avatar:          44px circle
    gap:             10px
    Name:            16px SemiBold #FFFFFF
    Verified badge:  inline after name
    Department:      13px Regular #9CA3AF
    Dot separator:   "·" #9CA3AF
    Time:            13px Regular #9CA3AF "6h ago"
    "..." menu:      24px #9CA3AF, absolute right

  Trending badge (when trending):
    position:        absolute top-right area of author row
    backgroundColor: gradient #EF4444 → #F97316
    borderRadius:    999px
    paddingH:        8px, paddingV: 3px
    icon:            🔴 dot or fire icon
    label:           "Trending" 11px Bold #FFFFFF

  Content text:
    15px Regular #FFFFFF, lineHeight 22px
    marginTop:       10px

  Media image (when present):
    width:           100%
    height:          220px (auto aspect if taller)
    borderRadius:    12px
    marginTop:       10px
    object-fit:      cover

  Actions row:
    marginTop:       12px
    flexDirection:   row, gap 20px, alignItems center

    Like:   heart outline icon 20px #9CA3AF + count "391" 14px #9CA3AF
    Comment: speech bubble icon 20px #9CA3AF + count "61" 14px #9CA3AF
    Share:  share icon 20px #9CA3AF + "Share" 14px #9CA3AF
    Bookmark: bookmark icon 20px #9CA3AF, absolute right

  Liked state:       heart icon fills #EF4444, count turns #EF4444
```

**Skeleton:** 3 post card skeletons (avatar circle + 2 text lines + image block + action row)

---

### SCREEN 3 — Notifications Dropdown (bell tap)

```
Position:          absolute, top 56px (below header), right 16px
width:             calc(100% - 32px)
backgroundColor:   #1A1A24
borderRadius:      16px
borderWidth:       1px
borderColor:       rgba(255,255,255,0.08)
shadow:            modal shadow
paddingV:          16px
maxHeight:         380px

Header row:
  "Notifications"  17px Bold #FFFFFF
  "3 new" badge:   backgroundColor #7C3AED, borderRadius 999, paddingH 8, paddingV 3
                   label 12px SemiBold #FFFFFF

Notification items (compact):
  paddingH:        16px, paddingV 10px
  gap:             12px (between items)

  Avatar:          36px circle
  Text block:
    Name:          14px SemiBold #FFFFFF inline
    Action:        14px Regular #9CA3AF inline
    Time:          12px Regular #9CA3AF, marginTop 2px

  Thumbnail (for post notifications):
    size:          44px × 44px, borderRadius 8px, right-aligned

"See all notifications":
  14px SemiBold #A78BFA (purple link)
  textAlign:       center
  paddingV:        14px
  borderTopWidth:  1px, borderColor rgba(255,255,255,0.06)
```

---

### SCREEN 4 — Notifications Full Screen

```
Header:
  Back arrow:      24px #FFFFFF
  "Notifications": 22px Bold #FFFFFF, centered
  "Mark all read": 14px Regular #A78BFA, right

Section label ("TODAY", "EARLIER"):
  12px SemiBold #4B5563
  letterSpacing:   1.5px (uppercase)
  marginTop:       20px, marginBottom 8px, paddingH 16px

NOTIFICATION ROW:
  backgroundColor: #1A1A24
  borderRadius:    12px
  padding:         14px 16px
  marginH:         16px
  marginBottom:    8px

  Unread state:
    leftBorderWidth: 3px, leftBorderColor #7C3AED
    backgroundColor: rgba(124,58,237,0.08)

  Read state:
    leftBorderWidth: 3px, leftBorderColor transparent

  Avatar:          44px circle
  Content block:
    Name:          15px SemiBold #FFFFFF
    Action text:   15px Regular #9CA3AF
    Time:          12px Regular #4B5563, marginTop 4px

  Thumbnail (post/image notifications):
    size:          48px × 48px, borderRadius 8px, right-aligned

  Aura notification icon (special):
    size:          44px circle
    backgroundColor: #7C3AED
    icon:          ⚡ 20px #FFFFFF centered

Empty state ("EARLIER" section):
  "You're all caught up! 🎉"
  15px Regular #9CA3AF, textAlign center, paddingV 32px
```

**Skeleton:** 5 notification row shimmer blocks

---

### SCREEN 5 — Discover

```
Background:        #0D0D12

Header:
  Left avatar:     32px circle (current user)
  Center "Discover": 18px Bold #FFFFFF
  (no right element)

DISCOVER CARD (fills most of screen):
  width:           100% - 32px (16px margin each side)
  height:          ~68% of screen height
  borderRadius:    24px
  overflow:        hidden
  backgroundColor: #1A1A24

  Profile image:   absolute fill (width: 100%, height: 100%, object-fit: cover)

  TOP OVERLAY (inside card, on the image):
    Name badge (top-left):
      "⚡ Zara Ahmed"
      backgroundColor: rgba(0,0,0,0.50)
      borderRadius:    999px
      padding:         6px 12px
      font:            13px SemiBold #FFFFFF
      icon:            ⚡ 12px #FBBF24

    Match % pill (top-right):
      "94% match"
      backgroundColor: rgba(0,0,0,0.60)
      borderRadius:    999px
      padding:         6px 12px
      font:            13px SemiBold #FFFFFF

    Aura pill (below match, top-right):
      "⚡ 2,840"
      backgroundColor: rgba(0,0,0,0.60)
      borderRadius:    999px
      padding:         5px 10px
      font:            13px SemiBold #FBBF24
      icon:            ⚡ 12px #FBBF24

  BOTTOM OVERLAY (gradient fade at bottom of card):
    gradient:        transparent → rgba(0,0,0,0.85)
    height:          45% of card
    padding:         20px 20px 20px

    Name + age + verified:
      "Zara Ahmed, 22 ✓"
      22px Bold #FFFFFF
      verified badge inline after name (16px, blue)

    Dept + semester:
      "CS · 6th Semester"
      14px Regular #9CA3AF, marginTop 4px

    Bio:
      "Coffee addict & code enthusiast ☕"
      14px Regular #FFFFFF, marginTop 6px

    Mutual friends row:
      Stacked avatars: 3 × 28px circles, overlap -8px each
      "3 mutual friends" 13px Regular #9CA3AF, marginLeft 8px

ACTION BUTTONS (below card, centered row):
  gap:             24px
  marginTop:       20px

  Pass (X):
    size:          56px circle
    backgroundColor: #1A1A24
    borderWidth:   1px, borderColor rgba(255,255,255,0.10)
    icon:          × 24px #9CA3AF

  Message (💬):
    size:          56px circle
    backgroundColor: #1A1A24
    borderWidth:   1px, borderColor rgba(255,255,255,0.10)
    icon:          chat bubble 20px #9CA3AF

  Like (❤️):
    size:          64px circle (larger than others)
    backgroundColor: #7C3AED
    icon:          heart 26px #FFFFFF
    shadow:        purple glow (see 1.4)
```

**Skeleton:** full-screen card shimmer + 3 circle button shimmer

---

### SCREEN 6 — Leaderboard Tab (Weekly)

```
Header:
  "Leaderboard"             28px Bold #FFFFFF
  "Who's running campus this week?" 14px Regular #9CA3AF, marginTop 4px

Tab row: Purple Pill Tabs
  "Leaderboard" active | "Department Rankings" inactive

TOP 3 SECTION:

  RANK 1 CARD (special):
    backgroundColor: #1A1A24
    borderRadius:    16px
    borderWidth:     2px
    borderColor:     #D97706 (gold)
    shadow:          gold glow
    padding:         16px
    gap:             12px

    Layout (horizontal):
      Crown emoji: 👑 16px above avatar (absolute top-center of avatar)
      Avatar:          56px × 56px, borderRadius 12px
      Content:
        Name:          17px SemiBold #FFFFFF
        Department:    13px Regular #9CA3AF
        "Main Character" badge:
          backgroundColor: #D97706
          borderRadius: 999px
          padding: 3px 8px
          font: 11px Bold #FFFFFF
      Score (right):
        "3,100"        28px Black #F59E0B
        "Aura pts"     12px Regular #9CA3AF, marginTop 2px

  RANK 2 CARD:
    Same structure
    borderColor:     #9CA3AF (silver)
    badge:           "Campus Celebrity" backgroundColor #6B7280
    score color:     #FFFFFF

  RANK 3 CARD:
    Same structure
    borderColor:     #D97706 (bronze/orange)
    badge:           "Aura Farmer" backgroundColor #F97316
    score color:     #F97316

"RANKINGS" divider:
  12px SemiBold #4B5563, letterSpacing 1.5px, textAlign center
  marginV: 20px
  borderBottom? No — just text label

RANKS 4–N (simple rows):
  backgroundColor: #1A1A24
  borderRadius:    12px
  padding:         14px 16px
  marginH:         16px
  marginBottom:    8px

  Layout:
    Rank number:   16px Bold #4B5563, width 28px
    Avatar:        44px circle
    Name:          15px SemiBold #FFFFFF
    Department:    13px Regular #9CA3AF
    Score:         "⚡ 1,920" 15px SemiBold #F59E0B, right-aligned
```

**Skeleton:** 3 large card shimmer + 5 row shimmer

---

### SCREEN 7 & 8 — Department Rankings Tab

```
Header + tabs: same as Leaderboard screen
Tab: "Department Rankings" now active

CURRENT LEADER CARD (hero card at top):
  backgroundColor: #1A1A24
  borderRadius:    16px
  borderWidth:     2px
  borderColor:     #D97706
  shadow:          gold glow, larger spread
  padding:         20px

  "Current Leader" badge:
    backgroundColor: #D97706
    borderRadius:    999px
    padding:         4px 10px
    icon:            🥇 12px
    label:           "Current Leader" 12px Bold #FFFFFF

  Dept icon:       laptop emoji or 48px icon, right side or top-left

  Dept abbreviation: "CS" 32px Black #FFFFFF
  Full name:       "Computer Science" 15px Regular #9CA3AF

  Score:           "48,920" 36px Black #F59E0B, right-aligned
  "Total Aura"     12px Regular #9CA3AF, marginTop 2px

  Weekly change:   "+2,340 this week" 13px SemiBold #22C55E
                   ↑ upward arrow icon before text

  Divider:         1px rgba(255,255,255,0.06), marginV 14px

  Member row:
    Stacked avatars: 4 × 28px overlapping circles
    "450 members contributing" 13px Regular #9CA3AF, marginLeft 10px

"ALL DEPARTMENTS" divider label:
  12px SemiBold #4B5563, letterSpacing 1.5px, textAlign center, marginV 16px

DEPARTMENT ROW:
  backgroundColor: #1A1A24
  borderRadius:    12px
  padding:         14px 16px
  marginH:         16px
  marginBottom:    8px

  Layout (horizontal):
    Rank medal:    medal emoji (🥇🥈🥉) or number badge for 4+
    Dept icon:     32px rounded square icon (each dept has unique icon/emoji)
    Name block:
      Abbreviation: 15px SemiBold #FFFFFF
      Full name:    12px Regular #9CA3AF
    Score (right):
      "⚡ 48,920"   15px SemiBold #F59E0B
      Change:       "↑ 2,340" 12px #22C55E  or  "↓ 890" 12px #EF4444
```

**Skeleton:** hero card shimmer + 5 row shimmer

---

### SCREEN 9 — Events

```
Header:
  "Events"          28px Bold #FFFFFF
  "What do you want to do, Omar?"  14px Regular #9CA3AF, marginTop 4px
  (personalized with user's first name)

Search bar:
  height:           48px
  backgroundColor:  #1A1A24
  borderRadius:     12px
  icon:             search icon 18px #9CA3AF, paddingLeft 14px
  placeholder:      "Search events..." 15px #4B5563
  marginV:          16px

"Upcoming" section label:  17px Bold #FFFFFF

FEATURED EVENTS GRID (2 columns):
  gap:              12px
  height per card:  ~180px

  FEATURED EVENT CARD:
    borderRadius:   16px
    overflow:       hidden
    position:       relative

    Banner image:   absolute fill
    Gradient overlay: bottom 40% → rgba(0,0,0,0.80)

    Date badge (top-left):
      backgroundColor: #7C3AED
      borderRadius: 999px
      padding: 4px 10px
      "15 JUL" 12px Bold #FFFFFF

    Going badge (bottom-left of image):
      backgroundColor: rgba(0,0,0,0.60)
      borderRadius: 999px
      padding: 4px 8px
      "142 going" 11px Regular #FFFFFF

    Title (below image):
      "Battle of Bands" 14px SemiBold #FFFFFF, marginTop 8px
    Organizer:
      "by Music Society" 12px Regular #9CA3AF, marginTop 2px

"Browse by Category" label:  17px Bold #FFFFFF, marginTop 24px

CATEGORY CHIPS (horizontal scroll):
  gap:              8px
  chip active:      backgroundColor #7C3AED, borderRadius 999, paddingH 16, paddingV 8
                    label 14px SemiBold #FFFFFF
  chip inactive:    backgroundColor #1A1A24, borderRadius 999, paddingH 16, paddingV 8
                    borderWidth 1, borderColor rgba(255,255,255,0.08)
                    label 14px Regular #9CA3AF
  Categories:       All · Music · Tech · Food · Art

EVENT LIST CARD (full width):
  backgroundColor: #1A1A24
  borderRadius:    14px
  padding:         12px
  flexDirection:   row
  gap:             12px

  Thumbnail:       72px × 72px, borderRadius 10px, objectFit cover
  Content:
    Name:          15px SemiBold #FFFFFF
    Organizer:     "by Entrepreneur Club" 12px Regular #9CA3AF, marginTop 2px
    Location row:  📍 icon 12px #9CA3AF + "FAST Campus" 12px #9CA3AF
    Going:         "89 going" 12px Regular #9CA3AF, dot separator
  Date badge (right):
    "22 JUL" same as featured card badge style
```

**Skeleton:** 2 featured card shimmer side by side + category chip row + 3 list card shimmer

---

### SCREEN 10 — Messages

```
Header:
  "Messages"        22px Bold #FFFFFF

  Right row (gap 10px):
    "Requests 3" pill:
      backgroundColor: #1A1A24
      borderRadius:    999px
      padding:         6px 12px
      "Requests" 13px Regular #9CA3AF + "3" 13px SemiBold #7C3AED
    Search icon:    20px #FFFFFF
    Compose icon:   pencil/edit 20px #FFFFFF

Tab pills:
  "Messages" active | "Community" inactive
  (Purple Pill Tabs — see global components)

Filter chips (below tabs, horizontal scroll):
  All (active purple) · Unread · Groups · Pinned
  Same chip style as category chips but smaller paddingH: 12px

CONVERSATION LIST:
  itemSeparator:   none (no border — rows are separated by gap)
  gap:             4px

  CONVERSATION ROW:
    backgroundColor: transparent (no card background — flush with page)
    paddingH:        16px, paddingV 12px
    borderRadius:    12px
    activeBackground: #1A1A24 (on press)

    Avatar:          44px circle with online dot (if online)
    Content:
      Name:          15px SemiBold #FFFFFF
      Preview:       14px Regular #9CA3AF (truncated 1 line)
      "Typing..." in purple: 14px Regular #7C3AED

    Right:
      Timestamp:     12px Regular #9CA3AF, top-right
      Unread badge:  (see global component 2.9), bottom-right
```

**Skeleton:** 6 conversation row shimmer (circle + 2 lines)

---

### SCREEN 11 — Community

```
Header:
  "Community"       22px Bold #FFFFFF
  Search icon:      20px #FFFFFF, right

Tab pills:
  "Messages" inactive | "Community" active

Search bar:         same as Events screen, placeholder "Find a community..."

"YOUR COMMUNITIES" section label:
  12px SemiBold #4B5563, letterSpacing 1.5px, marginV 14px

COMMUNITY CARD (joined):
  backgroundColor: #1A1A24
  borderRadius:    16px
  overflow:        hidden
  marginH:         16px
  marginBottom:    10px

  Banner image:    full width, height 90px, objectFit cover
  Gradient overlay on banner: rgba(0,0,0,0.40)

  Icon + name + members (overlaid on banner, bottom-left):
    Icon:          24px emoji or image
    Name:          15px Bold #FFFFFF
    Members:       "1,240 members" 12px Regular rgba(255,255,255,0.70)

  "Joined" button (overlaid on banner, bottom-right):
    Joined style (see global component 2.6)

  Description row (below banner):
    padding:       10px 14px
    Description:   13px Regular #9CA3AF, flex 1
    Online count:  "🟢 34" 13px Regular #22C55E, right-aligned

"DISCOVER MORE" section label: same style as YOUR COMMUNITIES

DISCOVER COMMUNITY CARD:
  Same card structure
  Button:          "Join" (active purple style)
```

**Skeleton:** 2 joined community card shimmer + 2 discover card shimmer

---

### SCREEN 12 — Community Detail

```
Header area:
  Back arrow:      24px #FFFFFF, absolute top-left, z-index high
  Banner image:    full width, height 200px, objectFit cover

Community info (over banner bottom):
  gradient overlay: bottom 50% of banner → rgba(0,0,0,0.80)
  Icon:            32px, bottom-left of banner
  Name:            17px Bold #FFFFFF
  Members:         "1,240 members" 13px Regular rgba(255,255,255,0.70)
  "Joined" button: bottom-right of banner overlay

Tab pills (Main | Chat):
  Below banner, paddingH 16px, marginTop 12px

POST CARD (inside community):
  backgroundColor: #1A1A24
  borderRadius:    14px
  padding:         14px
  marginH:         16px
  marginBottom:    10px

  Author row:      same as home feed post
  Content:         same as home feed post
  Actions row:
    ❤️ count + "Reply" text (no share, no bookmark)
    fontSize:       13px Regular #9CA3AF
```

**Skeleton:** banner shimmer + tab row shimmer + 3 post card shimmer

---

### SCREEN 13 — Chat Room

```
Header:
  Back arrow:      24px #FFFFFF
  Avatar:          36px circle (with online dot)
  Name + status:
    Name:          15px SemiBold #FFFFFF
    "Online":      12px Regular #22C55E, marginTop 1px
  Right icons:     phone 22px #FFFFFF + video 22px #FFFFFF, gap 16px

Date divider:
  "Today" pill:    backgroundColor rgba(255,255,255,0.08), borderRadius 999
                   padding: 4px 12px, 12px Regular #9CA3AF, centered

MESSAGES (FlatList, inverted for chat order):

  OTHER'S BUBBLE:
    backgroundColor: #1E1E2C
    borderRadius:    16px (top-left: 4px)
    paddingH:        14px, paddingV 10px
    maxWidth:        75%
    alignSelf:       flex-start
    avatar:          28px circle, to the left of bubble
    font:            15px Regular #FFFFFF
    timestamp:       11px Regular #4B5563, below bubble, left-aligned

  OWN BUBBLE:
    backgroundColor: gradient #7C3AED → #A855F7
    borderRadius:    16px (top-right: 4px)
    paddingH:        14px, paddingV 10px
    maxWidth:        75%
    alignSelf:       flex-end
    font:            15px Regular #FFFFFF
    timestamp:       11px Regular #4B5563, below bubble, right-aligned

INPUT BAR (sticky bottom):
  backgroundColor: #0D0D12
  borderTopWidth:  1px, borderColor rgba(255,255,255,0.06)
  paddingH:        12px, paddingV 10px
  minHeight:       56px
  flexDirection:   row, alignItems center, gap 10px

  "+" button:      32px circle, backgroundColor #1A1A24, icon 18px #9CA3AF
  Text input:
    flex:          1
    backgroundColor: #1A1A24
    borderRadius:  999px
    paddingH:      16px, paddingV 10px
    placeholder:   "Message..." 15px #4B5563
    font:          15px #FFFFFF

  Emoji button:    😊 emoji icon or smiley, 24px #9CA3AF
  Voice button:    32px circle, backgroundColor #7C3AED
                   microphone icon 16px #FFFFFF
```

**Skeleton:** 4 alternating bubble shimmer blocks + input bar shimmer

---

### SCREEN 14 — Profile (Me)

```
Settings icon:     gear icon 24px #9CA3AF, absolute top-right 16px 16px

COVER / BANNER:
  height:          200px
  image:           full-bleed photo (event/lifestyle photo)
  gradient overlay: bottom 30% → rgba(0,0,0,0.60)

AVATAR (overlapping banner):
  size:            80px × 80px circle
  border:          3px solid #0D0D12 (separates from banner)
  position:        absolute bottom -40px, left 16px (overlapping banner)
  Name overlay below avatar (inside banner):
    "Zara Ahmed" 13px SemiBold #FFFFFF (semi-transparent overlay text near avatar)

VERIFIED BADGE:
  size:            20px circle
  backgroundColor: #7C3AED
  icon:            ✓ 12px #FFFFFF
  position:        below avatar, center (absolute)

PROFILE INFO SECTION:
  marginTop:       48px (accounts for avatar overlap)
  paddingH:        16px

  Name:            22px Bold #FFFFFF
  Dept + semester: "CS · 6th Semester" 14px Regular #9CA3AF, marginTop 4px

  ACTION BUTTONS ROW (gap 8px, marginTop 14px):
    Share:         pill button (inactive style)
    Edit:          pill button (inactive style)
    +:             32px circle, backgroundColor #7C3AED, icon + 18px #FFFFFF

STATS ROW (marginTop 16px, gap 12px):
  Each stat card:
    backgroundColor: #1A1A24
    borderRadius:    12px
    flex:            1
    padding:         12px 16px
    alignItems:      center

    Value:           "⚡ 2,840" or "❤️ 47"
    Value font:      20px Bold, ⚡ #F59E0B / ❤️ #EF4444 for icon, #FFFFFF for number
    Label:           "Aura" or "Matches" 12px Regular #9CA3AF, marginTop 4px

BIO:
  "Coffee addict & code enthusiast ☕ | CS @ FAST | Building things that matter 🚀"
  14px Regular #FFFFFF, lineHeight 20px, marginTop 14px

TABS (Posts | Communities):
  marginTop:       20px
  Same purple pill tab style

POSTS GRID (3 columns):
  gap:             2px
  Each cell:       (screenWidth - 36px) / 3 wide, same height (square)
  image:           objectFit cover, borderRadius 4px
```

**Skeleton:** banner shimmer + avatar circle shimmer + name/dept lines + 2 stat cards + bio lines + 3×2 grid shimmer

---

## 4. NAVIGATION FLOWS

```
Login ──────────────────────────────────────────────────────►
  ├── "Create account" → Register screen
  ├── "Forgot Password?" → Forgot Password screen
  └── Successful login → Home Feed (main tabs)

Register ──────────────────────────────────────────────────►
  └── After email verification → Profile Setup → Home Feed

Home Feed ─────────────────────────────────────────────────►
  ├── Bell icon tap → Notifications dropdown (overlay)
  ├── "See all notifications" → Notifications full screen
  ├── Avatar tap → Profile screen
  ├── Post author tap → That user's Profile screen
  └── Post image tap → Post Detail screen

Discover ──────────────────────────────────────────────────►
  └── Match occurs → Match Celebration overlay

Ranks tab ─────────────────────────────────────────────────►
  ├── "Leaderboard" tab → Weekly leaderboard
  └── "Department Rankings" tab → Dept leaderboard

Events tab ────────────────────────────────────────────────►
  └── Event card tap → Event Detail screen

Chat tab ──────────────────────────────────────────────────►
  ├── "Messages" inner tab → Message list
  │     └── Conversation tap → Chat Room
  └── "Community" inner tab → Community list
        └── Community card tap → Community Detail
              └── "Chat" inner tab → Community Chat Room

Me tab ────────────────────────────────────────────────────►
  ├── Gear icon → Settings
  ├── "Edit" → Edit Profile
  └── "Communities" tab → User's joined communities
```

---

## 5. SKELETON IMPLEMENTATION RULES

```
1. Every screen must show its skeleton on first load (isLoading === true)
2. Skeleton must match the exact layout of the real screen
3. Minimum display time: 200ms (prevent flash)
4. Pulse animation: opacity 0.30 → 0.65 → 0.30 over 1800ms, loop
5. Base color: #1A1A24 / Shimmer: #252535
6. After data loads: fade content in (opacity 0 → 1, 200ms)
7. FlatList skeletons: render exactly 4–5 static skeleton items
8. Never show a blank screen — skeleton or content, always one of the two

Skeleton requirement per screen:
  Login:                2 input blocks + 1 button
  Home Feed:            3 post card blocks
  Notifications:        5 notification row blocks
  Discover:             1 large card block + 3 circle buttons
  Leaderboard:          3 large rank cards + 5 rows
  Dept Rankings:        1 hero card + 5 department rows
  Events:               2 featured cards + chip row + 3 list cards
  Messages:             6 conversation row blocks
  Community list:       2 joined cards + 2 discover cards
  Community Detail:     banner + 3 post cards
  Chat Room:            4 alternating bubble blocks
  Profile:              banner + avatar + stats + 6 grid cells
```

---

## 6. ANIMATION SPEC

```
Page transitions:     slide_from_right, 250ms
Tab switch:           fade, 150ms
Button press:         scale 1.0 → 0.95, spring (damping 15, stiffness 200)
Discover swipe:       card follows finger with rotation ±15°
                      speed exit: translateX ±500px + opacity 0, 300ms
Like button tap:      heart scale 1.0 → 1.3 → 1.0, 400ms spring
Notifications bell:   subtle shake on new notification, 3 oscillations
Unread badge:         scale in from 0 → 1, spring, on first appear
Skeleton shimmer:     opacity pulse, 1800ms loop (see Section 5)
Screen content entry: opacity 0 → 1, 200ms ease-out
Gold glow on top-3:   animate opacity 0.3 → 0.6 → 0.3, 3s loop (subtle)
```

---

## 7. CLAUDE CODE IMPLEMENTATION PROMPT

```
I am implementing the FAST SOCIO React Native app UI.
I have a complete UI spec (UISpec.md) that defines every screen,
component, color, spacing, and animation.

Read the UISpec.md file first. Then implement every screen
to match it exactly. Follow this exact order:

1. Implement design tokens in constants/colors.ts and constants/typography.ts
2. Build all global components (BottomNav, GlassCard, Input, PrimaryButton,
   PillButton, VerifiedBadge, OnlineDot, UnreadBadge, AuraBadge, EmptyState)
3. Build skeleton system (Skeleton.tsx + all 14 screen skeletons)
4. Implement screens in this order:
     Login → Register → Home Feed → Discover → Leaderboard →
     Department Rankings → Events → Messages → Community List →
     Community Detail → Chat Room → Notifications → Profile
5. Add animations (see Section 6 of UISpec)

For each screen:
  a. Implement the skeleton first
  b. Implement the screen layout
  c. Wire up data (TanStack Query or Zustand)
  d. Add interactions and navigation
  e. Test that skeleton shows before data loads

RULES:
  ✅ Match UISpec.md pixel-perfectly
  ✅ Use expo-image for all images (cachePolicy="memory-disk")
  ✅ Wrap all FlatList renderItem in React.memo
  ✅ All animations must use useNativeDriver: true
  ✅ Skeleton on every screen without exception
  ❌ Do not use any color not in the design tokens
  ❌ Do not add any UI element not in the UISpec
  ❌ Do not use React Native <Image> — use expo-image only
```
