import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import {
  isBaselineDemoRecord,
  validateSourceAndId,
  validateMediaUrlOrigin,
  assertPublicEditIntegrity,
  projectToPublicEdit,
  projectToPreviewEdit,
  BASELINE_DEMO_RECORDS,
  PINNED_EDITS_TS_SHA256,
  PUBLIC_FIELD_ALLOWLIST,
  FORBIDDEN_PRIVATE_FIELDS,
  isPublicFieldAllowed,
  isForbiddenPrivateField,
  projectRoot,
  resolveItemAuditEvidence,
  verifyProductionPublicationEligibility,
  validateContentManifest,
} from "../scripts/validate-content.mjs";
import { projectToPublicYouTubeEdit } from "../scripts/compile-youtube-catalog.mjs";

// ============================================================================
// 1. PINNED DEMO INTEGRITY AND UNFORGEABLE DEMO PREDICATE
// ============================================================================

test("Stage 2: src/data/edits.ts matches pinned SHA-256 baseline checksum", () => {
  const filePath = resolve(projectRoot, "src/data/edits.ts");
  const fileBytes = readFileSync(filePath);
  const actualHash = createHash("sha256").update(fileBytes).digest("hex");
  assert.equal(
    actualHash,
    PINNED_EDITS_TS_SHA256,
    `src/data/edits.ts checksum mismatch! Expected ${PINNED_EDITS_TS_SHA256}, got ${actualHash}`
  );
});

test("Stage 2: All 17 genuine baseline demo records pass isBaselineDemoRecord under supported base paths", () => {
  assert.equal(BASELINE_DEMO_RECORDS.length, 17);

  const supportedBases = ["", "/", "./", "/app/", "/lolixco/"];

  for (let id = 0; id < 17; id++) {
    const baseline = BASELINE_DEMO_RECORDS[id];

    for (const base of supportedBases) {
      const candidate = {
        id,
        title: baseline.title,
        category: baseline.category,
        tags: [...baseline.tags],
        description: baseline.description,
        creator: baseline.creator,
        poster: `${base}${baseline.posterSuffix}`,
        source: `${base}${baseline.sourceSuffix}`,
        duration: baseline.duration,
        trending: baseline.trending,
      };

      assert.equal(
        isBaselineDemoRecord(candidate, { checkFileChecksum: true }),
        true,
        `Genuine demo edit ${id} should pass under base '${base}'`
      );
    }
  }
});

test("Stage 2: Forged demo record with copied creator/description but modified title fails", () => {
  const candidate = {
    id: 0,
    title: "Forged Title Attempt",
    category: "Cinematic",
    tags: ["cinematic", "original", "demo", "landscape"],
    description: "Original geometric artwork. Silent motion study for player testing; not finished creator footage.",
    creator: "Lolixco demo",
    poster: "/media/art-0.svg",
    source: "/media/motion-study.webm",
    duration: "0:12",
    trending: false,
  };
  assert.equal(isBaselineDemoRecord(candidate), false);
});

test("Stage 2: Forged demo record with modified tags fails", () => {
  const candidate = {
    id: 0,
    title: "Into the Light",
    category: "Cinematic",
    tags: ["cinematic", "custom", "tag"],
    description: "Original geometric artwork. Silent motion study for player testing; not finished creator footage.",
    creator: "Lolixco demo",
    poster: "/media/art-0.svg",
    source: "/media/motion-study.webm",
    duration: "0:12",
    trending: false,
  };
  assert.equal(isBaselineDemoRecord(candidate), false);
});

test("Stage 2: Demo record with extra properties (e.g. format, sourceType) fails unforgeable check", () => {
  const candidate = {
    id: 0,
    title: "Into the Light",
    category: "Cinematic",
    tags: ["cinematic", "original", "demo", "landscape"],
    description: "Original geometric artwork. Silent motion study for player testing; not finished creator footage.",
    creator: "Lolixco demo",
    poster: "/media/art-0.svg",
    source: "/media/motion-study.webm",
    duration: "0:12",
    trending: false,
    format: "video",
    sourceType: "local_demo",
  };
  assert.equal(isBaselineDemoRecord(candidate), false);
});

test("Stage 2: Demo record with directory traversal in poster fails", () => {
  const candidate = {
    id: 0,
    title: "Into the Light",
    category: "Cinematic",
    tags: ["cinematic", "original", "demo", "landscape"],
    description: "Original geometric artwork. Silent motion study for player testing; not finished creator footage.",
    creator: "Lolixco demo",
    poster: "/media/../media/art-0.svg",
    source: "/media/../media/motion-study.webm",
    duration: "0:12",
    trending: false,
  };
  assert.equal(isBaselineDemoRecord(candidate), false);
});

test("Stage 2: Ordinary intake batch (isNewBatch: true) strictly rejects IDs 0-16", () => {
  for (let id = 0; id <= 16; id++) {
    const res = validateSourceAndId(
      { id, format: "video", sourceType: "youtube_embed" },
      { isNewBatch: true }
    );
    assert.equal(res.valid, false);
    assert.match(res.errors[0], /Reserved ID conflict: ID \d+ is reserved for baseline demo edits/);
  }
});

// ============================================================================
// 2. ID PARTITIONS, NUMBER SAFETY, AND FORMAT MIGRATION PROHIBITION
// ============================================================================

test("Stage 2: Number safety rejects fractions, booleans, strings, NaN, null, and negatives", () => {
  const invalidIds = [100.5, "100", true, false, NaN, Infinity, -Infinity, null, undefined, -1, -100];
  for (const id of invalidIds) {
    const res = validateSourceAndId({ id, format: "video", sourceType: "youtube_embed" });
    assert.equal(res.valid, false, `ID ${JSON.stringify(id)} should be rejected`);
  }
});

test("Stage 2: Partition 17-99 reserved test harness is rejected without allowTestHarness", () => {
  for (const id of [17, 50, 99]) {
    const res = validateSourceAndId({ id, format: "video", sourceType: "youtube_embed" });
    assert.equal(res.valid, false);
    assert.match(res.errors[0], /reserved for internal test harnesses/);
  }
});

test("Stage 2: Partitions 100-199 enforce YouTube landscape video", () => {
  const valid = validateSourceAndId({ id: 100, format: "video", sourceType: "youtube_embed" });
  assert.equal(valid.valid, true);

  const conflictFormat = validateSourceAndId({ id: 100, format: "short", sourceType: "youtube_embed" });
  assert.equal(conflictFormat.valid, false);
  assert.match(conflictFormat.errors[0], /Format partition conflict.*Automatic format migration is prohibited/);

  const conflictSource = validateSourceAndId({ id: 100, format: "video", sourceType: "licensed_local_media" });
  assert.equal(conflictSource.valid, false);
  assert.match(conflictSource.errors[0], /Source partition conflict/);
});

