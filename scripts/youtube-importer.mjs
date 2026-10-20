/**
 * YouTube Batch-of-10 URL Ingestion and Audit Tool for Lolixco.
 *
 * Enforces:
 * - At most 10 URLs per batch
 * - Normalization to canonical 11-char YouTube video ID
 * - Domain security and malformed ID rejection
 * - Duplicate detection within batch and across audit history (idempotency)
 * - Metadata retrieval with quota protection and offline mock support
 * - Editorial classification and conflict detection
 * - Preservation of approved review decisions across re-imports
 * - Preservation of owner category and fandom assignments
 * - Persistent audit trail storage at canonical path
 * - Executable CLI entrypoint with exit codes
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, copyFileSync, realpathSync, lstatSync, readlinkSync } from "node:fs";
import { resolve, dirname, basename, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { fetchYouTubeVideoMetadata, loadEnvConfig, isTestIsolationActive } from "./youtube-api.mjs";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

// Register TypeScript loader for on-the-fly TS transpilation
try {
  register("./tests/ts-hooks.mjs", new URL("../", import.meta.url));
} catch {
  // If already registered or unavailable, proceed
}

/**
 * Resolves the canonical, symlink-free absolute filesystem path.
 * Handles existing files, non-existent target files with existing parent directories,
 * and symbolic link aliases.
 */
export function getCanonicalPath(targetPath) {
  if (!targetPath) return "";
  let resolved = resolve(targetPath);
  try {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      const linkTarget = readlinkSync(resolved);
      resolved = resolve(dirname(resolved), linkTarget);
    }
  } catch {
    // File may not exist yet
  }
  try {
    return realpathSync(resolved);
  } catch {
    const parent = dirname(resolved);
    try {
      return resolve(realpathSync(parent), basename(resolved));
    } catch {
      return resolved;
    }
  }
}

export const IMMUTABLE_PROD_CATALOG = resolve(projectRoot, "src/data/edits.ts");
export const IMMUTABLE_PROD_SRC_DATA_DIR = resolve(projectRoot, "src/data");
export const IMMUTABLE_PROD_AUDIT = resolve(projectRoot, "content/audit/youtube-intake-audit.json");
export const IMMUTABLE_PROD_AUDIT_DIR = resolve(projectRoot, "content/audit");

function isPathInside(childPath, parentDir) {
  const rel = relative(parentDir, childPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

let customProtectedRoots = [];
let batchFileReader = readFileSync;

/**
 * Injects disposable protected roots for test isolation verification.
 * Note: Injected roots expand protection for testing; canonical production paths
 * (src/data, content/audit) are hardcoded and can never be weakened or cleared.
 *
 * @param {string[]} roots - Array of directory or file paths to treat as protected
 * @returns {() => void} Cleanup function to reset injected roots
 */
export function setProtectedRootsForTest(roots) {
  if (process.env.LOLIXCO_TEST_MODE !== "1") {
    throw new Error("setProtectedRootsForTest is only permitted in test mode (LOLIXCO_TEST_MODE=1)");
  }
  customProtectedRoots = Array.isArray(roots)
    ? roots.filter(Boolean).map((r) => resolve(r))
    : [];
  return () => {
    customProtectedRoots = [];
  };
}

export function getProtectedRootsForTest() {
  return [...customProtectedRoots];
}

export function setBatchFileReaderForTest(reader) {
  if (process.env.LOLIXCO_TEST_MODE !== "1") {
    throw new Error("setBatchFileReaderForTest is only permitted in test mode (LOLIXCO_TEST_MODE=1)");
  }
  batchFileReader = reader || readFileSync;
  return () => {
    batchFileReader = readFileSync;
  };
}

/**
 * Checks whether a given path targets a protected canonical production resource:
 * - The canonical catalog (src/data/edits.ts) or any file within src/data
 * - The canonical intake audit (content/audit/youtube-intake-audit.json) or any file within content/audit
 * - Symbolic link aliases to either
 * - Any path within injected test-only protected roots
 *
 * Evaluates without accessing canonical workstation filesystem metadata during fixture tests.
 */
export function isProtectedProductionPath(targetPath) {
  if (!targetPath) return false;

  // 1. Injected test-only protected roots check (disposable fixtures)
  if (customProtectedRoots.length > 0) {
    const canonicalTarget = getCanonicalPath(targetPath);
    for (const root of customProtectedRoots) {
      if (canonicalTarget === root || isPathInside(canonicalTarget, root)) {
        return true;
      }
    }
  }

  // 2. Lexical check against immutable production paths (zero filesystem metadata access)
  const resolvedTarget = resolve(targetPath);
  if (
    resolvedTarget === IMMUTABLE_PROD_CATALOG ||
    resolvedTarget === IMMUTABLE_PROD_AUDIT ||
    isPathInside(resolvedTarget, IMMUTABLE_PROD_AUDIT_DIR) ||
    isPathInside(resolvedTarget, IMMUTABLE_PROD_SRC_DATA_DIR)
  ) {
    return true;
  }

  // 3. Symlink alias resolution (only evaluates symlinks on targetPath)
  const canonicalTarget = getCanonicalPath(targetPath);
  if (
    canonicalTarget === IMMUTABLE_PROD_CATALOG ||
    canonicalTarget === IMMUTABLE_PROD_AUDIT ||
    isPathInside(canonicalTarget, IMMUTABLE_PROD_AUDIT_DIR) ||
    isPathInside(canonicalTarget, IMMUTABLE_PROD_SRC_DATA_DIR)
  ) {
    return true;
  }

  return false;
}

/**
 * Checks whether a given path targets a protected canonical private audit resource:
 * - The canonical intake audit (content/audit/youtube-intake-audit.json) or any file/directory within content/audit
 * - Symbolic link aliases to either
 * - Any path within injected test-only protected roots
 *
 * Evaluates without accessing canonical workstation filesystem metadata during fixture tests.
 */
export function isProtectedAuditPath(targetPath) {
  if (!targetPath) return false;

  // 1. Injected test-only protected roots check (disposable fixtures)
  if (customProtectedRoots.length > 0) {
    const canonicalTarget = getCanonicalPath(targetPath);
    for (const root of customProtectedRoots) {
      if (canonicalTarget === root || isPathInside(canonicalTarget, root)) {
        return true;
      }
    }
  }

  // 2. Lexical check against immutable production audit paths (zero filesystem metadata access)
  const resolvedTarget = resolve(targetPath);
  if (
    resolvedTarget === IMMUTABLE_PROD_AUDIT ||
    isPathInside(resolvedTarget, IMMUTABLE_PROD_AUDIT_DIR)
  ) {
    return true;
  }

  // 3. Symlink alias resolution (only evaluates symlinks on targetPath)
  const canonicalTarget = getCanonicalPath(targetPath);
  if (
    canonicalTarget === IMMUTABLE_PROD_AUDIT ||
    isPathInside(canonicalTarget, IMMUTABLE_PROD_AUDIT_DIR)
  ) {
    return true;
  }

  return false;
}

/**
 * Safely writes a file using a sibling temporary file and atomic rename.
 * In test mode, strictly prohibits writes to protected production destinations.
 */
export function safeAtomicWriteFileSync(filePath, content) {
  if (isTestIsolationActive() && (isProtectedProductionPath(filePath) || isProtectedAuditPath(filePath))) {
    throw new Error(
      `Write operation blocked: Path '${filePath}' resolves to a protected production path under active test isolation. Test execution cannot modify production files.`
    );
  }
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tempPath, content, "utf-8");
    renameSync(tempPath, filePath);
  } catch (err) {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore unlink error
      }
    }
    throw err;
  }
}

