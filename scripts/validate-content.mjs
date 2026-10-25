import {
  statSync,
  openSync,
  readSync,
  closeSync,
  existsSync,
  readFileSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { resolve, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

// Register TypeScript loader for on-the-fly TS transpilation
try {
  register("./tests/ts-hooks.mjs", new URL("../", import.meta.url));
} catch {
  // If already registered or unavailable, proceed
}

export const VALID_MODES = ["metadata", "assets", "publish"];

export const PRIMARY_CATEGORIES = [
  "Anime",
  "Movies",
  "Series",
  "Multifandom",
  "Gaming",
  "Phonk",
];

export const LEGACY_CATEGORIES = ["Cinematic"];
export const ALL_CATEGORIES = [...PRIMARY_CATEGORIES, ...LEGACY_CATEGORIES];

export const VALID_TAG_REGEX = /^[a-z0-9_-]+$/;
export const DURATION_REGEX = /^[0-9]+:[0-5][0-9]$/;
export const FANDOM_SLUG_REGEX = /^[a-z0-9_-]+$/;
export const POSTER_PATH_REGEX = /^(\/|https?:\/\/|\.\/).+\.(svg|png|jpg|jpeg|webp)$/;
export const VIDEO_PATH_REGEX = /^(\/|https?:\/\/|\.\/).+(\.(mp4|webm|m4v)|youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11})$/;
export const RFC3339_DATE_TIME_REGEX =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$/;

export const ALLOWED_ROOT_KEYS = [
  "$schema",
  "manifestVersion",
  "catalogVersion",
  "generatedAt",
  "description",
  "items",
];

export const REQUIRED_RECORD_KEYS = [
  "id",
  "format",
  "title",
  "description",
  "category",
  "tags",
  "poster",
  "source",
  "duration",
];

export const ALLOWED_RECORD_KEYS = [
  "id",
  "format",
  "title",
  "description",
  "category",
  "fandomIds",
  "tags",
  "poster",
  "source",
  "duration",
  "durationMs",
  "trending",
  "sourceType",
  "youtubeVideoId",
  "channelTitle",
  "channelId",
  "sourceUrl",
  "media",
  "editorial",
];

export const ALLOWED_MEDIA_KEYS = [
  "aspectRatio",
  "width",
  "height",
  "codec",
  "audioCodec",
  "frameRate",
  "bitrateKbps",
  "loudnessLkfs",
];

export const ALLOWED_EDITORIAL_KEYS = [
  "reviewStatus",
  "rightsCleared",
  "sourceAttribution",
  "curatorNotes",
  "ownerAssetRef",
];

export const ALLOWED_CODECS = ["h264", "hevc", "av1", "vp9", "vp8"];
export const ALLOWED_AUDIO_CODECS = ["aac", "opus", "mp3", "none"];
export const ALLOWED_ASPECT_RATIOS = ["16:9", "9:16", "4:3", "2.39:1"];
export const ALLOWED_REVIEW_STATUSES = ["draft", "reviewed", "approved", "rejected", "published"];

// Stage 2: Pinned checksum and unforgeable baseline reference for the 17 frozen demo records
export const PINNED_EDITS_TS_SHA256 =
  "43d214282ba2122c3f3b95e0c047d92027ea33f05a54f6832e17543a2e575b88";

export const BASELINE_DEMO_TITLES = Object.freeze([
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
]);

export const BASELINE_DEMO_CATEGORIES = Object.freeze([
  "Cinematic",
  "Gaming",
  "Anime",
  "Movies",
  "Series",
  "Phonk",
]);

export const ID_PARTITIONS = Object.freeze({
  DEMO: { min: 0, max: 16, description: "Baseline demo edits" },
  RESERVED_TEST: { min: 17, max: 99, description: "Internal test harness" },
  YOUTUBE_VIDEO: { min: 100, max: 199, description: "Curated landscape YouTube videos" },
  YOUTUBE_SHORT: { min: 200, max: 299, description: "Curated portrait YouTube shorts" },
  HOSTED_VIDEO: { min: 300, max: 399, description: "Licensed hosted landscape videos" },
  HOSTED_SHORT: { min: 400, max: 499, description: "Licensed hosted portrait shorts" },
  RESERVED_UPPER: { min: 500, max: Infinity, description: "Unallocated / reserved" },
});

const PRIVATE_PUBLIC_FIELD_ALLOWLIST = new Set([
  "id",
  "title",
  "category",
  "tags",
  "description",
  "creator",
  "poster",
  "source",
  "duration",
  "trending",
  "format",
  "fandomIds",
  "sourceType",
  "youtubeVideoId",
  "channelTitle",
  "channelId",
  "sourceUrl",
]);

const PRIVATE_FORBIDDEN_FIELDS = new Set([
  "media",
  "editorial",
  "reviewStatus",
  "rightsCleared",
  "sourceAttribution",
  "curatorNotes",
  "ownerAssetRef",
  "canonicalVideoId",
  "auditHistory",
  "provenance",
  "isMock",
  "syntheticOrigin",
  "metadataFetchStatus",
  "lastMetadataVerification",
  "formatConfirmed",
  "confirmedFormat",
  "rawMetadata",
  "s3Key",
  "s3Bucket",
  "credentials",
  "apiKey",
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
]);

export const PUBLIC_FIELD_ALLOWLIST = Object.freeze(Array.from(PRIVATE_PUBLIC_FIELD_ALLOWLIST));
export const FORBIDDEN_PRIVATE_FIELDS = Object.freeze(Array.from(PRIVATE_FORBIDDEN_FIELDS));

export function isPublicFieldAllowed(field) {
  return PRIVATE_PUBLIC_FIELD_ALLOWLIST.has(field);
}

export function isForbiddenPrivateField(field) {
  return PRIVATE_FORBIDDEN_FIELDS.has(field);
}

export const SECRET_PATTERNS = Object.freeze([
  /s3\.amazonaws\.com/i,
  /s3:\/\//i,
  /AKIA[0-9A-Z]{16}/,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /client_secret/i,
  /ghp_[A-Za-z0-9]{36}/,
  /AIza[0-9A-Za-z-_]{35}/,
]);

export const BASELINE_DEMO_RECORDS = Object.freeze(
  BASELINE_DEMO_TITLES.map((title, id) =>
    Object.freeze({
      id,
      title,
      category: BASELINE_DEMO_CATEGORIES[id % 6],
      tags: Object.freeze([
        BASELINE_DEMO_CATEGORIES[id % 6].toLowerCase(),
        "original",
        "demo",
        id % 2 ? "neon" : "landscape",
      ]),
      description:
        "Original geometric artwork. Silent motion study for player testing; not finished creator footage.",
      creator: "Lolixco demo",
      posterSuffix: `media/art-${id}.svg`,
      sourceSuffix: "media/motion-study.webm",
      duration: "0:12",
      trending: id > 10,
    })
  )
);

export function isBaselineDemoRecord(candidate, options = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }

  const candidateKeys = Object.keys(candidate).sort();
  const expectedKeys = [
    "category",
    "creator",
    "description",
    "duration",
    "id",
    "poster",
    "source",
    "tags",
    "title",
    "trending",
  ];
  if (candidateKeys.length !== expectedKeys.length) {
    return false;
  }
  for (let i = 0; i < expectedKeys.length; i++) {
    if (candidateKeys[i] !== expectedKeys[i]) {
      return false;
    }
  }

  const id = candidate.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || id > 16) {
    return false;
  }

  const expected = BASELINE_DEMO_RECORDS[id];
  if (!expected) return false;

  if (candidate.title !== expected.title) return false;
  if (candidate.category !== expected.category) return false;
  if (candidate.description !== expected.description) return false;
  if (candidate.creator !== expected.creator) return false;
  if (candidate.duration !== expected.duration) return false;
  if (candidate.trending !== expected.trending) return false;

  if (!Array.isArray(candidate.tags) || candidate.tags.length !== expected.tags.length) {
    return false;
  }
  for (let i = 0; i < expected.tags.length; i++) {
    if (candidate.tags[i] !== expected.tags[i]) return false;
  }

  if (typeof candidate.poster !== "string" || typeof candidate.source !== "string") {
    return false;
  }

  const expectedPosterSuffix = `media/art-${id}.svg`;
  const expectedSourceSuffix = "media/motion-study.webm";

  if (!candidate.poster.endsWith(expectedPosterSuffix)) return false;
  if (!candidate.source.endsWith(expectedSourceSuffix)) return false;

  const posterBase = candidate.poster.slice(0, candidate.poster.length - expectedPosterSuffix.length);
  const sourceBase = candidate.source.slice(0, candidate.source.length - expectedSourceSuffix.length);

  if (posterBase !== sourceBase) return false;

  // Reject control characters, userinfo, and dot-traversal segments
  if (/[\x00-\x1f\x7f@]/.test(posterBase)) return false;
  if (posterBase !== "./" && (
    /(?:^|\/)\.\.(?:\/|$)/.test(posterBase) ||
    /\/\.(?:\/|$)/.test(posterBase) ||
    /(?:%2e\.|\.%2e|%2e%2e)/i.test(posterBase) ||
    /%252e/i.test(posterBase) ||
    posterBase === "." ||
    posterBase === ".."
  )) {
    return false;
  }

  // External or protocol-relative substitutions are rejected unless that exact base is explicitly approved
  if (posterBase.startsWith("//") || /^https?:\/\//i.test(posterBase)) {
    const approved = Array.isArray(options.approvedOrigins)
      ? options.approvedOrigins
      : Array.isArray(options.trustedOrigins)
      ? options.trustedOrigins
      : [];
    const isApproved = approved.some((orig) => {
      const origNormalized = orig.endsWith("/") ? orig : `${orig}/`;
      return posterBase === orig || posterBase === origNormalized;
    });
    if (!isApproved) {
      return false;
    }
  } else {
    // Exact trusted deployment base(s) and asset paths
    const defaultAllowedLocalBases = ["", "/", "./", "/app/", "/lolixco/"];
    const allowedLocalBases = Array.isArray(options.supportedBases)
      ? options.supportedBases
      : options.configuredBase
      ? [options.configuredBase, "", "/", "./"]
      : defaultAllowedLocalBases;

    if (!allowedLocalBases.includes(posterBase)) {
      return false;
    }
  }

  // Pinned checksum verification: mandatory whenever baseline trust is claimed (production or checksum flag)
  const shouldCheckChecksum =
    options.checkFileChecksum === true ||
    options.forProduction === true ||
    options.enforceChecksum !== false;

  if (shouldCheckChecksum) {
    try {
      const editsTsPath = resolve(projectRoot, "src/data/edits.ts");
      if (!existsSync(editsTsPath)) return false;
      const fileBuffer = readFileSync(editsTsPath);
      const hash = createHash("sha256").update(fileBuffer).digest("hex");
      if (hash !== PINNED_EDITS_TS_SHA256) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export function validateSourceAndId(record, options = {}) {
  const errors = [];
  const {
    isNewBatch = false,
    allowTestHarness = false,
    requireCuratedFields = false,
  } = options;

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { valid: false, errors: ["Record must be an object"] };
  }

  const id = record.id;
  if (id === undefined || id === null) {
    return { valid: false, errors: ["Missing required property 'id'"] };
  }

  if (typeof id !== "number" || !Number.isSafeInteger(id)) {
    return {
      valid: false,
      errors: [`Invalid ID: ${JSON.stringify(id)} (must be a safe integer)`],
    };
  }

  if (id < 0) {
    return {
      valid: false,
      errors: [`Invalid ID: ${id} (must be non-negative)`],
    };
  }

  const seenIds = options.seenIds;
  if (seenIds && seenIds.has(id)) {
    errors.push(`Duplicate ID: ${id} is already assigned in this catalog/manifest`);
  } else if (seenIds) {
    seenIds.add(id);
  }

  const format = record.format;
  const sourceType = record.sourceType;

  if (id >= 0 && id <= 16) {
    if (isNewBatch) {
      errors.push(
        `Reserved ID conflict: ID ${id} is reserved for baseline demo edits (0-16). New curated content must use IDs >= 100.`
      );
    } else {
      if (!isBaselineDemoRecord(record, options)) {
        errors.push(
          `Demo impersonation detected for ID ${id}: record does not match trusted baseline demo record anchored to pinned checksum.`
        );
      }
    }
  } else if (id >= 17 && id <= 99) {
    if (!allowTestHarness) {
      errors.push(
        `Reserved ID conflict: ID ${id} is reserved for internal test harnesses (17-99) and is never publishable. Use 100-199 for YouTube videos, 200-299 for YouTube shorts, 300-399 for hosted videos, 400-499 for hosted shorts.`
      );
    }
  } else if (id >= 100 && id <= 199) {
    if (requireCuratedFields && !sourceType) {
      errors.push(`Curated record requires explicit sourceType 'youtube_embed' for ID ${id}`);
    }
    if (requireCuratedFields && !format) {
      errors.push(`Curated record requires explicit format 'video' for ID ${id}`);
    }
    if (sourceType && sourceType !== "youtube_embed") {
      errors.push(
        `Source partition conflict: ID ${id} belongs to YouTube landscape partition [100..199], but sourceType is '${sourceType}'.`
      );
    }
    if (format === "short") {
      errors.push(
        `Format partition conflict: ID range mismatch: Curated Short ID ${id} belongs to landscape partition [100..199], but format is 'short'. Curated Short ID ${id} must be in range 200-299 according to documented allocation policy. Automatic format migration is prohibited.`
      );
    }
  } else if (id >= 200 && id <= 299) {
    if (requireCuratedFields && !sourceType) {
      errors.push(`Curated record requires explicit sourceType 'youtube_embed' for ID ${id}`);
    }
    if (requireCuratedFields && !format) {
      errors.push(`Curated record requires explicit format 'short' for ID ${id}`);
    }
    if (sourceType && sourceType !== "youtube_embed") {
      errors.push(
        `Source partition conflict: ID ${id} belongs to YouTube portrait partition [200..299], but sourceType is '${sourceType}'.`
      );
    }
    if (format === "video") {
      errors.push(
        `Format partition conflict: ID range mismatch: Landscape video ID ${id} belongs to portrait Short partition [200..299], but format is 'video'. Landscape video ID ${id} must be in range 100-199 according to documented allocation policy. Automatic format migration is prohibited.`
      );
    }
  } else if (id >= 300 && id <= 399) {
    if (requireCuratedFields && !sourceType) {
      errors.push(`Curated record requires explicit sourceType 'licensed_local_media' for ID ${id}`);
    }
    if (requireCuratedFields && !format) {
      errors.push(`Curated record requires explicit format 'video' for ID ${id}`);
    }
    if (sourceType && sourceType !== "licensed_local_media") {
      errors.push(
        `Source partition conflict: ID ${id} belongs to licensed hosted landscape partition [300..399], but sourceType is '${sourceType}'.`
      );
    }
    if (format === "short") {
      errors.push(
        `Format partition conflict: ID ${id} belongs to landscape partition [300..399], but format is 'short'. Automatic format migration is prohibited.`
      );
    }
  } else if (id >= 400 && id <= 499) {
    if (requireCuratedFields && !sourceType) {
      errors.push(`Curated record requires explicit sourceType 'licensed_local_media' for ID ${id}`);
    }
    if (requireCuratedFields && !format) {
      errors.push(`Curated record requires explicit format 'short' for ID ${id}`);
    }
    if (sourceType && sourceType !== "licensed_local_media") {
      errors.push(
        `Source partition conflict: ID ${id} belongs to licensed hosted portrait partition [400..499], but sourceType is '${sourceType}'.`
      );
    }
    if (format === "video") {
      errors.push(
        `Format partition conflict: ID ${id} belongs to portrait Short partition [400..499], but format is 'video'. Automatic format migration is prohibited.`
      );
    }
  } else if (id >= 500) {
    errors.push(`Unallocated ID partition: ID ${id} is outside allocated partitions [0..499].`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateMediaUrlOrigin(rawUrl, options = {}) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { valid: false, error: "Media URL must be a non-empty string" };
  }

  const trimmed = rawUrl.trim();

  // Step 1: Raw String Security Checks
  if (/[\x00-\x1F\x7F\\]/.test(trimmed)) {
    return { valid: false, error: "URL contains forbidden control characters or backslashes" };
  }
  if (/%5c/i.test(trimmed)) {
    return { valid: false, error: "URL contains encoded backslash (%5C)" };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*@/.test(trimmed)) {
    return { valid: false, error: "URL contains forbidden userinfo syntax ('@')" };
  }

  const afterScheme = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  if (afterScheme.includes("//")) {
    return { valid: false, error: "URL contains forbidden double slashes" };
  }

  const pathPart = afterScheme.split(/[?#]/)[0];
  const queryPart = afterScheme.includes("?") ? afterScheme.split("?")[1].split("#")[0] : "";

  // Reject raw, single-dot, double-dot, mixed encoded, and double-encoded dot segments in path
  if (
    /(?:^|\/)(?:\.\.|\.%2e|%2e\.|%2e%2e|\.|%2e)(?:\/|$)/i.test(pathPart) ||
    /%252e/i.test(pathPart)
  ) {
    return { valid: false, error: "URL contains forbidden directory traversal or dot segment" };
  }

  if (/%2f/i.test(pathPart)) {
    return { valid: false, error: "URL contains forbidden encoded path separator (%2F)" };
  }

  // Query parameter security checks
  if (queryPart) {
    const rawPairs = queryPart.split("&");
    const seenParamKeys = new Set();
    for (const pair of rawPairs) {
      if (!pair) continue;
      const rawKey = pair.split("=")[0];
      if (/%[0-9a-fA-F]{2}/.test(rawKey)) {
        return { valid: false, error: `URL contains forbidden percent-encoded parameter name: '${rawKey}'` };
      }
      if (seenParamKeys.has(rawKey)) {
        if (rawKey === "v") {
          return { valid: false, error: "YouTube watch URL must contain exactly one 'v' parameter, found duplicate" };
        }
        return { valid: false, error: `URL contains duplicate query parameter: '${rawKey}'` };
      }
      seenParamKeys.add(rawKey);
    }
  }

  // Step 2: Parse URL
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return { valid: false, error: `Invalid URL syntax: ${err.message}` };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, error: `Media URL must use HTTPS protocol, got '${parsed.protocol}'` };
  }

  if (parsed.port !== "") {
    return { valid: false, error: `Media URL cannot specify custom port: ${parsed.port}` };
  }

  if (parsed.hash !== "") {
    return { valid: false, error: "Media URL cannot contain fragment identifier ('#')" };
  }

  // Hostname check: ASCII lowercase alphanumeric, hyphens, and dots only
  if (!/^[a-z0-9.-]+$/.test(parsed.hostname)) {
    return { valid: false, error: `URL hostname contains forbidden characters: ${parsed.hostname}` };
  }

  const sourceType = options.sourceType || "youtube_embed";
  const kind = options.kind || "source";
  const format = options.format;
  const expectedVideoId = options.expectedVideoId;

  // Step 3 & 4 & 5: Source-specific policy and path checks
  if (sourceType === "youtube_embed") {
    if (kind === "source") {
      const allowedOrigins = ["https://www.youtube.com", "https://youtube.com"];
      if (!allowedOrigins.includes(parsed.origin)) {
        return {
          valid: false,
          error: `YouTube watch URL origin must be 'https://www.youtube.com', got '${parsed.origin}'`,
        };
      }
      if (parsed.pathname !== "/watch") {
        return {
          valid: false,
          error: `YouTube watch URL pathname must be '/watch', got '${parsed.pathname}'`,
        };
      }
      const searchParams = Array.from(parsed.searchParams.entries());
      const vEntries = searchParams.filter(([k]) => k === "v");
      if (vEntries.length !== 1) {
        return {
          valid: false,
          error: `YouTube watch URL must contain exactly one 'v' parameter, found ${vEntries.length}`,
        };
      }
      if (searchParams.length !== 1) {
        return {
          valid: false,
          error: `YouTube watch URL must not contain query parameters other than 'v'`,
        };
      }
      const videoId = vEntries[0][1];
      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return {
          valid: false,
          error: `Invalid YouTube video ID format: '${videoId}' (must be 11 characters)`,
        };
      }
      if (expectedVideoId && videoId !== expectedVideoId) {
        return {
          valid: false,
          error: `YouTube video ID mismatch: expected '${expectedVideoId}', got '${videoId}'`,
        };
      }
    } else if (kind === "poster") {
      const allowedOrigins = ["https://i.ytimg.com"];
      if (!allowedOrigins.includes(parsed.origin)) {
        return {
          valid: false,
          error: `YouTube poster URL origin must be 'https://i.ytimg.com', got '${parsed.origin}'`,
        };
      }
      if (parsed.search !== "") {
        return {
          valid: false,
          error: "YouTube poster URL must not contain query parameters",
        };
      }
      const match = parsed.pathname.match(
        /^\/vi\/([a-zA-Z0-9_-]{11})\/(hqdefault|maxresdefault|default|mqdefault|sddefault)\.jpg$/
      );
      if (!match) {
        return {
          valid: false,
          error: `YouTube poster path does not match standard thumbnail pattern: '${parsed.pathname}'`,
        };
      }
      const posterVideoId = match[1];
      if (expectedVideoId && posterVideoId !== expectedVideoId) {
        return {
          valid: false,
          error: `YouTube poster video ID mismatch: expected '${expectedVideoId}', got '${posterVideoId}'`,
        };
      }
    }
  } else if (sourceType === "licensed_local_media") {
    const approvedOrigins = options.approvedOrigins;
    if (!approvedOrigins || !Array.isArray(approvedOrigins) || approvedOrigins.length === 0) {
      return {
        valid: false,
        error: "Hosted media origin validation failed: no approved CDN origins configured (fail-closed policy).",
      };
    }
    // Verify policy entries: no wildcards, exact canonical origins
    for (const entry of approvedOrigins) {
      if (typeof entry !== "string" || entry.includes("*")) {
        return {
          valid: false,
          error: `Malformed origin policy: wildcards are prohibited: '${entry}'`,
        };
      }
      try {
        const pEntry = new URL(entry);
        if (pEntry.origin !== entry) {
          return {
            valid: false,
            error: `Malformed origin policy entry: '${entry}' must be a canonical origin`,
          };
        }
      } catch {
        return {
          valid: false,
          error: `Malformed origin policy entry: '${entry}'`,
        };
      }
    }

    if (!approvedOrigins.includes(parsed.origin)) {
      return {
        valid: false,
        error: `Hosted media origin '${parsed.origin}' is not authorized by origin policy`,
      };
    }

    if (parsed.search !== "") {
      return {
        valid: false,
        error: "Hosted media URL must not contain query parameters",
      };
    }

    if (kind === "source") {
      if (format === "video") {
        if (!parsed.pathname.startsWith("/optimized/landscape/")) {
          return {
            valid: false,
            error: `Hosted landscape video path must start with '/optimized/landscape/', got '${parsed.pathname}'`,
          };
        }
      } else if (format === "short") {
        if (!parsed.pathname.startsWith("/optimized/portrait/")) {
          return {
            valid: false,
            error: `Hosted portrait short path must start with '/optimized/portrait/', got '${parsed.pathname}'`,
          };
        }
      } else {
        if (!parsed.pathname.startsWith("/optimized/")) {
          return {
            valid: false,
            error: `Hosted video path must start with '/optimized/', got '${parsed.pathname}'`,
          };
        }
      }
      if (!/\.(mp4|webm)$/i.test(parsed.pathname)) {
        return {
          valid: false,
          error: `Hosted video file must have .mp4 or .webm extension, got '${parsed.pathname}'`,
        };
      }
    } else if (kind === "poster") {
      if (format === "video") {
        if (!parsed.pathname.startsWith("/posters/landscape/")) {
          return {
            valid: false,
            error: `Hosted landscape poster path must start with '/posters/landscape/', got '${parsed.pathname}'`,
          };
        }
      } else if (format === "short") {
        if (!parsed.pathname.startsWith("/posters/portrait/")) {
          return {
            valid: false,
            error: `Hosted portrait poster path must start with '/posters/portrait/', got '${parsed.pathname}'`,
          };
        }
      } else {
        if (!parsed.pathname.startsWith("/posters/")) {
          return {
            valid: false,
            error: `Hosted poster path must start with '/posters/', got '${parsed.pathname}'`,
          };
        }
      }
      if (!/\.(webp|jpg|jpeg|png|svg)$/i.test(parsed.pathname)) {
        return {
          valid: false,
          error: `Hosted poster file must have image extension, got '${parsed.pathname}'`,
        };
      }
    }
  }

  return {
    valid: true,
    canonicalUrl: `${parsed.origin}${parsed.pathname}${parsed.search}`,
  };
}

export function assertPublicEditIntegrity(record, options = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("assertPublicEditIntegrity failed: record must be a non-null object");
  }

  // 1. Check for forbidden private fields and unexpected properties
  for (const key of Object.keys(record)) {
    if (PRIVATE_FORBIDDEN_FIELDS.has(key)) {
      throw new Error(
        `assertPublicEditIntegrity failed: forbidden private field '${key}' leaked into public edit ID ${record.id}`
      );
    }
    if (!PRIVATE_PUBLIC_FIELD_ALLOWLIST.has(key)) {
      throw new Error(
        `assertPublicEditIntegrity failed: unrecognized property '${key}' in public edit ID ${record.id}`
      );
    }
  }

  // 2. Check required fields
  const required = [
    "id",
    "title",
    "category",
    "tags",
    "description",
    "creator",
    "poster",
    "source",
    "duration",
    "trending",
  ];
  for (const req of required) {
    if (!(req in record) || record[req] === undefined || record[req] === null) {
      throw new Error(
        `assertPublicEditIntegrity failed: missing required property '${req}' in public edit ID ${record.id}`
      );
    }
  }

  // 3. Validate types and value constraints
  const id = record.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) {
    throw new Error(
      `assertPublicEditIntegrity failed: 'id' must be a safe non-negative integer, got ${JSON.stringify(id)}`
    );
  }

  if (typeof record.title !== "string" || record.title.trim().length < 3 || record.title.trim().length > 100) {
    throw new Error(
      `assertPublicEditIntegrity failed: 'title' must be a string of 3-100 characters, got '${record.title}'`
    );
  }

  if (typeof record.category !== "string" || !ALL_CATEGORIES.includes(record.category)) {
    throw new Error(
      `assertPublicEditIntegrity failed: 'category' must be one of allowed categories, got '${record.category}'`
    );
  }
  if (id >= 100 && !PRIMARY_CATEGORIES.includes(record.category)) {
    throw new Error(
      `assertPublicEditIntegrity failed: curated edit ID ${id} cannot use legacy category '${record.category}'`
    );
  }

  if (!Array.isArray(record.tags) || record.tags.length < 1 || record.tags.length > 20) {
    throw new Error(
      `assertPublicEditIntegrity failed: 'tags' must be an array of 1-20 strings in edit ID ${id}`
    );
  }
  for (const t of record.tags) {
    if (typeof t !== "string" || !VALID_TAG_REGEX.test(t)) {
      throw new Error(
        `assertPublicEditIntegrity failed: tag '${t}' is invalid (must be lowercase alphanumeric/hyphen)`
      );
    }
  }

  if (
    typeof record.description !== "string" ||
    record.description.trim().length < 5 ||
    record.description.trim().length > 1000
  ) {
    throw new Error(
      `assertPublicEditIntegrity failed: 'description' must be 5-1000 characters in edit ID ${id}`
    );
  }

  if (
    typeof record.creator !== "string" ||
    record.creator.trim().length < 1 ||
    record.creator.trim().length > 100
  ) {
    throw new Error(
      `assertPublicEditIntegrity failed: 'creator' must be 1-100 characters in edit ID ${id}`
    );
  }

  if (typeof record.duration !== "string" || !DURATION_REGEX.test(record.duration)) {
    throw new Error(
      `assertPublicEditIntegrity failed: 'duration' must match M:SS or MM:SS format, got '${record.duration}' in edit ID ${id}`
    );
  }

  if (typeof record.trending !== "boolean") {
    throw new Error(
      `assertPublicEditIntegrity failed: 'trending' must be boolean, got ${typeof record.trending} in edit ID ${id}`
    );
  }

  // 4. Validate optional fields if present
  if (record.format !== undefined && record.format !== null) {
    if (record.format !== "video" && record.format !== "short") {
      throw new Error(
        `assertPublicEditIntegrity failed: 'format' must be 'video' or 'short', got '${record.format}' in edit ID ${id}`
      );
    }
  }

  if (record.fandomIds !== undefined && record.fandomIds !== null) {
    if (!Array.isArray(record.fandomIds)) {
      throw new Error(
        `assertPublicEditIntegrity failed: 'fandomIds' must be an array in edit ID ${id}`
      );
    }
    for (const f of record.fandomIds) {
      if (typeof f !== "string" || !FANDOM_SLUG_REGEX.test(f)) {
        throw new Error(
          `assertPublicEditIntegrity failed: fandom ID '${f}' is invalid in edit ID ${id}`
        );
      }
    }
  }

  if (record.sourceType !== undefined && record.sourceType !== null) {
    const validSources = ["local_demo", "youtube_embed", "licensed_local_media"];
    if (!validSources.includes(record.sourceType)) {
      throw new Error(
        `assertPublicEditIntegrity failed: 'sourceType' must be one of ${validSources.join(", ")}, got '${record.sourceType}' in edit ID ${id}`
      );
    }
  }

  // 5. Partition and field check
  if (id >= 0 && id <= 16) {
    if (!isBaselineDemoRecord(record, options)) {
      throw new Error(
        `assertPublicEditIntegrity failed: demo impersonation detected for ID ${id}`
      );
    }
  } else if (id >= 17 && id <= 99) {
    throw new Error(
      `assertPublicEditIntegrity failed: ID ${id} is reserved for internal test harnesses and cannot be published.`
    );
  } else if (id >= 100) {
    if (!record.sourceType || typeof record.sourceType !== "string") {
      throw new Error(
        `assertPublicEditIntegrity failed: curated public edit ID ${id} requires an explicit 'sourceType'`
      );
    }
    if (!record.format || typeof record.format !== "string") {
      throw new Error(
        `assertPublicEditIntegrity failed: curated public edit ID ${id} requires an explicit 'format'`
      );
    }

    const partitionCheck = validateSourceAndId(record, {
      isNewBatch: false,
      isLiveCatalog: true,
      requireCuratedFields: true,
    });
    if (!partitionCheck.valid) {
      throw new Error(
        `assertPublicEditIntegrity failed: ID partition check failed for edit ID ${id}: ${partitionCheck.errors.join("; ")}`
      );
    }
  }

  if (record.sourceType === "youtube_embed") {
    if (!record.youtubeVideoId || typeof record.youtubeVideoId !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(record.youtubeVideoId)) {
      throw new Error(
        `assertPublicEditIntegrity failed: 'youtubeVideoId' must be 11 characters, got '${record.youtubeVideoId}' in edit ID ${id}`
      );
    }
  } else if (record.youtubeVideoId !== undefined && record.youtubeVideoId !== null) {
    throw new Error(
      `assertPublicEditIntegrity failed: 'youtubeVideoId' is only allowed for youtube_embed sources, got '${record.sourceType}' in edit ID ${id}`
    );
  }

  if (record.channelTitle !== undefined && record.channelTitle !== null) {
    if (typeof record.channelTitle !== "string" || record.channelTitle.length > 100) {
      throw new Error(
        `assertPublicEditIntegrity failed: 'channelTitle' must be string up to 100 characters in edit ID ${id}`
      );
    }
  }

  if (record.channelId !== undefined && record.channelId !== null) {
    if (typeof record.channelId !== "string" || record.channelId.length > 100) {
      throw new Error(
        `assertPublicEditIntegrity failed: 'channelId' must be string up to 100 characters in edit ID ${id}`
      );
    }
  }

  if (record.sourceUrl !== undefined && record.sourceUrl !== null) {
    if (typeof record.sourceUrl !== "string" || !record.sourceUrl.startsWith("https://")) {
      throw new Error(
        `assertPublicEditIntegrity failed: 'sourceUrl' must be a valid HTTPS URL in edit ID ${id}`
      );
    }
    const sourceUrlCheck = validateMediaUrlOrigin(record.sourceUrl, {
      sourceType: record.sourceType || "youtube_embed",
      kind: "source",
      format: record.format,
      expectedVideoId: record.youtubeVideoId,
      approvedOrigins: options.approvedOrigins,
    });
    if (!sourceUrlCheck.valid) {
      throw new Error(
        `assertPublicEditIntegrity failed: sourceUrl validation failed in edit ID ${id}: ${sourceUrlCheck.error}`
      );
    }
  }

  // 6. URL validation for curated content based on explicit sourceType
  if (id >= 100) {
    if (record.sourceType === "youtube_embed") {
      const sourceUrlCheck = validateMediaUrlOrigin(record.source, {
        sourceType: "youtube_embed",
        kind: "source",
        format: record.format,
        expectedVideoId: record.youtubeVideoId,
        approvedOrigins: options.approvedOrigins,
      });
      if (!sourceUrlCheck.valid) {
        throw new Error(
          `assertPublicEditIntegrity failed: source URL validation failed in edit ID ${id}: ${sourceUrlCheck.error}`
        );
      }

      const posterUrlCheck = validateMediaUrlOrigin(record.poster, {
        sourceType: "youtube_embed",
        kind: "poster",
        format: record.format,
        expectedVideoId: record.youtubeVideoId,
        approvedOrigins: options.approvedOrigins,
      });
      if (!posterUrlCheck.valid) {
        throw new Error(
          `assertPublicEditIntegrity failed: poster URL validation failed in edit ID ${id}: ${posterUrlCheck.error}`
        );
      }
    } else if (record.sourceType === "licensed_local_media") {
      const sourceUrlCheck = validateMediaUrlOrigin(record.source, {
        sourceType: "licensed_local_media",
        kind: "source",
        format: record.format,
        approvedOrigins: options.approvedOrigins,
      });
      if (!sourceUrlCheck.valid) {
        throw new Error(
          `assertPublicEditIntegrity failed: source URL validation failed in edit ID ${id}: ${sourceUrlCheck.error}`
        );
      }

      const posterUrlCheck = validateMediaUrlOrigin(record.poster, {
        sourceType: "licensed_local_media",
        kind: "poster",
        format: record.format,
        approvedOrigins: options.approvedOrigins,
      });
      if (!posterUrlCheck.valid) {
        throw new Error(
          `assertPublicEditIntegrity failed: poster URL validation failed in edit ID ${id}: ${posterUrlCheck.error}`
        );
      }
    }
  }

  // 7. Leakage / Secret scan (recursive for strings and string arrays)
  function scanValueForSecrets(val, path) {
    if (typeof val === "string") {
      for (const pat of SECRET_PATTERNS) {
        if (pat.test(val)) {
          throw new Error(
            `assertPublicEditIntegrity failed: secret/leakage pattern detected in field '${path}' of edit ID ${id}`
          );
        }
      }
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        scanValueForSecrets(val[i], `${path}[${i}]`);
      }
    }
  }

  for (const [k, val] of Object.entries(record)) {
    scanValueForSecrets(val, k);
  }

  return true;
}const schemaPath = resolve(projectRoot, "content/manifest.schema.json");
export const manifestSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));
export const contentRecordSchema = manifestSchema.definitions.ContentRecord;

