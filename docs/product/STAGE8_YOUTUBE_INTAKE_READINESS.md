# Stage 8 YouTube Intake Readiness & UI Repair Specification

## 1. Executive Summary

This specification records the intake readiness and UI playback integration for the owner-approved pool of **28 YouTube edits** (13 landscape videos and 15 YouTube Shorts).

The intake dataset satisfies all architectural standards established across Stages 3 through 7B:
- Stable sequential catalog IDs (`100..112` for landscape edits, `200..214` for Shorts).
- Motivation taxonomy compatibility: Both David Goggins edits (IDs `112` and `214`) are assigned to `Motivation`.
- Complete separation of selection and preparation from canonical publication: The 17 baseline demo records (IDs `0..16`) in `src/data/edits.ts` remain untouched.
- Strict exclusion boundaries: All 26 restricted candidate videos remain quarantined; 10 verified alternates remain on standby.

In addition, this pull request addresses critical UI, aspect-ratio, and playback display issues observed during in-app evaluation of YouTube embeds.

---

## 2. Approved 28 YouTube Edit Manifest

### Landscape Edits (IDs 100–112)

| Catalog ID | Canonical YouTube ID | Title | Creator / Channel | Category | Duration | Format |
|---|---|---|---|---|---|---|
| `100` | `0vswe8D3UTk` | Toji Fushiguro — Sorcerer Killer [Blu-Ray AMV] | SD97 | Anime | 2:15 | Landscape (16:9) |
| `101` | `HoxrYzuxH_Q` | Sukuna — Neon Blade [Jujutsu Kaisen AMV] | Molob | Anime | 0:39 | Landscape (16:9) |
| `102` | `uo0_I2ZNOds` | Jujutsu Kaisen — London View Flow Edit | Zweng | Anime | 0:22 | Landscape (16:9) |
| `103` | `yLhjFXkPpck` | Attack on Titan — Enemy [4K AMV] | Jemartob | Anime | 1:01 | Landscape (16:9) |
| `104` | `yuwmyuXg9_k` | Doctor Doom — I Am Doom [4K Cinematic Edit] | sanchezae | Movies | 0:23 | Landscape (16:9) |
| `105` | `aV-rL-vObE0` | The Karate Kid — Cheng Combat Phonk [4K Edit] | KingCasonova | Movies | 0:24 | Landscape (16:9) |
| `106` | `zswT92VzOYM` | Spider-Man — Polyester Web-Slinger Edit | BlackRob183 | Movies | 0:19 | Landscape (16:9) |
| `107` | `Z2qIpiDKqtU` | Animal — Untitled #13 Ranvijay 4K Edit | PIXXELL | Movies | 0:43 | Landscape (16:9) |
| `108` | `RZlioQRE3ms` | Money Heist — Berlin Charisma [HD Edit] | Tech By Webers Era | Series | 0:35 | Landscape (16:9) |
| `109` | `ZMbYQIK5B5I` | Game of Thrones — King in the North [Jon Snow 4K] | Lega | Series | 0:44 | Landscape (16:9) |
| `110` | `Q9hjJVxD6Zw` | Game of Thrones — Westeros Realm [4K Flow Edit] | L U X U S I O | Series | 0:19 | Landscape (16:9) |
| `111` | `9h7AGDjttSQ` | Game of Thrones — Battle of the Bastards [4K Duel] | Clegane Edits | Series | 0:29 | Landscape (16:9) |
| `112` | `1fHuksvJTxA` | David Goggins — Metamorphosis [4K Gym Phonk Edit] | Emotive | Motivation | 0:27 | Landscape (16:9) |

### YouTube Shorts (IDs 200–214)