test("Stage 2: Partitions 200-299 enforce YouTube portrait Short", () => {
  const valid = validateSourceAndId({ id: 200, format: "short", sourceType: "youtube_embed" });
  assert.equal(valid.valid, true);

  const conflictFormat = validateSourceAndId({ id: 200, format: "video", sourceType: "youtube_embed" });
  assert.equal(conflictFormat.valid, false);
  assert.match(conflictFormat.errors[0], /Format partition conflict.*Automatic format migration is prohibited/);

  const conflictSource = validateSourceAndId({ id: 200, format: "short", sourceType: "licensed_local_media" });
  assert.equal(conflictSource.valid, false);
  assert.match(conflictSource.errors[0], /Source partition conflict/);
});

test("Stage 2: Partitions 300-399 enforce licensed hosted landscape video", () => {
  const valid = validateSourceAndId({ id: 300, format: "video", sourceType: "licensed_local_media" });
  assert.equal(valid.valid, true);

  const conflictFormat = validateSourceAndId({ id: 300, format: "short", sourceType: "licensed_local_media" });
  assert.equal(conflictFormat.valid, false);
  assert.match(conflictFormat.errors[0], /Format partition conflict.*Automatic format migration is prohibited/);

  const conflictSource = validateSourceAndId({ id: 300, format: "video", sourceType: "youtube_embed" });
  assert.equal(conflictSource.valid, false);
  assert.match(conflictSource.errors[0], /Source partition conflict/);
});

test("Stage 2: Partitions 400-499 enforce licensed hosted portrait Short", () => {
  const valid = validateSourceAndId({ id: 400, format: "short", sourceType: "licensed_local_media" });
  assert.equal(valid.valid, true);

  const conflictFormat = validateSourceAndId({ id: 400, format: "video", sourceType: "licensed_local_media" });
  assert.equal(conflictFormat.valid, false);
  assert.match(conflictFormat.errors[0], /Format partition conflict.*Automatic format migration is prohibited/);

  const conflictSource = validateSourceAndId({ id: 400, format: "short", sourceType: "youtube_embed" });
  assert.equal(conflictSource.valid, false);
  assert.match(conflictSource.errors[0], /Source partition conflict/);
});

test("Stage 2: Unallocated IDs (500+) fail closed", () => {
  for (const id of [500, 501, 1000]) {
    const res = validateSourceAndId({ id, format: "video", sourceType: "youtube_embed" });
    assert.equal(res.valid, false);
    assert.match(res.errors[0], /Unallocated ID partition/);
  }
});

// ============================================================================
// 3. DETERMINISTIC URL SECURITY ARCHITECTURE
// ============================================================================

test("Stage 2: Raw userinfo syntax (@) is rejected fail-closed", () => {
  const userinfoUrls = [
    "https://@www.youtube.com/watch?v=12345678901",
    "https://user:pass@www.youtube.com/watch?v=12345678901",
    "https://admin@www.youtube.com/watch?v=12345678901",
    "https://@cdn.example.com/optimized/landscape/video.mp4",
  ];
  for (const url of userinfoUrls) {
    const res = validateMediaUrlOrigin(url);
    assert.equal(res.valid, false);
    assert.match(res.error, /URL contains forbidden userinfo syntax/);
  }
});

test("Stage 2: Explicit :443 normalizes and passes; other ports fail", () => {
  const port443 = "https://www.youtube.com:443/watch?v=12345678901";
  const res443 = validateMediaUrlOrigin(port443);
  assert.equal(res443.valid, true);
  assert.equal(res443.canonicalUrl, "https://www.youtube.com/watch?v=12345678901");

  const otherPorts = [
    "https://www.youtube.com:8080/watch?v=12345678901",
    "https://www.youtube.com:80/watch?v=12345678901",
    "https://www.youtube.com:8443/watch?v=12345678901",
  ];
  for (const url of otherPorts) {
    const res = validateMediaUrlOrigin(url);
    assert.equal(res.valid, false);
    assert.match(res.error, /Media URL cannot specify custom port/);
  }
});

test("Stage 2: Duplicate YouTube 'v' parameters fail", () => {
  const duplicateV = "https://www.youtube.com/watch?v=12345678901&v=12345678901";
  const res = validateMediaUrlOrigin(duplicateV);
  assert.equal(res.valid, false);
  assert.match(res.error, /must contain exactly one 'v' parameter/);
});

test("Stage 2: Extra query parameters on YouTube watch or poster fail", () => {
  const extraParamWatch = "https://www.youtube.com/watch?v=12345678901&list=PL123456";
  const resWatch = validateMediaUrlOrigin(extraParamWatch);
  assert.equal(resWatch.valid, false);
  assert.match(resWatch.error, /must not contain query parameters other than 'v'/);

  const queryPoster = "https://i.ytimg.com/vi/12345678901/hqdefault.jpg?version=2";
  const resPoster = validateMediaUrlOrigin(queryPoster, { kind: "poster" });
  assert.equal(resPoster.valid, false);
  assert.match(resPoster.error, /must not contain query parameters/);
});

test("Stage 2: Raw and encoded path traversal fail closed", () => {
  const traversalUrls = [
    "https://www.youtube.com/watch/../watch?v=12345678901",
    "https://www.youtube.com/%2e%2e/watch?v=12345678901",
    "https://www.youtube.com/%2E%2E/watch?v=12345678901",
    "https://www.youtube.com/%252e%252e/watch?v=12345678901",
    "https://www.youtube.com/watch%2f?v=12345678901",
    "https://www.youtube.com/watch%5c?v=12345678901",
    "https://www.youtube.com/watch\\?v=12345678901",
  ];
  for (const url of traversalUrls) {
    const res = validateMediaUrlOrigin(url);
    assert.equal(res.valid, false, `URL '${url}' should be rejected for traversal/encoding`);
  }
});

test("Stage 2: Deceptive hostnames fail origin verification", () => {
  const deceptiveUrls = [
    "https://www.youtube.com.attacker.com/watch?v=12345678901",
    "https://youtube.com.attacker.com/watch?v=12345678901",
    "https://evil-youtube.com/watch?v=12345678901",
    "https://i.ytimg.com.attacker.com/vi/12345678901/hqdefault.jpg",
  ];
  for (const url of deceptiveUrls) {
    const res = validateMediaUrlOrigin(url, { kind: url.includes("ytimg") ? "poster" : "source" });
    assert.equal(res.valid, false);
    assert.match(res.error, /origin must be/);
  }
});// ============================================================================
// 4. HOSTED MEDIA URL SECURITY AND ORIGIN POLICY
// ============================================================================