import { normalizeYouTubeUrl } from "./youtube-normalizer.mjs";
import {
  evaluateEditorialClassification,
  CANONICAL_CATEGORIES,
} from "./youtube-editorial.mjs";

/**
 * Validates the structure and integrity of an audit JSON document.
 * Enforces FIX B:
 * - Top-level must be a non-null plain object (not array or primitive).
 * - 'items' must be an array.
 * - Each item must be a non-null object with a valid canonicalVideoId.
 * - No duplicate canonicalVideoId inside items array.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateAuditDocument(auditData, auditFilePath = "audit.json") {
  const errors = [];

  if (typeof auditData !== "object" || auditData === null || Array.isArray(auditData)) {
    return {
      valid: false,
      errors: [
        `Audit file at '${auditFilePath}' is structurally malformed: expected top-level JSON object, got ${Array.isArray(auditData) ? "array" : auditData === null ? "null" : typeof auditData}. File preserved byte-for-byte without mutation. Recovery: inspect file or restore from a timestamped backup in content/audit/backups/.`,
      ],
    };
  }

  if (!("items" in auditData) || !Array.isArray(auditData.items)) {
    return {
      valid: false,
      errors: [
        `Audit file at '${auditFilePath}' is structurally malformed: 'items' property must be an array (got ${typeof auditData.items}). File preserved byte-for-byte without mutation. Recovery: inspect file or restore from a timestamped backup in content/audit/backups/.`,
      ],
    };
  }

  const seenVideoIds = new Set();
  for (let i = 0; i < auditData.items.length; i++) {
    const item = auditData.items[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(
        `Audit file at '${auditFilePath}' has invalid record at items[${i}]: expected record object, got ${item === null ? "null" : typeof item}.`
      );
      continue;
    }

    const videoId = item.canonicalVideoId;
    if (!videoId || typeof videoId !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      errors.push(
        `Audit file at '${auditFilePath}' has invalid record at items[${i}]: missing or invalid canonicalVideoId ('${videoId}').`
      );
      continue;
    }

    if (seenVideoIds.has(videoId)) {
      errors.push(
        `Audit file at '${auditFilePath}' contains duplicate canonicalVideoId '${videoId}' at items[${i}]. Duplicate YouTube video ID conflict. Rejecting structurally malformed audit log to prevent data corruption. File preserved byte-for-byte without mutation.`
      );
      continue;
    }
    seenVideoIds.add(videoId);
  }

  if (errors.length > 0) {
    errors.push(
      `File preserved byte-for-byte without modification. Recovery: check content/audit/backups/ or restore via: node scripts/review-youtube-batch.mjs --restore <backup-file>`
    );
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

/**
 * Creates a timestamped local backup of an audit file in content/audit/backups/
 */
export function createAuditBackup(auditFilePath) {
  if (isTestIsolationActive() && (isProtectedProductionPath(auditFilePath) || isProtectedAuditPath(auditFilePath))) {
    throw new Error(
      `Backup operation blocked: Audit file '${auditFilePath}' resolves to a protected production path under active test isolation.`
    );
  }
  if (!existsSync(auditFilePath)) return null;

  const baseDir = dirname(auditFilePath);
  const backupDir = resolve(baseDir, "backups");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = basename(auditFilePath, ".json");
  const backupPath = resolve(backupDir, `${baseName}.${timestamp}.bak.json`);

  try {
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
    const content = readFileSync(auditFilePath, "utf-8");
    safeAtomicWriteFileSync(backupPath, content);
    return backupPath;
  } catch (err) {
    throw new Error(
      `Failed to create audit backup at '${backupPath}': ${err.message}. Aborting mutation to prevent unprotected data loss.`
    );
  }
}

