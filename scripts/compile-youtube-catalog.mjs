/**
 * Public Catalog Compiler for Curated YouTube Edits.
 *
 * Compiles approved YouTube items from the audit trail into src/data/edits.ts.
 * Guarantees:
 * - Preservation of 17 baseline demo edits (IDs 0-16) at the array head
 * - Strict ID ranges: Landscape videos in [100..199], Portrait Shorts in [200..299]
 * - Only items with contentReviewStatus === 'approved' or 'published' are compiled
 * - Fail-closed validation against:
 *   * Synthetic mock metadata (real YouTube API metadata required)
 *   * Private or non-embeddable videos
 *   * Duplicate Lolixco IDs or conflicting YouTube video identities
 *   * Unregistered fandoms or non-canonical categories
 *   * Unconfirmed or ambiguous formats
 *   * Incomplete metadata (missing title, creator attribution, or duration)
 *   * Stale or unverified metadata
 * - Zero leakage of private editorial, rights notes, or audit history
 * - Executable CLI with preview mode and explicit --publish required to write
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

// Register TypeScript loader for on-the-fly TS transpilation
try {
  register("./tests/ts-hooks.mjs", new URL("../", import.meta.url));
} catch {
  // If already registered or unavailable, proceed
}

import { allocateStableId, CANONICAL_CATEGORIES } from "./youtube-editorial.mjs";
import { loadEnvConfig, isTestIsolationActive } from "./youtube-api.mjs";
import {
  safeAtomicWriteFileSync,
  validateAuditDocument,
  createAuditBackup,
  isProtectedProductionPath,
  isProtectedAuditPath,
  getCanonicalPath,
} from "./youtube-importer.mjs";
export const CANONICAL_AUDIT_PATH = resolve(projectRoot, "content/audit/youtube-intake-audit.json");
export const CANONICAL_OUTPUT_PATH = resolve(projectRoot, "src/data/edits.ts");

export function isCanonicalProductionCatalog(targetPath) {
  if (!targetPath) return false;
  return getCanonicalPath(targetPath) === getCanonicalPath(CANONICAL_OUTPUT_PATH);
}

export function isCanonicalProductionAudit(targetPath) {
  if (!targetPath) return false;
  return getCanonicalPath(targetPath) === getCanonicalPath(CANONICAL_AUDIT_PATH);
}

/**
 * Loads registered fandoms dynamically.
 */
export async function loadFandomRegistry() {
  try {
    const fandomsModule = await import(resolve(projectRoot, "src/data/fandoms.ts"));
    return fandomsModule.FANDOM_REGISTRY || [];
  } catch {
    return [
      { id: "jujutsu-kaisen", title: "Jujutsu Kaisen" },
      { id: "demon-slayer", title: "Demon Slayer" },
      { id: "spider-man", title: "Spider-Man" },
      { id: "valorant", title: "Valorant" },
      { id: "doom", title: "Doom" },
    ];
  }
}

/**
 * Projects a validated audit record to a public Edit object.
 * Strips all internal review statuses, notes, and audit fields.
 */
export function projectToPublicYouTubeEdit(auditItem) {
  const metadata = auditItem.metadata || {};
  const category = auditItem.category || auditItem.ownerCategory || "Cinematic";

  // Preserve explicit reviewed fandom assignments across importer, audit, and compiler (FIX D)
  const fandomIds = Array.isArray(auditItem.fandomIds) && auditItem.fandomIds.length > 0
    ? auditItem.fandomIds
    : Array.isArray(auditItem.ownerFandomIds) && auditItem.ownerFandomIds.length > 0
    ? auditItem.ownerFandomIds
    : auditItem.ownerFandom
    ? [auditItem.ownerFandom]
    : [];

  const rawTags = [
    category.toLowerCase(),
    ...fandomIds,
    ...(metadata.tags || []),
    ...(metadata.hashtags || []),
  ];

  const uniqueTags = Array.from(new Set(rawTags.map((t) => t.toLowerCase().trim()).filter(Boolean))).slice(0, 10);

  return {
    id: auditItem.assignedLolixcoId,
    title: metadata.title || "",
    category,
    tags: uniqueTags,
    description: metadata.description?.slice(0, 300) || "Curated cinematic edit.",
    creator: metadata.channelTitle || "",
    poster: metadata.thumbnailUrl || `https://i.ytimg.com/vi/${auditItem.canonicalVideoId}/hqdefault.jpg`,
    source: auditItem.canonicalUrl || `https://www.youtube.com/watch?v=${auditItem.canonicalVideoId}`,
    duration: metadata.durationFormatted || "0:30",
    trending: !!auditItem.trending,
    format: auditItem.format || "video",
    fandomIds,
    sourceType: "youtube_embed",
    youtubeVideoId: auditItem.canonicalVideoId,
    channelTitle: metadata.channelTitle || undefined,
    channelId: metadata.channelId || undefined,
  };
}