test("Stage 2: Hosted media origin validation fails closed when no approved origin is configured", () => {
  const url = "https://cdn.example.com/optimized/landscape/test.mp4";
  const res = validateMediaUrlOrigin(url, {
    sourceType: "licensed_local_media",
    kind: "source",
    format: "video",
  });
  assert.equal(res.valid, false);
  assert.match(res.error, /no approved CDN origins configured \(fail-closed policy\)/);
});

test("Stage 2: Hosted media origin policy rejects wildcard configurations", () => {
  const url = "https://cdn.example.com/optimized/landscape/test.mp4";
  const res = validateMediaUrlOrigin(url, {
    sourceType: "licensed_local_media",
    kind: "source",
    format: "video",
    approvedOrigins: ["https://*.cloudfront.net"],
  });
  assert.equal(res.valid, false);
  assert.match(res.error, /wildcards are prohibited/);
});

test("Stage 2: Candidate record cannot inject its own approvedOrigins policy", () => {
  const candidateWithInjectedPolicy = {
    id: 301,
    title: "Test Edit",
    category: "Gaming",
    tags: ["gaming"],
    description: "A valid description for test.",
    creator: "Creator",
    poster: "https://unauthorized-cdn.com/posters/landscape/poster.webp",
    source: "https://unauthorized-cdn.com/optimized/landscape/video.mp4",
    duration: "1:00",
    trending: false,
    format: "video",
    sourceType: "licensed_local_media",
    approvedOrigins: ["https://unauthorized-cdn.com"], // Attempted injection
  };

  assert.throws(
    () => assertPublicEditIntegrity(candidateWithInjectedPolicy),
    /unrecognized property 'approvedOrigins'|no approved CDN origins configured/
  );
});

test("Stage 2: Hosted media URLs enforce exact directory structures", () => {
  const approvedOrigins = ["https://media.lolixco.com"];

  // Landscape video in portrait directory
  const wrongDirLandscape = "https://media.lolixco.com/optimized/portrait/video.mp4";
  const res1 = validateMediaUrlOrigin(wrongDirLandscape, {
    sourceType: "licensed_local_media",
    kind: "source",
    format: "video",
    approvedOrigins,
  });
  assert.equal(res1.valid, false);
  assert.match(res1.error, /Hosted landscape video path must start with '\/optimized\/landscape\/'/);

  // Video in poster directory
  const videoInPoster = "https://media.lolixco.com/posters/landscape/video.mp4";
  const res2 = validateMediaUrlOrigin(videoInPoster, {
    sourceType: "licensed_local_media",
    kind: "source",
    format: "video",
    approvedOrigins,
  });
  assert.equal(res2.valid, false);
  assert.match(res2.error, /Hosted landscape video path must start with '\/optimized\/landscape\/'/);

  // Valid landscape video and poster
  const validSource = "https://media.lolixco.com/optimized/landscape/batch01.mp4";
  const validPoster = "https://media.lolixco.com/posters/landscape/batch01.webp";

  const resSource = validateMediaUrlOrigin(validSource, {
    sourceType: "licensed_local_media",
    kind: "source",
    format: "video",
    approvedOrigins,
  });
  assert.equal(resSource.valid, true);

  const resPoster = validateMediaUrlOrigin(validPoster, {
    sourceType: "licensed_local_media",
    kind: "poster",
    format: "video",
    approvedOrigins,
  });
  assert.equal(resPoster.valid, true);
});

// ============================================================================
// 5. PUBLIC RECORD INTEGRITY AND LEAKAGE PREVENTION
// ============================================================================

test("Stage 2: assertPublicEditIntegrity rejects empty object or missing required fields", () => {
  assert.throws(() => assertPublicEditIntegrity({}), /missing required property/);
  assert.throws(
    () =>
      assertPublicEditIntegrity({
        id: 100,
        title: "Test",
        category: "Gaming",
        tags: ["gaming"],
        // missing description, creator, etc.
      }),
    /missing required property/
  );
});

test("Stage 2: assertPublicEditIntegrity rejects incorrectly typed scalar fields", () => {
  const baseEdit = {
    id: 100,
    title: "Valid Title Here",
    category: "Gaming",
    tags: ["gaming"],
    description: "A valid long description.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "1:30",
    trending: false,
    format: "video",
    sourceType: "youtube_embed",
    youtubeVideoId: "12345678901",
  };

  // Wrong duration type
  assert.throws(() => assertPublicEditIntegrity({ ...baseEdit, duration: 90 }), /duration.*must match M:SS/);

  // Wrong trending type
  assert.throws(() => assertPublicEditIntegrity({ ...baseEdit, trending: "true" }), /trending.*must be boolean/);

  // Wrong tags type (string instead of array)
  assert.throws(() => assertPublicEditIntegrity({ ...baseEdit, tags: "gaming,anime" }), /tags.*must be an array/);

  // Wrong tags element (array of numbers)
  assert.throws(() => assertPublicEditIntegrity({ ...baseEdit, tags: [1, 2, 3] }), /tag '1' is invalid/);
});

test("Stage 2: assertPublicEditIntegrity strictly rejects private fields", () => {
  const baseEdit = {
    id: 100,
    title: "Valid Title Here",
    category: "Gaming",
    tags: ["gaming"],
    description: "A valid long description.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "1:30",
    trending: false,
    format: "video",
    sourceType: "youtube_embed",
    youtubeVideoId: "12345678901",
  };

  const forbiddenKeys = [
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
    "s3Key",
    "credentials",
  ];

  for (const fKey of forbiddenKeys) {
    assert.throws(
      () => assertPublicEditIntegrity({ ...baseEdit, [fKey]: "private_data" }),
      /forbidden private field/,
      `Field '${fKey}' must be rejected from public edit`
    );
  }
});

