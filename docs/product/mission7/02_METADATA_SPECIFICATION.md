# Mission 7A — Content Metadata Specification

## 1. Overview

The content intake process uses a declarative **Owner Content Manifest** format defined by the JSON Schema at [`content/manifest.schema.json`](file:///home/vuld0/Lolixco/content/manifest.schema.json).

This format provides:
1. **Clean separation of concerns:** Public client metadata is decoupled from private curation, rights review, and technical encoding metrics.
2. **Schema-enforced authoritativeness:** Types, value ranges, string lengths, enums, and aspect ratios are deterministically validated with strict `additionalProperties: false` enforcement across root, records, media, and editorial blocks.
3. **Owner-editable JSON workflow:** Editors work with structured JSON documents rather than modifying TypeScript application code directly.
4. **Enforced ID ranges:** 100–199 for landscape videos; 200–299 for portrait Shorts; 0–16 reserved for demo edits; 17–99 reserved for internal test harnesses.

---

## 2. Root Manifest Envelope

```json
{
  "$schema": "./manifest.schema.json",
  "manifestVersion": "1.0.0",
  "catalogVersion": "catalog-v2",
  "generatedAt": "2026-10-18T12:00:00Z",
  "description": "Lolixco owner-curated media intake manifest",
  "items": [ /* array of ContentRecord objects */ ]
}
```

### Fields

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `$schema` | `string` | No | Path to schema definition (enables editor autocomplete). |
| `manifestVersion` | `string` | Yes | Semantic version of the manifest format (`1.0.0`). |
| `catalogVersion` | `string` | Yes | Target catalog release identifier (e.g. `catalog-v2`). |
| `generatedAt` | `string` | No | RFC3339 / ISO 8601 date-time string. Strictly validated for calendar day correctness (rejects calendar-invalid dates such as `2026-02-31T12:00:00Z` or `2026-04-31T12:00:00Z`). |
| `description` | `string` | No | Contextual note regarding this content batch (must be a string; numeric values rejected). |
| `items` | `array` | Yes | Array of content record definitions. |

> [!IMPORTANT]
> **Authoritative Schema Entry Point:** `validateContentManifest()` invokes `validateJsonSchema()` at its primary entry point. The JSON Schema Draft-07 rules, runtime results, and CLI commands agree completely across root properties, types, date-time formats, item structures, and forbidden additional properties.

---

## 3. Content Record Specification (`ContentRecord`)

Each entry in `items` represents a single curated landscape video or portrait Short.

### 3.1 Public Metadata Fields

These fields are projected to client bundles and visible to platform visitors:

| Field | Type | Format / Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `integer` | `>= 0`, unique | Numeric ID. `0-16` are reserved for demo items. Required: `100-199` for landscape videos, `200-299` for portrait shorts. |
| `format` | `string` | `"video"` \| `"short"` | Mandatory presentation format. Standard landscape (`16:9`) or vertical Short (`9:16`). |
| `title` | `string` | `3` to `100` chars | Display title. |
| `description` | `string` | `5` to `1000` chars | Descriptive summary shown on video player and Shorts viewer. |
| `category` | `string` | Enum: `Anime`, `Gaming`, `Movies`, `Series`, `Phonk`, `Multifandom`, `Motivation`, `Cinematic` | Primary category. `Cinematic` is strictly prohibited for new content (`id >= 17`). |
| `fandomIds` | `string[]` | Registered slug IDs | Optional array of fandom slugs registered in `FANDOM_REGISTRY`. Must be compatible with `category` unless `Multifandom`. |
| `tags` | `string[]` | `^[a-z0-9_-]+$` | Array of lowercase search tags (strictly lowercase, no leading `#`). At least 1 required. |
| `poster` | `string` | Valid image file path | URL or local path (`/media/...`) to card poster image (`.svg`, `.png`, `.jpg`, `.webp`). |
| `source` | `string` | Valid video file path | URL or local path (`/media/...`) to video file (`.mp4`, `.webm`, `.m4v`). |
| `duration` | `string` | `^[0-9]+:[0-5][0-9]$` | Human-readable duration (e.g. `"0:24"`, `"1:45"`). |
| `durationMs` | `integer` | `1` to `3600000` | Optional exact duration in milliseconds. |
| `trending` | `boolean` | `true` \| `false` | Initial editorial placement in Trending row (default: `false`). |

---

### 3.2 Technical Media Metadata (`media`)

Optional technical specifications used for media validation and player performance tuning (`additionalProperties: false`):

| Field | Type | Values | Description |
| :--- | :--- | :--- | :--- |
| `aspectRatio` | `string` | `"16:9"` \| `"9:16"` \| `"4:3"` \| `"2.39:1"` | Enforces format consistency (`16:9` for video, `9:16` for short). |
| `width` | `integer` | `320` to `7680` | Frame width in pixels. |
| `height` | `integer` | `320` to `4320` | Frame height in pixels. |
| `codec` | `string` | `"h264"` \| `"hevc"` \| `"av1"` \| `"vp9"` \| `"vp8"` | Video compression format. |
| `audioCodec` | `string` | `"aac"` \| `"opus"` \| `"mp3"` \| `"none"` | Audio compression format. |
| `frameRate` | `number` | `23.976` to `120` | Video frame rate. |
| `bitrateKbps` | `integer` | `100` to `100000` | Target encoding bitrate in kbps. |
| `loudnessLkfs` | `number` | `-30` to `-5` | Integrated loudness (recommended: `-14 LKFS`). |

---

### 3.3 Private Editorial Metadata (`editorial`)

**Critical Architectural Constraint:** Private editorial metadata is used for internal review, license verification, and curation tracking. It is **strictly stripped** before public client bundle generation.

| Field | Type | Values | Description |
| :--- | :--- | :--- | :--- |
| `reviewStatus` | `string` | `"draft"` \| `"reviewed"` \| `"approved"` \| `"rejected"` \| `"published"` | Workflow review stage. Items cannot be published without `approved` or `published` status. |
| `rightsCleared` | `boolean` | `true` \| `false` | Confirms copyright clearance, digital release, or license verification. Mandatory `true` for publication. |
| `sourceAttribution` | `string` | Up to `500` chars | Internal record of creator identity, original platform link, or license terms. **Never exposed to public users.** |
| `curatorNotes` | `string` | Up to `1000` chars | Internal notes regarding pacing, cut rhythm, audio quality, or feature placement. |
| `ownerAssetRef` | `string` | Up to `100` chars | Owner batch inventory identifier (e.g. `BATCH01_LANDSCAPE_01`). |

---

## 4. Safe Public Client Projection

When compiling or generating the live catalog [`src/data/edits.ts`](file:///home/vuld0/Lolixco/src/data/edits.ts), the validation utility function [`projectToPublicEdit`](file:///home/vuld0/Lolixco/scripts/validate-content.mjs) projects the manifest record into the clean public `Edit` model.

**Safe by default:** To prevent unapproved or uncleared records from accidentally leaking into public client bundles, `projectToPublicEdit` enforces strict publication clearance by default (`allowDraft: false`). Developers never need to remember an optional safety flag. For development previews and internal staging, the explicitly named [`projectToPreviewEdit`](file:///home/vuld0/Lolixco/scripts/validate-content.mjs) function is provided.

```typescript
/**
 * Strip private editorial metadata for public client projection.
 * SAFE BY DEFAULT: Enforces approved review and cleared rights unless allowDraft: true is passed.
 */
export function projectToPublicEdit(item: ContentRecord, { allowDraft = false, strict = true } = {}): Edit {
  const isEnforcingClearance = !allowDraft && strict !== false;

  if (isEnforcingClearance) {
    const reviewStatus = item.editorial?.reviewStatus;
    const rightsCleared = item.editorial?.rightsCleared;
    if (reviewStatus !== "approved" && reviewStatus !== "published") {
      throw new Error(
        `Cannot project item ${item.id} to public catalog: editorial reviewStatus must be 'approved' or 'published', got '${reviewStatus}'`
      );
    }
    if (rightsCleared !== true) {
      throw new Error(
        `Cannot project item ${item.id} to public catalog: editorial rightsCleared must be true`
      );
    }
  }

  return {
    id: item.id,
    title: item.title,
    category: item.category,
    tags: Array.isArray(item.tags) ? [...item.tags] : [],
    description: item.description,
    creator: "Lolixco curated", // Uniform public display name
    poster: item.poster,
    source: item.source,
    duration: item.duration,
    trending: !!item.trending,
    format: item.format,
    ...(item.fandomIds?.length ? { fandomIds: [...item.fandomIds] } : {}),
  };
}

/**
 * Non-public preview projection function.
 * Explicitly allows draft and unreviewed items for development preview only.
 */
export function projectToPreviewEdit(item: ContentRecord): Edit {
  return projectToPublicEdit(item, { allowDraft: true, strict: false });
}
```

This guarantees:
1. **Safe by Default:** Unapproved or uncleared draft records cannot be compiled into public catalogs by calling `projectToPublicEdit(item)` without arguments.
2. **Dedicated Preview Path:** Staging tools and local preview harnesses must call `projectToPreviewEdit(item)` deliberately.
3. **Zero Leakage:** Private review statuses, rights notes, and internal curator remarks are stripped.
4. **Anonymized Attribution:** Creator personal details are completely excluded from public search indexes and cards.
5. **Backward Compatibility:** Full alignment with the existing TypeScript `Edit` interface and feed compositor.
