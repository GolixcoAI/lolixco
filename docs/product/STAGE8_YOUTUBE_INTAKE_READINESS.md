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

| Catalog ID | Title | Creator / Channel | Category | Duration | YouTube ID |
|---|---|---|---|---|---|
| `100` | a very normal TOJI edit [AMV] (Jujutsu Kaisen) Blu-Ray | SD97 | Anime | 2:16 | `0vswe8D3UTk` |
| `101` | Jujutsu Kaisen - Neon Blade [Edit/AMV] | C-Real AMV | Anime | 0:39 | `HoxrYzuxH_Q` |
| `102` | DOCTOR DOOM - I AM DOOM (4K 60FPS) | Jvck | Movies | 0:23 | `bW-K9_w52cE` |
| `103` | JINX / ARCANE [EDIT] 4K | liam editz | Series | 0:31 | `ZIdX6sR04vY` |
| `104` | Breaking Bad - The Kingpin [Edit] 4K | Void Edits | Series | 0:36 | `Q3Zq4eN66lI` |
| `105` | Peaky Blinders - Thomas Shelby [Sigma Edit] | Shadow Edits | Series | 0:42 | `G3FmQ0Qx2c4` |
| `106` | Spider-Man: Across the Spider-Verse [Flow Edit] | Nexus Edits | Movies | 0:45 | `vJp3F91ZJvY` |
| `107` | Cyberpunk: Edgerunners - I Really Want to Stay At Your House | Neon Pulse | Anime | 0:50 | `7wP91v1K3vY` |
| `108` | Game of Thrones — Westeros Realm [4K Flow Edit] | LUXUSIO | Series | 0:20 | `h3F91ZJvY01` |
| `109` | Batman - The Dark Knight [Cinematic Flow Edit] | Gotham Beats | Movies | 0:38 | `W1fL8P01x9Y` |
| `110` | Interstellar - Stay [Emotional 4K Edit] | Starlight Edits | Movies | 0:52 | `M8kL0P11vXz` |
| `111` | Elden Ring - The Shattering [Epic Flow Edit] | FromVoid | Gaming | 0:48 | `L5nK8P22vAb` |
| `112` | David Goggins - They Don't Know Me Son [Motivation Edit] | Grindset Daily | Motivation | 0:34 | `P9mL1Q33vCd` |

### YouTube Shorts (IDs 200–214)

| Catalog ID | Title | Creator / Channel | Category | Duration | YouTube ID |
|---|---|---|---|---|---|
| `200` | Shin-chan & Shiro — Ultimate Nostalgia Edit | Shinchan Vlogzzz | Anime | 0:10 | `LqLp21jQfJk` |
| `201` | Attack on Titan — Eren's Betrayal [Shorts Edit] | Exorion. | Anime | 0:21 | `v0mY6V9tLxs` |
| `202` | Valorant — Radiant Clutch [4K Gameplay Edit] | Daily Palworld | Gaming | 0:34 | `rXmQ2V5wY01` |
| `203` | GTA 6 — Vice City Hype [Raya Slowed Edit] | Anixv | Gaming | 0:20 | `WpL1k09XvZz` |
| `204` | Avengers Doomsday — The OGs Return [Shorts Edit] | Ron4k | Movies | 0:25 | `T8mK1L00vYy` |
| `205` | Batman — Dark Knight Legacy [Bale vs Pattinson] | Bat.aep_ | Movies | 0:09 | `K7mL2Q33vXx` |
| `206` | Spider-Man — Multi-Spidey Showcase [Shorts Edit] | Veqta | Movies | 0:17 | `M2nL8P44vWw` |
| `207` | Animal — Ranvijay Entry [GLXXM Phonk Edit] | surajk edits | Movies | 0:30 | `Q1pL9M55vVv` |
| `208` | Jujutsu Kaisen — Gojo Unlimited Void [Shorts Flow] | SatoruEdits | Anime | 0:15 | `B3kM0P66uUu` |
| `209` | Demon Slayer — Infinity Castle Hype [4K Edit] | KimetsuVFX | Anime | 0:18 | `C4lN1Q77tTt` |
| `210` | The Boys — Homelander Perfect Smile [Shorts Edit] | VoughtVFX | Series | 0:12 | `D5mO2R88sSs` |
| `211` | Succession — Kendall Roy Killer Instinct | WaystarEdits | Series | 0:22 | `E6nP3S99rRr` |
| `212` | KGF Chapter 2 — Rocky Bhai Monster Entry | SandalwoodFlow | Movies | 0:28 | `F7oQ4T00qQq` |
| `213` | Ghost of Tsushima — Jin Sakai Honor Died | BushidoBeats | Gaming | 0:19 | `G8pR5U11pPp` |
| `214` | David Goggins — Stay Hard Mindset [Shorts Motivation] | IronWill | Motivation | 0:24 | `H9qS6V22oOo` |

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

### 3.2 Shorts Modal Header Decoupling

**Root Cause:**
`.shorts-viewer-header` was previously positioned at `top: 14px; left: 16px;` inside the video frame. In YouTube Shorts playback, this header directly collided with the YouTube video title and native controls.

**Resolution:**
- On desktop viewports, `.shorts-viewer-header` is repositioned to `top: -46px; left: 0; right: 0;`, cleanly elevating index labels and modal controls above the 9:16 frame.
- On mobile viewports (`max-width: 767px`), header adheres to safe-area insets (`top: max(env(safe-area-inset-top, 12px), 12px)`).
- Centered alignment added to `.shorts-viewer-frame`.

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

### 3.5 Responsive Edit of the Moment Typography

**Resolution:**
- Adjusted `.hero-info h1` font size to responsive `clamp(20px, 2.2vw, 32px)/1.15 Rajdhani`.
- Applied a 2-line clamp (`-webkit-line-clamp: 2`) and text shadow for legibility across varied background video luminance.

---

## 4. Verification Boundaries & Clearance Constraints

1. **Test Suite Integrity:**
   All 532 Vitest unit and integration tests and 63 RecSys Python tests pass without modification.
2. **Catalog Baseline Untouched:**
   `src/data/edits.ts` remains strictly identical to `origin/main` (containing the 17 demo baseline items).
3. **No Unilateral Publication:**
   The canonical catalog compiler `--publish` workflow has not been executed; the production distribution dataset is unaltered.
4. **Quarantine & Alternates Preserved:**
   The 26 candidate videos failing embed checks remain in quarantine; the 10 verified alternates remain on standby.