test("Stage 2: assertPublicEditIntegrity detects and blocks leaked secrets/AWS patterns", () => {
  const baseEdit = {
    id: 100,
    title: "Valid Title Here",
    category: "Gaming",
    tags: ["gaming"],
    description: "A valid long description.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "1:30",
    trending: false,
    format: "video",
    sourceType: "youtube_embed",
    youtubeVideoId: "12345678901",
  };

  // Leaked S3 internal bucket URL
  assert.throws(
    () => assertPublicEditIntegrity({ ...baseEdit, description: "Check out https://internal.s3.amazonaws.com/edit.mp4" }),
    /secret\/leakage pattern detected/
  );

  // Leaked AWS key ID pattern
  assert.throws(
    () => assertPublicEditIntegrity({ ...baseEdit, creator: "AKIAIOSFODNN7EXAMPLE" }),
    /secret\/leakage pattern detected/
  );
});

// ============================================================================
// 6. PUBLICATION GATES AND PROJECTION BOUNDARY
// ============================================================================

test("Stage 2: projectToPublicEdit rejects YouTube item with synthetic or unverified provenance", () => {
  const mockItem = {
    id: 100,
    title: "Valid Title",
    category: "Gaming",
    tags: ["gaming"],
    description: "A valid description.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "1:00",
    trending: false,
    format: "video",
    sourceType: "youtube_embed",
    contentReviewStatus: "approved",
    isMock: true,
    provenance: "synthetic_mock",
  };

  assert.throws(() => projectToPublicEdit(mockItem), /synthetic mock metadata is prohibited/);
});

test("Stage 2: projectToPublicEdit rejects candidate Short without confirmedFormat: 'short'", () => {
  const unconfirmedShort = {
    id: 200,
    title: "Valid Short Title",
    category: "Gaming",
    tags: ["gaming"],
    description: "A valid short description.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "0:30",
    trending: false,
    format: "short",
    sourceType: "youtube_embed",
    contentReviewStatus: "approved",
    provenance: "youtube_data_api_v3",
    formatConfirmed: false,
  };

  assert.throws(() => projectToPublicEdit(unconfirmedShort), /format confirmation required/);
});

test("Stage 2: projectToPreviewEdit allows preview but projectToPublicEdit fails closed without approval", () => {
  const draftItem = {
    id: 100,
    title: "Draft Title",
    category: "Gaming",
    tags: ["gaming"],
    description: "A valid draft description.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "1:00",
    trending: false,
    format: "video",
    sourceType: "youtube_embed",
    youtubeVideoId: "12345678901",
    contentReviewStatus: "draft",
  };

  // Production publication fails closed
  assert.throws(() => projectToPublicEdit(draftItem), /review status must be 'approved' or 'published'/);

  // Preview projection succeeds
  const preview = projectToPreviewEdit(draftItem);
  assert.equal(preview.id, 100);
  assert.equal(preview.title, "Draft Title");
});

test("Stage 2: projectToPublicYouTubeEdit produces clean PublicEdit conforming to allowlist", () => {
  const auditItem = {
    assignedLolixcoId: 105,
    canonicalVideoId: "12345678901",
    canonicalUrl: "https://www.youtube.com/watch?v=12345678901",
    category: "Gaming",
    format: "video",
    trending: false,
    metadata: {
      title: "Real YouTube Video Title",
      description: "Real YouTube video description.",
      channelTitle: "Real Creator Channel",
      channelId: "UC1234567890123456789012",
      durationFormatted: "2:15",
      thumbnailUrl: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
      tags: ["gaming", "cinematic"],
    },
  };

  const publicEdit = projectToPublicYouTubeEdit(auditItem);

  assert.equal(publicEdit.id, 105);
  assert.equal(publicEdit.title, "Real YouTube Video Title");
  assert.equal(publicEdit.category, "Gaming");
  assert.equal(publicEdit.sourceType, "youtube_embed");
  assert.equal(publicEdit.youtubeVideoId, "12345678901");
  assert.equal(publicEdit.creator, "Real Creator Channel");
  assert.equal("canonicalVideoId" in publicEdit, false);
  assert.equal("metadata" in publicEdit, false);

  // Explicit assertion
  assert.equal(assertPublicEditIntegrity(publicEdit), true);
});
test("Stage 2: Curated public records (ID >= 100) strictly require explicit sourceType and format matching partition", () => {
  const baseRecord = {
    id: 110,
    title: "Explicit Field Test",
    category: "Anime",
    tags: ["anime", "action"],
    description: "Testing explicit sourceType and format requirement.",
    creator: "Studio Trigger",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    youtubeVideoId: "12345678901",
    duration: "1:30",
    trending: false,
  };

  // Missing sourceType must fail
  assert.throws(
    () => assertPublicEditIntegrity({ ...baseRecord, format: "video" }),
    /curated public edit ID 110 requires an explicit 'sourceType'/
  );

  // Missing format must fail
  assert.throws(
    () => assertPublicEditIntegrity({ ...baseRecord, sourceType: "youtube_embed" }),
    /curated public edit ID 110 requires an explicit 'format'/
  );

  // Mismatched format (short in 100-199 partition) must fail
  assert.throws(
    () => assertPublicEditIntegrity({ ...baseRecord, sourceType: "youtube_embed", format: "short" }),
    /belongs to landscape partition/
  );

  // Both explicit and matching must pass
  assert.equal(
    assertPublicEditIntegrity({ ...baseRecord, sourceType: "youtube_embed", format: "video" }),
    true
  );
});

test("Stage 2: Preview options (allowDraft: true, strict: false) are rejected when targeting production", () => {
  const draftItem = {
    id: 111,
    sourceType: "youtube_embed",
    format: "video",
    title: "Draft Item",
    category: "Anime",
    tags: ["anime"],
    description: "Draft item for preview.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "1:00",
    trending: false,
    contentReviewStatus: "draft",
  };

  // Preview projection succeeds with allowDraft: true
  const preview = projectToPublicEdit(draftItem, { allowDraft: true });
  assert.equal(preview.id, 111);

  // Production publication with allowDraft: true must fail closed
  assert.throws(
    () => projectToPublicEdit(draftItem, { allowDraft: true, isTargetingProduction: true }),
    /preview options .* are strictly forbidden for production output/
  );

  assert.throws(
    () => projectToPublicEdit(draftItem, { strict: false, forProduction: true }),
    /preview options .* are strictly forbidden for production output/
  );
});

// ============================================================================
// 7. ADVERSARIAL REVIEW REGRESSION SUITE (R1-R7)
// ============================================================================

