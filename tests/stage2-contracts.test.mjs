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