export function isValidDateTime(val) {
  if (typeof val !== "string") return false;
  const match = val.match(
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?([Zz]|[+-](?:[0-9]{2}):(?:[0-9]{2}))$/
  );
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const min = parseInt(match[5], 10);
  const sec = parseInt(match[6], 10);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour > 23 || min > 59 || sec > 59) return false;

  const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDays) return false;

  const timestamp = Date.parse(val);
  return !isNaN(timestamp);
}

export function normalizeCodec(name) {
  if (!name) return "";
  const lower = name.toLowerCase().trim();
  if (lower === "h264" || lower === "avc1") return "h264";
  if (lower === "hevc" || lower === "h265" || lower === "hev1" || lower === "hvc1") return "hevc";
  if (lower === "av1" || lower === "av01") return "av1";
  if (lower === "vp9") return "vp9";
  if (lower === "vp8") return "vp8";
  return lower;
}

export function validateJsonSchema(data, schema, rootSchema = schema, path = "") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;

  if (schema.$ref) {
    const refKey = schema.$ref.replace("#/definitions/", "");
    const refSchema = rootSchema.definitions?.[refKey];
    if (!refSchema) {
      throw new Error(`Unresolved schema reference: ${schema.$ref}`);
    }
    return validateJsonSchema(data, refSchema, rootSchema, path);
  }

  if (data === null) {
    errors.push(`Property '${path || "value"}' cannot be null`);
    return errors;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    let matchesType = false;
    for (const t of types) {
      if (t === "object" && typeof data === "object" && !Array.isArray(data)) matchesType = true;
      if (t === "array" && Array.isArray(data)) matchesType = true;
      if (t === "string" && typeof data === "string") matchesType = true;
      if (t === "integer" && typeof data === "number" && Number.isInteger(data)) matchesType = true;
      if (t === "number" && typeof data === "number" && !isNaN(data)) matchesType = true;
      if (t === "boolean" && typeof data === "boolean") matchesType = true;
    }
    if (!matchesType) {
      const actualType = Array.isArray(data) ? "array" : typeof data;
      errors.push(`Property '${path || "value"}' must be of type ${types.join(" or ")}, got ${actualType}`);
      return errors;
    }
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(
      `Property '${path || "value"}' must be one of allowed values: ${schema.enum.join(", ")}, got ${JSON.stringify(data)}`
    );
  }

  if (typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push(`Property '${path}' length must be at least ${schema.minLength} chars, got ${data.length}`);
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push(`Property '${path}' length must be at most ${schema.maxLength} chars, got ${data.length}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errors.push(`Property '${path}' must match pattern ${schema.pattern}, got "${data}"`);
    }
    if (schema.format === "date-time" && !isValidDateTime(data)) {
      errors.push(`Property '${path}' must be a valid RFC 3339 / ISO 8601 date-time string, got "${data}"`);
    }
  }

  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`Property '${path}' must be >= ${schema.minimum}, got ${data}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`Property '${path}' must be <= ${schema.maximum}, got ${data}`);
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push(`Property '${path}' must contain at least ${schema.minItems} items, got ${data.length}`);
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const itemErrors = validateJsonSchema(data[i], schema.items, rootSchema, `${path}[${i}]`);
        errors.push(...itemErrors);
      }
    }
  }

  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    if (schema.required) {
      for (const reqKey of schema.required) {
        if (!(reqKey in data) || data[reqKey] === undefined) {
          errors.push(`Missing required property '${reqKey}'${path ? ` in ${path}` : ""}`);
        }
      }
    }

    for (const [key, val] of Object.entries(data)) {
      const propSchema = schema.properties?.[key];
      const propPath = path ? `${path}.${key}` : key;
      if (!propSchema) {
        if (schema.additionalProperties === false) {
          errors.push(`Unexpected property '${key}'${path ? ` in ${path}` : ""} (schema forbids additionalProperties)`);
        }
      } else if (val !== undefined) {
        errors.push(...validateJsonSchema(val, propSchema, rootSchema, propPath));
      }
    }
  }

  return errors;
}

