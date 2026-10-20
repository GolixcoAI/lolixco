# Owner Batch Intake & Operator Runbook

## 1. Overview

This runbook guides the owner through submitting batches of up to 10 curated YouTube video and Shorts URLs, reviewing metadata, and publishing them to Lolixco without service disruption or manual coding.

## 2. Environment Configuration

Ensure a valid Google Cloud YouTube Data API v3 key (Label: `Lolixco YouTube Metadata Importer`) is configured in your local environment or `.env.local` (or `.env`):

```bash
# 1. Copy the example configuration template
cp .env.example .env.local

# 2. Paste your Google Cloud YouTube Data API v3 key into .env.local
YOUTUBE_DATA_API_KEY=AIzaSy...your_real_key_here
```

> **Security Note**: Never commit `.env` or `.env.local` or paste secrets into git-tracked files. Metadata retrieval occurs solely via Node.js CLI tools and is never bundled into client Vite code. The importer checks `YOUTUBE_DATA_API_KEY` first (with fallback to `YOUTUBE_API_KEY`).

## 3. Preparing a Batch

Batches are limited to **at most 10 URLs** per submission.

### Active Batch: `jjk-landscape-batch-01`
For the Jujutsu Kaisen landscape batch:
- Text file: `content/batches/jjk-landscape-batch-01.txt`
- Structured JSON: `content/batches/jjk-landscape-batch-01.json`

Ingest using the text list:
```bash
node scripts/youtube-importer.mjs \
  --batch jjk-landscape-batch-01 \
  --category Anime \
  --fandom jujutsu-kaisen \
  --format landscape \
  --input content/batches/jjk-landscape-batch-01.txt
```

Or using the structured JSON:
```bash
node scripts/youtube-importer.mjs \
  --batch jjk-landscape-batch-01 \
  --input content/batches/jjk-landscape-batch-01.json
```

### Option A: Uniform Domain Batch (Text File)
Create a text file, e.g., `batch-01.txt`:
```text
https://www.youtube.com/watch?v=dQw4w9WgXcQ
https://youtu.be/7wtfhZwyrcc
https://www.youtube.com/shorts/3JZ_D3ELwOQ
```

Run the intake tool specifying the batch category and fandom (supports `--input` / `--batch-file` and `--batch` / `--batch-id`):
```bash
node scripts/youtube-importer.mjs \
  --batch 01 \
  --category Gaming \
  --fandom valorant \
  --input batch-01.txt
```
Or using aliases:
```bash
node scripts/youtube-importer.mjs \
  --batch-id 01 \
  --category Gaming \
  --fandom valorant \
  --batch-file batch-01.txt
```

### Option B: Mixed Batch (JSON File)
Create a JSON file, e.g., `batch-01-mixed.json`:
```json
[
  {
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "category": "Gaming",
    "fandom": "valorant"
  },
  {
    "url": "https://www.youtube.com/shorts/7wtfhZwyrcc",
    "category": "Anime",
    "fandom": "jujutsu-kaisen"
  }
]
```

Run the intake tool:
```bash
node scripts/youtube-importer.mjs \
  --batch 01 \
  --input batch-01-mixed.json
```
Or using aliases:
```bash
node scripts/youtube-importer.mjs \
  --batch-id 01 \
  --batch-file batch-01-mixed.json
```

## 4. Execution Workflow

```
[1. URL Intake & Canonicalization]
       │
       ▼
[2. API Metadata Fetch (videos.list)]
       │
       ▼
[3. Editorial Classification & Conflict Check]
       │
       ▼
[4. Audit Trail Log: content/audit/youtube-intake-audit.json]
       │
       ▼
[5. Owner Review & Approval: scripts/review-youtube-batch.mjs]
       │
       ▼
[6. Public Catalog Compilation: scripts/compile-youtube-catalog.mjs]
       │
       ▼
[7. Full Quality Verification Suite]
```

### Step 5: Owner Review & Approval Workflow

Every imported video enters the audit trail as `embed_eligible`, `needs_review`, or `needs_recheck`. Real YouTube items are **never** automatically approved for public catalog compilation merely because they are embeddable. The owner inspects and confirms items explicitly.

#### A. List Pending Records
```bash
node scripts/review-youtube-batch.mjs --list
```

#### B. Inspect Individual YouTube Record
```bash
node scripts/review-youtube-batch.mjs --show <videoId>
```
Displays title, channel creator, duration, privacy status, embeddability, category, fandoms, format hint, conflict warnings, and audit history.

#### C. Explicit Shorts Format Confirmation (Required for Portrait Shorts)
A `/shorts/` URL or duration under 180 seconds is only an initial hint and does **not** prove portrait aspect ratio. For portrait Shorts, explicit recorded confirmation is required before approval:
```bash
node scripts/review-youtube-batch.mjs --confirm-format <videoId> --format short
```

#### D. Approve Individual Items or Entire Batch
```bash
# Approve single item as landscape video:
node scripts/review-youtube-batch.mjs --approve <videoId> --format video

# Approve single item as portrait Short (requires prior format confirmation or --format short):
node scripts/review-youtube-batch.mjs --approve <videoId> --format short

# Approve all eligible verified items in an entire batch (unconfirmed Shorts will be blocked):
node scripts/review-youtube-batch.mjs --approve-batch 01
```

