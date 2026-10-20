#!/usr/bin/env node
/**
 * Owner Review and Approval Tool for YouTube Ingestion Batches.
 *
 * Implements FIX E:
 * - Lists pending records requiring editorial review.
 * - Displays original YouTube metadata, creator, duration, and embeddability.
 * - Displays owner category, fandom associations, and conflict warnings.
 * - Confirms landscape ("video") or portrait ("short") content format.
 * - Approves or rejects individual items with explicit owner consent.
 * - Strictly prevents mock, unfetched, private, or embed-restricted items from approval.
 * - Preserves complete audit history for every status transition.
 * - Atomic writes with timestamped backup preservation.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

try {
  register("./tests/ts-hooks.mjs", new URL("../", import.meta.url));
} catch {
  // If already registered, proceed
}

import {
  CANONICAL_AUDIT_PATH,
  loadFandomRegistry,
  validateAuditDocument,
  safeAtomicWriteFileSync,
  createAuditBackup,
  restoreAuditBackup,
  isProtectedProductionPath,
  isProtectedAuditPath,
} from "./youtube-importer.mjs";
import { isTestIsolationActive } from "./youtube-api.mjs";
import { CANONICAL_CATEGORIES } from "./youtube-editorial.mjs";

/**
 * Lists all audit records pending owner review.
 */
export async function listPendingReviewItems(auditFilePath = CANONICAL_AUDIT_PATH) {
  if (isTestIsolationActive() && isProtectedProductionPath(auditFilePath)) {
    return {
      success: false,
      errors: [
        `Review listing blocked: Target audit path '${auditFilePath}' resolves to a protected production path under active test isolation.`,
      ],
      items: [],
    };
  }

  if (!existsSync(auditFilePath)) {
    return { success: false, errors: [`Audit file not found at: ${auditFilePath}`], items: [] };
  }

  const raw = readFileSync(auditFilePath, "utf-8");
  let auditData;
  try {
    auditData = JSON.parse(raw);
  } catch (err) {
    return { success: false, errors: [`Corrupted audit JSON: ${err.message}`], items: [] };
  }

  const validation = validateAuditDocument(auditData, auditFilePath);
  if (!validation.valid) {
    return { success: false, errors: validation.errors, items: [] };
  }

  const pendingStatuses = new Set([
    "embed_eligible",
    "needs_recheck",
    "needs_review",
    "metadata_collected",
    "submitted",
  ]);

  const pendingItems = auditData.items.filter((i) => pendingStatuses.has(i.contentReviewStatus));

  return {
    success: true,
    totalInAudit: auditData.items.length,
    pendingCount: pendingItems.length,
    items: pendingItems,
  };
}

/**
 * Retrieves detailed record information for a single video.
 */
export async function inspectReviewItem(videoId, auditFilePath = CANONICAL_AUDIT_PATH) {
  if (isTestIsolationActive() && isProtectedProductionPath(auditFilePath)) {
    return {
      success: false,
      error: `Review inspection blocked: Target audit path '${auditFilePath}' resolves to a protected production path under active test isolation.`,
    };
  }

  if (!existsSync(auditFilePath)) {
    return { success: false, error: `Audit file not found at: ${auditFilePath}` };
  }

  const auditData = JSON.parse(readFileSync(auditFilePath, "utf-8"));
  const validation = validateAuditDocument(auditData, auditFilePath);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join("; ") };
  }

  const item = auditData.items.find((i) => i.canonicalVideoId === videoId);
  if (!item) {
    return { success: false, error: `Record with video ID '${videoId}' not found in audit file.` };
  }

  return { success: true, item };
}

/**
 * Explicitly confirms the content format ("video" or "short") for a candidate item.
 * Required for portrait Shorts prior to approval (FIX C).
 */
