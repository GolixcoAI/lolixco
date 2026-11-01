# Mission 7A — Content Ingestion Runbook

This runbook describes the step-by-step operational procedure for ingesting the first batch of owner-provided landscape videos and portrait Shorts into Lolixco.

---

## Prerequisites

1. Working branch created from verified `main`.
2. Clean working tree (`git status` is clean).
3. Staged owner media assets (video files in `.mp4` or `.webm`, posters in `.webp` or `.png`).
4. Metadata completed in a working copy of [`content/manifest.template.json`](file:///home/vuld0/Lolixco/content/manifest.template.json).

---

## Phase 1 — Asset Staging

### Step 1.1: Organize Asset Files
Place incoming media assets in the designated directories under `public/media/`:
```
public/
  media/
    videos/
      video-100-<slug>.mp4
      short-200-<slug>.mp4
    posters/
      video-100-<slug>.webp
      short-200-<slug>.webp
```

*File naming convention:* Lowercase alphanumeric slugs prefixed with format and assigned ID (e.g. `video-100-gojo-domain.mp4`, `short-200-jett-ace.mp4`).

### Step 1.2: Check Asset Headers and Dimensions
Verify that video and poster files have valid headers and proper aspect ratios:
```bash
# Check video streams using ffprobe when available:
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,codec_name,duration \
  public/media/videos/*.mp4
```

---

## Phase 2 — Manifest Authoring

### Step 2.1: Populate Working Manifest
Copy the hypothetical template to the untracked working manifest:
```bash
cp content/manifest.template.json content/manifest.json
```
*(Note: `content/manifest.json` is protected by `.gitignore` to prevent leaking private editorial records to GitHub).*

### Step 2.2: Fill in Record Details
For each new item:
1. Assign unique integer ID:
   - Landscape videos: `100` to `199`.
   - Portrait shorts: `200` to `299`.
2. Specify format: `"video"` or `"short"`.
3. Choose canonical category: `"Anime" | "Movies" | "Series" | "Multifandom" | "Gaming" | "Phonk" | "Motivation"`.
4. Associate registered fandom slug IDs (e.g. `["jujutsu-kaisen"]`, `["valorant"]`). If introducing a new fandom, first declare it in `src/data/fandoms.ts`.
5. Add search tags (lowercase alphanumeric, no `#`).
6. Specify asset paths: `/media/videos/...` and `/media/posters/...`.
7. Fill in duration (`"0:32"`).
8. Record rights clearance and curator notes under the `editorial` block.

---

## Phase 3 — Validation Gate

### Step 3.1: Metadata Preparation Validation
Can be run before media files arrive to verify schema and taxonomy:
```bash
npm run check:content -- --manifest content/manifest.json --mode metadata
```
*Expected output:* Confirms schema validity, reports `Asset verification: SKIPPED (Metadata preparation mode)`.

### Step 3.2: Staged Asset Validation
Run after files are staged in `public/media/`:
```bash
npm run check:content -- --manifest content/manifest.json --mode assets
```
*Expected output:* Verifies file existence, safe path containment, and streaming magic byte signatures.

### Step 3.3: Publication Readiness Check
Execute final pre-publication gate:
```bash
npm run check:content -- --manifest content/manifest.json --mode publish
```
*Expected output:* Enforces that `reviewStatus` is `"approved"` or `"published"`, `rightsCleared` is `true`, staged assets are verified, physical video streams are certified via ffprobe (aspect ratios, container duration fallback, audio presence/codec, tolerances), and entire video files pass full playback decode integrity verification via FFmpeg (`ffmpeg -v error -xerror -i <file> -f null -`). **Fails closed** with fatal error if ffprobe or ffmpeg is unavailable in the environment, or if any stream fails decode verification.

---

## Phase 4 — Catalog Compilation & Recsys Sync

### Step 4.1: Project Public Metadata into `src/data/edits.ts`
Compile validated records into `src/data/edits.ts` using `projectToPublicEdit(item)`.

*Security guarantee:* `projectToPublicEdit(item)` is **safe by default** and throws immediately if an item lacks approved review or rights clearance. It completely strips all private editorial fields, setting `creator: "Lolixco curated"`. For development-only previews, call `projectToPreviewEdit(item)`.

### Step 4.2: Update Recommendation Engine Snapshot (Mission 7B)
```bash
python3 server/recsys/export_catalog.py
python3 server/recsys/export_catalog.py --check
```

---

## Phase 5 — Full Verification Suite

Execute the quality gates:

```bash
# 1. Frontend unit and regression tests
npm test

# 2. TypeScript compilation check
npm run typecheck

# 3. Python recommendation test suite
python3 -m unittest discover -s server/recsys/tests -v

# 4. Catalog snapshot drift check
python3 server/recsys/export_catalog.py --check

# 5. Asset integrity check
npm run check:assets

# 6. Content catalog validation (production live check)
npm run check:content

# 7. Production bundle build
npm run build
```

All gates must pass with exit code `0`.