test("Stage 2 R1: Production projection rejects self-declared authorization with synthetic/unverified provenance", () => {
  const syntheticYt = {
    id: 100,
    title: "Synthetic Review Fixture",
    category: "Anime",
    tags: ["anime"],
    description: "Synthetic offline review fixture only.",
    creator: "Synthetic Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "0:30",
    trending: false,
    format: "video",
    sourceType: "youtube_embed",
    youtubeVideoId: "12345678901",
    contentReviewStatus: "approved",
    provenance: "youtube_data_api_v3",
    metadataFetchStatus: "failed",
    lastMetadataVerification: "2000-01-01T00:00:00Z",
    metadata: {
      privacyStatus: "private",
      embeddable: false,
      syntheticOrigin: "LOLIXCO_SYNTHETIC_REVIEW",
    },
  };

  assert.throws(
    () => projectToPublicEdit(syntheticYt, { forProduction: true }),
    /production publication eligibility failed/
  );
});

test("Stage 2 R1: Production projection fails closed for hosted media without evidence", () => {
  const hostedItem = {
    id: 300,
    title: "Hosted Video",
    category: "Anime",
    tags: ["anime"],
    description: "Hosted video description.",
    creator: "Creator",
    poster: "https://cdn.review.invalid/posters/landscape/test.webp",
    source: "https://cdn.review.invalid/optimized/landscape/test.mp4",
    duration: "0:30",
    trending: false,
    format: "video",
    sourceType: "licensed_local_media",
    editorial: {
      reviewStatus: "approved",
      rightsCleared: true,
    },
  };

  assert.throws(
    () => projectToPublicEdit(hostedItem, { forProduction: true, approvedOrigins: ["https://cdn.review.invalid"] }),
    /hosted production publication requires verified media inspection/
  );
});

test("Stage 2 R2: Demo identity rejects arbitrary external asset bases even with matching checksum", () => {
  const b = BASELINE_DEMO_RECORDS[0];
  const externalDemo = {
    id: 0,
    title: b.title,
    category: b.category,
    tags: [...b.tags],
    description: b.description,
    creator: b.creator,
    poster: "https://attacker.invalid/media/art-0.svg",
    source: "https://attacker.invalid/media/motion-study.webm",
    duration: b.duration,
    trending: b.trending,
  };

  assert.equal(isBaselineDemoRecord(externalDemo, { checkFileChecksum: true }), false);
  assert.throws(
    () => projectToPublicEdit(externalDemo, { forProduction: true }),
    /production publication eligibility failed|failed baseline demo verification/
  );
});

test("Stage 2 R3: Public assertion validates sourceUrl and rejects credentials/unauthorized origins", () => {
  const yt = {
    id: 100,
    title: "Valid Title",
    category: "Anime",
    tags: ["anime"],
    description: "Valid description.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "0:30",
    trending: false,
    format: "video",
    sourceType: "youtube_embed",
    youtubeVideoId: "12345678901",
  };

  const maliciousSourceUrl = {
    ...yt,
    sourceUrl: "https://review-user:review-pass@attacker.invalid/path?token=LOLIXCO_SYNTHETIC_REVIEW",
  };

  assert.throws(
    () => assertPublicEditIntegrity(maliciousSourceUrl),
    /sourceUrl validation failed/
  );
});

test("Stage 2 R3: Public assertion rejects mismatched poster and source video identities", () => {
  const mismatchedYt = {
    id: 100,
    title: "Valid Title",
    category: "Anime",
    tags: ["anime"],
    description: "Valid description.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "0:30",
    trending: false,
    format: "video",
    sourceType: "youtube_embed",
    youtubeVideoId: "12345678901",
  };

  assert.throws(
    () => assertPublicEditIntegrity(mismatchedYt),
    /poster URL validation failed/
  );
});

test("Stage 2 R3: Public assertion detects leaked secrets inside array elements", () => {
  const ytWithSecretTag = {
    id: 100,
    title: "Valid Title",
    category: "Anime",
    tags: ["anime", "ghp_" + "a".repeat(36)],
    description: "Valid description.",
    creator: "Creator",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    source: "https://www.youtube.com/watch?v=12345678901",
    duration: "0:30",
    trending: false,
    format: "video",
    sourceType: "youtube_embed",
    youtubeVideoId: "12345678901",
  };

  assert.throws(
    () => assertPublicEditIntegrity(ytWithSecretTag),
    /secret\/leakage pattern detected/
  );
});

test("Stage 2 R6: Security lookup lists are frozen and immutable", () => {
  assert.equal(Array.isArray(PUBLIC_FIELD_ALLOWLIST), true);
  assert.equal(Object.isFrozen(PUBLIC_FIELD_ALLOWLIST), true);
  assert.equal(Array.isArray(FORBIDDEN_PRIVATE_FIELDS), true);
  assert.equal(Object.isFrozen(FORBIDDEN_PRIVATE_FIELDS), true);

  assert.throws(() => {
    PUBLIC_FIELD_ALLOWLIST.push("rightsClearanceDocumentation");
  }, /Cannot add property|not extensible|read only/i);

  assert.equal(isPublicFieldAllowed("rightsClearanceDocumentation"), false);
  assert.equal(isForbiddenPrivateField("canonicalVideoId"), true);
});

test("Stage 2 R7: validateMediaUrlOrigin rejects mixed-case and encoded dot segments before normalization", () => {
  const maliciousUrls = [
    "https://www.youtube.com/private/.%2e/watch?v=12345678901",
    "https://www.youtube.com/private/%2e./watch?v=12345678901",
    "https://www.youtube.com/./watch?v=12345678901",
    "https://www.youtube.com/watch?%76=12345678901",
  ];

  for (const url of maliciousUrls) {
    const res = validateMediaUrlOrigin(url, { sourceType: "youtube_embed", expectedVideoId: "12345678901" });
    assert.equal(res.valid, false, `URL ${url} must be rejected before normalization`);
  }
});

test("Stage 2 R5: compiler projects multiword and hashtag tags deterministically into slug contract", () => {
  const audit = {
    assignedLolixcoId: 105,
    canonicalVideoId: "12345678901",
    canonicalUrl: "https://www.youtube.com/watch?v=12345678901",
    category: "Anime",
    format: "video",
    metadata: {
      title: "Title",
      description: "Description",
      channelTitle: "Creator",
      channelId: "UC_SYNTHETIC_REVIEW",
      durationFormatted: "0:30",
      thumbnailUrl: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
      tags: ["anime edit", "4k", "#AMV", "action-packed"],
    },
  };

  const projected = projectToPublicYouTubeEdit(audit);
  assert.deepEqual(projected.tags, ["anime", "anime-edit", "4k", "amv", "action-packed"]);
  assert.equal(assertPublicEditIntegrity(projected), true);
});