export async function confirmItemFormat(videoId, format, options = {}) {
  const {
    auditFilePath = CANONICAL_AUDIT_PATH,
    notes = "Format explicitly confirmed by owner review",
    reviewer = "owner",
    dryRun = false,
  } = options;

  if (isTestIsolationActive() && isProtectedProductionPath(auditFilePath)) {
    return {
      success: false,
      errors: [
        `Format confirmation blocked: Target audit path '${auditFilePath}' resolves to a protected production path under active test isolation.`,
      ],
    };
  }

  if (!existsSync(auditFilePath)) {
    return { success: false, errors: [`Audit file not found at: ${auditFilePath}`] };
  }

  let auditData;
  try {
    auditData = JSON.parse(readFileSync(auditFilePath, "utf-8"));
  } catch (err) {
    return { success: false, errors: [`Failed to parse audit JSON: ${err.message}`] };
  }

  const validation = validateAuditDocument(auditData, auditFilePath);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const item = auditData.items.find((i) => i.canonicalVideoId === videoId);
  if (!item) {
    return { success: false, errors: [`Video ID '${videoId}' not found in audit log.`] };
  }

  if (format !== "video" && format !== "short") {
    return {
      success: false,
      errors: [`Invalid format '${format}'. Format must be either 'video' or 'short'.`],
    };
  }

  // Reject unsupported format changes that conflict with existing stable ID ranges (FIX C requirement 7)
  if (typeof item.assignedLolixcoId === "number") {
    if (format === "short" && (item.assignedLolixcoId < 200 || item.assignedLolixcoId > 299)) {
      return {
        success: false,
        errors: [
          `Format conflict for video '${videoId}': Cannot change format to 'short'. Existing assigned Lolixco ID ${item.assignedLolixcoId} is in the landscape range [100..199]. Format changes conflicting with stable ID ranges are prohibited.`,
        ],
      };
    }
    if (format === "video" && (item.assignedLolixcoId < 100 || item.assignedLolixcoId > 199)) {
      return {
        success: false,
        errors: [
          `Format conflict for video '${videoId}': Cannot change format to 'video'. Existing assigned Lolixco ID ${item.assignedLolixcoId} is in the shorts range [200..299]. Format changes conflicting with stable ID ranges are prohibited.`,
        ],
      };
    }
  }

  const previousFormat = item.format;
  item.format = format;
  item.confirmedFormat = format;
  item.formatConfirmed = true;

  if (!Array.isArray(item.auditHistory)) {
    item.auditHistory = [];
  }

  item.auditHistory.push({
    date: new Date().toISOString(),
    event: "format_confirmation",
    previousFormat,
    confirmedFormat: format,
    confirmedBy: reviewer,
    notes,
  });

  if (!dryRun) {
    try {
      createAuditBackup(auditFilePath);
    } catch (err) {
      return { success: false, errors: [`Audit backup failure: ${err.message}`] };
    }
    auditData.lastUpdated = new Date().toISOString();
    safeAtomicWriteFileSync(auditFilePath, JSON.stringify(auditData, null, 2));
  }

  return {
    success: true,
    videoId,
    confirmedFormat: format,
    formatConfirmed: true,
    item,
  };
}

/**
 * Approves an individual video for catalog publication with fail-closed safety checks.
 */