/**
 * Restores an audit file from a local backup file.
 * Validates source and destination paths separately under test isolation.
 */
export function restoreAuditBackup(backupPath, targetAuditPath = CANONICAL_AUDIT_PATH) {
  if (isTestIsolationActive()) {
    if (isProtectedProductionPath(targetAuditPath) || isProtectedAuditPath(targetAuditPath)) {
      throw new Error(
        `Restore operation blocked: Destination '${targetAuditPath}' resolves to a protected production path under active test isolation.`
      );
    }
    if (isProtectedProductionPath(backupPath) || isProtectedAuditPath(backupPath)) {
      throw new Error(
        `Restore operation blocked: Backup source '${backupPath}' resolves to a protected production path under active test isolation.`
      );
    }
  }
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found at: ${backupPath}`);
  }
  const content = readFileSync(backupPath, "utf-8");
  const parsed = JSON.parse(content);
  const validation = validateAuditDocument(parsed, backupPath);
  if (!validation.valid) {
    throw new Error(`Cannot restore invalid backup: ${validation.errors.join("; ")}`);
  }
  safeAtomicWriteFileSync(targetAuditPath, content);
  return true;
}

export const CANONICAL_AUDIT_PATH = resolve(projectRoot, "content/audit/youtube-intake-audit.json");

/**
 * Loads registered fandoms from src/data/fandoms.ts dynamically.
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
 * Parses batch input from string, array, or object.
 * Returns array of normalized entries: { url, category, fandom, fandomIds }.
 */
export function parseBatchInput(input, defaultCategory = "", defaultFandom = "", defaultFormat = "") {
  let items = [];

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return parseBatchInput(parsed, defaultCategory, defaultFandom, defaultFormat);
      } catch {
        // Fall back to line-by-line parsing
      }
    }

    // Line-by-line text parsing
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    items = lines.map((url) => ({
      url,
      category: defaultCategory,
      fandom: defaultFandom,
      fandomIds: defaultFandom ? [defaultFandom] : [],
      format: defaultFormat,
      hasExplicitCategory: Boolean(defaultCategory && defaultCategory.trim()),
      hasExplicitFandom: Boolean(defaultFandom && defaultFandom.trim()),
    }));
  } else if (Array.isArray(input)) {
    items = input.map((item) => {
      if (typeof item === "string") {
        return {
          url: item,
          category: defaultCategory,
          fandom: defaultFandom,
          fandomIds: defaultFandom ? [defaultFandom] : [],
          format: defaultFormat,
          hasExplicitCategory: Boolean(defaultCategory && defaultCategory.trim()),
          hasExplicitFandom: Boolean(defaultFandom && defaultFandom.trim()),
        };
      }
      const hasCat = Boolean(
        (item.category && item.category.trim()) ||
        (item.ownerCategory && item.ownerCategory.trim()) ||
        (defaultCategory && defaultCategory.trim())
      );
      const hasFan = Boolean(
        (item.fandom && item.fandom.trim()) ||
        (item.ownerFandom && item.ownerFandom.trim()) ||
        (Array.isArray(item.fandomIds) && item.fandomIds.length > 0) ||
        (Array.isArray(item.ownerFandomIds) && item.ownerFandomIds.length > 0) ||
        (defaultFandom && defaultFandom.trim())
      );
      return {
        url: item.url,
        category: item.category || item.ownerCategory || defaultCategory,
        fandom: item.fandom || item.ownerFandom || defaultFandom,
        format: item.format || item.ownerFormat || defaultFormat,
        fandomIds: Array.isArray(item.fandomIds)
          ? item.fandomIds
          : Array.isArray(item.ownerFandomIds)
            ? item.ownerFandomIds
            : (item.fandom ? [item.fandom] : (item.ownerFandom ? [item.ownerFandom] : (defaultFandom ? [defaultFandom] : []))),
        hasExplicitCategory: hasCat,
        hasExplicitFandom: hasFan,
      };
    });
  } else if (typeof input === "object" && input !== null) {
    const hasBatchCat = Boolean(
      (input.category && input.category.trim()) || (defaultCategory && defaultCategory.trim())
    );
    const hasBatchFan = Boolean(
      (input.fandom && input.fandom.trim()) ||
      (Array.isArray(input.fandomIds) && input.fandomIds.length > 0) ||
      (defaultFandom && defaultFandom.trim())
    );
    const batchCat = input.category || defaultCategory;
    const batchFan = input.fandom || defaultFandom;
    const batchFandomIds = Array.isArray(input.fandomIds)
      ? input.fandomIds
      : (batchFan ? [batchFan] : []);

    const batchFormat = input.format || input.ownerFormat || defaultFormat;

    if (Array.isArray(input.urls)) {
      items = input.urls.map((url) => ({
        url,
        category: batchCat,
        fandom: batchFan,
        fandomIds: batchFandomIds,
        format: batchFormat,
        hasExplicitCategory: hasBatchCat,
        hasExplicitFandom: hasBatchFan,
      }));
    } else if (Array.isArray(input.items)) {
      items = input.items.map((item) => {
        const itemHasCat = Boolean(
          (item.category && item.category.trim()) ||
          (item.ownerCategory && item.ownerCategory.trim()) ||
          hasBatchCat
        );
        const itemHasFan = Boolean(
          (item.fandom && item.fandom.trim()) ||
          (item.ownerFandom && item.ownerFandom.trim()) ||
          (Array.isArray(item.fandomIds) && item.fandomIds.length > 0) ||
          hasBatchFan
        );
        return {
          url: item.url,
          category: item.category || item.ownerCategory || batchCat,
          fandom: item.fandom || item.ownerFandom || batchFan,
          format: item.format || item.ownerFormat || batchFormat,
          fandomIds: Array.isArray(item.fandomIds)
            ? item.fandomIds
            : (item.fandom ? [item.fandom] : batchFandomIds),
          hasExplicitCategory: itemHasCat,
          hasExplicitFandom: itemHasFan,
        };
      });
    }
  }

  return items;
}

/**
 * Ingests a batch of up to 10 YouTube URLs.
 *
 * @param {object} options
 * @returns {Promise<object>} Ingestion report
 */
export async function ingestYouTubeBatch(inputOrOptions = {}, maybeOptions = {}) {
  loadEnvConfig();

  const options = (Array.isArray(inputOrOptions) || typeof inputOrOptions === "string")
    ? { ...maybeOptions, batchInput: inputOrOptions }
    : inputOrOptions;

  const batchId = options.batchId || options["batch-id"] || options.batch || `batch-${Date.now()}`;
  const batchFile = options.batchFile || options["batch-file"] || options.batchPath || options["batch-path"] || options.input;
  const {
    batchInput,
    category = "",
    fandom = "",
    format = "",
    auditFilePath = CANONICAL_AUDIT_PATH,
    dryRun = false,
    mockMode = false,
  } = options;

  const isInjectedFetcher = Boolean(
    typeof options.fetchMetadata === "function" ||
    typeof options.metadataFetcher === "function" ||
    typeof options.apiClient?.fetchMetadata === "function" ||
    typeof options.apiClient === "function"
  );

  let detectedSyntheticOrigin = null;
  if (typeof options.fetchMetadata === "function") {
    detectedSyntheticOrigin = "injected_fetch_metadata";
  } else if (typeof options.metadataFetcher === "function") {
    detectedSyntheticOrigin = "injected_metadata_fetcher";
  } else if (typeof options.apiClient?.fetchMetadata === "function" || typeof options.apiClient === "function") {
    detectedSyntheticOrigin = "injected_api_client";
  } else if (options.customMockMetadata) {
    detectedSyntheticOrigin = "custom_mock_metadata";
  } else if (mockMode || options.useMock || options.isMock) {
    detectedSyntheticOrigin = "batch_importer_mock";
  }

  const isSyntheticMode = Boolean(
    mockMode ||
    options.useMock ||
    options.isMock ||
    options.customMockMetadata ||
    isInjectedFetcher
  );

  const errors = [];
  const warnings = [];

  // Reject access to protected canonical production audits during test isolation (both dryRun and mutating runs)
  if (isTestIsolationActive() && (isProtectedProductionPath(auditFilePath) || isProtectedAuditPath(auditFilePath))) {
    return {
      success: false,
      batchId,
      processedCount: 0,
      newCount: 0,
      duplicateCount: 0,
      errors: [
        `Intake ingestion blocked: Target audit path '${auditFilePath}' resolves to a protected production path under active test isolation. Ingestion during test execution cannot read or modify canonical audit files.`,
      ],
      warnings,
      items: [],
      auditFilePath,
    };
  }

  // 1. Load batch items (supports batchFile, batchPath, raw text, JSON, array, or file path)
  let rawItems = [];
  const isLikelyPath = typeof batchInput === "string" && (
    batchInput.startsWith("/") ||
    batchInput.startsWith("./") ||
    batchInput.startsWith("../") ||
    batchInput.includes("content/audit") ||
    batchInput.includes("src/data") ||
    batchInput.endsWith(".json") ||
    batchInput.endsWith(".txt") ||
    customProtectedRoots.some((r) => batchInput.includes(r)) ||
    (!batchInput.includes("\n") && !batchInput.trim().startsWith("[") && !batchInput.trim().startsWith("{") && existsSync(batchInput))
  );
  const resolvedFilePath = batchFile || (isLikelyPath ? batchInput : null);

  if (resolvedFilePath) {
    const resolvedPath = resolve(resolvedFilePath);

    // Reject protected audit and production paths supplied as batch input under test isolation
    if (isTestIsolationActive() && (isProtectedProductionPath(resolvedPath) || isProtectedAuditPath(resolvedPath))) {
      return {
        success: false,
        batchId,
        processedCount: 0,
        newCount: 0,
        duplicateCount: 0,
        errors: [
          `Batch input blocked: Batch input path '${resolvedPath}' resolves to a protected production path under active test isolation. Ingestion during test execution cannot read protected audit or production files as batch sources.`,
        ],
        warnings,
        items: [],
        auditFilePath,
      };
    }

    if (!existsSync(resolvedPath)) {
      return {
        success: false,
        errors: [`Batch file not found: ${resolvedPath}`],
        warnings: [],
        processed: [],
      };
    }
    const content = batchFileReader(resolvedPath, "utf-8");
    rawItems = parseBatchInput(content, category, fandom, format);
  } else if (batchInput) {
    rawItems = parseBatchInput(batchInput, category, fandom, format);
  }

  // 2. Strict Limit: At most 10 URLs per batch
  if (rawItems.length === 0) {
    return {
      success: false,
      errors: ["Batch is empty. Please provide between 1 and 10 URLs."],
      warnings: [],
      processed: [],
    };
  }

  if (rawItems.length > 10) {
    return {
      success: false,
      errors: [
        `Batch exceeds maximum allowed size of 10 items (got ${rawItems.length} items). Please submit in batches of 10 or fewer.`,
      ],
      warnings: [],
      processed: [],
    };
  }

  // 3. Load existing audit history
  let auditData = { version: "1.0.0", items: [] };
  if (existsSync(auditFilePath)) {
    try {
      auditData = JSON.parse(readFileSync(auditFilePath, "utf-8"));
    } catch (err) {
      return {
        success: false,
        errors: [`Failed to parse existing audit file at ${auditFilePath}: ${err.message}. Preserving original file byte-for-byte without modification.`],
        warnings,
        processed: [],
      };
    }

    const auditValidation = validateAuditDocument(auditData, auditFilePath);
    if (!auditValidation.valid) {
      return {
        success: false,
        errors: auditValidation.errors,
        warnings,
        processed: [],
      };
    }
  }

  const existingByVideoId = new Map(auditData.items.map((i) => [i.canonicalVideoId, i]));
  const registeredFandoms = await loadFandomRegistry();

  // 4. Normalize URLs and detect duplicate URLs within the batch
  const normalizedBatch = [];
  const seenBatchVideoIds = new Set();
  const validVideoIdsToFetch = [];

  for (let idx = 0; idx < rawItems.length; idx++) {
    const raw = rawItems[idx];
    const norm = normalizeYouTubeUrl(raw.url);

    if (!norm.valid) {
      errors.push(`Item #${idx + 1} rejected: ${norm.error} (Input: '${raw.url}')`);
      continue;
    }

    if (seenBatchVideoIds.has(norm.videoId)) {
      errors.push(`Item #${idx + 1} duplicate: Video ID '${norm.videoId}' was submitted multiple times in this batch.`);
      continue;
    }
    seenBatchVideoIds.add(norm.videoId);

    // Cross-batch duplicate check
    if (existingByVideoId.has(norm.videoId)) {
      const existing = existingByVideoId.get(norm.videoId);
      warnings.push(
        `Item #${idx + 1} duplicate: Video ID '${norm.videoId}' was already imported in batch '${existing.batchId}' (status: ${existing.contentReviewStatus}). Updating metadata & preserving review decision.`
      );
    }

    normalizedBatch.push({
      submittedUrl: raw.url,
      canonicalVideoId: norm.videoId,
      canonicalUrl: norm.canonicalUrl,
      urlFormatHint: norm.urlFormatHint,
      category: raw.category || raw.ownerCategory || category,
      fandom: raw.fandom || raw.ownerFandom || fandom,
      format: raw.format || raw.ownerFormat || format,
      fandomIds: raw.fandomIds || (raw.fandom ? [raw.fandom] : (raw.ownerFandom ? [raw.ownerFandom] : (fandom ? [fandom] : []))),
      hasExplicitCategory: raw.hasExplicitCategory ?? Boolean((raw.category || raw.ownerCategory || category || "").trim()),
      hasExplicitFandom: raw.hasExplicitFandom ?? Boolean((raw.fandom || raw.ownerFandom || fandom || "").trim() || (Array.isArray(raw.fandomIds) && raw.fandomIds.length > 0)),
    });

    validVideoIdsToFetch.push(norm.videoId);
  }

  if (errors.length > 0 && normalizedBatch.length === 0) {
    return {
      success: false,
      errors,
      warnings,
      processed: [],
    };
  }

  // 5. Fetch Metadata via YouTube API (or injected mock client / fetchMetadata)
  let metadataResult;
  if (typeof options.fetchMetadata === "function") {
    metadataResult = await options.fetchMetadata(validVideoIdsToFetch);
  } else if (typeof options.metadataFetcher === "function") {
    const fetchedItems = [];
    const missing = [];
    const incomplete = [];
    const confirmedUnavailable = [];
    const retryable = [];
    const fetchErrors = [];
    for (const vid of validVideoIdsToFetch) {
      const res = await options.metadataFetcher(vid);
      if (res && res.success && (res.data || res.metadata)) {
        fetchedItems.push(res.data || res.metadata);
      } else {
        missing.push(vid);
        if (res?.confirmedUnavailable || res?.notFound || res?.status === 404 || res?.deleted) {
          confirmedUnavailable.push(vid);
        } else if (res?.incomplete) {
          incomplete.push(vid);
        } else if (res?.retryable) {
          retryable.push(vid);
        }
        if (res?.errors) fetchErrors.push(...res.errors);
        else if (res?.error) fetchErrors.push(res.error);
      }
    }
    metadataResult = {
      items: fetchedItems,
      missingIds: missing,
      incompleteIds: incomplete,
      confirmedUnavailableIds: confirmedUnavailable,
      retryableIds: retryable,
      errors: fetchErrors,
    };
  } else if (options.apiClient?.fetchMetadata || typeof options.apiClient === "function") {
    const fetchedItems = [];
    const missing = [];
    const incomplete = [];
    const confirmedUnavailable = [];
    const retryable = [];
    const fetchErrors = [];
    const clientFetch = typeof options.apiClient === "function"
      ? options.apiClient
      : options.apiClient.fetchMetadata.bind(options.apiClient);
    for (const vid of validVideoIdsToFetch) {
      const res = await clientFetch(vid);
      if (res && res.success && (res.data || res.metadata)) {
        fetchedItems.push(res.data || res.metadata);
      } else {
        missing.push(vid);
        if (res?.confirmedUnavailable || res?.notFound || res?.status === 404 || res?.deleted) {
          confirmedUnavailable.push(vid);
        } else if (res?.incomplete) {
          incomplete.push(vid);
        } else if (res?.retryable) {
          retryable.push(vid);
        }
        if (res?.errors) fetchErrors.push(...res.errors);
        else if (res?.error) fetchErrors.push(res.error);
      }
    }
    metadataResult = {
      items: fetchedItems,
      missingIds: missing,
      incompleteIds: incomplete,
      confirmedUnavailableIds: confirmedUnavailable,
      retryableIds: retryable,
      errors: fetchErrors,
    };
  } else {
    metadataResult = await fetchYouTubeVideoMetadata(validVideoIdsToFetch, {
      mockMode: mockMode || options.useMock || Boolean(options.customMockMetadata),
      customMockMetadata: options.customMockMetadata,
    });
  }

  // Centralized provenance policy:
  // If in synthetic mode (mockMode, customMockMetadata, or injected fetchers),
  // caller-supplied provenance, isMock, or fetchStatus fields can NEVER disguise test data as real API retrieval.
  if (isSyntheticMode && Array.isArray(metadataResult?.items)) {
    metadataResult.items = metadataResult.items.map((rawItem) => {
      if (!rawItem || typeof rawItem !== "object") return rawItem;
      return {
        ...rawItem,
        isMock: true,
        provenance: "synthetic_mock",
        syntheticOrigin: rawItem.syntheticOrigin || detectedSyntheticOrigin || "batch_importer_mock",
      };
    });
  }

  if (metadataResult.errors.length > 0) {
    const hasExistingItemsToPreserve = normalizedBatch.some((e) => existingByVideoId.has(e.canonicalVideoId));
    if (metadataResult.items.length === 0 && !hasExistingItemsToPreserve) {
      // Entire batch failed (e.g. missing API key, network failure, quota exceeded) on new items
      return {
        success: false,
        errors: metadataResult.errors,
        warnings,
        processed: [],
      };
    }
    warnings.push(...metadataResult.errors);
  }

  const metadataMap = new Map((metadataResult.items || []).map((item) => [item.canonicalVideoId, item]));
  const missingIdSet = new Set(metadataResult.missingIds || []);
  const confirmedUnavailableSet = new Set(metadataResult.confirmedUnavailableIds || []);
  const incompleteIdSet = new Set(metadataResult.incompleteIds || []);

  // 6. Editorial Classification and Record Assembly
  const processedRecords = [];

  for (const entry of normalizedBatch) {
    const videoId = entry.canonicalVideoId;
    const metadata = metadataMap.get(videoId);
    const existing = existingByVideoId.get(videoId);

    const hasExplicitCategory = Boolean(entry.hasExplicitCategory);
    const hasExplicitFandom = Boolean(entry.hasExplicitFandom);

    // FIX D: If category or fandom was omitted in refresh, preserve existing!
    const effectiveCategory = hasExplicitCategory
      ? entry.category
      : (existing?.category || existing?.ownerCategory || "");

    const effectiveFandom = hasExplicitFandom
      ? entry.fandom
      : (existing?.fandom || existing?.ownerFandom || "");

    const effectiveFandomIds = hasExplicitFandom
      ? (entry.fandomIds && entry.fandomIds.length > 0 ? entry.fandomIds : (entry.fandom ? [entry.fandom] : []))
      : (existing?.fandomIds || existing?.ownerFandomIds || []);

    const effectiveFormat = (entry.urlFormatHint && !existing?.format)
      ? entry.urlFormatHint
      : (existing?.format || entry.urlFormatHint || "video");

    let classification;
    if (metadata) {
      classification = evaluateEditorialClassification({
        ownerCategory: effectiveCategory,
        ownerFandom: effectiveFandom,
        ownerFandomIds: effectiveFandomIds,
        metadata,
        registeredFandoms,
        urlFormatHint: effectiveFormat,
        ownerFormat: entry.format || options.format || options.ownerFormat,
      });
    } else {
      classification = {
        category: effectiveCategory,
        fandomIds: effectiveFandomIds,
        format: effectiveFormat,
        conflictFlag: false,
        warnings: confirmedUnavailableSet.has(videoId)
          ? [`Video ID '${videoId}' not found or private on YouTube`]
          : [`Metadata lookup for '${videoId}' was incomplete or inconclusive; preserving existing record`],
        reviewStatus: "unavailable",
      };
    }

    // Preserve editorial review decision across re-imports (FIX C / FIX A / FIX D)
    let finalReviewStatus = classification.reviewStatus;
    const auditHistory = Array.isArray(existing?.auditHistory) ? [...existing.auditHistory] : [];
    let isInconclusiveRefresh = false;

    if (existing) {
      const isPreviouslyReviewed =
        existing.contentReviewStatus === "approved" ||
        existing.contentReviewStatus === "published";

      if (isPreviouslyReviewed) {
        const targetStatus = existing.contentReviewStatus; // "approved" or "published"
        if (!metadata) {
          // FIX A: Distinguish confirmed absence from incomplete or transient failure
          if (confirmedUnavailableSet.has(videoId)) {
            finalReviewStatus = "unavailable";
            classification.warnings.push(`Previously ${targetStatus} item is now confirmed unavailable or removed on YouTube.`);
            auditHistory.push({
              date: new Date().toISOString(),
              event: "status_transition",
              from: targetStatus,
              to: "unavailable",
              reason: "video_unavailable_or_removed",
            });
          } else {
            // INCONCLUSIVE REFRESH (incomplete response, transient error, quota, timeout)
            // Preserve the existing published/approved record and last verified metadata!
            finalReviewStatus = targetStatus;
            isInconclusiveRefresh = true;
            classification.warnings.push(
              `Verification warning: Inconclusive metadata refresh for '${videoId}'. Preserving last verified metadata; retry scheduled.`
            );
            auditHistory.push({
              date: new Date().toISOString(),
              event: "verification_warning",
              status: targetStatus,
              reason: "inconclusive_metadata_refresh",
              warning: "Inconclusive metadata response; preserving existing verified metadata and scheduling retry.",
              retryRequired: true,
            });
          }
        } else if (metadata.embeddable === false) {
          finalReviewStatus = "embed_restricted";
          classification.warnings.push(`Previously ${targetStatus} item embedding has been restricted.`);
          auditHistory.push({
            date: new Date().toISOString(),
            event: "status_transition",
            from: targetStatus,
            to: "embed_restricted",
            reason: "embedding_disabled",
          });
        } else if (metadata.privacyStatus && metadata.privacyStatus !== "public") {
          finalReviewStatus = "unavailable";
          classification.warnings.push(`Previously ${targetStatus} item privacyStatus changed to '${metadata.privacyStatus}'.`);
          auditHistory.push({
            date: new Date().toISOString(),
            event: "status_transition",
            from: targetStatus,
            to: "unavailable",
            reason: `privacy_status_${metadata.privacyStatus}`,
          });
        } else {
          const prevCat = existing.category || existing.ownerCategory || "";
          const prevFandoms = (existing.fandomIds || existing.ownerFandomIds || []).slice().sort().join(",");
          const prevFormat = existing.format || "video";

          const isExplicitCategoryChange = hasExplicitCategory && entry.category && entry.category !== prevCat;
          const newFandoms = (entry.fandomIds || (entry.fandom ? [entry.fandom] : [])).slice().sort().join(",");
          const isExplicitFandomChange = hasExplicitFandom && newFandoms !== prevFandoms;

          if (isExplicitCategoryChange || isExplicitFandomChange) {
            finalReviewStatus = "needs_recheck";
            classification.warnings.push(
              `Editorial classification changed on re-import (category: '${prevCat}' -> '${classification.category}', fandoms: '${prevFandoms}' -> '${classification.fandomIds.join(",")}'). Transitioned to 'needs_recheck'. Requires explicit owner review.`
            );
            auditHistory.push({
              date: new Date().toISOString(),
              event: "status_transition",
              from: targetStatus,
              to: "needs_recheck",
              reason: "editorial_classification_change",
              previousClassification: {
                category: prevCat,
                fandomIds: existing.fandomIds || existing.ownerFandomIds || [],
                format: prevFormat,
              },
              newClassification: {
                category: classification.category,
                fandomIds: classification.fandomIds,
                format: classification.format,
              },
            });
          } else if (
            existing.metadata &&
            (existing.metadata.title !== metadata.title ||
              Math.abs((existing.metadata.durationSec || 0) - (metadata.durationSec || 0)) > 5)
          ) {
            finalReviewStatus = "needs_recheck";
            classification.warnings.push(`Material changes detected in video metadata since ${targetStatus} status. Transitioned to needs_recheck.`);
            auditHistory.push({
              date: new Date().toISOString(),
              event: "status_transition",
              from: targetStatus,
              to: "needs_recheck",
              reason: "material_metadata_change",
            });
          } else {
            // Metadata and classifications are valid and unchanged: preserve approved/published status!
            finalReviewStatus = targetStatus;
            auditHistory.push({
              date: new Date().toISOString(),
              event: "reimport_verification",
              status: targetStatus,
              note: "Metadata and classifications verified unchanged",
            });
          }
        }
      } else if (existing.contentReviewStatus === "rejected") {
        // Never automatically re-approve a rejected item
        finalReviewStatus = "rejected";
      }
    }

    let finalAssignedId = existing?.assignedLolixcoId || null;
    if (existing?.assignedLolixcoId && existing.format && classification.format && existing.format !== classification.format) {
      finalAssignedId = null;
      classification.warnings.push(
        `Format changed from '${existing.format}' to '${classification.format}'. Previously assigned ID ${existing.assignedLolixcoId} requires deliberate migration and review.`
      );
    }

    const auditRecord = {
      batchId,
      submittedUrl: entry.submittedUrl,
      canonicalVideoId: videoId,
      canonicalUrl: entry.canonicalUrl,
      ownerCategory: effectiveCategory,
      ownerFandom: effectiveFandom,
      ownerFandomIds: effectiveFandomIds,
      category: classification.category || effectiveCategory,
      fandomIds: classification.fandomIds?.length > 0 ? classification.fandomIds : effectiveFandomIds,
      suggestedCategories: classification.suggestedCategories || [],
      suggestedFandomIds: classification.suggestedFandomIds || [],
      conflictFlag: classification.conflictFlag,
      format: existing?.format || classification.format,
      inferredFormat: classification.format,
      formatConfirmed: existing?.formatConfirmed === true,
      confirmedFormat: existing?.formatConfirmed ? (existing.confirmedFormat || existing.format) : null,
      metadataFetchStatus: isInconclusiveRefresh
        ? (existing?.metadataFetchStatus || "fetched")
        : (metadata ? "fetched" : "failed"),
      contentReviewStatus: finalReviewStatus,
      validationWarnings: classification.warnings,
      retryRequired: isInconclusiveRefresh || Boolean(existing?.retryRequired),
      lastMetadataVerification: isInconclusiveRefresh
        ? (existing?.lastMetadataVerification || null)
        : new Date().toISOString(),
      metadata: isInconclusiveRefresh
        ? (existing?.metadata || null)
        : (metadata
          ? {
              ...metadata,
              ...(isSyntheticMode || metadata.isMock === true || metadata.provenance === "synthetic_mock" || metadata.syntheticOrigin
                ? {
                    isMock: true,
                    provenance: "synthetic_mock",
                    syntheticOrigin: metadata.syntheticOrigin || detectedSyntheticOrigin || "batch_importer_mock",
                  }
                : {}),
            }
          : null),
      isMock: isInconclusiveRefresh
        ? (existing?.isMock === true)
        : Boolean(isSyntheticMode || metadata?.isMock === true || metadata?.provenance === "synthetic_mock" || metadata?.syntheticOrigin),
      provenance: isInconclusiveRefresh
        ? (existing?.provenance || "unfetched")
        : (isSyntheticMode || metadata?.isMock === true || metadata?.provenance === "synthetic_mock" || metadata?.syntheticOrigin
          ? "synthetic_mock"
          : (metadata?.provenance || "unfetched")),
      ...((isInconclusiveRefresh ? existing?.isMock === true : (isSyntheticMode || metadata?.isMock === true || metadata?.provenance === "synthetic_mock" || metadata?.syntheticOrigin))
        ? { syntheticOrigin: (isInconclusiveRefresh ? existing?.syntheticOrigin : null) || metadata?.syntheticOrigin || detectedSyntheticOrigin || "batch_importer_mock" }
        : {}),
      assignedLolixcoId: finalAssignedId,
      auditHistory,
    };

    processedRecords.push(auditRecord);

    // Update in-memory audit store (preserving assignedLolixcoId)
    existingByVideoId.set(videoId, auditRecord);
  }

  // 7. Save Audit Trail (unless dryRun)
  if (!dryRun) {
    try {
      createAuditBackup(auditFilePath);
    } catch (err) {
      return {
        success: false,
        errors: [`Audit backup failure: ${err.message}`],
        warnings,
        processed: [],
      };
    }
    auditData.items = Array.from(existingByVideoId.values());
    auditData.lastUpdated = new Date().toISOString();
    safeAtomicWriteFileSync(auditFilePath, JSON.stringify(auditData, null, 2));
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    processedCount: processedRecords.length,
    processed: processedRecords,
    dryRun,
    auditFilePath,
  };
}