/**
 * Generates TypeScript code content for src/data/edits.ts.
 */
export function generateYouTubeEditsTs(compiledEdits) {
  const hasDemoHead =
    compiledEdits.length >= 17 &&
    compiledEdits.slice(0, 17).every((e, idx) => e.id === idx && e.creator === "Lolixco demo");

  let code = `import { mediaAssets, assetUrl } from "./media-assets.js";

import type { ContentFormat, VideoSourceType } from "../types/content";
export { type VideoSourceType } from "../types/content";

export type Edit = {
  id: number;
  title: string;
  category: string;
  tags: string[];
  description: string;
  creator: string;
  poster: string;
  source: string;
  duration: string;
  trending: boolean;
  format?: ContentFormat;
  fandomIds?: string[];
  sourceType?: VideoSourceType;
  youtubeVideoId?: string;
  channelTitle?: string;
  channelId?: string;
  sourceUrl?: string;
};

export function isYouTubeEmbed(edit: Edit): boolean {
  return (
    edit.sourceType === "youtube_embed" &&
    typeof edit.youtubeVideoId === "string" &&
    edit.youtubeVideoId.length === 11
  );
}

export function isLocalDemo(edit: Edit): boolean {
  return !edit.sourceType || edit.sourceType === "local_demo";
}

export function getCanonicalSourceUrl(edit: Edit): string {
  if (edit.sourceType === "youtube_embed" && edit.youtubeVideoId) {
    return \`https://www.youtube.com/watch?v=\${edit.youtubeVideoId}\`;
  }
  return edit.source;
}

`;

  if (hasDemoHead) {
    code += `const titles = [
  "Into the Light",
  "Echoes of Tomorrow",
  "Fragments",
  "Red Horizon",
  "Silent World",
  "Neon Soul",
  "Broken Crowns",
  "Liminal",
  "Darkest Days",
  "Reflections",
  "Chasing Heaven",
  "Afterglow",
  "Cold Hearts",
  "Parallel",
  "Lost Signal",
  "Radiant",
  "Midnight City",
];
const categories = [
  "Cinematic",
  "Gaming",
  "Anime",
  "Movies",
  "Series",
  "Phonk",
];
const baseDemoEdits: Edit[] = titles.map((title, id) => ({
  id,
  title,
  category: categories[id % 6],
  tags: [
    categories[id % 6].toLowerCase(),
    "original",
    "demo",
    id % 2 ? "neon" : "landscape",
  ],
  description:
    "Original geometric artwork. Silent motion study for player testing; not finished creator footage.",
  creator: "Lolixco demo",
  poster: assetUrl(mediaAssets.posters[id], import.meta.env?.BASE_URL ?? "/"),
  source: assetUrl(mediaAssets.video, import.meta.env?.BASE_URL ?? "/"),
  duration: "0:12",
  trending: id > 10,
}));

`;

    const newEdits = compiledEdits.slice(17);
    if (newEdits.length === 0) {
      code += `export const edits: Edit[] = baseDemoEdits;\n`;
    } else {
      code += `const curatedEdits: Edit[] = ${JSON.stringify(newEdits, null, 2)};\n\n`;
      code += `export const edits: Edit[] = [...baseDemoEdits, ...curatedEdits];\n`;
    }
  } else {
    code += `export const edits: Edit[] = ${JSON.stringify(compiledEdits, null, 2)};\n`;
  }

  code += `
export const categoriesList = [
  "Featured",
  "Trending",
  "Anime",
  "Movies",
  "Series",
  "Gaming",
  "Phonk",
  "Cinematic",
  "New",
];
`;

  return code;
}