export async function approveReviewItem(videoId, options = {}) {
  const {
    format,
    notes = "Approved by owner review",
    auditFilePath = CANONICAL_AUDIT_PATH,
    dryRun = false,
  } = options;

  if (isTestIsolationActive() && isProtectedProductionPath(auditFilePath)) {
    return {
      success: false,
      errors: [
        `Review approval blocked: Target audit path '${auditFilePath}' resolves to a protected production path under active test isolation.`,
      ],
    };
  }

  if (!existsSync(auditFilePath)) {
    return { success: false, errors: [`Audit file not found at: ${auditFilePath}`] };
  }

  let auditData;
  try {
    auditData = JSON.parse(readFileSync(auditFilePath, "utf-8"));
  } catch (err) {
    return { success: false, errors: [`Failed to parse audit JSON: ${err.message}`] };
  }

  const validation = validateAuditDocument(auditData, auditFilePath);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const item = auditData.items.find((i) => i.canonicalVideoId === videoId);
  if (!item) {
    return { success: false, errors: [`Video ID '${videoId}' not found in audit log.`] };
  }

  const errors = [];

  // FIX E Validation: Never grant approval automatically because video is embeddable.
  // Must verify genuine positive API retrieval, availability, format, and metadata integrity.

  // 1. Synthetic mock rejection
  const isSynthetic =
    item.isMock === true ||
    item.metadata?.isMock === true ||
    item.provenance === "synthetic_mock" ||
    item.metadata?.provenance === "synthetic_mock" ||
    Boolean(item.syntheticOrigin) ||
    Boolean(item.metadata?.syntheticOrigin);

  if (isSynthetic) {
    errors.push(`Video '${videoId}' is marked as synthetic mock metadata. Real YouTube API records are required for approval.`);
  }

  // 2. Verified API provenance
  if (item.provenance !== "youtube_data_api_v3" || item.metadata?.provenance !== "youtube_data_api_v3") {
    errors.push(`Video '${videoId}' missing positive 'youtube_data_api_v3' provenance.`);
  }

  // 3. Successful metadata fetch status (FIX C)
  if (item.metadataFetchStatus !== "fetched" || !item.metadata) {
    errors.push(`Video '${videoId}' metadata retrieval status is '${item.metadataFetchStatus}' (must be 'fetched').`);
  }

  // 4. Public availability and embeddability
  if (item.metadata) {
    if (item.metadata.privacyStatus !== "public") {
      errors.push(`Video '${videoId}' is not public on YouTube (privacyStatus: '${item.metadata.privacyStatus}').`);
    }
    if (item.metadata.embeddable !== true) {
      errors.push(`Video '${videoId}' has embedded playback disabled or restricted on YouTube.`);
    }
    if (!item.metadata.title || item.metadata.title.trim().length < 3) {
      errors.push(`Video '${videoId}' is missing valid title metadata.`);
    }
    if (!item.metadata.channelTitle) {
      errors.push(`Video '${videoId}' is missing channel creator attribution.`);
    }
  }

  // 5. Canonical Category & Registered Fandoms
  const effectiveCat = item.category || item.ownerCategory;
  if (!effectiveCat || !CANONICAL_CATEGORIES.includes(effectiveCat)) {
    errors.push(`Video '${videoId}' has invalid category '${effectiveCat}'. Allowed: ${CANONICAL_CATEGORIES.join(", ")}`);
  }

  const registeredFandoms = await loadFandomRegistry();
  const registeredSlugs = new Set(registeredFandoms.map((f) => f.id));
  const fandoms = item.fandomIds || [];
  for (const fId of fandoms) {
    if (!registeredSlugs.has(fId)) {
      errors.push(`Video '${videoId}' has unregistered fandom ID '${fId}'.`);
    }
  }

  // 6. Confirmed Content Format ("video" or "short") (FIX B)
  let targetFormat = format;
  const isCandidateShort =
    targetFormat === "short" ||
    (!targetFormat && (item.confirmedFormat === "short" || item.format === "short" || item.inferredFormat === "short"));

  if (isCandidateShort) {
    // For portrait Shorts, require recorded manual confirmation before approval!
    // A /shorts/ URL or <= 180s duration alone does not prove portrait dimensions.
    const isExplicitlyConfirmedNow = options.confirmShort === true || options.confirmFormat === "short";
    const hasRecordedFormatConfirmation = item.formatConfirmed === true && item.confirmedFormat === "short";

    if (!hasRecordedFormatConfirmation && !isExplicitlyConfirmedNow) {
      errors.push(
        `Video '${videoId}': Candidate portrait Short requires recorded manual format confirmation before approval. A /shorts/ URL or <=180s duration does not prove portrait dimensions. Confirm format via --confirm-format or pass format: 'short'.`
      );
    } else {
      targetFormat = "short";
    }
  } else {
    // Candidate landscape video
    targetFormat = targetFormat || item.confirmedFormat || item.format || "video";
    if (targetFormat !== "video") {
      errors.push(`Video '${videoId}' has invalid format '${targetFormat}'. Must be 'video' or 'short'.`);
    }
    // Reject contradictory format confirmation
    if (item.formatConfirmed === true && item.confirmedFormat !== "video") {
      errors.push(`Video '${videoId}': contradictory format confirmation. Target is 'video' but confirmedFormat is '${item.confirmedFormat}'.`);
    }
    if (item.confirmedFormat === "short") {
      errors.push(`Video '${videoId}': contradictory format confirmation. Target is 'video' but confirmedFormat is 'short'.`);
    }
  }

  // Reject unsupported format changes that conflict with existing stable ID ranges (FIX C requirement 7)
  if (typeof item.assignedLolixcoId === "number") {
    if (targetFormat === "short" && (item.assignedLolixcoId < 200 || item.assignedLolixcoId > 299)) {
      errors.push(
        `Format conflict for video '${videoId}': Cannot approve as 'short'. Existing assigned Lolixco ID ${item.assignedLolixcoId} is in the landscape range [100..199]. Format changes conflicting with stable ID ranges are prohibited.`
      );
    }
    if (targetFormat === "video" && (item.assignedLolixcoId < 100 || item.assignedLolixcoId > 199)) {
      errors.push(
        `Format conflict for video '${videoId}': Cannot approve as 'video'. Existing assigned Lolixco ID ${item.assignedLolixcoId} is in the shorts range [200..299]. Format changes conflicting with stable ID ranges are prohibited.`
      );
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Transition status and record audit history
  const previousStatus = item.contentReviewStatus;
  item.contentReviewStatus = "approved";
  item.format = targetFormat;
  item.confirmedFormat = targetFormat;
  item.formatConfirmed = true;

  if (!Array.isArray(item.auditHistory)) {
    item.auditHistory = [];
  }

  if (targetFormat === "short" && (options.confirmShort === true || options.confirmFormat === "short")) {
    item.auditHistory.push({
      date: new Date().toISOString(),
      event: "format_confirmation",
      confirmedFormat: "short",
      confirmedBy: options.approvedBy || "owner",
      notes: "Explicit format confirmation recorded during review approval",
    });
  }

  item.auditHistory.push({
    date: new Date().toISOString(),
    event: "owner_approval",
    from: previousStatus,
    to: "approved",
    confirmedFormat: targetFormat,
    formatConfirmed: true,
    notes,
  });

  if (!dryRun) {
    try {
      createAuditBackup(auditFilePath);
    } catch (err) {
      return { success: false, errors: [`Audit backup failure: ${err.message}`] };
    }
    auditData.lastUpdated = new Date().toISOString();
    safeAtomicWriteFileSync(auditFilePath, JSON.stringify(auditData, null, 2));
  }

  return {
    success: true,
    videoId,
    previousStatus,
    newStatus: "approved",
    confirmedFormat: targetFormat,
    item,
  };
}

/**
 * Rejects an individual video with recorded justification.
 */
export async function rejectReviewItem(videoId, options = {}) {
  const {
    reason = "Rejected by owner review",
    auditFilePath = CANONICAL_AUDIT_PATH,
    dryRun = false,
  } = options;

  if (isTestIsolationActive() && isProtectedProductionPath(auditFilePath)) {
    return {
      success: false,
      errors: [
        `Review rejection blocked: Target audit path '${auditFilePath}' resolves to a protected production path under active test isolation.`,
      ],
    };
  }

  if (!existsSync(auditFilePath)) {
    return { success: false, errors: [`Audit file not found at: ${auditFilePath}`] };
  }

  const auditData = JSON.parse(readFileSync(auditFilePath, "utf-8"));
  const validation = validateAuditDocument(auditData, auditFilePath);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const item = auditData.items.find((i) => i.canonicalVideoId === videoId);
  if (!item) {
    return { success: false, errors: [`Video ID '${videoId}' not found in audit log.`] };
  }

  const previousStatus = item.contentReviewStatus;
  item.contentReviewStatus = "rejected";

  if (!Array.isArray(item.auditHistory)) {
    item.auditHistory = [];
  }

  item.auditHistory.push({
    date: new Date().toISOString(),
    event: "owner_rejection",
    from: previousStatus,
    to: "rejected",
    reason,
  });

  if (!dryRun) {
    try {
      createAuditBackup(auditFilePath);
    } catch (err) {
      return { success: false, errors: [`Audit backup failure: ${err.message}`] };
    }
    auditData.lastUpdated = new Date().toISOString();
    safeAtomicWriteFileSync(auditFilePath, JSON.stringify(auditData, null, 2));
  }

  return {
    success: true,
    videoId,
    previousStatus,
    newStatus: "rejected",
    item,
  };
}

/**
 * Approves all eligible pending items in a given batch.
 */
export async function approveBatch(batchId, options = {}) {
  const { auditFilePath = CANONICAL_AUDIT_PATH, dryRun = false } = options;

  if (isTestIsolationActive() && isProtectedProductionPath(auditFilePath)) {
    return {
      success: false,
      errors: [
        `Batch approval blocked: Target audit path '${auditFilePath}' resolves to a protected production path under active test isolation.`,
      ],
      approvedCount: 0,
      totalEligible: 0,
      warnings: [],
      auditFilePath,
    };
  }

  if (!existsSync(auditFilePath)) {
    return { success: false, errors: [`Audit file not found at: ${auditFilePath}`] };
  }

  const auditData = JSON.parse(readFileSync(auditFilePath, "utf-8"));
  const validation = validateAuditDocument(auditData, auditFilePath);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const batchItems = Array.isArray(batchId)
    ? auditData.items.filter((i) => batchId.includes(i.canonicalVideoId))
    : auditData.items.filter((i) => i.batchId === batchId);
  if (batchItems.length === 0) {
    return { success: false, errors: [`No items found for batch ID '${batchId}'.`] };
  }

  const results = [];
  const errors = [];

  for (const item of batchItems) {
    if (item.contentReviewStatus === "approved" || item.contentReviewStatus === "published") {
      results.push({ videoId: item.canonicalVideoId, status: item.contentReviewStatus, skipped: true });
      continue;
    }

    const appRes = await approveReviewItem(item.canonicalVideoId, {
      ...options,
      dryRun: true, // We will write once in bulk
    });

    if (appRes.success) {
      if (appRes.item) {
        Object.assign(item, appRes.item);
      }
      results.push({ videoId: item.canonicalVideoId, status: "approved" });
    } else {
      errors.push(`Video '${item.canonicalVideoId}': ${appRes.errors.join("; ")}`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
      batchId,
      approvedCount: results.filter((r) => r.status === "approved" && !r.skipped).length,
    };
  }

  if (!dryRun) {
    try {
      createAuditBackup(auditFilePath);
    } catch (err) {
      return { success: false, errors: [`Audit backup failure: ${err.message}`] };
    }
    auditData.lastUpdated = new Date().toISOString();
    safeAtomicWriteFileSync(auditFilePath, JSON.stringify(auditData, null, 2));
  }

  return {
    success: true,
    batchId,
    approvedCount: results.length,
    results,
  };
}

/**
 * CLI Runner for owner batch review.
 */
export async function runReviewCli(args = process.argv.slice(2)) {
  let auditFilePath = CANONICAL_AUDIT_PATH;
  let command = "help";
  let targetId = null;
  let format = null;
  let notes = null;
  let reason = null;
  let restorePath = null;
  let batchId = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      command = "help";
    } else if (arg === "--list" || arg === "--pending") {
      command = "list";
    } else if ((arg === "--show" || arg === "--inspect") && args[i + 1]) {
      command = "show";
      targetId = args[++i];
    } else if (arg === "--confirm-format" && args[i + 1]) {
      command = "confirm-format";
      targetId = args[++i];
    } else if (arg === "--approve" && args[i + 1]) {
      command = "approve";
      targetId = args[++i];
    } else if (arg === "--reject" && args[i + 1]) {
      command = "reject";
      targetId = args[++i];
    } else if (arg === "--approve-batch" && args[i + 1]) {
      command = "approve-batch";
      batchId = args[++i];
    } else if (arg === "--restore" && args[i + 1]) {
      command = "restore";
      restorePath = args[++i];
    } else if (arg === "--format" && args[i + 1]) {
      format = args[++i];
    } else if (arg === "--notes" && args[i + 1]) {
      notes = args[++i];
    } else if (arg === "--reason" && args[i + 1]) {
      reason = args[++i];
    } else if (arg === "--audit-file" && args[i + 1]) {
      auditFilePath = resolve(args[++i]);
    }
  }

  if (command === "help") {
    console.log(`
Lolixco YouTube Owner Editorial Review CLI

Usage:
  node scripts/review-youtube-batch.mjs [command] [options]

Commands:
  --list, --pending               List all imported items pending owner review
  --show <videoId>                Display full metadata and classification for a video
  --confirm-format <videoId>      Confirm format (video or short) before approval (required for Shorts)
  --approve <videoId>             Approve an item for catalog publication
  --reject <videoId>              Reject an item with recorded reason
  --approve-batch <batchId>       Approve all eligible items in an imported batch
  --restore <backupFile>          Restore audit file from a local timestamped backup

Options:
  --format <video|short>          Explicitly confirm format as landscape video or portrait short
  --notes "<text>"                Optional curator notes for approval audit log
  --reason "<text>"               Reason for rejection
  --audit-file <path>             Path to intake audit file (default: content/audit/youtube-intake-audit.json)
  -h, --help                      Show this help message

Batch 01 Review Example:
  # 1. List pending intake items
  node scripts/review-youtube-batch.mjs --list

  # 2. Inspect an item's YouTube metadata and classifications
  node scripts/review-youtube-batch.mjs --show dQw4w9WgXcQ

  # 3. Approve as landscape video
  node scripts/review-youtube-batch.mjs --approve dQw4w9WgXcQ --format video

  # 4. Or approve entire batch after verification
  node scripts/review-youtube-batch.mjs --approve-batch 01
`);
    return 0;
  }

  if (["list", "show", "restore", "confirm-format", "approve", "reject", "approve-batch"].includes(command)) {
    if (isTestIsolationActive() && isProtectedProductionPath(auditFilePath)) {
      console.error(`\n❌ Review command '${command}' aborted: Target audit path '${auditFilePath}' resolves to a protected production path under active test isolation.`);
      return 1;
    }
  }

  if (command === "restore" && restorePath) {
    if (isTestIsolationActive() && isProtectedProductionPath(restorePath)) {
      console.error(`\n❌ Review restore aborted: Source backup path '${restorePath}' resolves to a protected production path under active test isolation.`);
      return 1;
    }
  }

  if (command === "restore") {
    console.log(`Restoring audit file from: ${restorePath}`);
    try {
      restoreAuditBackup(restorePath, auditFilePath);
      console.log(`✅ Audit file restored successfully to: ${auditFilePath}`);
      return 0;
    } catch (err) {
      console.error(`❌ Restoration failed: ${err.message}`);
      return 1;
    }
  }

  if (command === "list") {
    const res = await listPendingReviewItems(auditFilePath);
    if (!res.success) {
      console.error(`❌ Error listing items: ${res.errors.join("; ")}`);
      return 1;
    }

    console.log(`\n=== Pending YouTube Intake Review (${res.pendingCount} of ${res.totalInAudit} total records) ===\n`);
    if (res.items.length === 0) {
      console.log("No records currently pending review.");
      return 0;
    }

    for (const item of res.items) {
      console.log(`- [${item.canonicalVideoId}] ${item.metadata?.title || item.submittedUrl}`);
      console.log(`  Status   : ${item.contentReviewStatus}`);
      console.log(`  Category : ${item.category} | Fandoms: [${(item.fandomIds || []).join(", ")}] | Format: ${item.format}`);
      console.log(`  Creator  : ${item.metadata?.channelTitle || "Unknown"} | Duration: ${item.metadata?.durationFormatted || "Unknown"}`);
      if (item.validationWarnings?.length > 0) {
        console.log(`  Warnings : ${item.validationWarnings.join("; ")}`);
      }
      console.log("");
    }
    return 0;
  }

  if (command === "show") {
    const res = await inspectReviewItem(targetId, auditFilePath);
    if (!res.success) {
      console.error(`❌ ${res.error}`);
      return 1;
    }
    const item = res.item;
    console.log(`\n=== YouTube Record Details: ${item.canonicalVideoId} ===`);
    console.log(`Title            : ${item.metadata?.title || "N/A"}`);
    console.log(`Channel / Creator: ${item.metadata?.channelTitle || "N/A"} (${item.metadata?.channelId || "N/A"})`);
    console.log(`Duration         : ${item.metadata?.durationFormatted || "N/A"} (${item.metadata?.durationSec || 0}s)`);
    console.log(`Privacy Status   : ${item.metadata?.privacyStatus || "N/A"}`);
    console.log(`Embeddable       : ${item.metadata?.embeddable === true ? "YES" : "NO"}`);
    console.log(`Provenance       : ${item.provenance} (fetchStatus: ${item.metadataFetchStatus})`);
    console.log(`Review Status    : ${item.contentReviewStatus}`);
    console.log(`Category         : ${item.category} (owner: ${item.ownerCategory})`);
    console.log(`Fandoms          : [${(item.fandomIds || []).join(", ")}]`);
    console.log(`Format           : ${item.format}`);
    console.log(`Assigned ID      : ${item.assignedLolixcoId || "None (allocated at compilation)"}`);
    if (item.validationWarnings?.length > 0) {
      console.log(`Warnings         :\n  - ${item.validationWarnings.join("\n  - ")}`);
    }
    if (item.auditHistory?.length > 0) {
      console.log(`Audit History    :`);
      for (const h of item.auditHistory) {
        console.log(`  [${h.date}] ${h.event}: ${JSON.stringify(h)}`);
      }
    }
    return 0;
  }

  if (command === "confirm-format") {
    if (!format) {
      console.error(`❌ --format <video|short> is required for --confirm-format.`);
      return 1;
    }
    console.log(`Confirming format for video ID '${targetId}' as '${format}'...`);
    const res = await confirmItemFormat(targetId, format, { notes, auditFilePath });
    if (!res.success) {
      console.error(`❌ Format confirmation failed:\n  - ${res.errors.join("\n  - ")}`);
      return 1;
    }
    console.log(`✅ Format confirmed: Video '${targetId}' successfully confirmed as '${res.confirmedFormat}'.`);
    return 0;
  }

  if (command === "approve") {
    console.log(`Approving video ID: ${targetId}...`);
    const res = await approveReviewItem(targetId, { format, notes, auditFilePath });
    if (!res.success) {
      console.error(`❌ Approval rejected due to validation errors:\n  - ${res.errors.join("\n  - ")}`);
      return 1;
    }
    console.log(`✅ Approved: Video '${targetId}' successfully approved as '${res.confirmedFormat}'.`);
    return 0;
  }

  if (command === "reject") {
    console.log(`Rejecting video ID: ${targetId}...`);
    const res = await rejectReviewItem(targetId, { reason, auditFilePath });
    if (!res.success) {
      console.error(`❌ Rejection failed: ${res.errors.join("; ")}`);
      return 1;
    }
    console.log(`✅ Rejected: Video '${targetId}' status updated to 'rejected'.`);
    return 0;
  }

  if (command === "approve-batch") {
    console.log(`Approving all eligible items in batch '${batchId}'...`);
    const res = await approveBatch(batchId, { format, auditFilePath });
    if (!res.success) {
      console.error(`❌ Batch approval failed:\n  - ${res.errors.join("\n  - ")}`);
      return 1;
    }
    console.log(`✅ Batch '${batchId}' approved (${res.approvedCount} items approved).`);
    return 0;
  }

  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runReviewCli().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
