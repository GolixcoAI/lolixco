/** Authoritative paired catalog compiler. No environment loading or network IO. */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  projectToPublicYouTubeEdit,
  generateYouTubeEditsTs,
} from "./compile-youtube-catalog.mjs";
import {
  assertPublicEditIntegrity,
  isBaselineDemoRecord,
  verifyProductionPublicationEligibility,
  hasSyntheticMarker,
  projectRoot,
} from "./validate-content.mjs";
import {
  validateAuditDocument,
  isProtectedAuditPath,
  isProtectedProductionPath,
} from "./youtube-importer.mjs";
import { isTestIsolationActive } from "./youtube-api.mjs";
import {
  checkOutputPaths,
  commitCatalogPair,
  recoverCatalogPair,
  PRODUCTION_OUTPUTS,
  canonicalPath,
} from "./catalog-transaction.mjs";

const active = (status) => status === "approved" || status === "published";
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
class CatalogValidationError extends Error {}
const fail = (message) => {
  throw new CatalogValidationError(message);
};
const string = (value) => typeof value === "string" && value.trim().length > 0;
const identity = (record, type) =>
  type === "youtube_embed" ? record.canonicalVideoId : record.assetRef;

function recent(timestamp, now, ageDays = 30) {
  const time = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
  return (
    Number.isFinite(time) &&
    time <= now + 300000 &&
    now - time <= ageDays * 86400000
  );
}

function auditItems(document, type) {
  if (!object(document) || !Array.isArray(document.items))
    fail(
      `Missing or malformed ${type} audit; both complete source audits are required`,
    );
  if (type === "youtube_embed" && !validateAuditDocument(document).valid)
    fail("Malformed YouTube audit document");
  const identities = new Set();
  for (const record of document.items) {
    if (
      !object(record) ||
      !string(identity(record, type)) ||
      !string(record.contentReviewStatus)
    )
      fail(`Malformed ${type} audit record`);
    const key = identity(record, type);
    if (identities.has(key)) fail(`Duplicate ${type} identity in audit`);
    identities.add(key);
    if (record.sourceType && record.sourceType !== type)
      fail("Audit source mismatch");
  }
  return document.items;
}

function playback(evidence, key, now) {
  if (
    !object(evidence) ||
    evidence.identity !== key ||
    evidence.status !== "passed" ||
    !recent(evidence.verifiedAt, now)
  )
    fail("Missing, stale or mismatched in-app playback evidence");
}

function hostedProjection(record, policy, now) {
  if (!Array.isArray(policy.approvedOrigins) || !policy.approvedOrigins.length)
    fail("Hosted publication requires approved origin policy");
  if (
    hasSyntheticMarker(record) ||
    record.provenance !== "owner_direct_upload" ||
    !active(record.contentReviewStatus)
  )
    fail("Hosted approval/provenance is not eligible");
  if (
    record.rightsCleared !== true ||
    !string(record.rightsDocumentation) ||
    !object(record.rights) ||
    record.rights.videoDistribution !== true ||
    record.rights.audioDistribution !== true ||
    record.rights.documentationRef !== record.rightsDocumentation
  )
    fail("Hosted video and audio distribution rights must be documented");
  const inspected = record.mediaVerification;
  if (
    !object(inspected) ||
    inspected.assetRef !== record.assetRef ||
    inspected.source !== record.deliveryUrl ||
    inspected.poster !== record.posterDeliveryUrl ||
    inspected.format !== record.format ||
    !/^[a-f0-9]{64}$/.test(inspected.sha256 || "") ||
    inspected.decodeVerified !== true ||
    !recent(inspected.verifiedAt, now)
  )
    fail("Hosted media verification is missing or mismatched");
  const { width, height, durationSec } = inspected;
  if (
    ![width, height].every((n) => Number.isSafeInteger(n) && n > 0) ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    inspected.codec !== "h264" ||
    inspected.audioCodec !== "aac"
  )
    fail("Hosted media inspection is invalid");
  const ratio = record.format === "short" ? height / width : width / height;
  if (
    ratio < 1.7 ||
    ratio > 1.86 ||
    (record.format === "short" && durationSec > 180)
  )
    fail("Hosted media format does not match verified dimensions/duration");
  if (
    record.formatConfirmed !== true ||
    record.confirmedFormat !== record.format
  )
    fail("Hosted format must be confirmed");
  playback(record.playbackVerification, record.assetRef, now);
  const projected = {
    id: record.assignedLolixcoId,
    title: record.title,
    description: record.description,
    creator: record.creator,
    category: record.category,
    tags: record.tags,
    poster: record.posterDeliveryUrl,
    source: record.deliveryUrl,
    duration: record.duration,
    trending: record.trending ?? false,
    format: record.format,
    sourceType: "licensed_local_media",
  };
  if (record.fandomIds !== undefined) projected.fandomIds = record.fandomIds;
  // The public assertion applies exact origins, optimized/poster prefixes and shapes.
  assertPublicEditIntegrity(projected, {
    approvedOrigins: policy.approvedOrigins,
  });
  const parts = projected.duration.split(":").map(Number);
  if (Math.abs(parts[0] * 60 + parts[1] - durationSec) > 1)
    fail("Hosted display duration contradicts inspected duration");
  return projected;
}