/**
 * Compiles approved YouTube items into public catalog records.
 *
 * Enforces strict fail-closed validation:
 * - Real API metadata (synthetic mocks rejected)
 * - Valid 11-char canonical video IDs
 * - Public availability and embeddability
 * - Reviewed canonical category & registered fandom associations
 * - Confirmed format (video or short)
 * - Approval status (approved or published)
 * - Stable ID ownership & cross-batch ID uniqueness
 * - Freshness timestamp
 * - Incomplete metadata rejection (no fabricated titles or creator fallbacks)
 */
export async function compileYouTubeCatalog(options = {}) {
  loadEnvConfig();

  const {
    auditFilePath = CANONICAL_AUDIT_PATH,
    outputPath = CANONICAL_OUTPUT_PATH,
    dryRun = true,
    allowDraft = false,
    allowMocks = false,
    baseCatalog = null,
    maxMetadataAgeDays = 30,
    maxMetadataAgeMs = null,
    now = null,
  } = options;

  const errors = [];
  const warnings = [];

  const isTargetingProduction = outputPath.includes("src/data/edits.ts");

  // FIX A: Separate preview-only behavior from publication
  // Production writes must require explicit approved or published status
  if (!dryRun && allowDraft) {
    return {
      success: false,
      errors: [
        "Compilation aborted: 'allowDraft' is strictly forbidden during catalog writes. Production writes require explicit 'approved' or 'published' status."
      ],
      warnings: [],
      compiledCount: 0,
      compiledEdits: baseCatalog || [],
      dryRun,
    };
  }

  // TEST ISOLATION GUARDS:
  // Reject access to protected canonical audit or production catalog destinations during test execution
  if (isTestIsolationActive()) {
    // 1. Audit read & write guard: reading or writing canonical audit files is strictly prohibited under test isolation
    if (isProtectedAuditPath(auditFilePath) || isProtectedProductionPath(auditFilePath)) {
      return {
        success: false,
        errors: [
          `Production catalog compilation blocked: Audit source '${auditFilePath}' resolves to a protected production path under active test isolation. Accessing canonical audit files is strictly prohibited in test mode.`,
        ],
        warnings: [],
        compiledCount: 0,
        compiledEdits: baseCatalog || [],
        dryRun,
      };
    }

    // 2. Production catalog write guard: mutating src/data/edits.ts is strictly prohibited
    if (!dryRun && (isProtectedProductionPath(outputPath) || isCanonicalProductionCatalog(outputPath))) {
      return {
        success: false,
        errors: [
          `Production catalog compilation blocked: Destination '${outputPath}' resolves to a protected production path under active test isolation. Writes to production catalog are strictly prohibited in test mode.`,
        ],
        warnings: [],
        compiledCount: 0,
        compiledEdits: baseCatalog || [],
        dryRun,
      };
    }
  }

  // 1. Load base catalog
  let currentBaseCatalog = baseCatalog;
  if (!currentBaseCatalog) {
    const editsModule = await import(resolve(projectRoot, "src/data/edits.ts"));
    currentBaseCatalog = editsModule.edits;
  }

  // 2. Load audit trail
  if (!existsSync(auditFilePath)) {
    return {
      success: false,
      errors: [`Audit file not found: ${auditFilePath}`],
      warnings: [],
      compiledCount: 0,
      compiledEdits: currentBaseCatalog,
    };
  }

  let auditData;
  try {
    auditData = JSON.parse(readFileSync(auditFilePath, "utf-8"));
  } catch (err) {
    return {
      success: false,
      errors: [`Failed to parse audit file at ${auditFilePath}: ${err.message}. Preserving original file without modification.`],
      warnings: [],
      compiledCount: 0,
      compiledEdits: currentBaseCatalog,
      dryRun,
    };
  }

  const auditValidation = validateAuditDocument(auditData, auditFilePath);
  if (!auditValidation.valid) {
    return {
      success: false,
      errors: auditValidation.errors,
      warnings: [],
      compiledCount: 0,
      compiledEdits: currentBaseCatalog,
      dryRun,
    };
  }

  const registeredFandoms = await loadFandomRegistry();
  const registeredSlugs = new Set(registeredFandoms.map((f) => f.id));

  const items = Array.isArray(auditData.items) ? auditData.items : [];
  const approvedItems = [];

  for (const item of items) {
    const status = item.contentReviewStatus;
    if (status === "approved" || status === "published") {
      approvedItems.push(item);
    } else if (dryRun && allowDraft && (status === "metadata_collected" || status === "embed_eligible")) {
      approvedItems.push(item);
    }
  }

  // Fail-closed synthetic mock prohibition:
  // When compiling for publication (dryRun: false), synthetic mock items from any test hook
  // are strictly prohibited from catalog publication.
  if (!dryRun) {
    for (const item of items) {
      const isMock =
        item.isMock === true ||
        item.metadata?.isMock === true ||
        item.provenance === "synthetic_mock" ||
        item.metadata?.provenance === "synthetic_mock" ||
        Boolean(item.syntheticOrigin) ||
        Boolean(item.metadata?.syntheticOrigin);

      if (isMock) {
        errors.push(
          `Item '${item.canonicalVideoId}': synthetic mock metadata is prohibited from production catalog publication. Real YouTube API metadata is required.`
        );
      }
    }
  }

  // Build historical allocation registry from every historical assigned ID in audit (FIX B)
  const historicalIdToVideoMap = new Map();
  const historicalVideoToIdMap = new Map();
  const reservedHistoricalIds = new Set();

  for (const item of items) {
    const videoId = item.canonicalVideoId;
    const assignedId = item.assignedLolixcoId;
    if (typeof assignedId === "number") {
      // Detect historical duplicate ownership and fail closed (FIX B requirement 5)
      if (historicalIdToVideoMap.has(assignedId)) {
        const existingVideoId = historicalIdToVideoMap.get(assignedId);
        if (existingVideoId !== videoId) {
          errors.push(
            `Historical duplicate Lolixco ID collision detected: assigned Lolixco ID ${assignedId} was assigned to both '${existingVideoId}' and '${videoId}'. Catalog compilation aborted to prevent corrupted ID ownership.`
          );
        }
      } else {
        historicalIdToVideoMap.set(assignedId, videoId);
      }
      historicalVideoToIdMap.set(videoId, assignedId);
      reservedHistoricalIds.add(assignedId);
    }
  }

  // Also reserve IDs from base catalog (e.g. demo edits 0-16 and any existing edits)
  for (const edit of currentBaseCatalog) {
    if (typeof edit.id === "number") {
      reservedHistoricalIds.add(edit.id);
    }
  }

  // Fail closed immediately if historical duplicate IDs exist in audit data
  if (errors.length > 0) {
    return {
      success: false,
      errors,
      warnings,
      compiledCount: 0,
      compiledEdits: currentBaseCatalog,
      dryRun,
    };
  }

  // 3. Fail-Closed Item Validation before compilation (FIX B, FIX D, FIX E)
  const newEdits = [];
  const seenLolixcoIds = new Set(currentBaseCatalog.slice(0, 17).map((e) => e.id));
  const seenYouTubeVideoIds = new Set();

  for (const item of approvedItems) {
    const videoId = item.canonicalVideoId;

    // A. Canonical YouTube video ID validation
    if (!videoId || typeof videoId !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      errors.push(`Item '${videoId}': invalid canonical YouTube video ID format.`);
      continue;
    }

    // B. Conflicting YouTube video identity check
    if (seenYouTubeVideoIds.has(videoId)) {
      errors.push(`Duplicate YouTube video ID conflict: '${videoId}' appears multiple times in candidate catalog.`);
    }
    seenYouTubeVideoIds.add(videoId);

    // Approval status validation (FIX A)
    if (item.contentReviewStatus !== "approved" && item.contentReviewStatus !== "published") {
      if (!dryRun || (isTargetingProduction && !allowDraft)) {
        errors.push(
          `Item '${videoId}': unapproved review status '${item.contentReviewStatus}'. Production publication strictly requires 'approved' or 'published' review status.`
        );
      }
    }

    // C. Synthetic mock & positive API provenance validation (FIX B)
    const isMock =
      item.isMock === true ||
      item.metadata?.isMock === true ||
      item.provenance === "synthetic_mock" ||
      item.metadata?.provenance === "synthetic_mock" ||
      Boolean(item.syntheticOrigin) ||
      Boolean(item.metadata?.syntheticOrigin);

    if ((isTargetingProduction || !dryRun) && !allowDraft) {
      if (isMock) {
        errors.push(
          `Item '${videoId}': synthetic mock metadata is prohibited from production catalog publication. Real YouTube API metadata is required.`
        );
      }

      if (item.provenance !== "youtube_data_api_v3" || item.metadata?.provenance !== "youtube_data_api_v3") {
        errors.push(
          `Item '${videoId}': missing or unverified API provenance ('${item.provenance}'). Positive evidence of genuine YouTube Data API v3 retrieval is required for production publication.`
        );
      }

      // Positive allowlisting for genuine successful retrieval (FIX C)
      if (item.metadataFetchStatus !== "fetched") {
        errors.push(
          `Item '${videoId}': unverified metadata retrieval status '${item.metadataFetchStatus}'. Positive evidence of successful API retrieval ('fetched') is required for production publication.`
        );
      }

      if (!item.metadata || item.canonicalVideoId !== item.metadata.canonicalVideoId) {
        errors.push(
          `Item '${videoId}': canonical YouTube ID mismatch between audit record ('${item.canonicalVideoId}') and metadata payload ('${item.metadata?.canonicalVideoId}').`
        );
      }
    }

    // D. Public availability and embedding eligibility check (FIX E)
    if (!item.metadata) {
      errors.push(`Item '${videoId}': missing metadata payload.`);
      continue;
    }

    if (item.metadata.privacyStatus !== "public") {
      errors.push(`Item '${videoId}': video is not public on YouTube (privacyStatus: '${item.metadata.privacyStatus}').`);
    }

    if (item.metadata.embeddable !== true) {
      errors.push(`Item '${videoId}': embedded playback is disabled or restricted on YouTube.`);
    }

    // E. Completeness: Real title and creator attribution (no synthetic fallbacks)
    const title = (item.metadata.title || "").trim();
    if (!title || title.startsWith("Curated Edit") || title.startsWith("YouTube Video")) {
      errors.push(`Item '${videoId}': missing genuine title metadata.`);
    }

    const channelTitle = (item.metadata.channelTitle || "").trim();
    if (!channelTitle || channelTitle === "Unknown Creator" || channelTitle === "YouTube Creator") {
      errors.push(`Item '${videoId}': missing genuine channel creator attribution.`);
    }

    const durationSec = item.metadata.durationSec ?? item.metadata.durationSeconds;
    if (typeof durationSec !== "number" || durationSec <= 0) {
      errors.push(`Item '${videoId}': invalid or missing duration metadata.`);
    }

    // F. Freshness verification (FIX D)
    const verificationTimestamp = item.lastMetadataVerification;
    if (!verificationTimestamp || isNaN(Date.parse(verificationTimestamp))) {
      errors.push(`Item '${videoId}': missing or invalid lastMetadataVerification timestamp.`);
    } else {
      const verifiedTime = new Date(verificationTimestamp).getTime();
      const currentTime = now ? new Date(now).getTime() : Date.now();
      const effectiveMaxAgeMs = typeof maxMetadataAgeMs === "number"
        ? maxMetadataAgeMs
        : (maxMetadataAgeDays || 30) * 24 * 60 * 60 * 1000;

      // Reject future-dated timestamps (tolerance: 5 minutes)
      if (verifiedTime > currentTime + (5 * 60 * 1000)) {
        errors.push(
          `Item '${videoId}': future-dated verification timestamp '${verificationTimestamp}' is invalid.`
        );
      } else if (currentTime - verifiedTime > effectiveMaxAgeMs) {
        const ageDays = ((currentTime - verifiedTime) / (24 * 60 * 60 * 1000)).toFixed(1);
        const maxDays = (effectiveMaxAgeMs / (24 * 60 * 60 * 1000)).toFixed(0);
        errors.push(
          `Item '${videoId}': metadata verification is stale (${ageDays} days old, max allowed is ${maxDays} days). Fresh YouTube API verification is required before publication.`
        );
      }
    }

    // G. Explicit confirmed format (FIX B)
    if (item.format !== "video" && item.format !== "short") {
      errors.push(`Item '${videoId}': unconfirmed format '${item.format}'. Format must be explicitly confirmed as 'video' or 'short'.`);
    } else if (item.format === "short") {
      // Positively require formatConfirmed === true
      if (item.formatConfirmed !== true) {
        errors.push(
          `Item '${videoId}': candidate portrait short requires positive format confirmation (formatConfirmed: true). Explicit editorial format confirmation is required before publication.`
        );
      }
      // Positively require confirmedFormat === "short"
      if (item.confirmedFormat !== "short") {
        errors.push(
          `Item '${videoId}': candidate portrait short requires confirmedFormat: 'short'. Explicit editorial format confirmation is required before publication.`
        );
      }
    } else if (item.format === "video") {
      if (item.formatConfirmed === true && item.confirmedFormat !== "video") {
        errors.push(
          `Item '${videoId}': contradictory format confirmation. Format is 'video' but confirmedFormat is '${item.confirmedFormat}'.`
        );
      }
      if (item.confirmedFormat === "short") {
        errors.push(
          `Item '${videoId}': contradictory format confirmation. Format is 'video' but confirmedFormat is 'short'.`
        );
      }
    }

    // H. Canonical category & registered fandom check
    const projected = projectToPublicYouTubeEdit(item);

    if (!CANONICAL_CATEGORIES.includes(projected.category)) {
      errors.push(`Item '${videoId}': non-canonical category '${projected.category}'. Must be one of: ${CANONICAL_CATEGORIES.join(", ")}`);
    }

    for (const fId of projected.fandomIds) {
      if (!registeredSlugs.has(fId)) {
        errors.push(`Item '${videoId}': unregistered fandom ID '${fId}'. Must exist in FANDOM_REGISTRY.`);
      }
    }

    // I. Allocate stable ID and verify ranges (FIX B)
    // 1. Allow an existing video to reclaim its original stable ID after becoming available again (FIX B requirement 4)
    if (historicalVideoToIdMap.has(videoId)) {
      item.assignedLolixcoId = historicalVideoToIdMap.get(videoId);
    }

    // 2. Prevent taking an ID previously owned by another video (FIX B requirements 1-3)
    if (!item.assignedLolixcoId) {
      item.assignedLolixcoId = allocateStableId(item, Array.from(reservedHistoricalIds));
      reservedHistoricalIds.add(item.assignedLolixcoId);
      historicalIdToVideoMap.set(item.assignedLolixcoId, videoId);
      historicalVideoToIdMap.set(videoId, item.assignedLolixcoId);
    } else {
      // Verify that this video actually owns this assignedLolixcoId
      const ownerVideoId = historicalIdToVideoMap.get(item.assignedLolixcoId);
      if (ownerVideoId && ownerVideoId !== videoId) {
        errors.push(
          `ID conflict for item '${videoId}': assigned Lolixco ID ${item.assignedLolixcoId} is already owned by video '${ownerVideoId}'. One video cannot take an ID previously owned by another.`
        );
      }
    }
    projected.id = item.assignedLolixcoId;

    // Check ID range and reject format changes conflicting with stable ID ranges (FIX C requirement 7)
    if (projected.format === "short") {
      if (projected.id < 200 || projected.id > 299) {
        errors.push(
          `Short '${videoId}': assigned ID ${projected.id} outside allowed range [200..299]. Format changes conflicting with stable ID ranges are prohibited.`
        );
      }
    } else {
      if (projected.id < 100 || projected.id > 199) {
        errors.push(
          `Landscape video '${videoId}': assigned ID ${projected.id} outside allowed range [100..199]. Format changes conflicting with stable ID ranges are prohibited.`
        );
      }
    }

    // Baseline collision and cross-batch uniqueness check (FIX E)
    if (projected.id <= 16) {
      errors.push(`ID collision with baseline demo edit: ${projected.id}`);
    }

    if (seenLolixcoIds.has(projected.id)) {
      errors.push(`Duplicate Lolixco ID collision: ID ${projected.id} is assigned multiple times.`);
    }
    seenLolixcoIds.add(projected.id);

    newEdits.push(projected);
  }

  // If any validation error occurred, abort before writing
  if (errors.length > 0) {
    return {
      success: false,
      errors,
      warnings,
      compiledCount: 0,
      compiledEdits: currentBaseCatalog,
      dryRun,
    };
  }

  const finalEdits = [...currentBaseCatalog.slice(0, 17), ...newEdits];

  // 4. Write to output if not dryRun (FIX F: atomic writes with transactional rollback & backup visibility)
  let writtenTo = null;
  if (!dryRun) {
    if (isTestIsolationActive()) {
      if (isProtectedProductionPath(outputPath) || isProtectedAuditPath(auditFilePath)) {
        return {
          success: false,
          errors: [
            `Production catalog compilation blocked: Destination '${outputPath}' or audit source '${auditFilePath}' resolves to a protected production path under active test isolation. Writes to production catalog or canonical audit files are strictly prohibited in test mode.`,
          ],
          warnings,
          compiledCount: 0,
          compiledEdits: currentBaseCatalog,
          dryRun,
        };
      }
    }

    const catalogBackupPath = existsSync(outputPath) ? `${outputPath}.tmp.bak.${process.pid}.${Date.now()}` : null;
    const auditBackupPath = existsSync(auditFilePath) ? `${auditFilePath}.tmp.bak.${process.pid}.${Date.now()}` : null;

    if (catalogBackupPath) {
      copyFileSync(outputPath, catalogBackupPath);
    }
    if (auditBackupPath) {
      copyFileSync(auditFilePath, auditBackupPath);
    }

    try {
      createAuditBackup(auditFilePath);
    } catch (backupErr) {
      if (catalogBackupPath && existsSync(catalogBackupPath)) unlinkSync(catalogBackupPath);
      if (auditBackupPath && existsSync(auditBackupPath)) unlinkSync(auditBackupPath);
      return {
        success: false,
        errors: [`Audit backup failure prior to compilation: ${backupErr.message}`],
        warnings,
        compiledCount: 0,
        compiledEdits: currentBaseCatalog,
        dryRun,
      };
    }

    try {
      const code = generateYouTubeEditsTs(finalEdits);
      safeAtomicWriteFileSync(outputPath, code);
      writtenTo = outputPath;

      // Transition approved items to published status and record in audit history
      for (const item of items) {
        if (item.contentReviewStatus === "approved") {
          item.contentReviewStatus = "published";
          if (!Array.isArray(item.auditHistory)) item.auditHistory = [];
          item.auditHistory.push({
            date: new Date().toISOString(),
            event: "publication",
            status: "published",
            assignedLolixcoId: item.assignedLolixcoId,
          });
        }
      }

      auditData.items = items;
      auditData.lastPublished = new Date().toISOString();
      safeAtomicWriteFileSync(auditFilePath, JSON.stringify(auditData, null, 2));

      // Clean up temporary recovery backups
      if (catalogBackupPath && existsSync(catalogBackupPath)) {
        unlinkSync(catalogBackupPath);
      }
      if (auditBackupPath && existsSync(auditBackupPath)) {
        unlinkSync(auditBackupPath);
      }
    } catch (writeErr) {
      // Deterministic rollback: restore prior state
      if (catalogBackupPath && existsSync(catalogBackupPath)) {
        try {
          copyFileSync(catalogBackupPath, outputPath);
          unlinkSync(catalogBackupPath);
        } catch {
          // Ignore secondary cleanup error
        }
      }
      if (auditBackupPath && existsSync(auditBackupPath)) {
        try {
          copyFileSync(auditBackupPath, auditFilePath);
          unlinkSync(auditBackupPath);
        } catch {
          // Ignore secondary cleanup error
        }
      }
      return {
        success: false,
        errors: [
          `Catalog publication write failed: ${writeErr.message}. Deterministic rollback executed: catalog and audit files restored to pre-compilation state.`,
        ],
        warnings,
        compiledCount: 0,
        compiledEdits: currentBaseCatalog,
        dryRun,
      };
    }
  }

  return {
    success: true,
    errors: [],
    warnings,
    baseCount: currentBaseCatalog.length,
    newCount: newEdits.length,
    compiledCount: newEdits.length,
    totalCount: finalEdits.length,
    compiledEdits: finalEdits,
    dryRun,
    writtenTo,
  };
}