#### E. Reject an Unsuitable Item
```bash
node scripts/review-youtube-batch.mjs --reject <videoId> --reason "Low audio quality / watermark"
```

### Step 6: Review & Compile Approved Items into Catalog

To inspect the status breakdown of the intake audit log:
```bash
node scripts/compile-youtube-catalog.mjs --review
```

To validate and preview catalog generation in memory without modifying production files:
```bash
node scripts/compile-youtube-catalog.mjs
# or explicitly: node scripts/compile-youtube-catalog.mjs --preview
```

To publish approved items to the live production catalog (`src/data/edits.ts`):
```bash
node scripts/compile-youtube-catalog.mjs --publish
```

This updates `src/data/edits.ts` deterministically:
- IDs 0–16: Baseline original demo edits (strictly preserved).
- IDs 100–199: Curated landscape YouTube edits.
- IDs 200–299: Curated portrait YouTube Shorts.
- Historical ID Reservation: Previously allocated Lolixco IDs are permanently reserved across all audit states (`unavailable`, `rejected`, `needs_recheck`, etc.). Re-activated videos reclaim their stable original ID.
- Fail-closed validation against mocks, private/unembeddable videos, duplicate IDs, unregistered fandoms, and incomplete metadata.
- All internal audit notes and secrets are completely stripped.
- Two-file write sequence is transactional: if catalog write or audit persistence fails, automatic rollback restores prior state.

### Step 7: Verify Catalog & System Integrity
```bash
npm test
npm run typecheck
python3 -m unittest discover -s server/recsys/tests -v
python3 -m server.recsys.export_catalog --check
npm run check:assets
npm run check:content
npm run build
```

## 5. Local Backup & Rollback Procedure

Because `content/audit/youtube-intake-audit.json` contains private ingestion records and is gitignored, rollback does **not** rely on Git history. A local automated backup mechanism is built into the workflow.

1. **Automatic Timestamped Backups**: Every write to the audit trail creates a timestamped snapshot in `content/audit/backups/`, e.g.:
   `content/audit/backups/youtube-intake-audit.2026-10-19T12-30-00-000Z.bak.json`
   Backup creation failures fail closed and abort mutations before file modification.
2. **Restoring a Previous Audit Snapshot**:
   ```bash
   node scripts/review-youtube-batch.mjs --restore content/audit/backups/<backup-file>.json
   ```
3. **Re-compiling Live Catalog**:
   ```bash
   node scripts/compile-youtube-catalog.mjs --publish
   ```
4. Verify system integrity:
   ```bash
   npm run check:content
   npm test
   ```

## 6. Coordinated Production Transition Guide (When Adding First Real YouTube Items)

When genuinely approved YouTube items are ready for initial production release, follow this coordinated transition to maintain zero-drift stability:

### 1. Expanded Frontend Catalog Validation
- The frontend content integrity checker (`npm run check:content` and `checkContentIntegrity` in `src/data/edits.ts`) automatically validates expanded catalogs:
  - Preserves 17 baseline demo edits (IDs 0–16) with unmodified local assets.
  - Ensures YouTube embeds have 11-character alphanumeric IDs, valid channels, durations, and non-empty titles.
  - Enforces strict ID ranges: landscape in `[100..199]`, portrait shorts in `[200..299]`.
  - Rejects synthetic mock metadata or duplicate IDs.

### 2. Recommendation Snapshot & Catalog-Version Migration
- The Python recommendation engine relies on `server/recsys/catalog_snapshot.json` and catalog schema checks.
- When `src/data/edits.ts` is updated with genuinely approved YouTube edits:
  1. Export the updated catalog to the Python snapshot:
     ```bash
     python3 -m server.recsys.export_catalog
     ```
  2. Verify catalog snapshot alignment:
     ```bash
     python3 -m server.recsys.export_catalog --check
     ```
  3. Run the full Python recommendation test suite:
     ```bash
     python3 -m unittest discover -s server/recsys/tests -v
     ```

### 3. GitHub CI Validation Behavior with Expanded Records
- GitHub Actions CI executes:
  - `npm run check:content`
  - `python3 -m server.recsys.export_catalog --check`
- When the catalog contains more than 17 records, CI passes only if `server/recsys/catalog_snapshot.json` matches `src/data/edits.ts`.
- Running the export command above ensures CI consistency before committing.

### 4. Preservation of Existing Demo Content
- The 17 baseline demo edits (`id: 0` through `id: 16`) must remain at the exact head of the `edits` array in `src/data/edits.ts`.
- Their local mp4/webm/poster assets, categories, durations, and flags remain active for demo and offline playback.

### 5. Emergency Rollback & Recovery
If an issue arises after publishing real YouTube edits:
1. Revert `src/data/edits.ts` and `server/recsys/catalog_snapshot.json`:
   ```bash
   git checkout -- src/data/edits.ts server/recsys/catalog_snapshot.json
   ```
2. If audit trail was altered, restore the pre-publication backup:
   ```bash
   node scripts/review-youtube-batch.mjs --restore content/audit/backups/<pre-publication-backup>.json
   ```
3. Run the full verification suite to confirm complete restoration:
   ```bash
   npm run check:content
   python3 -m server.recsys.export_catalog --check
   npm test
   ```