// ============================================================================
// ============================================================================
// 10. STAGE 2 FINAL CORRECTIONS (V3): NO SYNTHETIC BYPASS, EXPLICIT EVIDENCE BINDING
//     WITHOUT OVERWRITING, STRICT COMPILER COMPLETENESS & FORWARDED OPTION INTEGRITY
// ============================================================================

test("Stage 2 V3: Demo identity rejects unconfigured local bases; forwarded options cannot disable checksum or production integrity", () => {
  const baseline = BASELINE_DEMO_RECORDS[0];
  const unconfiguredDemo = {
    id: 0,
    title: baseline.title,
    category: baseline.category,
    tags: [...baseline.tags],
    description: baseline.description,
    creator: baseline.creator,
    poster: `/unconfigured/${baseline.posterSuffix}`,
    source: `/unconfigured/${baseline.sourceSuffix}`,
    duration: baseline.duration,
    trending: baseline.trending,
  };

  // 1. Default supported bases (["", "/", "./", "/app/", "/lolixco/"]) must reject unconfigured local prefix
  assert.equal(isBaselineDemoRecord(unconfiguredDemo), false);
  assert.throws(() => {
    projectToPublicEdit(unconfiguredDemo, { forProduction: true });
  }, /failed baseline demo verification|Not recognized as genuine baseline demo item/i);

  // 2. Exact configured base allows legitimate custom deployment base
  assert.equal(
    isBaselineDemoRecord(unconfiguredDemo, { supportedBases: ["/unconfigured/"] }),
    true
  );
  const projected = projectToPublicEdit(unconfiguredDemo, {
    forProduction: true,
    supportedBases: ["/unconfigured/"],
  });
  assert.equal(projected.id, 0);
  assert.equal(projected.poster, "/unconfigured/media/art-0.svg");

  // 3. Forwarded options CANNOT disable checksum check or preview options during production projection
  const genuine = {
    id: 0,
    title: baseline.title,
    category: baseline.category,
    tags: [...baseline.tags],
    description: baseline.description,
    creator: baseline.creator,
    poster: `./${baseline.posterSuffix}`,
    source: `./${baseline.sourceSuffix}`,
    duration: baseline.duration,
    trending: baseline.trending,
  };

  // Attempting to pass allowDraft: true to production projection must be rejected
  assert.throws(() => {
    projectToPublicEdit(genuine, { forProduction: true, allowDraft: true });
  }, /preview options.*strictly forbidden for production output/i);

  // Attempting to pass strict: false to production projection must be rejected
  assert.throws(() => {
    projectToPublicEdit(genuine, { forProduction: true, strict: false });
  }, /preview options.*strictly forbidden for production output/i);
});

test("Stage 2 V3: Production projection and publish mode strictly reject synthetic evidence without any bypass flag", () => {
  const syntheticItem = {
    id: 105,
    title: "Synthetic Video Edit",
    description: "A test item with synthetic mock evidence.",
    creator: "Synthetic Studio",
    category: "Anime",
    format: "video",
    duration: "1:30",
    sourceType: "youtube_embed",
    source: "https://www.youtube.com/watch?v=12345678901",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    youtubeVideoId: "12345678901",
    tags: ["anime"],
    editorial: {
      reviewStatus: "approved",
      rightsCleared: true,
    },
    publicationStatus: "published",
    canonicalVideoId: "12345678901",
    canonicalUrl: "https://www.youtube.com/watch?v=12345678901",
    provenance: "synthetic_mock",
    metadataFetchStatus: "fetched",
    lastMetadataVerification: "2026-10-23T12:00:00Z",
    metadata: {
      canonicalVideoId: "12345678901",
      title: "Synthetic Video Edit",
      channelTitle: "Synthetic Studio",
      channelId: "UC_SYNTHETIC_CHANNEL",
      durationSec: 90,
      privacyStatus: "public",
      embeddable: true,
      formatConfirmed: true,
      confirmedFormat: "video",
      provenance: "synthetic_mock",
    },
  };

  // 1. Attempting to enable allowSyntheticAudit: true in projectToPublicEdit({ forProduction: true }) MUST THROW
  assert.throws(() => {
    projectToPublicEdit(syntheticItem, { forProduction: true, allowSyntheticAudit: true });
  }, /synthetic bypass options.*allowSyntheticAudit.*strictly forbidden/i);

  // 2. Production eligibility without options also fails closed
  const elig = verifyProductionPublicationEligibility(syntheticItem);
  assert.equal(elig.valid, false);
  assert.match(elig.errors.join("; "), /synthetic mock metadata is prohibited/i);

  // 3. Synthetic preview behavior remains separate: projectToPreviewEdit allows previewing drafts/mocks
  const preview = projectToPreviewEdit(syntheticItem);
  assert.equal(preview.id, 105);
  assert.equal(preview.title, "Synthetic Video Edit");
});