/**
 * CLI Runner with explicit argument parsing, preview mode, and exit codes.
 */
export async function runCompilerCli(args = process.argv.slice(2)) {
  loadEnvConfig();

  const options = {
    auditFilePath: CANONICAL_AUDIT_PATH,
    outputPath: CANONICAL_OUTPUT_PATH,
    publish: false,
    review: false,
    allowDraft: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`
Lolixco YouTube Catalog Compiler CLI

Usage:
  node scripts/compile-youtube-catalog.mjs [options]

Modes:
  (default)             Preview mode: Validates approved items and displays compilation preview without writing
  --publish, --write    Explicit publication: Validates and writes compiled catalog to src/data/edits.ts
  --review              Summary mode: Inspects audit log and prints review status breakdown

Options:
  --audit-file <path>   Audit file path (default: content/audit/youtube-intake-audit.json)
  --output <path>       Target catalog file (default: src/data/edits.ts)
  --allow-draft         Allow compiling draft items (embed_eligible) for staging tests
  -h, --help            Show this help message
`);
      return 0;
    } else if (arg === "--publish" || arg === "--write") {
      options.publish = true;
    } else if (arg === "--preview") {
      options.publish = false;
    } else if (arg === "--review") {
      options.review = true;
    } else if (arg === "--audit-file" && args[i + 1]) {
      options.auditFilePath = resolve(args[++i]);
    } else if (arg === "--output" && args[i + 1]) {
      options.outputPath = resolve(args[++i]);
    } else if (arg === "--allow-draft") {
      options.allowDraft = true;
    }
  }

  // FIX A: Disallow combining --publish with --allow-draft
  if (options.publish && options.allowDraft) {
    console.error("\n❌ Compilation aborted: Combining --publish with --allow-draft is prohibited. Production writes strictly require explicit 'approved' or 'published' review status.");
    return 1;
  }

  if (options.review) {
    if (!existsSync(options.auditFilePath)) {
      console.log(`No audit file found at: ${options.auditFilePath}`);
      return 0;
    }
    try {
      const data = JSON.parse(readFileSync(options.auditFilePath, "utf-8"));
      const items = Array.isArray(data.items) ? data.items : [];
      console.log(`\n=== YouTube Intake Audit Summary (${items.length} total entries) ===`);
      const counts = {};
      for (const item of items) {
        counts[item.contentReviewStatus] = (counts[item.contentReviewStatus] || 0) + 1;
      }
      for (const [st, c] of Object.entries(counts)) {
        console.log(`  ${st.padEnd(20)}: ${c}`);
      }
      return 0;
    } catch (err) {
      console.error(`Failed to read audit file: ${err.message}`);
      return 1;
    }
  }

  console.log(`Compiling YouTube catalog from audit trail: ${options.auditFilePath}`);
  console.log(`Target output: ${options.outputPath}`);
  if (!options.publish) {
    console.log("Mode: PREVIEW (pass --publish to write to production catalog)");
  } else {
    console.log("Mode: PUBLISH (writing approved edits to production catalog)");
  }

  if (isTestIsolationActive() && isProtectedAuditPath(options.auditFilePath)) {
    console.error(`\n❌ Compilation aborted: Accessing canonical audit file '${options.auditFilePath}' is prohibited under active test isolation.`);
    return 1;
  }

  if (options.publish && isTestIsolationActive() && isProtectedProductionPath(options.outputPath)) {
    console.error(`\n❌ Compilation aborted: Production writes to '${options.outputPath}' are prohibited under active test isolation.`);
    return 1;
  }

  const result = await compileYouTubeCatalog({
    auditFilePath: options.auditFilePath,
    outputPath: options.outputPath,
    dryRun: !options.publish,
    allowDraft: options.allowDraft,
  });

  if (!result.success) {
    console.error("\n❌ Compilation aborted. Fail-closed validation errors:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    return 1;
  }

  console.log(`\n✔ Validation and compilation successful!`);
  console.log(`  Baseline Demo Edits: 17`);
  console.log(`  New Approved YouTube Edits: ${result.newCount}`);
  console.log(`  Total Catalog Size: ${result.totalCount}`);

  if (result.writtenTo) {
    console.log(`  ✔ Written to: ${result.writtenTo}`);
  } else {
    console.log(`  [PREVIEW ONLY] Catalog validated cleanly. Run with --publish to write.`);
  }

  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCompilerCli().then((code) => {
    process.exit(code);
  });
}