/**
 * CLI Runner with explicit argument parsing, error handling, and exit codes.
 */
export async function runImporterCli(args = process.argv.slice(2)) {
  loadEnvConfig();

  const options = {
    batchId: `batch-${Date.now()}`,
    category: "",
    fandom: "",
    format: "",
    batchPath: "",
    urls: [],
    dryRun: false,
    mockMode: false,
    auditFilePath: CANONICAL_AUDIT_PATH,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`
Lolixco YouTube Importer CLI

Usage:
  node scripts/youtube-importer.mjs [options]

Options:
  --batch, --batch-id <id>     Batch identifier (e.g. 01, batch-01, batch-10)
  --category <name>            Category (Anime, Gaming, Movies, Series, Phonk, Multifandom)
  --fandom <slug>              Fandom slug (e.g. valorant, jujutsu-kaisen)
  --format <type>              Format (video, landscape, short)
  --input, --batch-file <file> Input file (.txt with 1 URL per line or .json)
  --urls <u1,u2>               Comma-separated list of YouTube URLs
  --dry-run                    Simulate import without writing to audit file
  --mock                       Enable offline mock mode for testing
  --audit-file <path>          Audit file path (default: content/audit/youtube-intake-audit.json)
  -h, --help                   Show this help message
`);
      return 0;
    } else if ((arg === "--batch" || arg === "--batch-id") && args[i + 1]) {
      options.batchId = args[++i];
    } else if (arg === "--category" && args[i + 1]) {
      options.category = args[++i];
    } else if (arg === "--fandom" && args[i + 1]) {
      options.fandom = args[++i];
    } else if ((arg === "--format" || arg === "--owner-format") && args[i + 1]) {
      options.format = args[++i];
    } else if ((arg === "--input" || arg === "--batch-file") && args[i + 1]) {
      options.batchPath = args[++i];
    } else if (arg === "--urls" && args[i + 1]) {
      options.urls = args[++i].split(",").map((u) => u.trim()).filter(Boolean);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--mock") {
      options.mockMode = true;
    } else if (arg === "--audit-file" && args[i + 1]) {
      options.auditFilePath = resolve(args[++i]);
    }
  }

  if (!options.batchPath && options.urls.length === 0) {
    console.error("Error: Must specify --input <file> or --urls <url1,url2,...>");
    return 1;
  }

  const batchInput = options.urls.length > 0 ? options.urls : undefined;

  console.log(`Starting YouTube batch import [${options.batchId}]...`);
  if (options.dryRun) console.log("Mode: DRY-RUN (no files will be written)");
  if (options.mockMode) console.log("Mode: MOCK (synthetic offline test mode)");

  if (isTestIsolationActive() && (isProtectedProductionPath(options.auditFilePath) || isProtectedAuditPath(options.auditFilePath))) {
    console.error(`\n❌ Ingestion aborted: Accessing protected production audit file '${options.auditFilePath}' is prohibited under active test isolation.`);
    return 1;
  }

  if (options.batchPath && isTestIsolationActive() && (isProtectedProductionPath(options.batchPath) || isProtectedAuditPath(options.batchPath))) {
    console.error(`\n❌ Ingestion aborted: Accessing protected production batch input file '${options.batchPath}' is prohibited under active test isolation.`);
    return 1;
  }

  const result = await ingestYouTubeBatch({
    batchId: options.batchId,
    category: options.category,
    fandom: options.fandom,
    format: options.format,
    batchPath: options.batchPath || undefined,
    batchInput,
    dryRun: options.dryRun,
    mockMode: options.mockMode,
    auditFilePath: options.auditFilePath,
  });

  if (!result.success) {
    console.error("\n❌ Import failed with errors:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    if (result.warnings.length > 0) {
      console.warn("\nWarnings:");
      for (const w of result.warnings) {
        console.warn(`  - ${w}`);
      }
    }
    return 1;
  }

  console.log(`\n✔ Ingestion successful!`);
  console.log(`  Processed: ${result.processedCount} items`);
  console.log(`  Audit file: ${result.auditFilePath}`);
  if (result.warnings.length > 0) {
    console.log(`  Warnings (${result.warnings.length}):`);
    for (const w of result.warnings) {
      console.log(`    - ${w}`);
    }
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runImporterCli().then((code) => {
    process.exit(code);
  });
}