test("Stage 2 V3: Audit evidence binding compares without overwriting candidate intake identity, URLs, or format", () => {
  // Candidate intake record
  const candidate = {
    id: 105,
    title: "Candidate Intake Title",
    description: "An authentic intake description.",
    creator: "Candidate Intake Creator",
    category: "Anime",
    format: "video",
    duration: "2:00",
    sourceType: "youtube_embed",
    source: "https://www.youtube.com/watch?v=12345678901",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    youtubeVideoId: "12345678901",
    tags: ["anime"],
    editorial: {
      reviewStatus: "approved",
      rightsCleared: true,
    },
  };

  // 1. Audit evidence with mismatched video ID cannot overwrite candidate URL/identity and fails
  const mismatchedVideoAudit = {
    assignedLolixcoId: 105,
    canonicalVideoId: "abcdefghijk",
    canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    provenance: "youtube_data_api_v3",
    metadataFetchStatus: "fetched",
    lastMetadataVerification: "2026-10-23T12:00:00Z",
    metadata: {
      canonicalVideoId: "abcdefghijk",
      title: "Real Evidence Title",
      channelTitle: "Real Creator",
      channelId: "UC_REAL_CREATOR",
      durationSec: 120,
      privacyStatus: "public",
      embeddable: true,
      formatConfirmed: true,
      confirmedFormat: "video",
      provenance: "youtube_data_api_v3",
    },
  };

  const res1 = verifyProductionPublicationEligibility(candidate, { auditEvidence: mismatchedVideoAudit });
  assert.equal(res1.valid, false);
  assert.match(res1.errors.join("; "), /canonical YouTube ID mismatch between evidence record.*and candidate video ID/i);

  // 2. Audit evidence with mismatched assigned catalog ID fails
  const mismatchedIdAudit = {
    ...mismatchedVideoAudit,
    assignedLolixcoId: 106,
    canonicalVideoId: "12345678901",
    canonicalUrl: "https://www.youtube.com/watch?v=12345678901",
    metadata: {
      ...mismatchedVideoAudit.metadata,
      canonicalVideoId: "12345678901",
    },
  };
  const res2 = verifyProductionPublicationEligibility(candidate, { auditEvidence: mismatchedIdAudit });
  assert.equal(res2.valid, false);
  assert.match(res2.errors.join("; "), /audit evidence assignedLolixcoId \(106\) does not match candidate catalog ID \(105\)/i);

  // 3. Audit evidence with conflicting format cannot overwrite candidate format and fails
  const conflictingFormatAudit = {
    ...mismatchedIdAudit,
    assignedLolixcoId: 105,
    format: "short",
    confirmedFormat: "short",
    metadata: {
      ...mismatchedIdAudit.metadata,
      confirmedFormat: "short",
    },
  };
  const res3 = verifyProductionPublicationEligibility(candidate, { auditEvidence: conflictingFormatAudit });
  assert.equal(res3.valid, false);
  assert.match(res3.errors.join("; "), /format contradiction|contradictory format confirmation/i);

  // 4. Ambiguous audit matches in auditRecords (multiple matching records) fail
  const ambiguousOptions = {
    auditRecords: [
      { assignedLolixcoId: 105, canonicalVideoId: "12345678901" },
      { assignedLolixcoId: 105, canonicalVideoId: "12345678901" },
    ],
  };
  const ambiguousRes = resolveItemAuditEvidence(candidate, ambiguousOptions);
  assert.match(ambiguousRes.error, /Ambiguous audit match: multiple audit records/i);

  // 5. Conflicting audit matches (record for ID differs from record for video ID) fail
  const conflictingOptions = {
    auditRecords: [
      { assignedLolixcoId: 105, canonicalVideoId: "OTHER_ID_00" },
      { assignedLolixcoId: 999, canonicalVideoId: "12345678901" },
    ],
  };
  const conflictingRes = resolveItemAuditEvidence(candidate, conflictingOptions);
  assert.match(conflictingRes.error, /Conflicting audit match/i);
});

test("Stage 2 V3: Completeness requires genuine metadata title, channel attribution, and finite positive numeric duration", () => {
  const baseCandidate = {
    id: 105,
    title: "Display Title Set On Intake",
    description: "An authentic intake description.",
    creator: "Display Creator Set On Intake",
    category: "Anime",
    format: "video",
    duration: "2:00",
    sourceType: "youtube_embed",
    source: "https://www.youtube.com/watch?v=12345678901",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    youtubeVideoId: "12345678901",
    tags: ["anime"],
    editorial: {
      reviewStatus: "approved",
      rightsCleared: true,
    },
  };

  const validEvidence = {
    assignedLolixcoId: 105,
    canonicalVideoId: "12345678901",
    canonicalUrl: "https://www.youtube.com/watch?v=12345678901",
    provenance: "youtube_data_api_v3",
    metadataFetchStatus: "fetched",
    lastMetadataVerification: "2026-10-23T12:00:00Z",
    metadata: {
      canonicalVideoId: "12345678901",
      title: "Genuine Real Title From YouTube",
      channelTitle: "Genuine Real Creator Studio",
      channelId: "UC_GENUINE_CREATOR",
      durationSec: 120,
      privacyStatus: "public",
      embeddable: true,
      formatConfirmed: true,
      confirmedFormat: "video",
      provenance: "youtube_data_api_v3",
    },
  };

  // 1. Public duration string (duration: '2:00') must NOT rescue missing or invalid API durationSec
  const missingDurationAudit = {
    ...validEvidence,
    metadata: { ...validEvidence.metadata, durationSec: undefined, durationSeconds: undefined },
  };
  const res1 = verifyProductionPublicationEligibility(baseCandidate, { auditEvidence: missingDurationAudit });
  assert.equal(res1.valid, false);
  assert.match(res1.errors.join("; "), /invalid or missing duration metadata/i);

  const zeroDurationAudit = {
    ...validEvidence,
    metadata: { ...validEvidence.metadata, durationSec: 0, durationSeconds: 0 },
  };
  const res2 = verifyProductionPublicationEligibility(baseCandidate, { auditEvidence: zeroDurationAudit });
  assert.equal(res2.valid, false);
  assert.match(res2.errors.join("; "), /invalid or missing duration metadata/i);

  const negativeDurationAudit = {
    ...validEvidence,
    metadata: { ...validEvidence.metadata, durationSec: -30, durationSeconds: -30 },
  };
  const res3 = verifyProductionPublicationEligibility(baseCandidate, { auditEvidence: negativeDurationAudit });
  assert.equal(res3.valid, false);
  assert.match(res3.errors.join("; "), /invalid or missing duration metadata/i);

  const stringDurationAudit = {
    ...validEvidence,
    metadata: { ...validEvidence.metadata, durationSec: "120", durationSeconds: "120" },
  };
  const res4 = verifyProductionPublicationEligibility(baseCandidate, { auditEvidence: stringDurationAudit });
  assert.equal(res4.valid, false);
  assert.match(res4.errors.join("; "), /invalid or missing duration metadata/i);

  // 2. Candidate title must NOT rescue missing or generic metadata title
  const genericTitleAudit = {
    ...validEvidence,
    metadata: { ...validEvidence.metadata, title: "Curated Edit #105" },
  };
  const res5 = verifyProductionPublicationEligibility(baseCandidate, { auditEvidence: genericTitleAudit });
  assert.equal(res5.valid, false);
  assert.match(res5.errors.join("; "), /missing genuine title metadata/i);

  // 3. Candidate creator must NOT rescue missing or generic channelTitle
  const genericChannelAudit = {
    ...validEvidence,
    metadata: { ...validEvidence.metadata, channelTitle: "YouTube Creator" },
  };
  const res6 = verifyProductionPublicationEligibility(baseCandidate, { auditEvidence: genericChannelAudit });
  assert.equal(res6.valid, false);
  assert.match(res6.errors.join("; "), /missing genuine channel creator attribution/i);
});

