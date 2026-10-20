import { readFileSync, existsSync, realpathSync, lstatSync } from "node:fs";
import { resolve, relative, isAbsolute, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __projectRoot = fileURLToPath(new URL("../", import.meta.url));

// Capture initial system default fetch before any test stubs are installed
const _initialDefaultFetch = globalThis.fetch;

// Registry of explicitly authorized disposable fixture directories for test-mode environment loading
const _authorizedTestEnvDirs = new Set();

/**
 * Registers an explicitly authorized disposable fixture directory for test-mode environment loading.
 * The directory must be within os.tmpdir() and have a valid canonical path.
 * @param {string} dirPath Directory path to authorize
 */
export function registerAuthorizedTestEnvDir(dirPath) {
  if (typeof dirPath === "string" && dirPath.trim()) {
    try {
      const canonical = existsSync(dirPath) ? realpathSync(dirPath) : resolve(dirPath);
      _authorizedTestEnvDirs.add(canonical);
    } catch {
      _authorizedTestEnvDirs.add(resolve(dirPath));
    }
  }
}

/**
 * Unregisters an authorized test environment directory.
 * @param {string} dirPath Directory path to unregister
 */
export function unregisterAuthorizedTestEnvDir(dirPath) {
  if (typeof dirPath === "string" && dirPath.trim()) {
    try {
      const canonical = existsSync(dirPath) ? realpathSync(dirPath) : resolve(dirPath);
      _authorizedTestEnvDirs.delete(canonical);
    } catch {
      _authorizedTestEnvDirs.delete(resolve(dirPath));
    }
  }
}

/**
 * Clears all registered authorized test environment directories.
 */
export function clearAuthorizedTestEnvDirs() {
  _authorizedTestEnvDirs.clear();
}

/**
 * Evaluates whether test isolation is active.
 * Evaluates multiple redundant indicators: environment variables,
 * process arguments, and test runner contexts.
 * @returns {boolean}
 */
export function isTestIsolationActive() {
  return (
    process.env.LOLIXCO_TEST_ISOLATION === "1" ||
    process.env.LOLIXCO_TEST_MODE === "1" ||
    process.env.NODE_ENV === "test" ||
    process.env.npm_lifecycle_event === "test" ||
    (Array.isArray(process.execArgv) && process.execArgv.includes("--test")) ||
    typeof process.env.NODE_TEST_CONTEXT !== "undefined"
  );
}

/**
 * Loads .env and .env.local if present in target directory.
 * When test isolation is active:
 * 1. Target directory resolving canonically to project root (including symlinks/aliases) is strictly skipped.
 * 2. Only explicitly authorized disposable fixture environments strictly within os.tmpdir() may be loaded.
 * 3. Arbitrary external workstation directories and un-registered temporary directories are strictly rejected.
 * 4. Symlinks resolving outside the registered fixture directory boundary are strictly blocked.
 *
 * @param {string} rootDir Root directory to search for .env files
 * @returns {{ loaded: boolean; skipped: boolean; reason?: string }}
 */
export function loadEnvConfig(rootDir = __projectRoot) {
  let canonicalTarget = null;
  if (isTestIsolationActive()) {
    try {
      const canonicalProjectRoot = realpathSync(__projectRoot);
      const targetExists = existsSync(rootDir);
      canonicalTarget = targetExists ? realpathSync(rootDir) : resolve(rootDir);

      // Block canonical project root and any symlink aliases pointing to it
      if (canonicalTarget === canonicalProjectRoot) {
        return { loaded: false, skipped: true, reason: "test_isolation_active" };
      }

      // Block any directory located inside project root
      const relToProject = relative(canonicalProjectRoot, canonicalTarget);
      if (!relToProject.startsWith("..") && !isAbsolute(relToProject)) {
        return { loaded: false, skipped: true, reason: "test_isolation_active" };
      }

      // Restrict test-mode parsing strictly to explicitly authorized disposable fixture directories inside os.tmpdir()
      const canonicalTmpDir = realpathSync(tmpdir());
      const relToTmp = relative(canonicalTmpDir, canonicalTarget);

      // Proper directory-boundary check: must be strictly inside canonicalTmpDir
      // Rejects temporary-directory prefix lookalikes (e.g. /tmp-lookalike) and the temp root itself (/tmp)
      if (relToTmp.startsWith("..") || isAbsolute(relToTmp) || relToTmp === "") {
        return { loaded: false, skipped: true, reason: "unauthorized_test_env_directory" };
      }

      // Explicit authorization check: do NOT treat every directory under os.tmpdir() as approved.
      // Requires explicit registration via registerAuthorizedTestEnvDir
      const isExplicitlyRegistered = _authorizedTestEnvDirs.has(canonicalTarget);
      if (!isExplicitlyRegistered) {
        return { loaded: false, skipped: true, reason: "unauthorized_test_env_directory" };
      }
    } catch {
      return { loaded: false, skipped: true, reason: "test_isolation_active" };
    }
  }

  // Helper to ensure target file is strictly contained within the registered fixture boundary
  function validateFixtureFile(filePath) {
    if (!isTestIsolationActive()) return { safe: true };
    try {
      if (!canonicalTarget) return { safe: false, reason: "unauthorized_test_env_directory" };
      const lstat = lstatSync(filePath);
      const canonicalFile = realpathSync(filePath);
      const relToFile = relative(canonicalTarget, canonicalFile);

      // If it's a symlink pointing outside or resolving outside the registered fixture directory -> reject!
      if (relToFile.startsWith("..") || isAbsolute(relToFile) || relToFile === "") {
        return {
          safe: false,
          reason: lstat.isSymbolicLink() ? "symlink_escape_denied" : "file_traversal_denied",
        };
      }
      return { safe: true };
    } catch {
      return { safe: false, reason: "file_access_error" };
    }
  }

  // In test isolation, do NOT use process.loadEnvFile directly because it opens files without
  // running canonical symlink containment checks.
  if (!isTestIsolationActive() && typeof process.loadEnvFile === "function") {
    const envLocalPath = resolve(rootDir, ".env.local");
    if (existsSync(envLocalPath)) {
      try { process.loadEnvFile(envLocalPath); } catch {}
    }
    const envPath = resolve(rootDir, ".env");
    if (existsSync(envPath)) {
      try { process.loadEnvFile(envPath); } catch {}
    }
  }

  // Fallback manual parser to ensure .env.local / .env loading across platforms with symlink containment check
  const targetFiles = [".env.local", ".env"];
  for (const file of targetFiles) {
    const fullPath = resolve(rootDir, file);
    if (existsSync(fullPath)) {
      const validation = validateFixtureFile(fullPath);
      if (!validation.safe) {
        return { loaded: false, skipped: true, reason: validation.reason };
      }
      try {
        const content = readFileSync(fullPath, "utf-8");
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (key && !(key in process.env)) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }
  return { loaded: true, skipped: false };
}

// Auto-load on import ONLY when NOT in test isolation
if (!isTestIsolationActive()) {
  loadEnvConfig();
}

/**
 * Parses ISO 8601 duration (e.g., "PT30S", "PT1M15S", "PT1H2M3S") into seconds and formatted string.
 */
export function parseIsoDuration(isoDuration) {
  if (typeof isoDuration !== "string" || !isoDuration.startsWith("P")) {
    return { seconds: 0, formatted: "0:00" };
  }

  const regex = /P(?:([0-9]+)D)?T?(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?/;
  const match = isoDuration.match(regex);
  if (!match) {
    return { seconds: 0, formatted: "0:00" };
  }

  const days = parseInt(match[1] || "0", 10);
  const hours = parseInt(match[2] || "0", 10);
  const minutes = parseInt(match[3] || "0", 10);
  const seconds = parseInt(match[4] || "0", 10);

  const totalSeconds = days * 86400 + hours * 3600 + minutes * 60 + seconds;

  let formatted;
  if (hours > 0) {
    const minsStr = minutes.toString().padStart(2, "0");
    const secsStr = seconds.toString().padStart(2, "0");
    formatted = `${hours}:${minsStr}:${secsStr}`;
  } else {
    const secsStr = seconds.toString().padStart(2, "0");
    formatted = `${minutes}:${secsStr}`;
  }

  return { seconds: totalSeconds, formatted };
}

/**
 * Extracts hashtags from description text.
 */
export function extractHashtags(text) {
  if (typeof text !== "string") return [];
  const hashtagRegex = /#([a-zA-Z0-9_-]+)/g;
  const tags = [];
  let match;
  while ((match = hashtagRegex.exec(text)) !== null) {
    const tag = match[1].toLowerCase().trim();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Selects highest quality official thumbnail URL from snippet.thumbnails object.
 */
export function selectBestThumbnail(thumbnails = {}, fallbackVideoId = "") {
  if (thumbnails.maxres?.url) return thumbnails.maxres.url;
  if (thumbnails.standard?.url) return thumbnails.standard.url;
  if (thumbnails.high?.url) return thumbnails.high.url;
  if (thumbnails.medium?.url) return thumbnails.medium.url;
  if (thumbnails.default?.url) return thumbnails.default.url;

  if (fallbackVideoId) {
    return `https://i.ytimg.com/vi/${fallbackVideoId}/hqdefault.jpg`;
  }
  return "";
}

/**
 * Mask API key in error messages.
 */
export function maskApiKey(str, apiKey) {
  if (!str || !apiKey) return str;
  return str.replaceAll(apiKey, "YOUTUBE_API_KEY_HIDDEN");
}

/**
 * In-memory mock response registry for automated tests.
 */
export const MOCK_YOUTUBE_DATABASE = new Map();

/**
 * Helper to register a mock video record for testing.
 */
export function registerMockVideo(videoId, data) {
  MOCK_YOUTUBE_DATABASE.set(videoId, data);
}

/**
 * Clear mock registry.
 */
export function clearMockVideos() {
  MOCK_YOUTUBE_DATABASE.clear();
}

/**
 * Fetches metadata for a batch of up to 50 YouTube video IDs.
 *
 * @param {string[]} videoIds Array of 11-char YouTube video IDs
 * @param {object} options Configuration options
 * @returns {Promise<{ items: object[]; missingIds: string[]; errors: string[] }>}
 */
export async function fetchYouTubeVideoMetadata(videoIds, options = {}) {
  loadEnvConfig();

  const {
    apiKey = process.env.YOUTUBE_DATA_API_KEY || process.env.YOUTUBE_API_KEY,
    mockMode = false,
    customMockMetadata = null,
    timeoutMs = 10000,
    maxRetries = 2,
    fetchTransport = null,
    customFetch = null,
  } = options;

  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return { items: [], missingIds: [], errors: [] };
  }

  // Deduplicate video IDs
  const uniqueIds = Array.from(new Set(videoIds.filter((id) => typeof id === "string" && id.length === 11)));
  if (uniqueIds.length === 0) {
    return { items: [], missingIds: videoIds, errors: ["No valid 11-char video IDs provided"] };
  }

  // Limit to 50 items per request
  const batch = uniqueIds.slice(0, 50);

  const isMock = Boolean(mockMode || options.useMock || options.isMock || customMockMetadata);

  // FAIL CLOSED: Require a real API key for normal ingestion
  if (!isMock && (!apiKey || typeof apiKey !== "string" || !apiKey.trim())) {
    return {
      items: [],
      missingIds: batch,
      errors: [
        "YouTube API key is missing. Set YOUTUBE_DATA_API_KEY (or YOUTUBE_API_KEY) in .env.local or .env, or pass --mock for offline testing.",
      ],
    };
  }

  // MOCK MODE (For automated tests only via explicit switch or injected mock database)
  if (isMock) {
    const items = [];
    const missingIds = [];
    const incompleteIds = [];
    const confirmedUnavailableIds = [];
    const retryableIds = [];
    const errors = [];

    for (const id of batch) {
      let mock = undefined;
      if (customMockMetadata && id in customMockMetadata) {
        mock = customMockMetadata[id];
      } else if (MOCK_YOUTUBE_DATABASE.has(id)) {
        mock = MOCK_YOUTUBE_DATABASE.get(id);
      }

      if (mock !== undefined) {
        if (mock === null) {
          // Explicitly simulated 404/deleted
          missingIds.push(id);
          confirmedUnavailableIds.push(id);
        } else if (mock && mock.quotaExceeded === true) {
          missingIds.push(id);
          retryableIds.push(id);
          errors.push(`Video '${id}': YouTube API quota exceeded (retryable).`);
        } else if (mock && mock.incomplete === true) {
          missingIds.push(id);
          incompleteIds.push(id);
          errors.push(`Video '${id}': incomplete YouTube API response - missing required metadata fields.`);
        } else if (mock && mock.retryable === true) {
          missingIds.push(id);
          retryableIds.push(id);
          errors.push(`Video '${id}': transient YouTube API failure (retryable).`);
        } else {
          items.push({
            canonicalVideoId: id,
            ...mock,
            // Guaranteed synthetic markers: caller-supplied fields can NEVER override synthetic mode
            isMock: true,
            provenance: "synthetic_mock",
            syntheticOrigin: customMockMetadata && id in customMockMetadata ? "custom_mock_metadata" : "mock_database",
          });
        }
      } else {
        // Default deterministic synthetic response for testing
        const durSeconds = 25;
        items.push({
          canonicalVideoId: id,
          title: `Curated Edit ${id}`,
          description: `High-fidelity edit for #action #anime testing.`,
          channelId: "UC_mock_channel_id",
          channelTitle: "Lolixco Creator",
          publishedAt: "2026-01-15T12:00:00Z",
          tags: ["anime", "action", "edit"],
          hashtags: ["action", "anime"],
          durationIso: "PT25S",
          durationSec: durSeconds,
          durationFormatted: "0:25",
          thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          embeddable: true,
          privacyStatus: "public",
          regionRestriction: null,
          isMock: true,
          provenance: "synthetic_mock",
          syntheticOrigin: "default_mock",
        });
      }
    }

    return { items, missingIds, incompleteIds, confirmedUnavailableIds, retryableIds, errors };
  }

  // REAL API CALL (When YOUTUBE_API_KEY is available)
  const isCustomTransport = Boolean(fetchTransport || customFetch);
  const isSyntheticExecution = isTestIsolationActive() || isCustomTransport;
  const transport = fetchTransport || customFetch || globalThis.fetch;

  // FAIL-CLOSED TEST ISOLATION:
  // In test mode, reject unmocked default-network calls before fetch executes,
  // even when the test bootstrap was not imported.
  if (isTestIsolationActive()) {
    const isUnmockedDefaultTransport =
      !isCustomTransport &&
      (transport === _initialDefaultFetch ||
        transport === globalThis.__LOLIXCO_FAIL_CLOSED_FETCH__ ||
        (typeof transport === "function" &&
          transport.name === "fetch" &&
          typeof globalThis.__LOLIXCO_FAIL_CLOSED_FETCH__ === "undefined" &&
          transport === globalThis.fetch));

    if (isUnmockedDefaultTransport) {
      return {
        items: [],
        missingIds: batch,
        incompleteIds: [],
        confirmedUnavailableIds: [],
        retryableIds: [],
        errors: [
          "FAIL-CLOSED TEST ISOLATION: Unmocked default-network YouTube API calls are strictly prohibited in test mode. Tests must provide deterministic mock transports (fetchTransport/customFetch), use mockMode, or execute outside test isolation.",
        ],
      };
    }
  }

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "snippet,contentDetails,status");
  endpoint.searchParams.set("id", batch.join(","));
  endpoint.searchParams.set("key", apiKey);

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await transport(endpoint.toString(), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        let errBody = "";
        try {
          errBody = await response.text();
        } catch {
          // Ignore
        }
        const masked = maskApiKey(errBody, apiKey);

        if (response.status === 403 && masked.includes("quotaExceeded")) {
          return {
            items: [],
            missingIds: batch,
            incompleteIds: batch,
            confirmedUnavailableIds: [],
            retryableIds: batch,
            isQuotaExceeded: true,
            retryable: true,
            errors: ["YouTube Data API quota exceeded (quotaExceeded). Please wait or use cached metadata."],
          };
        }

        if (response.status >= 500 && attempt <= maxRetries) {
          // Transient server error: retry
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }

        return {
          items: [],
          missingIds: batch,
          incompleteIds: batch,
          confirmedUnavailableIds: [],
          retryableIds: batch,
          retryable: true,
          errors: [`YouTube Data API error HTTP ${response.status}: ${masked}`],
        };
      }

      const json = await response.json();
      const rawItems = Array.isArray(json.items) ? json.items : [];
      const foundIds = new Set();
      const mappedItems = [];
      const incompleteIds = [];
      const itemErrors = [];

      for (const item of rawItems) {
        const id = item.id;
        foundIds.add(id);

        const snippet = item.snippet || {};
        const contentDetails = item.contentDetails || {};
        const status = item.status || {};

        const durationInfo = parseIsoDuration(contentDetails.duration || "PT0S");
        const description = snippet.description || "";
        const tags = Array.isArray(snippet.tags) ? snippet.tags.map((t) => t.toLowerCase()) : [];
        const hashtags = extractHashtags(description);

        const rawTitle = typeof snippet.title === "string" ? snippet.title.trim() : "";
        const rawChannelTitle = typeof snippet.channelTitle === "string" ? snippet.channelTitle.trim() : "";

        // Reject incomplete records without fabricating titles or creator attribution
        if (!rawTitle) {
          incompleteIds.push(id);
          itemErrors.push(`Video '${id}': incomplete YouTube API response - missing title in snippet.`);
          continue;
        }

        if (!rawChannelTitle) {
          incompleteIds.push(id);
          itemErrors.push(`Video '${id}': incomplete YouTube API response - missing channelTitle in snippet.`);
          continue;
        }

        mappedItems.push({
          canonicalVideoId: id,
          title: rawTitle,
          description,
          channelId: snippet.channelId || "",
          channelTitle: rawChannelTitle,
          publishedAt: snippet.publishedAt || "",
          tags,
          hashtags,
          durationIso: contentDetails.duration || "",
          durationSec: durationInfo.seconds,
          durationFormatted: durationInfo.formatted,
          thumbnailUrl: selectBestThumbnail(snippet.thumbnails, id),
          embeddable: status.embeddable === true,
          privacyStatus: status.privacyStatus || "unknown",
          regionRestriction: contentDetails.regionRestriction || null,
          isMock: isSyntheticExecution ? true : false,
          provenance: isSyntheticExecution ? "synthetic_mock" : "youtube_data_api_v3",
          ...(isSyntheticExecution ? { syntheticOrigin: isCustomTransport ? "injected_fetch_transport" : "test_environment_mock" } : {}),
          fetchStatus: "success",
        });
      }

      const notFoundIds = batch.filter((id) => !foundIds.has(id));
      const allMissingIds = [...notFoundIds, ...incompleteIds];

      return {
        items: mappedItems,
        missingIds: allMissingIds,
        incompleteIds,
        confirmedUnavailableIds: notFoundIds,
        retryableIds: [],
        errors: itemErrors,
      };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  const errorMsg = lastError ? maskApiKey(lastError.message, apiKey) : "Network timeout or connection error";
  return {
    items: [],
    missingIds: batch,
    incompleteIds: batch,
    confirmedUnavailableIds: [],
    retryableIds: batch,
    retryable: true,
    errors: [`Failed to query YouTube API after ${attempt} attempts: ${errorMsg}`],
  };
}