export function isFFprobeAvailable() {
  try {
    const res = spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

export function inspectVideoWithFFprobe(filePath) {
  if (!isFFprobeAvailable()) {
    return { available: false, ok: false, error: "ffprobe is not installed in the execution environment" };
  }
  try {
    const res = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,width,height,r_frame_rate,duration:format=duration",
        "-of",
        "json",
        filePath,
      ],
      { encoding: "utf8" }
    );
    if (!res || res.status !== 0 || !res.stdout || !res.stdout.trim()) {
      return {
        available: true,
        ok: false,
        error: `Stream inspection failed (code ${res?.status}): ${res?.stderr?.trim() || "undecodable, missing, or corrupted video stream"}`,
      };
    }

    let data;
    try {
      data = JSON.parse(res.stdout);
    } catch (parseErr) {
      return {
        available: true,
        ok: false,
        error: `Failed to parse ffprobe json output: ${parseErr.message}`,
      };
    }

    const streams = Array.isArray(data.streams) ? data.streams : [];
    const videoStream = streams.find((s) => s.codec_type === "video");

    if (!videoStream) {
      return { available: true, ok: false, error: "No video stream found in media file" };
    }

    const codec = videoStream.codec_name ? videoStream.codec_name.toLowerCase().trim() : null;
    const width = parseInt(videoStream.width, 10) || null;
    const height = parseInt(videoStream.height, 10) || null;
    const frameRateStr = videoStream.r_frame_rate ? String(videoStream.r_frame_rate).trim() : null;

    let frameRate = null;
    if (frameRateStr) {
      if (frameRateStr.includes("/")) {
        const [num, den] = frameRateStr.split("/").map((s) => parseFloat(s.trim()));
        if (den && !isNaN(num) && !isNaN(den) && den > 0) {
          frameRate = num / den;
        }
      } else {
        frameRate = parseFloat(frameRateStr) || null;
      }
    }

    if (!width || !height || width <= 0 || height <= 0) {
      return { available: true, ok: false, error: "Failed to decode valid stream dimensions from video" };
    }

    const streamDuration = videoStream.duration ? parseFloat(videoStream.duration) : null;
    const formatDuration = data.format?.duration ? parseFloat(data.format.duration) : null;
    const durationSec =
      streamDuration && !isNaN(streamDuration) && streamDuration > 0
        ? streamDuration
        : formatDuration && !isNaN(formatDuration) && formatDuration > 0
        ? formatDuration
        : null;

    const audioStream = streams.find((s) => s.codec_type === "audio");
    const hasAudio = !!audioStream;
    const audioCodec = audioStream?.codec_name ? audioStream.codec_name.toLowerCase().trim() : null;

    return {
      available: true,
      ok: true,
      width,
      height,
      codec,
      frameRate,
      frameRateStr,
      durationSec,
      hasAudio,
      audioCodec,
    };
  } catch (err) {
    return { available: true, ok: false, error: `ffprobe execution failed: ${err.message}` };
  }
}