| Catalog ID | Canonical YouTube ID | Title | Creator / Channel | Category | Duration | Format |
|---|---|---|---|---|---|---|
| `200` | `wEjDTQFeVxU` | Shin-chan & Shiro — Ultimate Nostalgia Edit | Shinchan Vlogzzz | Anime | 0:10 | Shorts (9:16) |
| `201` | `Qx3IrEUvflE` | Attack on Titan — Eren's Betrayal [Shorts Edit] | Exorion. | Anime | 0:21 | Shorts (9:16) |
| `202` | `KY0xrjzfFLA` | Valorant — Radiant Clutch [4K Gameplay Edit] | Daily Palworld | Gaming | 0:34 | Shorts (9:16) |
| `203` | `DvC9pK3CpEw` | GTA 6 — Vice City Hype [Raya Slowed Edit] | Arxzv | Gaming | 0:20 | Shorts (9:16) |
| `204` | `kR-USMTLxQk` | Avengers Doomsday — The OGs Return [Shorts Edit] | Ron4k | Movies | 0:25 | Shorts (9:16) |
| `205` | `fLK7a4vLFNg` | Batman — Dark Knight Legacy [Bale vs Pattinson] | Bat.aep_ | Movies | 0:09 | Shorts (9:16) |
| `206` | `q55SLQ2o8Yk` | Spider-Man — Multi-Spidey Showcase [Shorts Edit] | Veqta | Movies | 0:17 | Shorts (9:16) |
| `207` | `a7_od1YCcns` | Animal — Don't Stop [GLXXMSTRIDER Phonk Edit] | surajk editx | Movies | 0:39 | Shorts (9:16) |
| `208` | `BddGwfy_hq0` | Ramayana — Ravana Raj [Montagem Tyrant Phonk] | s1ngh edit | Movies | 0:31 | Shorts (9:16) |
| `209` | `RzjQCa4oOj8` | Power Rangers — Morphin Grid Power [Shorts Edit] | Harshit Mutneja | Series | 0:48 | Shorts (9:16) |
| `210` | `gA1KUzOhyfE` | Money Heist — The Professor's Masterplan [4K Short] | CKS EDITS | Series | 0:23 | Shorts (9:16) |
| `211` | `-kYk7nRzV_8` | Stranger Things — Upside Down Horror [Vazio Eterno] | stala6351@rex | Series | 0:33 | Shorts (9:16) |
| `212` | `2dCzYwWfmzE` | Stranger Things — Steve Harrington Babysitter Edit | Jemiez_Editt | Series | 0:53 | Shorts (9:16) |
| `213` | `DvzaLGOH2vw` | Squid Game — Player 218 Cho Sang-woo [Shorts Edit] | erebus editz | Series | 0:15 | Shorts (9:16) |
| `214` | `W4E_UW0r6FA` | David Goggins — Still I Grind [Mindset Short] | Oliver | Motivation | 0:47 | Shorts (9:16) |