function publicIdentity(record) {
  return record.sourceType === "youtube_embed" ? record.youtubeVideoId : null;
}

export async function compileCatalog(options = {}) {
  try {
    if (
      options.allowDraft ||
      options.allowMocks ||
      options.allowSyntheticAudit ||
      options.strict === false
    )
      fail(
        "Preview or synthetic bypass options are forbidden in unified compilation",
      );
    const now =
      options.now === undefined ? Date.now() : Date.parse(options.now);
    if (!Number.isFinite(now)) fail("Invalid compiler verification time");
    const policy = structuredClone(options.policy || {});
    if (
      !object(policy) ||
      Object.keys(policy).some((key) => key !== "approvedOrigins")
    )
      fail("Invalid trusted policy document");
    const youtube = auditItems(
      structuredClone(options.youtubeAudit),
      "youtube_embed",
    );
    const hosted = auditItems(
      structuredClone(options.hostedAudit),
      "licensed_local_media",
    );
    let current = structuredClone(options.previousCatalog);
    let existingSource = null;
    let paths = null;
    if (options.publish === true || options.check) {
      paths = checkOutputPaths([
        options.outputPath || PRODUCTION_OUTPUTS[0],
        options.snapshotPath || PRODUCTION_OUTPUTS[1],
      ]);
      const present = paths.map(existsSync);
      if (present[0] !== present[1])
        fail("Paired outputs are incomplete; recover before compiling");
      if (present[0]) {
        const previous = JSON.parse(readFileSync(paths[1], "utf8"));
        if (
          !object(previous) ||
          Object.keys(previous).some(
            (key) =>
              ![
                "catalog_version",
                "total_edits",
                "edits",
                "exported_at",
              ].includes(key),
          ) ||
          !string(previous.catalog_version) ||
          !Array.isArray(previous.edits) ||
          previous.total_edits !== previous.edits.length
        )
          fail("Existing snapshot is malformed");
        if (current && !isDeepStrictEqual(current, previous.edits))
          fail(
            "Caller previous catalog disagrees with existing paired snapshot",
          );
        current = previous.edits;
        existingSource = readFileSync(paths[0], "utf8");
      }
    }
    current ??= (await import("../src/data/edits.ts")).edits;
    current = structuredClone(current);
    if (!Array.isArray(current) || current.length < 17)
      fail("Previous complete catalog is required");
    for (let id = 0; id < 17; id++)
      if (
        current[id]?.id !== id ||
        !isBaselineDemoRecord(current[id], { checkFileChecksum: true })
      )
        fail("Frozen demo identity/order mismatch");
    const previousIds = new Set(),
      previousVideoIds = new Set();
    for (const record of current) {
      assertPublicEditIntegrity(record, {
        approvedOrigins: policy.approvedOrigins,
      });
      if (
        previousIds.has(record.id) ||
        (publicIdentity(record) && previousVideoIds.has(publicIdentity(record)))
      )
        fail("Duplicate identity in previous catalog");
      previousIds.add(record.id);
      if (publicIdentity(record)) previousVideoIds.add(publicIdentity(record));
    }
    const baselineSource = readFileSync(
      resolve(projectRoot, "content/baseline/edits.ts"),
      "utf8",
    );
    if (
      existingSource !== null &&
      existingSource !==
        (current.length === 17
          ? baselineSource
          : generateYouTubeEditsTs(current))
    )
      fail(
        "Frontend and snapshot are not the same verified generation; recover before compiling",
      );
    const registry = (await import("../src/data/fandoms.ts")).FANDOM_REGISTRY;
    if (
      !Array.isArray(registry) ||
      registry.some((f) => !object(f) || !string(f.id))
    )
      fail("Fandom registry is invalid");
    const slugs = new Set(registry.map((f) => f.id));
    const reserved = new Map(),
      owners = new Map(),
      currentRecords = new Map();
    const reserve = (id, owner, type, format) => {
      if (id === undefined || id === null) return;
      const min =
        type === "youtube_embed"
          ? format === "short"
            ? 200
            : 100
          : format === "short"
            ? 400
            : 300;
      if (!Number.isSafeInteger(id) || id < min || id > min + 99)
        fail(
          "Historical ID allocation/source/format conflict; automatic migration is forbidden",
        );
      if (reserved.has(id) && reserved.get(id) !== owner)
        fail("Historical ID ownership collision");
      if (owners.has(owner) && owners.get(owner) !== id)
        fail(
          "Historical owner has conflicting IDs; automatic migration is forbidden",
        );
      reserved.set(id, owner);
      owners.set(owner, id);
    };
    for (const [records, type] of [
      [youtube, "youtube_embed"],
      [hosted, "licensed_local_media"],
    ]) {
      for (const record of records) {
        const key = identity(record, type),
          owner = `${type}:${key}`;
        if (
          (active(record.contentReviewStatus) ||
            record.assignedLolixcoId != null ||
            record.auditHistory?.some(
              (event) => event?.assignedLolixcoId != null,
            )) &&
          record.format !== "video" &&
          record.format !== "short"
        )
          fail("Allocated/approved audit format must be explicit");
        reserve(record.assignedLolixcoId, owner, type, record.format);
        if (
          record.auditHistory !== undefined &&
          !Array.isArray(record.auditHistory)
        )
          fail("Malformed allocation history");
        for (const event of record.auditHistory || []) {
          if (!object(event)) fail("Malformed allocation event");
          reserve(event.assignedLolixcoId, owner, type, record.format);
        }
        if (record.assignedLolixcoId != null)
          currentRecords.set(record.assignedLolixcoId, { record, type, key });
      }
    }
    for (const previous of current.slice(17)) {
      const matched = currentRecords.get(previous.id);
      if (
        !matched ||
        matched.type !== previous.sourceType ||
        (matched.type === "youtube_embed" &&
          matched.key !== previous.youtubeVideoId)
      )
        fail("Previous catalog ownership missing from complete source audits");
      if (previous.format !== matched.record.format)
        fail("Previously allocated format cannot migrate");
      if (
        previous.sourceType === "licensed_local_media" &&
        previous.source !== matched.record.deliveryUrl
      )
        fail(
          "Hosted identity/delivery change requires a separately reviewed migration",
        );
      if (!active(matched.record.contentReviewStatus)) {
        const removal = matched.record.publicationRemoval;
        if (
          !["rejected", "unavailable", "embed_restricted"].includes(
            matched.record.contentReviewStatus,
          ) ||
          !object(removal) ||
          removal.approved !== true ||
          removal.id !== previous.id ||
          removal.identity !== matched.key ||
          removal.status !== matched.record.contentReviewStatus ||
          !string(removal.reason) ||
          !recent(removal.approvedAt, now)
        )
          fail(
            "Removing public content requires an explicit authorized lifecycle change",
          );
      }
    }
    const real = [];
    for (const [records, type] of [
      [youtube, "youtube_embed"],
      [hosted, "licensed_local_media"],
    ]) {
      for (const record of records) {
        if (!active(record.contentReviewStatus)) continue;
        if (!Number.isSafeInteger(record.assignedLolixcoId))
          fail(
            "Approved item lacks historical allocation; compiler never invents IDs",
          );
        let projected;
        if (type === "youtube_embed") {
          projected = projectToPublicYouTubeEdit(record);
          projected.sourceUrl = projected.source;
          const eligible = verifyProductionPublicationEligibility(projected, {
            auditEvidence: record,
            now: new Date(now).toISOString(),
          });
          if (!eligible.valid)
            fail("YouTube publication evidence failed validation");
          if (
            record.format !== projected.format ||
            !string(record.metadata?.channelId)
          )
            fail("YouTube format/channel evidence is missing");
          const duration = /^(\d+):([0-5]\d)$/.exec(
            record.metadata.durationFormatted || "",
          );
          const seconds =
            record.metadata.durationSec ?? record.metadata.durationSeconds;
          if (
            !duration ||
            Math.abs(Number(duration[1]) * 60 + Number(duration[2]) - seconds) >
              1 ||
            (record.format === "short" && seconds > 180)
          )
            fail("YouTube formatted/measured duration is inconsistent");
          playback(record.playbackVerification, record.canonicalVideoId, now);
        } else projected = hostedProjection(record, policy, now);
        if ((projected.fandomIds || []).some((id) => !slugs.has(id)))
          fail("Unregistered fandom in public projection");
        // Convert to JSON values so snapshot and frontend agree on optional omissions.
        const publicRecord = JSON.parse(JSON.stringify(projected));
        assertPublicEditIntegrity(publicRecord, {
          approvedOrigins: policy.approvedOrigins,
        });
        real.push(publicRecord);
      }
    }
    real.sort((a, b) => a.id - b.id);
    const catalog = [...current.slice(0, 17), ...real];
    const version = options.catalogVersion || "demo-catalog-v1";
    if (typeof version !== "string" || !/^[a-zA-Z0-9_-]+$/.test(version))
      fail("Invalid catalog version");
    const source =
      catalog.length === 17 ? baselineSource : generateYouTubeEditsTs(catalog);
    const snapshot =
      JSON.stringify(
        {
          catalog_version: version,
          total_edits: catalog.length,
          edits: catalog,
        },
        null,
        2,
      ) + "\n";
    let matches = null;
    if (options.publish === true || options.check) {
      if (options.publish === true) {
        try {
          commitCatalogPair(paths, [source, snapshot], { io: options.io });
        } catch (error) {
          const safe = [
            "Catalog transaction failed; original outputs restored",
            "Catalog transaction failed; rollback incomplete, retain journal and recover before reuse",
            "Catalog transaction already exists; inspect/recover it before retrying",
          ];
          fail(
            safe.includes(error.message)
              ? error.message
              : "Output transaction failed; inspect recovery journal before retrying",
          );
        }
      }
      matches = paths.every(
        (path, i) =>
          existsSync(path) &&
          readFileSync(path, "utf8") === [source, snapshot][i],
      );
    }
    if (options.check && !matches)
      fail("Generated catalogs differ from paired outputs");
    return {
      success: true,
      catalog,
      source,
      snapshot,
      totalCount: catalog.length,
      written: options.publish === true,
      matches,
    };
  } catch (error) {
    // Never echo raw audit fields, parser payloads, credentials or filesystem errors.
    return {
      success: false,
      errors: [
        error instanceof CatalogValidationError
          ? `Catalog compilation rejected: ${error.message}`
          : "Catalog compilation rejected: public integrity or output transaction failed. Private input details are suppressed; inspect recovery journal before retrying a failed write.",
      ],
    };
  }
}