export function isFFmpegAvailable() {
  try {
    const res = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

export function verifyVideoDecodeIntegrityWithFFmpeg(filePath) {
  if (!isFFmpegAvailable()) {
    return {
      available: false,
      ok: false,
      error: "ffmpeg is not installed in the execution environment",
    };
  }
  try {
    const res = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-xerror",
        "-i",
        filePath,
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8" }
    );
    if (!res || res.status !== 0) {
      return {
        available: true,
        ok: false,
        error: `FFmpeg decode verification failed (exit code ${res?.status}): ${
          res?.stderr?.trim() || "stream decode failed or file is truncated/corrupted"
        }`,
      };
    }
    const stderr = res.stderr ? res.stderr.trim() : "";
    if (stderr.length > 0 && /error|invalid|corrupt|truncated|end of file/i.test(stderr)) {
      return {
        available: true,
        ok: false,
        error: `FFmpeg decode verification detected stream errors: ${stderr}`,
      };
    }
    return {
      available: true,
      ok: true,
    };
  } catch (err) {
    return {
      available: true,
      ok: false,
      error: `FFmpeg execution failed: ${err.message}`,
    };
  }
}

export function verifyAssetBytesStreaming(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const info = statSync(filePath);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`Empty file or not a regular file (size: ${info.size})`);
  }

  const fd = openSync(filePath, "r");
  const buffer = Buffer.alloc(Math.min(65536, info.size));
  try {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      throw new Error("Unable to read file header (0 bytes read)");
    }
  } finally {
    closeSync(fd);
  }

  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case ".svg":
      if (!buffer.toString("utf8").includes("<svg")) {
        throw new Error("Invalid SVG: missing <svg element");
      }
      break;

    case ".png":
      if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new Error("Invalid PNG header signature (expected 89504e470d0a1a0a)");
      }
      break;

    case ".jpg":
    case ".jpeg":
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw new Error("Invalid JPEG header signature (expected ffd8ff)");
      }
      break;

    case ".webp":
      if (
        buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
        buffer.subarray(8, 12).toString("ascii") !== "WEBP"
      ) {
        throw new Error("Invalid WebP header signature (expected RIFF....WEBP)");
      }
      break;

    case ".mp4":
    case ".m4v":
      if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
        throw new Error("Invalid MP4 header signature (expected 'ftyp' box at offset 4)");
      }
      break;

    case ".webm":
      if (buffer.subarray(0, 4).toString("hex") !== "1a45dfa3") {
        throw new Error("Invalid WebM container signature (expected EBML 1a45dfa3)");
      }
      break;

    default:
      throw new Error(`Unsupported media extension: ${ext}`);
  }

  return { bytes: info.size, extension: ext };
}