test("Stage 2 V3: Positive offline fixtures exercise production contract cleanly without any bypass flags", () => {
  const genuineYouTubeItem = {
    id: 105,
    title: "Authentic Trigger Anime Edit",
    description: "An offline genuine production fixture matching existing historical compiler contracts.",
    creator: "Studio Trigger",
    category: "Anime",
    format: "video",
    duration: "1:35",
    sourceType: "youtube_embed",
    source: "https://www.youtube.com/watch?v=12345678901",
    poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
    youtubeVideoId: "12345678901",
    tags: ["anime", "amv"],
    editorial: {
      reviewStatus: "approved",
      rightsCleared: true,
    },
    publicationStatus: "published",
    canonicalVideoId: "12345678901",
    canonicalUrl: "https://www.youtube.com/watch?v=12345678901",
    provenance: "youtube_data_api_v3",
    metadataFetchStatus: "fetched",
    lastMetadataVerification: "2026-10-23T12:00:00Z",
    metadata: {
      canonicalVideoId: "12345678901",
      title: "Authentic Trigger Anime Edit",
      description: "Official publication metadata from YouTube Data API v3",
      channelTitle: "Studio Trigger Official",
      channelId: "UC_TRIGGER_OFFICIAL_1234",
      durationSec: 95,
      durationFormatted: "1:35",
      privacyStatus: "public",
      embeddable: true,
      thumbnailUrl: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
      formatConfirmed: true,
      confirmedFormat: "video",
      provenance: "youtube_data_api_v3",
    },
  };

  // Direct production projection succeeds cleanly WITHOUT any allowSyntheticAudit or bypass flag
  const projected = projectToPublicEdit(genuineYouTubeItem, { forProduction: true });
  assert.equal(projected.id, 105);
  assert.equal(projected.title, "Authentic Trigger Anime Edit");
  assert.equal(projected.youtubeVideoId, "12345678901");
  assert.equal(projected.format, "video");
  assert.equal(projected.sourceType, "youtube_embed");
  assert.equal(assertPublicEditIntegrity(projected), true);
});

test("Stage 2 V3: Manifest publication succeeds with schema-valid intake record + matched trusted audit context (no bypass flags)", () => {
  // Schema-valid intake manifest: NO private audit properties in JSON (respects additionalProperties: false)
  const manifest = {
    manifestVersion: "1.0.0",
    catalogVersion: "catalog-v2",
    items: [
      {
        id: 105,
        format: "video",
        title: "Verified Curated Anime Edit",
        description: "An authentic high-octane anime edit curated for Lolixco.",
        category: "Anime",
        tags: ["anime"],
        poster: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
        source: "https://www.youtube.com/watch?v=12345678901",
        duration: "2:00",
        sourceType: "youtube_embed",
        youtubeVideoId: "12345678901",
        editorial: {
          reviewStatus: "approved",
          rightsCleared: true,
          curatorNotes: "Curated for production test",
        },
      },
    ],
  };

  // Trusted caller provides genuine audit context separately (no synthetic bypass)
  const auditRecords = [
    {
      assignedLolixcoId: 105,
      canonicalVideoId: "12345678901",
      canonicalUrl: "https://www.youtube.com/watch?v=12345678901",
      provenance: "youtube_data_api_v3",
      metadataFetchStatus: "fetched",
      lastMetadataVerification: "2026-10-23T12:00:00Z",
      reviewStatus: "approved",
      publicationStatus: "published",
      metadata: {
        canonicalVideoId: "12345678901",
        title: "Verified Curated Anime Edit",
        description: "Official publication metadata",
        channelTitle: "Studio Trigger Official",
        channelId: "UC_GENUINE_CREATOR",
        durationSec: 120,
        durationFormatted: "2:00",
        privacyStatus: "public",
        embeddable: true,
        thumbnailUrl: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
        formatConfirmed: true,
        confirmedFormat: "video",
        provenance: "youtube_data_api_v3",
      },
    },
  ];

  // 1. Publish validation WITH matched genuine audit context passes without requiring local media decode
  const successRes = validateContentManifest(manifest, {
    mode: "publish",
    auditRecords,
  });
  assert.equal(successRes.valid, true, `Expected valid manifest, got: ${successRes.errors.join("; ")}`);
  assert.equal(successRes.errors.length, 0);
  assert.match(successRes.streamInspection, /NOT_APPLICABLE/i);
  assert.match(successRes.decodeVerification, /NOT_APPLICABLE/i);

  // 2. Publish validation WITHOUT audit context fails on missing evidence (zero decode errors)
  const failMissingRes = validateContentManifest(manifest, {
    mode: "publish",
  });
  assert.equal(failMissingRes.valid, false);
  assert.match(failMissingRes.errors.join("; "), /missing provenance or audit evidence/i);
  const decodeErrors = failMissingRes.errors.filter((e) => e.includes("decode") || e.includes("FFmpeg"));
  assert.equal(decodeErrors.length, 0);

  // 3. Publish validation with mismatched audit context fails
  const mismatchedAudit = [{ ...auditRecords[0], canonicalVideoId: "99999999999" }];
  const failMismatchRes = validateContentManifest(manifest, {
    mode: "publish",
    auditRecords: mismatchedAudit,
  });
  assert.equal(failMismatchRes.valid, false);
  assert.match(failMismatchRes.errors.join("; "), /canonical YouTube ID mismatch/i);

  // 4. Publish validation with synthetic evidence strictly fails, EVEN IF caller passes allowSyntheticAudit: true
  const syntheticAudit = [
    {
      ...auditRecords[0],
      provenance: "synthetic_mock",
      metadata: {
        ...auditRecords[0].metadata,
        provenance: "synthetic_mock",
      },
    },
  ];
  const failSyntheticRes = validateContentManifest(manifest, {
    mode: "publish",
    auditRecords: syntheticAudit,
    allowSyntheticAudit: true, // Cannot bypass production checks
  });
  assert.equal(failSyntheticRes.valid, false);
  assert.match(failSyntheticRes.errors.join("; "), /synthetic mock metadata is prohibited|strictly forbidden/i);

  // 5. Hosted media remains fail-closed in publish mode
  const hostedManifest = {
    manifestVersion: "1.0.0",
    catalogVersion: "catalog-v2",
    items: [
      {
        id: 305,
        format: "video",
        title: "Hosted Video Edit",
        description: "A licensed hosted video edit for testing publication gates.",
        category: "Anime",
        tags: ["anime"],
        poster: "/media/hosted.jpg",
        source: "/media/hosted.mp4",
        duration: "1:30",
        sourceType: "licensed_local_media",
        editorial: {
          reviewStatus: "approved",
          rightsCleared: true,
        },
      },
    ],
  };
  const hostedRes = validateContentManifest(hostedManifest, { mode: "publish" });
  assert.equal(hostedRes.valid, false);
  assert.match(hostedRes.errors.join("; "), /hosted publication evidence is not implemented/i);
});