> [!NOTE]
> **Pre-existing Duration Annotation for Item 204 (`kR-USMTLxQk`):**
> The owner-approved manifest records a display duration of `0:25` (25s), whereas YouTube player runtime inspection evidence records `26.0s` (a 1-second rounding discrepancy between YouTube's rounded metadata and decoded container length). In compliance with catalog intake governance, the approved record is preserved as approved without silent modification, and documented here for publication clearance.

---

## 3. UI Repairs & Architectural Fixes

### 3.1 YouTube Iframe Full-Geometry Expansion

**Root Cause:**
Third-party YouTube iframe embeds initialize by default to 640x360 pixels when the container or replacement element lacks explicit sizing (`100%`). This caused landscape videos in Fullscreen Immersion Mode and portrait videos in the Shorts modal to render as a tiny box anchored in the top-left corner.

**Resolution:**
- Applied `height: "100%"` to the inline styles of `.youtube-player-wrapper` in `src/components/video/YouTubePlayer.tsx`.
- Updated CSS in `src/styles/index.css`:
  - `.youtube-player-wrapper`: Enforced `width: 100%`, `height: 100%`, and centered flex layout.
  - `.youtube-player-wrapper > div:first-child`: Explicitly expanded child container to `100%` width and height.
  - `.youtube-player-wrapper iframe`: Added `width: 100% !important; height: 100% !important; display: block; border: 0;` to guarantee full coverage of the player frame.

### 3.2 Responsive Shorts Viewer Header & Viewport Geometry

**Root Cause:**
Negative absolute positioning (`top: -46px`) placed header controls outside the viewport on laptop viewports (e.g., 1280×720, where container starts at y=36, placing buttons at y=-10). In mobile viewports (`390×844`), positioning inside the video frame overlapped YouTube's native title and channel avatar.

**Resolution:**
- Replaced negative positioning with a robust responsive layout:
  - On desktop and laptop viewports, `.shorts-viewer-container` uses a flex column with bounded dimensions (`width: min(calc((100vh - 100px) * 9 / 16), 92vw, 506px)`), reserving an in-flow header row above `.shorts-viewer-frame`. All controls (index, Play, Mute, Close) start at y ≥ 27px from the top of the viewport on all standard screens (1280×720, 1366×768, 1440×900, 1920×1080) with zero clipping.
  - On mobile viewports (`max-width: 767px`), `.shorts-viewer-container` establishes a full-screen flex column with `.shorts-viewer-header` as a dedicated top bar (`position: relative; top: 0; background: #000; padding-top: max(env(safe-area-inset-top, 8px), 8px)`). The video frame begins cleanly below the bar, preventing any overlap with YouTube's embedded title bar or controls.

### 3.3 Shorts Card Duration Badge Decoupling

**Root Cause:**
In `src/components/shorts/ShortsCard.tsx`, the duration badge was structured as `<span className="duration shorts-duration">{short.duration}</span>`. The generic `.duration` class applied `bottom: 5px; right: 5px;` while `.shorts-duration` applied `top: 8px; right: 8px;`. In multiple browsers, having both `top` and `bottom` constraints stretched the dark translucent backdrop along the entire vertical height of the card.

**Resolution:**
- Decoupled badge to `<span className="shorts-duration">{short.duration}</span>`.
- The badge renders as a compact, top-right pill without vertical backdrop artifacts.

### 3.4 Fullscreen Immersion Mode Geometry & Ambience

**Resolution:**
- Expanded `.immersion-video-wrapper.landscape` to `min(96vw, calc((100vh - 120px) * 16 / 9))` and `.portrait` to `min(calc(100vh - 120px), 920px)`.
- Sized `.immersion-tag-list` to `max-width: 50%` with hidden scrollbars for clean navigation.

### 3.5 Featured Watch Now Interactivity & Seek Timeline Protection

**Root Cause:**
Positioning `.hero-info` at `bottom: 24px` placed the clickable Watch Now button across the same vertical coordinate space as the playback seek timeline (`.timeline` at `inset: auto 12px 5px`). On viewports such as 1280×720, clicking the timeline near the beginning (e.g. ~2 seconds) intercepted the Watch Now button instead of seeking.

**Resolution:**
- Elevated `.hero-info` to `bottom: 68px`, establishing >15px of physical separation above the playback rail across all screen sizes.
- Assigned `z-index: 5` to `.player-bottom` (exceeding `.hero-info`'s `z-index: 4`) ensuring the seek timeline and player controls take absolute precedence for hit-testing across their full width.
- Maintained responsive `clamp(20px, 2.2vw, 32px)/1.15 Rajdhani` typography with 2-line clamping.
- Maintained explicit `pointer-events: auto` on interactive child controls (`.watch` and `.shuffle-moment-btn`) when visible, and `pointer-events: none !important` when cinematic fade hides player info (`[data-info-hidden="true"]`).

---

## 4. Verification Boundaries & Clearance Constraints

1. **Test Suite Integrity:**
   All 536 isolated Node test runner tests and 63 RecSys Python tests pass cleanly without modification or failure.
2. **Catalog Baseline Untouched:**
   `src/data/edits.ts` remains strictly identical to `origin/main` (containing the 17 demo baseline items).
3. **No Unilateral Publication:**
   The canonical catalog compiler `--publish` workflow has not been executed; the production distribution dataset is unaltered.
4. **Quarantine & Alternates Preserved:**
   The 26 candidate videos failing embed checks remain in quarantine; the 10 verified alternates remain on standby.
