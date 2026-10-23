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
export const VIDEO_PATH_REGEX = /^(\/|https?:\/\/|\.\/).+\.(mp4|webm|m4v)$/;
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

const schemaPath = resolve(projectRoot, "content/manifest.schema.json");
export const manifestSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));
export const contentRecordSchema = manifestSchema.definitions.ContentRecord;

/**
 * Validate RFC 3339 / ISO date-time string with strict calendar validity (handling month lengths and leap years).
 */
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

  // Calendar validation for days in month (handling leap years)
  // Date.UTC(year, month, 0) returns the last day of the given 1-indexed month
  const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDays) return false;

  const timestamp = Date.parse(val);
  return !isNaN(timestamp);
}

/**
 * Normalize codec names across formats and containers (e.g. avc1 -> h264).
 */
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

/**
 * Authoritative JSON Schema validator (Draft-07 compliant for manifest schema).
 * Returns array of structured validation error strings.
 */
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

  // Reject explicit nulls for non-null types
  if (data === null) {
    errors.push(`Property '${path || "value"}' cannot be null`);
    return errors;
  }

  // Type check
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

  // Enum check
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(
      `Property '${path || "value"}' must be one of allowed values: ${schema.enum.join(", ")}, got ${JSON.stringify(data)}`
    );
  }

  // String checks
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

  // Number checks
  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`Property '${path}' must be >= ${schema.minimum}, got ${data}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`Property '${path}' must be <= ${schema.maximum}, got ${data}`);
    }
  }

  // Array checks
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

  // Object checks
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

/**
 * Check if ffprobe is installed and executable in PATH.
 */
export function isFFprobeAvailable() {
  try {
    const res = spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Inspect actual video and audio streams using ffprobe when available.
 * Queries stream metadata and container format information (for container-level duration fallback).
 */
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

    // Container format duration fallback when stream duration is missing (e.g. WebM/Matroska)
    const streamDuration = videoStream.duration ? parseFloat(videoStream.duration) : null;
    const formatDuration = data.format?.duration ? parseFloat(data.format.duration) : null;
    const durationSec =
      streamDuration && !isNaN(streamDuration) && streamDuration > 0
        ? streamDuration
        : formatDuration && !isNaN(formatDuration) && formatDuration > 0
        ? formatDuration
        : null;

    // Audio stream inspection
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

/**
 * Check if ffmpeg is installed and executable in PATH.
 */
export function isFFmpegAvailable() {
  try {
    const res = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * FFmpeg may exit zero despite demuxer errors. Read tagged severity rather than
 * matching broad words in warnings; some versions report incomplete input only
 * as a warning, so explicitly recognize those container-integrity diagnostics.
 */
export function hasFFmpegDecodeErrors(stderr) {
  const prefix = "^[ \\t]*(?:\\[[^\\]\\r\\n]+\\][ \\t]*)*";
  const severe = new RegExp(`${prefix}\\[(?:error|fatal|panic)\\]`, "im");
  const incomplete = new RegExp(
    `${prefix}(?:File ended prematurely\\b|File extends beyond end of segment\\b|Truncating packet\\b|Packet corrupt\\b)`,
    "im"
  );
  return severe.test(stderr) || incomplete.test(stderr);
}

/**
 * Perform playback-integrity verification by decoding the full media stream to a null sink.
 * Detects truncated media, bitstream corruption, and unplayable files.
 */
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
        "level+warning",
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
    if (hasFFmpegDecodeErrors(stderr)) {
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

/**
 * Verify asset file headers and magic bytes without reading entire file into memory.
 * Reads a fixed-size header buffer (up to 64KB).
 */
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

    case ".webm":
      if (buffer.subarray(0, 4).toString("hex") !== "1a45dfa3") {
        throw new Error("Invalid WebM header signature (expected 1a45dfa3)");
      }
      break;

    case ".mp4":
    case ".m4v":
      if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
        throw new Error("Invalid MP4 header signature (expected 'ftyp' box at offset 4)");
      }
      break;

    default:
      break;
  }

  return { bytes: info.size, extension: ext };
}

/**
 * Verify asset path containment against symlink escapes and directory traversal.
 */
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

  // Check if target is a symbolic link escaping permitted directories
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
}

/**
 * Validate an individual content record.
 */
export function validateContentRecord(record, options = {}) {
  const {
    seenIds = new Set(),
    isNewBatch = false,
    fandomRegistry = [],
    mode = "metadata", // "metadata" | "assets" | "publish"
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

  // Handle malformed item root types
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

  // Schema Rule: Reject explicit nulls for any defined property
  for (const [k, v] of Object.entries(record)) {
    if (v === null) {
      errors.push(`Property '${k}' cannot be null`);
    }
  }

  // Schema Rule: Check unexpected properties (additionalProperties: false)
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

  // Schema Rule: Check required fields
  const requiredKeys = isLiveCatalog
    ? REQUIRED_RECORD_KEYS.filter((k) => k !== "format")
    : REQUIRED_RECORD_KEYS;
  for (const reqKey of requiredKeys) {
    if (!(reqKey in record) || record[reqKey] === undefined) {
      errors.push(`Missing required property '${reqKey}'`);
    }
  }

  // 1. Validate ID
  const id = record.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0) {
    if ("id" in record && record.id !== null) {
      errors.push(`Invalid ID: ${JSON.stringify(id)} (must be non-negative integer)`);
    }
  } else {
    if (seenIds.has(id)) {
      errors.push(`Duplicate ID: ${id} is already assigned in this catalog/manifest`);
    } else {
      seenIds.add(id);
    }

    if (isNewBatch) {
      if (id >= 0 && id <= 16) {
        errors.push(
          `Reserved ID conflict: ID ${id} is reserved for baseline demo edits (0-16). New curated content must use IDs >= 100.`
        );
      } else if (id >= 17 && id <= 99) {
        errors.push(
          `Reserved ID conflict: ID ${id} is reserved for internal test harnesses (17-99). Use 100-199 for landscape videos or 200-299 for portrait shorts.`
        );
      } else {
        // Enforce documented ID range policy
        const format = record.format;
        if (format === "video" && (id < 100 || id > 199)) {
          errors.push(
            `ID range mismatch: Landscape video ID ${id} must be in range 100-199 according to documented allocation policy.`
          );
        } else if (format === "short" && (id < 200 || id > 299)) {
          errors.push(
            `ID range mismatch: Curated Short ID ${id} must be in range 200-299 according to documented allocation policy.`
          );
        }
      }
    }
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

  // 7. Validate Tags (Strict lower-case regex match)
  if (record.tags !== undefined && record.tags !== null) {
    if (!Array.isArray(record.tags) || record.tags.length === 0) {
      errors.push("Missing or empty tags array (at least 1 tag required)");
    } else {
      for (const tag of record.tags) {
        if (typeof tag !== "string" || !tag.trim()) {
          errors.push(`Invalid tag: ${JSON.stringify(tag)}`);
        } else {
          const trimmedTag = tag.trim();
          if (trimmedTag.startsWith("#")) {
            errors.push(`Tag "${tag}" must not include leading '#' symbol`);
          }
          if (!VALID_TAG_REGEX.test(trimmedTag)) {
            errors.push(
              `Tag "${tag}" contains invalid characters or uppercase letters (must match /^[a-z0-9_-]+$/)`
            );
          }
        }
      }
    }
  }

  // 8. Validate Duration
  if (record.duration !== undefined && record.duration !== null) {
    if (typeof record.duration !== "string" || !DURATION_REGEX.test(record.duration.trim())) {
      errors.push(
        `Invalid duration: "${record.duration}" (expected format M:SS or MM:SS, e.g. "0:24", "1:45")`
      );
    }
  }

  if (record.durationMs !== undefined && record.durationMs !== null) {
    if (
      typeof record.durationMs !== "number" ||
      !Number.isInteger(record.durationMs) ||
      record.durationMs <= 0 ||
      record.durationMs > 3600000
    ) {
      errors.push(`Invalid durationMs: ${record.durationMs} (must be positive integer <= 3600000)`);
    }
  }

  // Cross-check record.duration vs record.durationMs (tolerance: ±1.0s)
  if (
    record.duration &&
    typeof record.duration === "string" &&
    DURATION_REGEX.test(record.duration.trim()) &&
    typeof record.durationMs === "number" &&
    Number.isInteger(record.durationMs) &&
    record.durationMs > 0
  ) {
    const [minStr, secStr] = record.duration.split(":");
    const declaredSec = parseInt(minStr, 10) * 60 + parseInt(secStr, 10);
    const msSec = record.durationMs / 1000;
    if (Math.abs(declaredSec - msSec) > 1.0) {
      errors.push(
        `Contradictory duration values: declared duration '${record.duration}' (${declaredSec}s) contradicts durationMs (${record.durationMs}ms / ${msSec.toFixed(1)}s) by more than 1s tolerance`
      );
    }
  }

  // Validate trending boolean
  if (record.trending !== undefined && record.trending !== null) {
    if (typeof record.trending !== "boolean") {
      errors.push(`Property 'trending' must be a boolean, got ${typeof record.trending}`);
    }
  }

  // 9. Validate Media Details & Consistency (Schema & Aspect Ratio)
  if (record.media !== undefined && record.media !== null) {
    if (typeof record.media !== "object" || Array.isArray(record.media)) {
      errors.push("media property must be an object");
    } else {
      // Reject explicit nulls inside media
      for (const [mK, mV] of Object.entries(record.media)) {
        if (mV === null) {
          errors.push(`media.${mK} cannot be null`);
        }
      }

      // Check additionalProperties: false on media
      for (const mKey of Object.keys(record.media)) {
        if (!ALLOWED_MEDIA_KEYS.includes(mKey)) {
          errors.push(`Unexpected media property '${mKey}' (schema forbids additionalProperties)`);
        }
      }

      const { aspectRatio, width, height, codec, audioCodec, frameRate, bitrateKbps, loudnessLkfs } =
        record.media;

      if (aspectRatio !== undefined && aspectRatio !== null) {
        if (!ALLOWED_ASPECT_RATIOS.includes(aspectRatio)) {
          errors.push(
            `Invalid aspectRatio '${aspectRatio}'. Allowed: ${ALLOWED_ASPECT_RATIOS.join(", ")}`
          );
        }
      }

      if (codec !== undefined && codec !== null && !ALLOWED_CODECS.includes(codec)) {
        errors.push(`Unsupported codec '${codec}'. Allowed: ${ALLOWED_CODECS.join(", ")}`);
      }

      if (audioCodec !== undefined && audioCodec !== null && !ALLOWED_AUDIO_CODECS.includes(audioCodec)) {
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

      // Cross-check declared aspectRatio against declared width and height
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

      // Aspect ratio consistency
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
      if (!record.poster.startsWith("https://") && !record.poster.startsWith("http://")) {
        errors.push(`YouTube embed poster must be a valid URL, got '${record.poster}'`);
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
      if (
        !/^https:\/\/(www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/.test(record.source) &&
        !/^https:\/\/youtu\.be\/[a-zA-Z0-9_-]{11}/.test(record.source)
      ) {
        errors.push(`YouTube embed source must be a valid YouTube URL, got '${record.source}'`);
      }
      if (record.youtubeVideoId && !/^[a-zA-Z0-9_-]{11}$/.test(record.youtubeVideoId)) {
        errors.push(`Invalid YouTube video ID '${record.youtubeVideoId}'`);
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

          // Deep stream inspection with ffprobe (or injected inspector)
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
              // ffprobe failed on the media stream
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
              // Successful stream inspection: validate actual dimensions, aspect ratio, codec, audio presence/codec, duration, frame rate
              const { width, height, codec, durationSec, frameRate, hasAudio, audioCodec } = inspectedStreamResult;

              // Validate dimensions against declared media metadata if declared
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

              // Validate declared media.aspectRatio against actual stream dimensions
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

              // Validate codec if declared in media metadata
              if (record.media?.codec && codec) {
                const normalizedStreamCodec = normalizeCodec(codec);
                const declaredCodec = normalizeCodec(record.media.codec);
                if (normalizedStreamCodec !== declaredCodec) {
                  errors.push(
                    `Actual video codec '${codec}' does not match declared media.codec '${record.media.codec}'`
                  );
                }
              }

              // Validate audio stream presence and codec when declared
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

              // Validate frame rate if declared in media metadata (documented tolerance: ±0.5 fps)
              if (record.media?.frameRate && typeof frameRate === "number") {
                if (Math.abs(frameRate - record.media.frameRate) > 0.5) {
                  errors.push(
                    `Actual frame rate (${frameRate.toFixed(2)} fps) deviates from declared frameRate (${record.media.frameRate} fps) by more than 0.5 fps tolerance`
                  );
                }
              }

              // Cross-check physical duration (measured duration)
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

          // Full decode playback-integrity verification with ffmpeg (or injected decode verifier)
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

  // 11. Validate Editorial & Publication Requirements (FIX C)
  if (record.editorial !== undefined && record.editorial !== null) {
    if (typeof record.editorial !== "object" || Array.isArray(record.editorial)) {
      errors.push("editorial property must be an object");
    } else {
      // Reject explicit nulls inside editorial
      for (const [eK, eV] of Object.entries(record.editorial)) {
        if (eV === null) {
          errors.push(`editorial.${eK} cannot be null`);
        }
      }

      // Check additionalProperties: false on editorial
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

  // Publication Readiness Enforcement (FIX A & FIX C)
  if (mode === "publish") {
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

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    inspectedStream: inspectedStreamResult,
    verifiedDecode: verifiedDecodeResult,
  };
}

/**
 * Validate a full content manifest.
 */
export function validateContentManifest(manifest, options = {}) {
  const {
    mode = "metadata",
    isNewBatch = true,
    existingCatalog = [],
    existingCatalogIds = [],
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
    };
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      valid: false,
      errors: ["Manifest root must be a JSON object"],
      warnings: [],
      mode,
      summary: { total: 0, videos: 0, shorts: 0 },
    };
  }

  // 1. Authoritative Draft-07 JSON Schema Validation
  const schemaErrors = validateJsonSchema(manifest, manifestSchema, manifestSchema, "");
  for (const sErr of schemaErrors) {
    if (!errors.includes(sErr)) {
      errors.push(`Manifest schema error: ${sErr}`);
    }
  }

  // Check unexpected root keys
  for (const rKey of Object.keys(manifest)) {
    if (!ALLOWED_ROOT_KEYS.includes(rKey)) {
      const errStr = `Unexpected root property '${rKey}' (schema forbids additionalProperties)`;
      if (!errors.includes(errStr)) {
        errors.push(errStr);
      }
    }
  }

  if (manifest.generatedAt !== undefined) {
    if (!isValidDateTime(manifest.generatedAt)) {
      const errStr = `Manifest 'generatedAt' must be a valid RFC 3339 / ISO 8601 date-time string (e.g. '2026-10-18T12:00:00Z'), got '${manifest.generatedAt}'`;
      if (!errors.includes(errStr)) {
        errors.push(errStr);
      }
    }
  }

  if (typeof manifest.manifestVersion !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.manifestVersion)) {
    const errStr = "Manifest missing valid 'manifestVersion' semantic version string (e.g. '1.0.0')";
    if (!errors.includes(errStr)) {
      errors.push(errStr);
    }
  }
  if (typeof manifest.catalogVersion !== "string" || !/^[a-zA-Z0-9_-]+$/.test(manifest.catalogVersion)) {
    const errStr = "Manifest missing valid 'catalogVersion' string (e.g. 'catalog-v2')";
    if (!errors.includes(errStr)) {
      errors.push(errStr);
    }
  }
  if (!Array.isArray(manifest.items)) {
    const errStr = "Manifest missing 'items' array";
    if (!errors.includes(errStr)) {
      errors.push(errStr);
    }
    return {
      valid: false,
      errors,
      warnings,
      mode,
      summary: { total: 0, videos: 0, shorts: 0 },
    };
  }

  const seenIds = new Set([
    ...existingCatalogIds,
    ...existingCatalog.map((item) => item?.id).filter((id) => typeof id === "number"),
  ]);
  let videoCount = 0;
  let shortCount = 0;
  let inspectedStreamCount = 0;
  let streamErrors = 0;
  let unavailableStreams = 0;
  let decodedStreamCount = 0;
  let decodeErrors = 0;
  let unavailableDecoders = 0;

  for (let idx = 0; idx < manifest.items.length; idx++) {
    const item = manifest.items[idx];
    const itemResult = validateContentRecord(item, {
      ...options,
      seenIds,
      isNewBatch,
      mode,
    });

    if (item && typeof item === "object" && !Array.isArray(item)) {
      if (item.format === "short") {
        shortCount++;
      } else {
        videoCount++;
      }
    }

    if (itemResult.inspectedStream) {
      if (itemResult.inspectedStream.ok) {
        inspectedStreamCount++;
      } else if (!itemResult.inspectedStream.available) {
        unavailableStreams++;
      } else {
        streamErrors++;
      }
    }

    if (itemResult.verifiedDecode) {
      if (itemResult.verifiedDecode.ok) {
        decodedStreamCount++;
      } else if (!itemResult.verifiedDecode.available) {
        unavailableDecoders++;
      } else {
        decodeErrors++;
      }
    }

    for (const err of itemResult.errors) {
      errors.push(`Item [index ${idx}${item?.id !== undefined ? `, id ${item.id}` : ""}]: ${err}`);
    }
    for (const warn of itemResult.warnings) {
      warnings.push(`Item [index ${idx}${item?.id !== undefined ? `, id ${item.id}` : ""}]: ${warn}`);
    }
  }

  // Accurate stream inspection and decode verification reporting
  let streamInspection = "SKIPPED (Metadata preparation mode)";
  let decodeVerification = "SKIPPED (Metadata preparation mode)";

  if (mode === "publish") {
    if ((!isFFprobeAvailable() && !options.videoInspector) || unavailableStreams > 0) {
      streamInspection = "INCOMPLETE (ffprobe unavailable in environment; publication blocked)";
      if (!errors.some((e) => e.includes("ffprobe is not installed"))) {
        errors.push(
          "Publication requirement failed: ffprobe is not installed in the environment. Physical stream verification is mandatory for publication readiness."
        );
      }
    } else if (streamErrors > 0) {
      streamInspection = `FAILED (${streamErrors} streams undecodable or failed inspection)`;
    } else if (inspectedStreamCount === manifest.items.length && manifest.items.length > 0) {
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
    } else if (decodedStreamCount === manifest.items.length && manifest.items.length > 0) {
      decodeVerification = `VERIFIED (${decodedStreamCount} video streams decoded and playback-certified)`;
    } else {
      decodeVerification = "INCOMPLETE (Streams not fully verified for playback decode integrity)";
      errors.push("Publication readiness requirement failed: All media streams must pass playback decode verification.");
    }
  } else if (mode === "assets") {
    if (inspectedStreamCount > 0) {
      streamInspection = `VERIFIED (${inspectedStreamCount} streams inspected)`;
    } else if (!isFFprobeAvailable() || unavailableStreams > 0) {
      streamInspection = "INCOMPLETE (ffprobe unavailable; technical stream inspection incomplete)";
    } else {
      streamInspection = "INCOMPLETE (no video streams inspected)";
    }

    if (decodedStreamCount > 0) {
      decodeVerification = `VERIFIED (${decodedStreamCount} streams decoded)`;
    } else if (!isFFmpegAvailable() || unavailableDecoders > 0) {
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
      total: manifest.items.length,
      videos: videoCount,
      shorts: shortCount,
    },
  };
}

/**
 * Validate the live TypeScript production catalog in src/data/edits.ts
 */
export async function validateLiveCatalog(root = projectRoot, options = {}) {
  const editsModule = await import(resolve(root, "src/data/edits.ts"));
  const fandomsModule = await import(resolve(root, "src/data/fandoms.ts"));

  const edits = editsModule.edits;
  const fandomRegistry = fandomsModule.FANDOM_REGISTRY;

  const errors = [];
  const warnings = [];

  const allowExpanded = options.allowExpandedCatalog ?? false;
  const isExpanded = allowExpanded || (Array.isArray(edits) && edits.length > 17);

  // Invariant 1: Exactly 17 demo edits (or >= 17 if expanded)
  if (!Array.isArray(edits)) {
    errors.push(`Live catalog edit count violation: expected array of edits, got ${typeof edits}`);
  } else if (!isExpanded && edits.length !== 17) {
    errors.push(`Live catalog edit count violation: expected exactly 17 edits, got ${edits.length}`);
  } else if (isExpanded && edits.length < 17) {
    errors.push(`Expanded catalog must preserve at least the 17 baseline demo edits, got ${edits.length}`);
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

    // For expanded catalog: enforce ID range policy for curated items beyond demo baseline
    if (isExpanded && i >= 17) {
      if (edit.format === "short") {
        if (edit.id < 200 || edit.id > 299) {
          errors.push(`Curated short ID ${edit.id} outside allowed range [200..299]`);
        }
      } else {
        if (edit.id < 100 || edit.id > 199) {
          errors.push(`Curated video ID ${edit.id} outside allowed range [100..199]`);
        }
      }
    }
  }

  // Invariant 2: Production contains zero fabricated Shorts (unless expanded catalog allows genuine shorts)
  if (!isExpanded && shortCount !== 0) {
    errors.push(
      `Production catalog contains ${shortCount} Shorts. Invariant requires exactly 0 Shorts until owner media is received.`
    );
  }

  // Invariant 3: Baseline demo IDs must be exactly 0 to 16
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

/**
 * Strip private editorial metadata for public client projection.
 * SAFE BY DEFAULT: Rejects unapproved or uncleared records unless allowDraft: true is explicitly provided.
 */
export function projectToPublicEdit(item, { allowDraft = false, strict = true } = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Cannot project non-object to public edit");
  }

  const reviewStatus = item.editorial?.reviewStatus;
  const rightsCleared = item.editorial?.rightsCleared;

  if (!allowDraft && strict !== false) {
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
    creator: "Lolixco curated",
    poster,
    source,
    duration,
    trending: !!trending,
    format,
  };

  if (fandomIds && Array.isArray(fandomIds) && fandomIds.length > 0) {
    publicRecord.fandomIds = [...fandomIds];
  }

  return publicRecord;
}

/**
 * Non-public preview projection function.
 * Explicitly allows draft and unreviewed items for development preview only.
 */
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
      console.error(`Error: Unrecognized option '${args[i]}'. Allowed options: --manifest <path>, --mode <${VALID_MODES.join("|")}>, --publish, --assets, --metadata, --allow-expanded`);
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