function readInput(path) {
  if (!path || !path.endsWith(".json")) fail("Explicit JSON input required");
  if (
    isTestIsolationActive() &&
    (isProtectedAuditPath(path) ||
      isProtectedProductionPath(path) ||
      /[/\\]content[/\\]audit[/\\]/.test(resolve(path)))
  )
    fail("Protected input is forbidden under test isolation");
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function runUnifiedCompilerCli(args = process.argv.slice(2)) {
  try {
    if (args.includes("--help")) {
      console.log(
        "Unified catalog compiler: --youtube-audit FILE --hosted-audit FILE [--policy FILE] [--previous-snapshot FILE] [--output FILE --snapshot FILE] [--check | --publish | --recover]. Default: validate/dry-run. Publication needs separate owner authorization.",
      );
      return 0;
    }
    const options = {},
      values = new Map();
    const valued = new Set([
      "--youtube-audit",
      "--hosted-audit",
      "--policy",
      "--previous-snapshot",
      "--output",
      "--snapshot",
      "--version",
    ]);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (values.has(arg)) fail("Duplicate argument");
      if (valued.has(arg)) {
        if (!args[i + 1] || args[i + 1].startsWith("--"))
          fail("Missing argument");
        values.set(arg, args[++i]);
      } else if (["--publish", "--check", "--recover"].includes(arg))
        values.set(arg, true);
      else fail("Unknown argument");
    }
    if (
      ["--publish", "--check", "--recover"].filter((key) => values.has(key))
        .length > 1
    )
      fail("Conflicting modes");
    options.outputPath = values.get("--output");
    options.snapshotPath = values.get("--snapshot");
    if (values.has("--recover")) {
      recoverCatalogPair([
        options.outputPath || PRODUCTION_OUTPUTS[0],
        options.snapshotPath || PRODUCTION_OUTPUTS[1],
      ]);
      console.log("Catalog recovery completed");
      return 0;
    }
    options.youtubeAudit = readInput(values.get("--youtube-audit"));
    options.hostedAudit = readInput(values.get("--hosted-audit"));
    if (values.has("--policy"))
      options.policy = readInput(values.get("--policy"));
    if (values.has("--previous-snapshot")) {
      const previous = readInput(values.get("--previous-snapshot"));
      if (
        !object(previous) ||
        !Array.isArray(previous.edits) ||
        previous.total_edits !== previous.edits.length
      )
        fail("Invalid previous snapshot");
      options.previousCatalog = previous.edits;
    }
    if (values.has("--publish")) {
      const outputs = checkOutputPaths([
        options.outputPath || PRODUCTION_OUTPUTS[0],
        options.snapshotPath || PRODUCTION_OUTPUTS[1],
      ]);
      for (const key of ["--youtube-audit", "--hosted-audit", "--policy"]) {
        if (values.has(key) && outputs.includes(canonicalPath(values.get(key))))
          fail("Output overlaps a private input or policy");
      }
    }
    options.catalogVersion = values.get("--version");
    options.publish = values.has("--publish");
    options.check = values.has("--check");
    const result = await compileCatalog(options);
    if (!result.success) {
      console.error(result.errors[0]);
      return 1;
    }
    console.log(
      `Verified ${result.totalCount} records; ${result.written ? "paired outputs committed" : "no writes (dry-run/check)"}`,
    );
    return 0;
  } catch {
    console.error(
      "Catalog command rejected: verify explicit inputs, output paths and mode; private input details are suppressed.",
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await runUnifiedCompilerCli();