export function verifyAssetPathContainment(targetFile, publicDir) {
  const mediaDir = resolve(publicDir, "media");
  const brandDir = resolve(publicDir, "brand");

  if (!targetFile.startsWith(mediaDir + sep) && !targetFile.startsWith(brandDir + sep)) {
    throw new Error(
      `Unsafe path traversal: "${targetFile}" resolves outside public/media or public/brand directory`
    );
  }

  if (!existsSync(targetFile)) {
    throw new Error(`File not found: ${targetFile}`);
  }

  const realTarget = realpathSync(targetFile);
  const realMediaDir = existsSync(mediaDir) ? realpathSync(mediaDir) : mediaDir;
  const realBrandDir = existsSync(brandDir) ? realpathSync(brandDir) : brandDir;

  const inMedia = realTarget.startsWith(realMediaDir + sep);
  const inBrand = realTarget.startsWith(realBrandDir + sep);

  if (!inMedia && !inBrand) {
    throw new Error(
      `Unsafe symlink escape: "${targetFile}" resolves outside public/media or public/brand directory (target: "${realTarget}")`
    );
  }

  return realTarget;
}export function validateContentRecord(record, options = {}) {
  const {
    seenIds = new Set(),
    isNewBatch = false,
    fandomRegistry = [],
    mode = "metadata",
    publicDir = resolve(projectRoot, "public"),
    videoInspector = inspectVideoWithFFprobe,
    decodeVerifier = verifyVideoDecodeIntegrityWithFFmpeg,
  } = options;

  const errors = [];
  const warnings = [];

  if (!VALID_MODES.includes(mode)) {
    return {
      valid: false,
      errors: [`Invalid validation mode '${mode}'. Allowed modes: ${VALID_MODES.join(", ")}`],
      warnings: [],
    };
  }

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {
      valid: false,
      errors: [
        `Record must be a JSON object, got ${record === null ? "null" : Array.isArray(record) ? "array" : typeof record}`,
      ],
      warnings: [],
    };
  }

  const isLiveCatalog = options.isLiveCatalog ?? !isNewBatch;

  for (const [k, v] of Object.entries(record)) {
    if (v === null) {
      errors.push(`Property '${k}' cannot be null`);
    }
  }

  const allowedKeys = isLiveCatalog
    ? [
        ...ALLOWED_RECORD_KEYS,
        "creator",
        "sourceType",
        "youtubeVideoId",
        "channelTitle",
        "channelId",
        "sourceUrl",
      ]
    : ALLOWED_RECORD_KEYS;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`Unexpected record property '${key}' (schema forbids additionalProperties)`);
    }
  }

  const requiredKeys = isLiveCatalog
    ? REQUIRED_RECORD_KEYS.filter((k) => k !== "format")
    : REQUIRED_RECORD_KEYS;
  for (const reqKey of requiredKeys) {
    if (!(reqKey in record) || record[reqKey] === undefined) {
      errors.push(`Missing required property '${reqKey}'`);
    }
  }

  // 1. Validate ID & Partition Consistency
  const sourceAndIdCheck = validateSourceAndId(record, {
    isNewBatch,
    isLiveCatalog,
    allowTestHarness: false,
    checkFileChecksum: false,
    seenIds,
  });
  if (!sourceAndIdCheck.valid) {
    errors.push(...sourceAndIdCheck.errors);
  }

  // 2. Validate Format
  const format = record.format ?? (isLiveCatalog ? "video" : undefined);
  if (record.format !== undefined && record.format !== null) {
    if (record.format !== "video" && record.format !== "short") {
      errors.push(`Invalid format: ${JSON.stringify(record.format)} (must be "video" or "short")`);
    }
  }

  // 3. Validate Title
  if (record.title !== undefined && record.title !== null) {
    if (typeof record.title !== "string" || !record.title.trim()) {
      errors.push("Title must be a non-empty string");
    } else if (record.title.trim().length < 3 || record.title.trim().length > 100) {
      errors.push(
        `Title length out of bounds: "${record.title.trim()}" (${record.title.trim().length} chars, expected 3-100)`
      );
    }
  }

  // 4. Validate Description
  if (record.description !== undefined && record.description !== null) {
    if (typeof record.description !== "string" || !record.description.trim()) {
      errors.push("Description must be a non-empty string");
    } else if (record.description.trim().length < 5 || record.description.trim().length > 1000) {
      errors.push(
        `Description length out of bounds (${record.description.trim().length} chars, expected 5-1000)`
      );
    }
  }

  // 5. Validate Category
  if (record.category !== undefined && record.category !== null) {
    if (typeof record.category !== "string" || !record.category.trim()) {
      errors.push("Category must be a non-empty string");
    } else {
      const trimmedCat = record.category.trim();
      if (!ALL_CATEGORIES.includes(trimmedCat)) {
        errors.push(
          `Invalid category: "${trimmedCat}". Allowed categories: ${ALL_CATEGORIES.join(", ")}`
        );
      } else if (isNewBatch && trimmedCat === "Cinematic") {
        errors.push(
          `Legacy category "Cinematic" is strictly reserved for demo edits (IDs 0-16). New content must use canonical categories: ${PRIMARY_CATEGORIES.join(", ")}`
        );
      }
    }
  }

  // 6. Validate Fandom Associations
  if (record.fandomIds !== undefined && record.fandomIds !== null) {
    if (!Array.isArray(record.fandomIds)) {
      errors.push("fandomIds must be an array of string slugs");
    } else {
      const registryMap = new Map(fandomRegistry.map((f) => [f.id.toLowerCase(), f]));
      for (const fandomId of record.fandomIds) {
        if (typeof fandomId !== "string" || !fandomId.trim()) {
          errors.push(`Invalid fandom ID: ${JSON.stringify(fandomId)}`);
          continue;
        }
        const normalized = fandomId.trim().toLowerCase();
        if (!FANDOM_SLUG_REGEX.test(normalized)) {
          errors.push(
            `Fandom slug "${fandomId}" contains invalid characters (allowed: /^[a-z0-9_-]+$/)`
          );
        }
        const fandom = registryMap.get(normalized);
        if (!fandom) {
          errors.push(
            `Unrecognized fandom ID: "${fandomId}". Must be registered in FANDOM_REGISTRY.`
          );
        } else if (record.category && record.category !== "Multifandom") {
          const compatible = fandom.categories.some(
            (c) => c.toLowerCase() === record.category.toLowerCase()
          );
          if (!compatible) {
            errors.push(
              `Fandom "${fandom.title}" (${fandom.id}) is associated with [${fandom.categories.join(", ")}], incompatible with category "${record.category}"`
            );
          }
        }
      }
    }
  }

  // 7. Validate Tags
  if (record.tags !== undefined && record.tags !== null) {
    if (!Array.isArray(record.tags)) {
      errors.push("tags must be an array of strings");
    } else if (record.tags.length === 0) {
      errors.push("tags array must contain at least one tag");
    } else {
      const tagSet = new Set();
      for (const t of record.tags) {
        if (typeof t !== "string" || !t.trim()) {
          errors.push(`Invalid tag: ${JSON.stringify(t)} (must be a non-empty string)`);
          continue;
        }
        const trimmedTag = t.trim();
        if (trimmedTag.startsWith("#")) {
          errors.push(`Tag "${t}" must not include leading '#' symbol`);
        }
        if (!VALID_TAG_REGEX.test(trimmedTag)) {
          errors.push(
            `Tag "${t}" contains invalid characters or uppercase letters (must match /^[a-z0-9_-]+$/)`
          );
        }
        if (tagSet.has(trimmedTag)) {
          errors.push(`Duplicate tag detected: "${trimmedTag}"`);
        }
        tagSet.add(trimmedTag);
      }
    }
  }

  // 8. Validate Duration
  if (record.duration !== undefined && record.duration !== null) {
    if (typeof record.duration !== "string" || !record.duration.trim()) {
      errors.push("Duration must be a non-empty string");
    } else if (!DURATION_REGEX.test(record.duration.trim())) {
      errors.push(
        `Duration format invalid: "${record.duration}". Must match M:SS or MM:SS (e.g. "0:24", "1:45")`
      );
    }
  }

  if (record.durationMs !== undefined && record.durationMs !== null) {
    if (
      typeof record.durationMs !== "number" ||
      !Number.isInteger(record.durationMs) ||
      record.durationMs < 1 ||
      record.durationMs > 3600000
    ) {
      errors.push(
        `durationMs must be an integer between 1 and 3,600,000 (1 hour max), got ${record.durationMs}`
      );
    } else if (record.duration && DURATION_REGEX.test(record.duration.trim())) {
      const [minStr, secStr] = record.duration.split(":");
      const declaredSec = parseInt(minStr, 10) * 60 + parseInt(secStr, 10);
      const msSec = record.durationMs / 1000;
      if (Math.abs(declaredSec - msSec) > 1.0) {
        errors.push(
          `Contradictory duration values: declared duration '${record.duration}' (${declaredSec}s) contradicts durationMs (${record.durationMs}ms / ${msSec.toFixed(1)}s) by more than 1s tolerance`
        );
      }
    }
  }  // Validate trending boolean
  if (record.trending !== undefined && record.trending !== null) {
    if (typeof record.trending !== "boolean") {
      errors.push(`Property 'trending' must be a boolean, got ${typeof record.trending}`);
    }
  }

  // 9. Validate Media Technical Metadata
  if (record.media !== undefined && record.media !== null) {
    if (typeof record.media !== "object" || Array.isArray(record.media)) {
      errors.push("media property must be an object");
    } else {
      for (const [mK, mV] of Object.entries(record.media)) {
        if (mV === null) {
          errors.push(`media.${mK} cannot be null`);
        }
      }

      for (const mKey of Object.keys(record.media)) {
        if (!ALLOWED_MEDIA_KEYS.includes(mKey)) {
          errors.push(`Unexpected media property '${mKey}' (schema forbids additionalProperties)`);
        }
      }

      const { aspectRatio, width, height, codec, audioCodec, frameRate, bitrateKbps, loudnessLkfs } =
        record.media;

      if (aspectRatio !== undefined && aspectRatio !== null && !ALLOWED_ASPECT_RATIOS.includes(aspectRatio)) {
        errors.push(
          `Invalid media.aspectRatio '${aspectRatio}'. Allowed: ${ALLOWED_ASPECT_RATIOS.join(", ")}`
        );
      }

      if (codec !== undefined && codec !== null && !ALLOWED_CODECS.includes(normalizeCodec(codec))) {
        errors.push(
          `Unsupported codec '${codec}'. Allowed: ${ALLOWED_CODECS.join(", ")}`
        );
      }

      if (audioCodec !== undefined && audioCodec !== null && !ALLOWED_AUDIO_CODECS.includes(normalizeCodec(audioCodec))) {
        errors.push(
          `Unsupported audioCodec '${audioCodec}'. Allowed: ${ALLOWED_AUDIO_CODECS.join(", ")}`
        );
      }

      if (width !== undefined && width !== null) {
        if (typeof width !== "number" || !Number.isInteger(width) || width < 320 || width > 7680) {
          errors.push(`media.width must be an integer between 320 and 7680, got ${width}`);
        }
      }

      if (height !== undefined && height !== null) {
        if (typeof height !== "number" || !Number.isInteger(height) || height < 320 || height > 4320) {
          errors.push(`media.height must be an integer between 320 and 4320, got ${height}`);
        }
      }

      if (frameRate !== undefined && frameRate !== null) {
        if (typeof frameRate !== "number" || frameRate < 23.976 || frameRate > 120) {
          errors.push(`media.frameRate must be a number between 23.976 and 120, got ${frameRate}`);
        }
      }

      if (bitrateKbps !== undefined && bitrateKbps !== null) {
        if (
          typeof bitrateKbps !== "number" ||
          !Number.isInteger(bitrateKbps) ||
          bitrateKbps < 100 ||
          bitrateKbps > 100000
        ) {
          errors.push(
            `media.bitrateKbps must be an integer between 100 and 100000, got ${bitrateKbps}`
          );
        }
      }

      if (loudnessLkfs !== undefined && loudnessLkfs !== null) {
        if (typeof loudnessLkfs !== "number" || loudnessLkfs < -30 || loudnessLkfs > -5) {
          errors.push(
            `media.loudnessLkfs must be a number between -30 and -5, got ${loudnessLkfs}`
          );
        }
      }

      if (aspectRatio && typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
        const declaredRatio = width / height;
        let matchesDeclared = false;
        let expectedRatioStr = "";
        if (aspectRatio === "16:9") {
          matchesDeclared = declaredRatio >= 1.70 && declaredRatio <= 1.86;
          expectedRatioStr = "16:9 (~1.778)";
        } else if (aspectRatio === "4:3") {
          matchesDeclared = declaredRatio >= 1.28 && declaredRatio <= 1.39;
          expectedRatioStr = "4:3 (~1.333)";
        } else if (aspectRatio === "2.39:1") {
          matchesDeclared = declaredRatio >= 2.30 && declaredRatio <= 2.48;
          expectedRatioStr = "2.39:1 (~2.390)";
        } else if (aspectRatio === "9:16") {
          const vRatio = height / width;
          matchesDeclared = vRatio >= 1.70 && vRatio <= 1.86;
          expectedRatioStr = "9:16 (~0.562)";
        }
        if (!matchesDeclared) {
          errors.push(
            `Declared media dimensions ${width}x${height} (ratio ${declaredRatio.toFixed(3)}) do not match declared media.aspectRatio '${aspectRatio}' (expected ${expectedRatioStr})`
          );
        }
      }

      if (format === "video") {
        if (aspectRatio === "9:16") {
          errors.push(`Format "video" (landscape) cannot declare vertical aspect ratio "9:16"`);
        }
        if (width && height && height > width) {
          errors.push(`Format "video" (landscape) has portrait dimensions: ${width}x${height}`);
        }
      } else if (format === "short") {
        if (aspectRatio && aspectRatio !== "9:16") {
          errors.push(
            `Format "short" (vertical) must have aspect ratio "9:16", got "${aspectRatio}"`
          );
        }
        if (width && height && width > height) {
          errors.push(`Format "short" (vertical) has landscape dimensions: ${width}x${height}`);
        }
      }
    }
  }

  // 10. Validate Asset References & Staged Files
  const checkAssetFiles = mode === "assets" || mode === "publish";

  if (record.poster !== undefined && record.poster !== null) {
    if (typeof record.poster !== "string" || !record.poster.trim()) {
      errors.push("Poster must be a non-empty string");
    } else if (record.sourceType === "youtube_embed") {
      const urlCheck = validateMediaUrlOrigin(record.poster, {
        sourceType: "youtube_embed",
        kind: "poster",
        format: record.format,
        expectedVideoId: record.youtubeVideoId,
      });
      if (!urlCheck.valid) {
        errors.push(`YouTube embed poster validation error: ${urlCheck.error}`);
      }
    } else if (record.sourceType === "licensed_local_media" && (record.poster.startsWith("http://") || record.poster.startsWith("https://"))) {
      const urlCheck = validateMediaUrlOrigin(record.poster, {
        sourceType: "licensed_local_media",
        kind: "poster",
        format: record.format,
        approvedOrigins: options.approvedOrigins,
      });
      if (!urlCheck.valid) {
        errors.push(`Hosted media poster validation error: ${urlCheck.error}`);
      }
    } else if (!POSTER_PATH_REGEX.test(record.poster.trim())) {
      errors.push(
        `Poster path '${record.poster}' does not match required pattern (must end in .svg, .png, .jpg, .jpeg, or .webp)`
      );
    } else if (checkAssetFiles) {
      if (record.poster.startsWith("http://") || record.poster.startsWith("https://")) {
        errors.push(
          `Remote poster reference '${record.poster}' cannot be verified offline. Staged local media is required for production publication.`
        );
      } else {
        const normalized = record.poster.startsWith("/") ? record.poster.slice(1) : record.poster;
        const targetFile = resolve(publicDir, normalized);
        try {
          const realTarget = verifyAssetPathContainment(targetFile, publicDir);
          verifyAssetBytesStreaming(realTarget);
        } catch (err) {
          errors.push(`Poster asset verification failed (${record.poster}): ${err.message}`);
        }
      }
    }
  }

  let inspectedStreamResult = null;
  let verifiedDecodeResult = null;

  if (record.source !== undefined && record.source !== null) {
    if (typeof record.source !== "string" || !record.source.trim()) {
      errors.push("Source video must be a non-empty string");
    } else if (record.sourceType === "youtube_embed") {
      const urlCheck = validateMediaUrlOrigin(record.source, {
        sourceType: "youtube_embed",
        kind: "source",
        format: record.format,
        expectedVideoId: record.youtubeVideoId,
      });
      if (!urlCheck.valid) {
        errors.push(`YouTube embed source validation error: ${urlCheck.error}`);
      }
    } else if (record.sourceType === "licensed_local_media" && (record.source.startsWith("http://") || record.source.startsWith("https://"))) {
      const urlCheck = validateMediaUrlOrigin(record.source, {
        sourceType: "licensed_local_media",
        kind: "source",
        format: record.format,
        approvedOrigins: options.approvedOrigins,
      });
      if (!urlCheck.valid) {
        errors.push(`Hosted media source validation error: ${urlCheck.error}`);
      }
    } else if (!VIDEO_PATH_REGEX.test(record.source.trim())) {
      errors.push(
        `Source video path '${record.source}' does not match required pattern (must end in .mp4, .webm, or .m4v)`
      );
    } else if (checkAssetFiles) {
      if (record.source.startsWith("http://") || record.source.startsWith("https://")) {
        errors.push(
          `Remote video reference '${record.source}' cannot be verified offline. Staged local media is required for production publication.`
        );
      } else {
        const normalized = record.source.startsWith("/") ? record.source.slice(1) : record.source;
        const targetFile = resolve(publicDir, normalized);
        try {
          const realTarget = verifyAssetPathContainment(targetFile, publicDir);
          verifyAssetBytesStreaming(realTarget);

          if (videoInspector) {
            inspectedStreamResult = videoInspector(realTarget);

            if (!inspectedStreamResult.available) {
              if (mode === "publish") {
                errors.push(
                  `Publication readiness requirement failed (${record.source}): ffprobe is required for physical media stream certification before publication.`
                );
              } else {
                warnings.push(
                  `Technical stream inspection incomplete (${record.source}): ffprobe unavailable in environment.`
                );
              }
            } else if (!inspectedStreamResult.ok) {
              if (mode === "publish") {
                errors.push(
                  `Source video stream inspection failed (${record.source}): ${inspectedStreamResult.error}`
                );
              } else {
                warnings.push(
                  `Source video stream warning (${record.source}): ${inspectedStreamResult.error}`
                );
              }
            } else {
              const { width, height, codec, durationSec, frameRate, hasAudio, audioCodec } =
                inspectedStreamResult;

              if (record.media?.width && width && record.media.width !== width) {
                errors.push(
                  `Actual stream width (${width}px) does not match declared media.width (${record.media.width}px)`
                );
              }

              if (record.media?.height && height && record.media.height !== height) {
                errors.push(
                  `Actual stream height (${height}px) does not match declared media.height (${record.media.height}px)`
                );
              }

              if (record.media?.aspectRatio && width && height) {
                const streamRatio = width / height;
                const declaredAR = record.media.aspectRatio;
                let matchesAR = false;
                let expectedStr = "";
                if (declaredAR === "16:9") {
                  matchesAR = streamRatio >= 1.70 && streamRatio <= 1.86;
                  expectedStr = "16:9 (~1.778)";
                } else if (declaredAR === "4:3") {
                  matchesAR = streamRatio >= 1.28 && streamRatio <= 1.39;
                  expectedStr = "4:3 (~1.333)";
                } else if (declaredAR === "2.39:1") {
                  matchesAR = streamRatio >= 2.30 && streamRatio <= 2.48;
                  expectedStr = "2.39:1 (~2.390)";
                } else if (declaredAR === "9:16") {
                  const verticalRatio = height / width;
                  matchesAR = verticalRatio >= 1.70 && verticalRatio <= 1.86;
                  expectedStr = "9:16 (~0.562)";
                }
                if (!matchesAR) {
                  errors.push(
                    `Actual stream dimensions (${width}x${height}, ratio ${streamRatio.toFixed(3)}) do not match declared media.aspectRatio '${declaredAR}' (expected ${expectedStr})`
                  );
                }
              }

              // Validate genuine format aspect ratio
              if (format === "video") {
                if (height > width) {
                  errors.push(
                    `Actual media stream is portrait (${width}x${height}), incompatible with format "video"`
                  );
                } else {
                  const ratio = width / height;
                  if (ratio < 1.28 || ratio > 2.50) {
                    errors.push(
                      `Actual video aspect ratio (${width}x${height}, ratio ${ratio.toFixed(3)}) is not a genuine landscape format (expected 16:9 ratio ~1.777 or 4:3 ~1.333)`
                    );
                  }
                }
              } else if (format === "short") {
                if (width > height) {
                  errors.push(
                    `Actual media stream is landscape (${width}x${height}), incompatible with format "short"`
                  );
                } else {
                  const verticalRatio = height / width;
                  // Genuine portrait Short: 9:16 is ratio ~1.777 (or width/height ~0.562). Tolerance 1.70 to 1.86.
                  if (verticalRatio < 1.70 || verticalRatio > 1.86) {
                    errors.push(
                      `Actual video aspect ratio (${width}x${height}, ratio ${(width / height).toFixed(3)}) is not a genuine portrait 9:16 Short (expected 9:16 portrait ratio ~0.562)`
                    );
                  }
                }
              }

              if (record.media?.codec && codec) {
                const normalizedStreamCodec = normalizeCodec(codec);
                const declaredCodec = normalizeCodec(record.media.codec);
                if (normalizedStreamCodec !== declaredCodec) {
                  errors.push(
                    `Actual video codec '${codec}' does not match declared media.codec '${record.media.codec}'`
                  );
                }
              }

              if (record.media?.audioCodec) {
                const declaredAudio = normalizeCodec(record.media.audioCodec);
                if (declaredAudio === "none") {
                  if (hasAudio) {
                    errors.push(
                      `Actual media file contains an audio stream ('${audioCodec || "audio"}'), but declared media.audioCodec is 'none'`
                    );
                  }
                } else {
                  if (!hasAudio) {
                    errors.push(
                      `Actual media file contains no audio streams, but declared media.audioCodec is '${record.media.audioCodec}'`
                    );
                  } else if (audioCodec) {
                    const normalizedStreamAudio = normalizeCodec(audioCodec);
                    if (normalizedStreamAudio !== declaredAudio) {
                      errors.push(
                        `Actual audio codec '${audioCodec}' does not match declared media.audioCodec '${record.media.audioCodec}'`
                      );
                    }
                  }
                }
              }

              if (record.media?.frameRate && typeof frameRate === "number") {
                if (Math.abs(frameRate - record.media.frameRate) > 0.5) {
                  errors.push(
                    `Actual frame rate (${frameRate.toFixed(2)} fps) deviates from declared frameRate (${record.media.frameRate} fps) by more than 0.5 fps tolerance`
                  );
                }
              }

              if (typeof durationSec === "number" && durationSec > 0) {
                if (record.duration) {
                  const [minStr, secStr] = record.duration.split(":");
                  const declaredSec = parseInt(minStr, 10) * 60 + parseInt(secStr, 10);
                  if (Math.abs(durationSec - declaredSec) > 3.0) {
                    errors.push(
                      `Actual stream duration (${durationSec.toFixed(1)}s) deviates from declared duration '${record.duration}' (${declaredSec}s) by more than 3s tolerance`
                    );
                  }
                }
                if (typeof record.durationMs === "number" && record.durationMs > 0) {
                  const msSec = record.durationMs / 1000;
                  if (Math.abs(durationSec - msSec) > 3.0) {
                    errors.push(
                      `Actual stream duration (${durationSec.toFixed(1)}s) deviates from declared durationMs (${record.durationMs}ms / ${msSec.toFixed(1)}s) by more than 3s tolerance`
                    );
                  }
                }
              } else if (mode === "publish") {
                errors.push(
                  `Publication readiness failed (${record.source}): Failed to retrieve reliable physical duration from media file. Properties cannot be certified without measurement.`
                );
              }
            }
          }

          if (decodeVerifier) {
            verifiedDecodeResult = decodeVerifier(realTarget);

            if (!verifiedDecodeResult.available) {
              if (mode === "publish") {
                errors.push(
                  `Publication readiness requirement failed (${record.source}): ffmpeg is required for playback decode integrity verification before publication.`
                );
              } else {
                warnings.push(
                  `Playback decode integrity verification incomplete (${record.source}): ffmpeg unavailable in environment.`
                );
              }
            } else if (!verifiedDecodeResult.ok) {
              if (mode === "publish") {
                errors.push(
                  `Source video playback decode integrity verification failed (${record.source}): ${verifiedDecodeResult.error}`
                );
              } else {
                warnings.push(
                  `Source video playback decode warning (${record.source}): ${verifiedDecodeResult.error}`
                );
              }
            }
          }
        } catch (err) {
          errors.push(`Source video verification failed (${record.source}): ${err.message}`);
        }
      }
    }
  }

  // 11. Validate Editorial & Publication Requirements
  if (record.editorial !== undefined && record.editorial !== null) {
    if (typeof record.editorial !== "object" || Array.isArray(record.editorial)) {
      errors.push("editorial property must be an object");
    } else {
      for (const [eK, eV] of Object.entries(record.editorial)) {
        if (eV === null) {
          errors.push(`editorial.${eK} cannot be null`);
        }
      }

      for (const eKey of Object.keys(record.editorial)) {
        if (!ALLOWED_EDITORIAL_KEYS.includes(eKey)) {
          errors.push(
            `Unexpected editorial property '${eKey}' (schema forbids additionalProperties)`
          );
        }
      }

      const { reviewStatus, rightsCleared, sourceAttribution, curatorNotes, ownerAssetRef } =
        record.editorial;

      if (reviewStatus !== undefined && reviewStatus !== null && !ALLOWED_REVIEW_STATUSES.includes(reviewStatus)) {
        errors.push(
          `Invalid editorial.reviewStatus '${reviewStatus}'. Allowed: ${ALLOWED_REVIEW_STATUSES.join(", ")}`
        );
      }

      if (rightsCleared !== undefined && rightsCleared !== null && typeof rightsCleared !== "boolean") {
        errors.push("editorial.rightsCleared must be a boolean");
      }

      if (sourceAttribution !== undefined && sourceAttribution !== null) {
        if (typeof sourceAttribution !== "string" || sourceAttribution.length > 500) {
          errors.push("editorial.sourceAttribution must be a string up to 500 characters");
        }
      }

      if (curatorNotes !== undefined && curatorNotes !== null) {
        if (typeof curatorNotes !== "string" || curatorNotes.length > 1000) {
          errors.push("editorial.curatorNotes must be a string up to 1000 characters");
        }
      }

      if (ownerAssetRef !== undefined && ownerAssetRef !== null) {
        if (typeof ownerAssetRef !== "string" || ownerAssetRef.length > 100) {
          errors.push("editorial.ownerAssetRef must be a string up to 100 characters");
        }
      }
    }
  }

  if (mode === "publish") {
    const id = record.id;
    const isYouTube = record.sourceType === "youtube_embed";
    if (isYouTube) {
      const status = record.editorial?.reviewStatus || record.contentReviewStatus || record.reviewStatus;
      if (status !== "approved" && status !== "published") {
        errors.push(
          `Publication requirement failed for ID ${id}: reviewStatus is "${status}". Only "approved" or "published" records may be published.`
        );
      }
    } else {
      if (!record.editorial) {
        errors.push(
          `Publication requirement failed for ID ${id}: Missing editorial review block. Approved review and documented rights clearance are mandatory for publication.`
        );
      } else {
        const status = record.editorial.reviewStatus;
        if (status !== "approved" && status !== "published") {
          errors.push(
            `Publication requirement failed for ID ${id}: reviewStatus is "${status}". Only "approved" or "published" records may be published.`
          );
        }
        if (record.editorial.rightsCleared !== true) {
          errors.push(
            `Publication requirement failed for ID ${id}: rightsCleared is not true. Documented rights clearance is mandatory for publication.`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    inspectedStream: inspectedStreamResult,
    verifiedDecode: verifiedDecodeResult,
  };
}
export function resolveItemAuditEvidence(item, options = {}) {
  if (!item || typeof item !== "object") return null;

  const id = item.id ?? item.assignedLolixcoId;
  let publicVideoId = item.youtubeVideoId;
  if (!publicVideoId && typeof item.source === "string") {
    const match = /[?&]v=([a-zA-Z0-9_-]{11})(?:&|$)/.exec(item.source);
    if (match) publicVideoId = match[1];
  }
  if (!publicVideoId && typeof item.canonicalVideoId === "string") {
    publicVideoId = item.canonicalVideoId;
  }

  if (Array.isArray(options.auditRecords)) {
    const idMatches = typeof id === "number"
      ? options.auditRecords.filter((a) => a && (a.assignedLolixcoId === id || a.id === id))
      : [];
    const videoMatches = typeof publicVideoId === "string" && publicVideoId
      ? options.auditRecords.filter((a) => a && (a.canonicalVideoId === publicVideoId || a.youtubeVideoId === publicVideoId))
      : [];

    if (idMatches.length > 1) {
      return { error: `Ambiguous audit match: multiple audit records (${idMatches.length}) match candidate ID ${id}.` };
    }
    if (videoMatches.length > 1) {
      return { error: `Ambiguous audit match: multiple audit records (${videoMatches.length}) match video ID '${publicVideoId}'.` };
    }

    if (idMatches.length === 1 && videoMatches.length === 1 && idMatches[0] !== videoMatches[0]) {
      return { error: `Conflicting audit match: audit record for candidate ID ${id} differs from audit record for video ID '${publicVideoId}'.` };
    }

    const matched = idMatches[0] || videoMatches[0];
    if (matched) return { evidence: matched };
    return null;
  }

  if (options.auditContext) {
    if (typeof options.auditContext.getAuditForRecord === "function") {
      const res = options.auditContext.getAuditForRecord(item);
      return res ? { evidence: res } : null;
    }
    if (typeof options.auditContext === "function") {
      const res = options.auditContext(item);
      return res ? { evidence: res } : null;
    }
    if (typeof options.auditContext === "object") {
      const idMatch = typeof id === "number" ? options.auditContext[id] : null;
      const videoMatch = typeof publicVideoId === "string" && publicVideoId ? options.auditContext[publicVideoId] : null;

      if (idMatch && videoMatch && idMatch !== videoMatch) {
        return { error: `Conflicting audit match in auditContext: record for ID ${id} differs from record for video ID '${publicVideoId}'.` };
      }

      const matched = idMatch || videoMatch;
      if (matched) return { evidence: matched };
    }
  }

  return null;
}
export function verifyProductionPublicationEligibility(item, options = {}) {
  const errors = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { valid: false, errors: ["Record must be an object"] };
  }

  // Preview or bypass options strictly forbidden during production publication
  if (options.allowDraft || options.strict === false || options.allowSyntheticAudit) {
    return {
      valid: false,
      errors: [
        "Production publication aborted: preview or bypass options (allowDraft: true, strict: false, or allowSyntheticAudit: true) are strictly forbidden for production output."
      ],
    };
  }

  const id = item.id ?? item.assignedLolixcoId;
  const sourceType = item.sourceType;

  // 1. Frozen Demos (0-16)
  if (typeof id === "number" && id >= 0 && id <= 16) {
    if (!isBaselineDemoRecord(item, { ...options, checkFileChecksum: true, enforceChecksum: true, forProduction: true })) {
      errors.push(`Demo ID ${id} failed baseline demo verification anchored to pinned checksum.`);
    }
    return { valid: errors.length === 0, errors };
  }

  // 2. YouTube Embeds (100-299 or sourceType === "youtube_embed")
  if (sourceType === "youtube_embed" || (typeof id === "number" && id >= 100 && id <= 299)) {
    // Resolve audit evidence explicitly WITHOUT overwriting candidate intake record
    let audit = options.auditEvidence || options.auditRecord;
    if (!audit) {
      const resolution = resolveItemAuditEvidence(item, options);
      if (resolution?.error) {
        errors.push(`YouTube edit ID ${id}: ${resolution.error}`);
        return { valid: false, errors };
      }
      if (resolution?.evidence) {
        audit = resolution.evidence;
      } else if (item.metadata && typeof item.metadata === "object") {
        // Direct caller supplied record with audit metadata
        audit = item;
      }
    }

    if (!audit || typeof audit !== "object") {
      errors.push(`YouTube edit ID ${id}: missing provenance or audit evidence for YouTube embed publication.`);
      return { valid: false, errors };
    }

    // Resolve public video ID
    let publicVideoId = item.youtubeVideoId;
    if (!publicVideoId && typeof item.source === "string") {
      const match = /[?&]v=([a-zA-Z0-9_-]{11})(?:&|$)/.exec(item.source);
      if (match) publicVideoId = match[1];
    }
    if (!publicVideoId && typeof audit.canonicalVideoId === "string") {
      publicVideoId = audit.canonicalVideoId;
    }

    if (!publicVideoId || typeof publicVideoId !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(publicVideoId)) {
      errors.push(`YouTube edit ID ${id}: missing or invalid 11-character YouTube video ID.`);
    } else {
      // Candidate URL integrity: candidate source and poster must match public video ID
      if (typeof item.source === "string" && item.source.includes("youtube.com")) {
        const sMatch = /[?&]v=([a-zA-Z0-9_-]{11})(?:&|$)/.exec(item.source);
        if (!sMatch || sMatch[1] !== publicVideoId) {
          errors.push(
            `YouTube edit ID ${id}: source URL video ID '${sMatch ? sMatch[1] : ""}' does not match public video ID '${publicVideoId}'.`
          );
        }
      }
      if (typeof item.poster === "string" && item.poster.includes("ytimg.com")) {
        const pMatch = /\/vi\/([a-zA-Z0-9_-]{11})\//.exec(item.poster);
        if (!pMatch || pMatch[1] !== publicVideoId) {
          errors.push(
            `YouTube edit ID ${id}: poster thumbnail video ID '${pMatch ? pMatch[1] : ""}' does not match public video ID '${publicVideoId}'.`
          );
        }
      }

      // Audit evidence binding against candidate intake identity (audit fields must not overwrite candidate)
      if (audit.assignedLolixcoId !== undefined && audit.assignedLolixcoId !== null && typeof id === "number" && audit.assignedLolixcoId !== id) {
        errors.push(
          `YouTube edit ID ${id}: audit evidence assignedLolixcoId (${audit.assignedLolixcoId}) does not match candidate catalog ID (${id}).`
        );
      }
      if (audit.id !== undefined && audit.id !== null && typeof id === "number" && audit.id !== id) {
        errors.push(
          `YouTube edit ID ${id}: audit evidence ID (${audit.id}) does not match candidate catalog ID (${id}).`
        );
      }

      if (audit.canonicalVideoId && audit.canonicalVideoId !== publicVideoId) {
        errors.push(
          `YouTube edit ID ${id}: canonical YouTube ID mismatch between evidence record ('${audit.canonicalVideoId}') and candidate video ID ('${publicVideoId}').`
        );
      }
      if (audit.metadata?.canonicalVideoId && audit.metadata.canonicalVideoId !== publicVideoId) {
        errors.push(
          `YouTube edit ID ${id}: canonical YouTube ID mismatch between metadata payload ('${audit.metadata.canonicalVideoId}') and candidate video ID ('${publicVideoId}').`
        );
      }
      if (typeof audit.canonicalUrl === "string") {
        const cMatch = /[?&]v=([a-zA-Z0-9_-]{11})(?:&|$)/.exec(audit.canonicalUrl);
        if (!cMatch || cMatch[1] !== publicVideoId) {
          errors.push(
            `YouTube edit ID ${id}: audit canonicalUrl video ID does not match candidate video ID '${publicVideoId}'.`
          );
        }
      }
    }

    // Format verification against intake candidate (audit fields must not overwrite candidate format)
    const candidateFormat = item.format || (typeof id === "number" && id >= 200 && id <= 299 ? "short" : "video");
    if (audit.format && audit.format !== candidateFormat) {
      errors.push(
        `YouTube edit ID ${id}: format contradiction between candidate format ('${candidateFormat}') and audit record format ('${audit.format}').`
      );
    }
    if (candidateFormat === "video") {
      if (audit.confirmedFormat === "short") {
        errors.push(
          `YouTube edit ID ${id}: contradictory format confirmation. Format is 'video' but audit confirmedFormat is 'short'.`
        );
      }
      if (audit.formatConfirmed === true && audit.confirmedFormat !== "video") {
        errors.push(
          `YouTube edit ID ${id}: contradictory format confirmation. Format is 'video' but audit confirmedFormat is '${audit.confirmedFormat}'.`
        );
      }
    } else if (candidateFormat === "short") {
      if (audit.confirmedFormat === "video") {
        errors.push(
          `YouTube edit ID ${id}: contradictory format confirmation. Format is 'short' but audit confirmedFormat is 'video'.`
        );
      }
      if (audit.formatConfirmed !== true || audit.confirmedFormat !== "short") {
        errors.push(
          `YouTube edit ID ${id}: candidate portrait Short requires positive format confirmation (formatConfirmed: true and confirmedFormat: 'short'). Explicit editorial format confirmation is required before publication.`
        );
      }
    }

    // Review status check
    const status = item.contentReviewStatus || item.editorial?.reviewStatus || item.reviewStatus || audit.contentReviewStatus || audit.reviewStatus || audit.editorial?.reviewStatus;
    if (status !== "approved" && status !== "published") {
      errors.push(`YouTube edit ID ${id} requires 'approved' or 'published' review status, got '${status}'`);
    }

    // Provenance and synthetic mock validation (Point 1: No synthetic bypass)
    const isMock =
      audit.isMock === true ||
      audit.metadata?.isMock === true ||
      audit.provenance === "synthetic_mock" ||
      audit.metadata?.provenance === "synthetic_mock" ||
      Boolean(audit.syntheticOrigin) ||
      Boolean(audit.metadata?.syntheticOrigin) ||
      String(audit.provenance || "").includes("synthetic") ||
      String(audit.metadata?.provenance || "").includes("synthetic") ||
      String(audit.metadata?.channelId || "").startsWith("UC_SYNTHETIC") ||
      item.isMock === true ||
      item.provenance === "synthetic_mock";

    if (isMock) {
      errors.push(
        `YouTube edit ID ${id}: synthetic mock metadata is prohibited from production catalog publication. Real YouTube API metadata is required.`
      );
    }

    if (audit.provenance !== "youtube_data_api_v3" || audit.metadata?.provenance !== "youtube_data_api_v3") {
      errors.push(
        `YouTube edit ID ${id}: missing or unverified API provenance ('${audit.provenance}'). Positive evidence of genuine YouTube Data API v3 retrieval is required for production publication.`
      );
    }

    if (audit.metadataFetchStatus !== "fetched") {
      errors.push(
        `YouTube edit ID ${id}: unverified metadata retrieval status '${audit.metadataFetchStatus}'. Positive evidence of successful API retrieval ('fetched') is required for production publication.`
      );
    }

    // Metadata completeness requirements (matching compiler lines 575-589)
    if (!audit.metadata || typeof audit.metadata !== "object") {
      errors.push(`YouTube edit ID ${id}: missing metadata payload.`);
    } else {
      if (audit.metadata.privacyStatus !== "public") {
        errors.push(`YouTube edit ID ${id}: video is not public on YouTube (privacyStatus: '${audit.metadata.privacyStatus}').`);
      }
      if (audit.metadata.embeddable !== true) {
        errors.push(`YouTube edit ID ${id}: embedded playback is disabled or restricted on YouTube.`);
      }

      // Completeness: Real title and creator attribution (compiler lines 575-589; candidate display fields do NOT rescue)
      const title = (audit.metadata.title || "").trim();
      if (!title || title.startsWith("Curated Edit") || title.startsWith("YouTube Video")) {
        errors.push(`YouTube edit ID ${id}: missing genuine title metadata.`);
      }

      const channelTitle = (audit.metadata.channelTitle || "").trim();
      if (!channelTitle || channelTitle === "Unknown Creator" || channelTitle === "YouTube Creator") {
        errors.push(`YouTube edit ID ${id}: missing genuine channel creator attribution.`);
      }

      // Duration: finite positive numeric duration (compiler lines 585-589; candidate duration string does NOT rescue)
      const durationSec = audit.metadata.durationSec ?? audit.metadata.durationSeconds;
      if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
        errors.push(`YouTube edit ID ${id}: invalid or missing duration metadata.`);
      }
    }

    // Freshness check
    const verificationTimestamp = audit.lastMetadataVerification;
    if (!verificationTimestamp || isNaN(Date.parse(verificationTimestamp))) {
      errors.push(`YouTube edit ID ${id}: missing or invalid lastMetadataVerification timestamp.`);
    } else {
      const verifiedTime = new Date(verificationTimestamp).getTime();
      const currentTime = options.now ? new Date(options.now).getTime() : Date.now();
      const effectiveMaxAgeMs = typeof options.maxMetadataAgeMs === "number"
        ? options.maxMetadataAgeMs
        : (options.maxMetadataAgeDays || 30) * 24 * 60 * 60 * 1000;

      if (verifiedTime > currentTime + 5 * 60 * 1000) {
        errors.push(`YouTube edit ID ${id}: future-dated verification timestamp '${verificationTimestamp}' is invalid.`);
      } else if (currentTime - verifiedTime > effectiveMaxAgeMs) {
        errors.push(`YouTube edit ID ${id}: metadata verification is stale. Fresh YouTube API verification is required before publication.`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // 3. Hosted media (300-499 or sourceType === "licensed_local_media")
  if (sourceType === "licensed_local_media" || (typeof id === "number" && id >= 300 && id <= 499)) {
    errors.push(
      `Cannot project hosted item ${id} for production: hosted production publication requires verified media inspection, decode playback verification, and documented rights clearance; hosted publication evidence is not implemented.`
    );
    return { valid: false, errors };
  }

  errors.push(`Item ${id}: unknown sourceType or unallocated ID partition for production publication.`);
  return { valid: false, errors };
}
export function validateContentManifest(manifestData, options = {}) {
  const {
    fandomRegistry = [],
    existingCatalog = [],
    mode = "metadata",
    isNewBatch = true,
  } = options;

  const errors = [];
  const warnings = [];

  // Reject unsupported modes
  if (!VALID_MODES.includes(mode)) {
    return {
      valid: false,
      errors: [`Invalid validation mode '${mode}'. Allowed modes: ${VALID_MODES.join(", ")}`],
      warnings: [],
      mode,
      summary: { total: 0, videos: 0, shorts: 0 },
      assetVerification: "SKIPPED (Metadata preparation mode)",
      streamInspection: "SKIPPED (Metadata preparation mode)",
      decodeVerification: "SKIPPED (Metadata preparation mode)",
    };
  }

  const schemaErrors = validateJsonSchema(manifestData, manifestSchema);
  errors.push(...schemaErrors);

  if (manifestData && typeof manifestData === "object" && !Array.isArray(manifestData)) {
    for (const key of Object.keys(manifestData)) {
      if (!ALLOWED_ROOT_KEYS.includes(key)) {
        errors.push(`Unexpected root property '${key}' (schema forbids additionalProperties)`);
      }
    }
  }

  if (manifestData?.generatedAt !== undefined) {
    if (!isValidDateTime(manifestData.generatedAt)) {
      const errStr = `Manifest 'generatedAt' must be a valid RFC 3339 / ISO 8601 date-time string (e.g. '2026-10-18T12:00:00Z'), got '${manifestData.generatedAt}'`;
      if (!errors.includes(errStr)) {
        errors.push(errStr);
      }
    }
  }

  if (typeof manifestData?.manifestVersion !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifestData.manifestVersion)) {
    const errStr = "Manifest missing valid 'manifestVersion' semantic version string (e.g. '1.0.0')";
    if (!errors.includes(errStr)) {
      errors.push(errStr);
    }
  }
  if (typeof manifestData?.catalogVersion !== "string" || !/^[a-zA-Z0-9_-]+$/.test(manifestData.catalogVersion)) {
    const errStr = "Manifest missing valid 'catalogVersion' string (e.g. 'catalog-v2')";
    if (!errors.includes(errStr)) {
      errors.push(errStr);
    }
  }

  const items = Array.isArray(manifestData?.items) ? manifestData.items : [];
  const seenIds = new Set(existingCatalog.map((e) => e.id));

  let videoCount = 0;
  let shortCount = 0;
  let localMediaCount = 0;
  let inspectedStreamCount = 0;
  let streamErrors = 0;
  let unavailableStreams = 0;
  let decodedStreamCount = 0;
  let decodeErrors = 0;
  let unavailableDecoders = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemResult = validateContentRecord(item, {
      ...options,
      seenIds,
      isNewBatch,
      fandomRegistry,
      mode,
      publicDir: options.publicDir,
      approvedOrigins: options.approvedOrigins,
      videoInspector: options.videoInspector,
      decodeVerifier: options.decodeVerifier,
    });

    for (const err of itemResult.errors) {
      errors.push(`Item #${i + 1} (ID ${item?.id ?? "unknown"}): ${err}`);
    }
    for (const warn of itemResult.warnings) {
      warnings.push(`Item #${i + 1} (ID ${item?.id ?? "unknown"}): ${warn}`);
    }

    if (item?.format === "short") {
      shortCount++;
    } else if (item?.format === "video") {
      videoCount++;
    }

    const isItemYouTube = item?.sourceType === "youtube_embed" || (typeof item?.id === "number" && item.id >= 100 && item.id <= 299 && item?.source?.includes("youtube.com"));
    if (!isItemYouTube) {
      localMediaCount++;
      if (itemResult.inspectedStream) {
        if (itemResult.inspectedStream.available) {
          if (itemResult.inspectedStream.ok) {
            inspectedStreamCount++;
          } else {
            streamErrors++;
          }
        } else {
          unavailableStreams++;
        }
      }

      if (itemResult.verifiedDecode) {
        if (itemResult.verifiedDecode.available) {
          if (itemResult.verifiedDecode.ok) {
            decodedStreamCount++;
          } else {
            decodeErrors++;
          }
        } else {
          unavailableDecoders++;
        }
      }
    }

    // In publish mode: verify production publication eligibility for each item
    if (mode === "publish") {
      let elig;
      if (isItemYouTube) {
        const auditRes = resolveItemAuditEvidence(item, options);
        if (auditRes?.error) {
          errors.push(`Item #${i + 1} (ID ${item?.id ?? "unknown"}): ${auditRes.error}`);
          continue;
        }
        if (!auditRes?.evidence) {
          errors.push(`Item #${i + 1} (ID ${item?.id ?? "unknown"}): missing provenance or audit evidence for YouTube embed publication.`);
          continue;
        }
        elig = verifyProductionPublicationEligibility(item, {
          ...options,
          auditEvidence: auditRes.evidence,
        });
      } else {
        elig = verifyProductionPublicationEligibility(item, options);
      }

      if (!elig.valid) {
        for (const e of elig.errors) {
          errors.push(`Item #${i + 1} (ID ${item?.id ?? "unknown"}): ${e}`);
        }
      }
    }
  }

  // Accurate stream inspection and decode verification reporting
  let streamInspection = "SKIPPED (Metadata preparation mode)";
  let decodeVerification = "SKIPPED (Metadata preparation mode)";

  if (mode === "publish") {
    if (localMediaCount === 0) {
      streamInspection = "NOT_APPLICABLE (All items are YouTube embeds verified via API evidence)";
      decodeVerification = "NOT_APPLICABLE (All items are YouTube embeds verified via API evidence)";
    } else {
      if ((!isFFprobeAvailable() && !options.videoInspector) || unavailableStreams > 0) {
        streamInspection = "INCOMPLETE (ffprobe unavailable in environment; publication blocked)";
        if (!errors.some((e) => e.includes("ffprobe is not installed"))) {
          errors.push(
            "Publication requirement failed: ffprobe is not installed in the environment. Physical stream verification is mandatory for publication readiness."
          );
        }
      } else if (streamErrors > 0) {
        streamInspection = `FAILED (${streamErrors} streams undecodable or failed inspection)`;
      } else if (inspectedStreamCount === localMediaCount) {
        streamInspection = `VERIFIED (${inspectedStreamCount} video streams certified)`;
      } else {
        streamInspection = "INCOMPLETE (Streams not fully verified)";
        errors.push("Publication readiness requirement failed: All media streams must be verified.");
      }

      if ((!isFFmpegAvailable() && !options.decodeVerifier) || unavailableDecoders > 0) {
        decodeVerification = "INCOMPLETE (ffmpeg unavailable in environment; publication blocked)";
        if (!errors.some((e) => e.includes("ffmpeg is not installed"))) {
          errors.push(
            "Publication requirement failed: ffmpeg is not installed in the environment. Full decode playback-integrity verification is mandatory for publication readiness."
          );
        }
      } else if (decodeErrors > 0) {
        decodeVerification = `FAILED (${decodeErrors} streams failed playback decode integrity verification)`;
      } else if (decodedStreamCount === localMediaCount) {
        decodeVerification = `VERIFIED (${decodedStreamCount} video streams decoded and playback-certified)`;
      } else {
        decodeVerification = "INCOMPLETE (Streams not fully verified for playback decode integrity)";
        errors.push("Publication readiness requirement failed: All media streams must pass playback decode verification.");
      }
    }
  } else if (mode === "assets") {
    if (inspectedStreamCount > 0) {
      streamInspection = `VERIFIED (${inspectedStreamCount} streams inspected)`;
    } else if ((!isFFprobeAvailable() && !options.videoInspector) || unavailableStreams > 0) {
      streamInspection = "INCOMPLETE (ffprobe unavailable; technical stream inspection incomplete)";
    } else {
      streamInspection = "INCOMPLETE (no video streams inspected)";
    }

    if (decodedStreamCount > 0) {
      decodeVerification = `VERIFIED (${decodedStreamCount} streams decoded)`;
    } else if ((!isFFmpegAvailable() && !options.decodeVerifier) || unavailableDecoders > 0) {
      decodeVerification = "INCOMPLETE (ffmpeg unavailable; playback integrity verification incomplete)";
    } else {
      decodeVerification = "INCOMPLETE (no video streams decoded)";
    }
  }

  let assetVerification = "SKIPPED (Metadata preparation mode)";
  if (mode === "assets") {
    assetVerification = "PERFORMED (Staged local assets verified)";
  } else if (mode === "publish") {
    assetVerification = "PERFORMED (Publication readiness verification)";
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    mode,
    assetVerification,
    streamInspection,
    decodeVerification,
    summary: {
      total: items.length,
      videos: videoCount,
      shorts: shortCount,
    },
  };
}

export async function validateLiveCatalog(root = projectRoot, options = {}) {
  const { allowExpandedCatalog = false, approvedOrigins } = options;
  const errors = [];
  const warnings = [];

  const editsPath = resolve(root, "src/data/edits.ts");
  if (!existsSync(editsPath)) {
    return {
      valid: false,
      errors: [`Production catalog not found at ${editsPath}`],
      warnings: [],
      summary: { total: 0, videos: 0, shorts: 0 },
    };
  }

  let editsModule;
  try {
    editsModule = await import(editsPath);
  } catch (err) {
    return {
      valid: false,
      errors: [`Failed to load production catalog: ${err.message}`],
      warnings: [],
      summary: { total: 0, videos: 0, shorts: 0 },
    };
  }

  const edits = editsModule.edits;
  const isExpanded = allowExpandedCatalog;

  if (!Array.isArray(edits)) {
    errors.push(`Live catalog edit count violation: expected array of edits, got ${typeof edits}`);
  } else if (!isExpanded && edits.length !== 17) {
    errors.push(`Live catalog edit count violation: expected exactly 17 edits, got ${edits.length}`);
  } else if (isExpanded && edits.length < 17) {
    errors.push(`Expanded catalog must preserve at least the 17 baseline demo edits, got ${edits.length}`);
  }

  let fandomRegistry = [];
  try {
    const fandomsModule = await import(resolve(root, "src/data/fandoms.ts"));
    fandomRegistry = fandomsModule.FANDOM_REGISTRY || [];
  } catch {
    fandomRegistry = [];
  }

  const seenIds = new Set();
  let shortCount = 0;
  let videoCount = 0;

  for (let i = 0; i < (edits || []).length; i++) {
    const edit = edits[i];
    if (edit.format === "short") {
      shortCount++;
    } else {
      videoCount++;
    }

    if (i < 17) {
      if (!isBaselineDemoRecord(edit, { checkFileChecksum: true })) {
        errors.push(
          `Baseline demo edit ID ${edit.id} at index ${i} does not match trusted unforgeable reference anchored to pinned checksum.`
        );
      }
    } else {
      try {
        assertPublicEditIntegrity(edit, { approvedOrigins });
      } catch (err) {
        errors.push(`Live Edit ID ${edit.id}: ${err.message}`);
      }
    }

    const itemResult = validateContentRecord(edit, {
      seenIds,
      isNewBatch: false,
      isLiveCatalog: true,
      fandomRegistry,
      mode: "assets",
      publicDir: resolve(root, "public"),
    });

    for (const err of itemResult.errors) {
      errors.push(`Live Edit ID ${edit.id}: ${err}`);
    }
    for (const warn of itemResult.warnings) {
      warnings.push(`Live Edit ID ${edit.id}: ${warn}`);
    }

    if (isExpanded && i >= 17) {
      const partCheck = validateSourceAndId(edit, { isNewBatch: false, isLiveCatalog: true });
      if (!partCheck.valid) {
        for (const err of partCheck.errors) {
          errors.push(`Live Edit ID ${edit.id}: ${err}`);
        }
      }
    }
  }

  if (!isExpanded && shortCount !== 0) {
    errors.push(
      `Production catalog contains ${shortCount} Shorts. Invariant requires exactly 0 Shorts until owner media is received.`
    );
  }

  for (let expectedId = 0; expectedId < 17; expectedId++) {
    if (!seenIds.has(expectedId)) {
      errors.push(`Missing expected demo edit ID: ${expectedId}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      total: edits ? edits.length : 0,
      videos: videoCount,
      shorts: shortCount,
    },
  };
}

export function projectToPublicEdit(item, options = {}) {
  const {
    allowDraft = false,
    strict = true,
    forProduction = false,
    isTargetingProduction = false,
    approvedOrigins = [],
  } = options;

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Cannot project non-object to public edit");
  }

  const isTargetingProd = Boolean(isTargetingProduction || forProduction);

  // Preview or bypass options strictly forbidden during production publication
  if (isTargetingProd) {
    if (allowDraft || strict === false) {
      throw new Error(
        "Production publication aborted: preview options (allowDraft: true or strict: false) are strictly forbidden for production output."
      );
    }
    if (options.allowSyntheticAudit) {
      throw new Error(
        "Production publication aborted: synthetic bypass options (allowSyntheticAudit: true) are strictly forbidden for production output."
      );
    }
    const productionOptions = {
      ...options,
      forProduction: true,
      isTargetingProduction: true,
      allowDraft: false,
      strict: true,
      allowSyntheticAudit: false,
      checkFileChecksum: true,
      enforceChecksum: true,
      allowTestHarness: false,
      approvedOrigins,
    };
    const elig = verifyProductionPublicationEligibility(item, productionOptions);
    if (!elig.valid) {
      throw new Error(`Cannot project item ${item.id ?? item.assignedLolixcoId}: production publication eligibility failed: ${elig.errors.join("; ")}`);
    }
  } else if (!allowDraft && strict !== false) {
    const isYouTube = item.sourceType === "youtube_embed";
    if (isYouTube) {
      const status = item.contentReviewStatus || item.editorial?.reviewStatus || item.reviewStatus;
      if (status !== "approved" && status !== "published") {
        throw new Error(
          `Cannot project YouTube item ${item.id} to public catalog: review status must be 'approved' or 'published', got '${status}'`
        );
      }
      const isMock =
        item.isMock === true ||
        item.metadata?.isMock === true ||
        item.provenance === "synthetic_mock" ||
        item.metadata?.provenance === "synthetic_mock" ||
        Boolean(item.syntheticOrigin) ||
        Boolean(item.metadata?.syntheticOrigin);
      if (isMock) {
        throw new Error(
          `Cannot project YouTube item ${item.id} to public catalog: synthetic mock metadata is prohibited`
        );
      }
      if (item.provenance !== "youtube_data_api_v3" && item.metadata?.provenance !== "youtube_data_api_v3") {
        throw new Error(
          `Cannot project YouTube item ${item.id} to public catalog: missing positive API provenance`
        );
      }
      if (item.format === "short") {
        if (item.formatConfirmed !== true && item.confirmedFormat !== "short") {
          throw new Error(
            `Cannot project portrait Short ${item.id} to public catalog: format confirmation required`
          );
        }
      }
    } else if (item.id >= 0 && item.id <= 16) {
      if (!isBaselineDemoRecord(item, options)) {
        throw new Error(
          `Cannot project item ${item.id}: record does not match trusted baseline demo record`
        );
      }
    } else {
      const reviewStatus = item.editorial?.reviewStatus || item.contentReviewStatus;
      const rightsCleared = item.editorial?.rightsCleared ?? item.rightsCleared;
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
  }

  const {
    id,
    format = "video",
    title,
    description,
    category,
    fandomIds,
    tags,
    poster,
    source,
    duration,
    trending = false,
  } = item;

  const publicRecord = {
    id,
    title,
    category,
    tags: Array.isArray(tags) ? [...tags] : [],
    description,
    creator: item.creator || (item.channelTitle ? item.channelTitle : "Lolixco curated"),
    poster,
    source,
    duration,
    trending: !!trending,
  };

  if (item.format !== undefined) {
    publicRecord.format = item.format;
  }
  if (fandomIds && Array.isArray(fandomIds) && fandomIds.length > 0) {
    publicRecord.fandomIds = [...fandomIds];
  }
  if (item.sourceType) {
    publicRecord.sourceType = item.sourceType;
  }
  if (item.youtubeVideoId) {
    publicRecord.youtubeVideoId = item.youtubeVideoId;
  }
  if (item.channelTitle) {
    publicRecord.channelTitle = item.channelTitle;
  }
  if (item.channelId) {
    publicRecord.channelId = item.channelId;
  }
  if (item.sourceUrl) {
    publicRecord.sourceUrl = item.sourceUrl;
  }

  if (!allowDraft) {
    const assertionOptions = isTargetingProd
      ? {
          ...options,
          forProduction: true,
          isTargetingProduction: true,
          checkFileChecksum: true,
          enforceChecksum: true,
          allowDraft: false,
          strict: true,
          allowTestHarness: false,
        }
      : options;
    assertPublicEditIntegrity(publicRecord, assertionOptions);
  }

  return publicRecord;
}

export function projectToPreviewEdit(item) {
  return projectToPublicEdit(item, { allowDraft: true });
}

// CLI Execution entry point
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let manifestPath = null;
  let mode = "metadata";
  let checkLive = true;
  let allowExpanded = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest" && args[i + 1]) {
      manifestPath = resolve(args[i + 1]);
      checkLive = false;
      i++;
    } else if (args[i] === "--mode" && args[i + 1]) {
      mode = args[i + 1];
      i++;
      if (!VALID_MODES.includes(mode)) {
        console.error(`Error: Invalid validation mode '${mode}'. Allowed modes: ${VALID_MODES.join(", ")}`);
        process.exit(1);
      }
    } else if (args[i].startsWith("--mode=")) {
      mode = args[i].slice("--mode=".length);
      if (!VALID_MODES.includes(mode)) {
        console.error(`Error: Invalid validation mode '${mode}'. Allowed modes: ${VALID_MODES.join(", ")}`);
        process.exit(1);
      }
    } else if (args[i] === "--publish" || args[i] === "--publication-ready") {
      mode = "publish";
    } else if (args[i] === "--verify-assets" || args[i] === "--assets") {
      mode = "assets";
    } else if (args[i] === "--metadata") {
      mode = "metadata";
    } else if (args[i] === "--allow-expanded") {
      allowExpanded = true;
    } else if (args[i].endsWith(".json")) {
      manifestPath = resolve(args[i]);
      checkLive = false;
    } else {
      console.error(
        `Error: Unrecognized option '${args[i]}'. Allowed options: --manifest <path>, --mode <${VALID_MODES.join("|")}>, --publish, --assets, --metadata, --allow-expanded`
      );
      process.exit(1);
    }
  }

  async function main() {
    let allValid = true;

    if (manifestPath) {
      console.log(`Validating manifest (${mode} mode): ${relative(projectRoot, manifestPath)}...`);
      const rawText = readFileSync(manifestPath, "utf8");
      const manifestData = JSON.parse(rawText);

      const fandomsModule = await import(resolve(projectRoot, "src/data/fandoms.ts"));
      const editsModule = await import(resolve(projectRoot, "src/data/edits.ts"));
      const result = validateContentManifest(manifestData, {
        fandomRegistry: fandomsModule.FANDOM_REGISTRY,
        existingCatalog: editsModule.edits,
        mode,
        isNewBatch: true,
      });

      console.log(`- Mode: ${result.mode}`);
      console.log(`- Asset verification: ${result.assetVerification}`);
      console.log(`- Stream inspection: ${result.streamInspection}`);
      console.log(`- Decode verification: ${result.decodeVerification}`);
      console.log(
        `- Total items: ${result.summary.total} (${result.summary.videos} videos, ${result.summary.shorts} shorts)`
      );

      if (result.warnings.length > 0) {
        console.warn(`\nWarnings (${result.warnings.length}):`);
        for (const w of result.warnings) console.warn(`  ! ${w}`);
      }

      if (!result.valid) {
        console.error(`\nValidation errors (${result.errors.length}):`);
        for (const err of result.errors) console.error(`  x ${err}`);
        allValid = false;
      } else {
        console.log(`OK: Manifest passed all validation checks for mode '${mode}'.`);
      }
    }

    if (checkLive) {
      console.log(`Validating live production catalog (src/data/edits.ts)...`);
      const liveResult = await validateLiveCatalog(projectRoot, { allowExpandedCatalog: allowExpanded });
      console.log(
        `- Verified ${liveResult.summary.total} edits (${liveResult.summary.videos} videos, ${liveResult.summary.shorts} shorts)`
      );

      if (!liveResult.valid) {
        console.error(`\nLive catalog errors (${liveResult.errors.length}):`);
        for (const err of liveResult.errors) console.error(`  x ${err}`);
        allValid = false;
      } else {
        console.log(`OK: Live catalog verified (${liveResult.summary.total} edits, 0 drift).`);
      }
    }

    if (!allValid) {
      process.exit(1);
    }
  }

  main().catch((err) => {
    console.error("Fatal error during validation:", err);
    process.exit(1);
  });
}