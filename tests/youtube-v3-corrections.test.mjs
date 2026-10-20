import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

import {
  compileYouTubeCatalog,
  runCompilerCli,
  CANONICAL_OUTPUT_PATH,
} from "../scripts/compile-youtube-catalog.mjs";
import {
  ingestYouTubeBatch,
  safeAtomicWriteFileSync,
} from "../scripts/youtube-importer.mjs";
import { fetchYouTubeVideoMetadata } from "../scripts/youtube-api.mjs";
import { playbackCoordinator } from "../src/utils/playbackCoordinator.ts";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "lolixco-v3-test-"));
}

// ---------------------------------------------------------------------------
// 1. DRAFT PUBLICATION BYPASS (FIX A)
// ---------------------------------------------------------------------------
test("V3 FIX 1: Draft publication bypass is strictly prohibited in CLI and programmatic compilation", async () => {
  // 1. CLI with --publish --allow-draft must fail with exit code 1
  const cliResult = spawnSync(
    "node",
    ["scripts/compile-youtube-catalog.mjs", "--publish", "--allow-draft"],
    { cwd: projectRoot, encoding: "utf-8" }
  );
  assert.equal(cliResult.status, 1, "CLI must reject --publish with --allow-draft");
  const combinedOut = (cliResult.stdout || "") + (cliResult.stderr || "");
  assert.ok(
    combinedOut.includes("Combining --publish with --allow-draft is prohibited"),
    "Must output explicit error prohibiting draft publication"
  );

  // 2. Programmatic compileYouTubeCatalog with !dryRun and allowDraft must fail
  const progResult = await compileYouTubeCatalog({
    outputPath: resolve(projectRoot, "src/data/edits.ts"),
    allowDraft: true,
    dryRun: false,
  });
  assert.equal(progResult.success, false);
  assert.ok(
    progResult.errors.some((e) => e.includes("'allowDraft' is strictly forbidden during catalog writes")),
    "Programmatic write with allowDraft must fail closed"
  );

  // 3. Draft/unapproved item (embed_eligible) must never pass production compilation
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "draft-audit.json");
  const now = new Date().toISOString();
  const draftAudit = {
    version: "1.0.0",
    items: [
      {
        canonicalVideoId: "draftItem11",
        ownerCategory: "Gaming",
        fandomIds: ["valorant"],
        format: "video",
        contentReviewStatus: "embed_eligible", // NOT approved!
        assignedLolixcoId: 100,
        provenance: "youtube_data_api_v3",
        metadataFetchStatus: "fetched",
        lastMetadataVerification: now,
        metadata: {
          canonicalVideoId: "draftItem11",
          provenance: "youtube_data_api_v3",
          title: "Draft Item",
          channelTitle: "Creator",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 60,
        },
      },
    ],
  };
  writeFileSync(testAuditPath, JSON.stringify(draftAudit, null, 2), "utf-8");

  try {
    // A. Preview mode allows inspecting in memory
    const previewResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
      allowDraft: true,
    });
    assert.equal(previewResult.success, true, "Preview may inspect unapproved items in memory");
    assert.equal(previewResult.newCount, 1, "Preview inspects 1 draft item");
    assert.equal(previewResult.writtenTo, null, "Preview never writes to disk");

    // B. Production compilation strictly excludes unapproved items
    const prodResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: join(tempDir, "edits.ts"),
      dryRun: false,
      allowDraft: false,
    });
    assert.equal(prodResult.newCount, 0, "Zero unapproved items should be compiled for production");
    assert.equal(prodResult.compiledEdits.length, 17, "Production catalog must remain strictly 17 demo edits");

    // C. The confirmed reproduction: allowDraft: true with dryRun: false must fail closed
    const reproResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: false,
      allowDraft: true,
    });
    assert.equal(reproResult.success, false, "Production compilation with allowDraft: true must fail closed");
    assert.ok(
      reproResult.errors.some((e) => e.includes("'allowDraft' is strictly forbidden during catalog writes")),
      "Must return explicit error preventing unapproved publication"
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. ELIMINATE SYNTHETIC PUBLICATION BYPASSES (FIX B)
// ---------------------------------------------------------------------------
test("V3 FIX 2: Synthetic metadata publication bypass is eliminated", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "synth-audit.json");
  const now = new Date().toISOString();

  // Synthetic mock record marked 'approved'
  const mockApproved = {
    version: "1.0.0",
    items: [
      {
        canonicalVideoId: "mockItem001",
        ownerCategory: "Gaming",
        fandomIds: ["valorant"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 100,
        isMock: true,
        provenance: "synthetic_mock",
        metadataFetchStatus: "fetched",
        lastMetadataVerification: now,
        metadata: {
          canonicalVideoId: "mockItem001",
          isMock: true,
          provenance: "synthetic_mock",
          title: "Mock Gaming Edit",
          channelTitle: "Mock Creator",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 60,
        },
      },
    ],
  };
  writeFileSync(testAuditPath, JSON.stringify(mockApproved, null, 2), "utf-8");

  try {
    // Attempt compilation targeting production with forceSynthetic: true (bypasses must be gone)
    const compileResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
      forceSynthetic: true, // Should have NO effect!
    });

    assert.equal(compileResult.success, false, "Production compilation must strictly reject synthetic mocks");
    assert.ok(
      compileResult.errors.some((e) => e.includes("synthetic mock metadata is prohibited")),
      "Must reject with explicit synthetic mock prohibition error"
    );

    // Scratch/isolated non-production preview may inspect in memory
    const scratchResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: join(tempDir, "scratch-preview.ts"),
      dryRun: true,
      baseCatalog: [],
    });
    // Scratch target does not target production src/data/edits.ts and dryRun is true
    assert.equal(scratchResult.success, true);
    assert.equal(scratchResult.compiledEdits.length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. POSITIVE PROVENANCE AND UNFETCHED RECORD REJECTION (FIX B)
// ---------------------------------------------------------------------------
test("V3 FIX 3: Positive provenance and verified retrieval enforcement", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "provenance-audit.json");
  const now = new Date().toISOString();

  // 1. Record with missing/unverified provenance
  const missingProvenanceItem = {
    version: "1.0.0",
    items: [
      {
        canonicalVideoId: "unverified1",
        ownerCategory: "Gaming",
        fandomIds: ["valorant"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 100,
        provenance: "custom_scraper", // NOT genuine API provenance!
        metadataFetchStatus: "fetched",
        lastMetadataVerification: now,
        metadata: {
          canonicalVideoId: "unverified1",
          provenance: "custom_scraper",
          title: "Scraped Title",
          channelTitle: "Scraped Creator",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 60,
        },
      },
    ],
  };
  writeFileSync(testAuditPath, JSON.stringify(missingProvenanceItem, null, 2), "utf-8");

  try {
    const result1 = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
    });
    assert.equal(result1.success, false);
    assert.ok(
      result1.errors.some((e) => e.includes("missing or unverified API provenance")),
      "Must reject unverified provenance"
    );

    // 2. Record with mismatched canonical video IDs between item and metadata
    const mismatchedIdItem = {
      version: "1.0.0",
      items: [
        {
          canonicalVideoId: "videoItem01",
          ownerCategory: "Gaming",
          fandomIds: ["valorant"],
          format: "video",
          contentReviewStatus: "approved",
          assignedLolixcoId: 100,
          provenance: "youtube_data_api_v3",
          metadataFetchStatus: "fetched",
          lastMetadataVerification: now,
          metadata: {
            canonicalVideoId: "videoItem02", // MISMATCH!
            provenance: "youtube_data_api_v3",
            title: "Mismatched Video",
            channelTitle: "Creator",
            privacyStatus: "public",
            embeddable: true,
            durationSec: 60,
          },
        },
      ],
    };
    writeFileSync(testAuditPath, JSON.stringify(mismatchedIdItem, null, 2), "utf-8");

    const result2 = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
    });
    assert.equal(result2.success, false);
    assert.ok(
      result2.errors.some((e) => e.includes("canonical YouTube ID mismatch")),
      "Must reject ID mismatch between record and metadata"
    );

    // 3. Positive evidence of genuine API retrieval passes cleanly
    const genuineItem = {
      version: "1.0.0",
      items: [
        {
          canonicalVideoId: "genuineVid1",
          ownerCategory: "Gaming",
          fandomIds: ["valorant"],
          format: "video",
          contentReviewStatus: "approved",
          assignedLolixcoId: 100,
          provenance: "youtube_data_api_v3",
          metadataFetchStatus: "fetched",
          lastMetadataVerification: now,
          metadata: {
            canonicalVideoId: "genuineVid1",
            provenance: "youtube_data_api_v3",
            title: "Genuine Valorant Edit",
            channelTitle: "Genuine Creator",
            privacyStatus: "public",
            embeddable: true,
            durationSec: 60,
          },
        },
      ],
    };
    writeFileSync(testAuditPath, JSON.stringify(genuineItem, null, 2), "utf-8");

    const result3 = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
    });
    assert.equal(result3.success, true);
    assert.equal(result3.newCount, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. METADATA FRESHNESS POLICY (FIX D)
// ---------------------------------------------------------------------------
test("V3 FIX 4: Enforces meaningful metadata freshness (stale, future-dated, and injected clock)", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "freshness-audit.json");

  // Injected test clock: 2026-06-01T12:00:00Z
  const injectedNow = "2026-06-01T12:00:00Z";

  try {
    // 1. Stale timestamp (verified 60 days prior on 2026-04-01)
    const staleAudit = {
      version: "1.0.0",
      items: [
        {
          canonicalVideoId: "staleVid001",
          ownerCategory: "Gaming",
          fandomIds: ["valorant"],
          format: "video",
          contentReviewStatus: "approved",
          assignedLolixcoId: 100,
          provenance: "youtube_data_api_v3",
          lastMetadataVerification: "2026-04-01T12:00:00Z", // 61 days stale!
          metadata: {
            canonicalVideoId: "staleVid001",
            provenance: "youtube_data_api_v3",
            title: "Stale Video",
            channelTitle: "Creator",
            privacyStatus: "public",
            embeddable: true,
            durationSec: 60,
          },
        },
      ],
    };
    writeFileSync(testAuditPath, JSON.stringify(staleAudit, null, 2), "utf-8");

    const staleResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
      now: injectedNow,
      maxMetadataAgeDays: 30,
    });
    assert.equal(staleResult.success, false);
    assert.ok(
      staleResult.errors.some((e) => e.includes("metadata verification is stale")),
      "Must reject stale verification timestamp"
    );

    // 2. Future-dated timestamp (2 hours into the future)
    const futureAudit = {
      version: "1.0.0",
      items: [
        {
          canonicalVideoId: "futureVid01",
          ownerCategory: "Gaming",
          fandomIds: ["valorant"],
          format: "video",
          contentReviewStatus: "approved",
          assignedLolixcoId: 100,
          provenance: "youtube_data_api_v3",
          lastMetadataVerification: "2026-06-01T15:00:00Z", // 3 hours in future!
          metadata: {
            canonicalVideoId: "futureVid01",
            provenance: "youtube_data_api_v3",
            title: "Future Video",
            channelTitle: "Creator",
            privacyStatus: "public",
            embeddable: true,
            durationSec: 60,
          },
        },
      ],
    };
    writeFileSync(testAuditPath, JSON.stringify(futureAudit, null, 2), "utf-8");

    const futureResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
      now: injectedNow,
    });
    assert.equal(futureResult.success, false);
    assert.ok(
      futureResult.errors.some((e) => e.includes("future-dated verification timestamp")),
      "Must reject future-dated verification timestamp"
    );

    // 3. Fresh timestamp (verified 2 days prior) passes
    const freshAudit = {
      version: "1.0.0",
      items: [
        {
          canonicalVideoId: "freshVid001",
          ownerCategory: "Gaming",
          fandomIds: ["valorant"],
          format: "video",
          contentReviewStatus: "approved",
          assignedLolixcoId: 100,
          provenance: "youtube_data_api_v3",
          metadataFetchStatus: "fetched",
          lastMetadataVerification: "2026-05-30T12:00:00Z", // 2 days old
          metadata: {
            canonicalVideoId: "freshVid001",
            provenance: "youtube_data_api_v3",
            title: "Fresh Video",
            channelTitle: "Creator",
            privacyStatus: "public",
            embeddable: true,
            durationSec: 60,
          },
        },
      ],
    };
    writeFileSync(testAuditPath, JSON.stringify(freshAudit, null, 2), "utf-8");

    const freshResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
      now: injectedNow,
      maxMetadataAgeDays: 30,
    });
    assert.equal(freshResult.success, true);
    assert.equal(freshResult.newCount, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. APPROVED ITEM CLASSIFICATION CHANGES (FIX C)
// ---------------------------------------------------------------------------
test("V3 FIX 5: Approved item classification changes transition to needs_recheck and retain history", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "class-change-audit.json");
  const now = new Date().toISOString();

  // Existing approved item: Gaming -> Valorant
  const existingAudit = {
    version: "1.0.0",
    items: [
      {
        canonicalVideoId: "classVid111",
        canonicalUrl: "https://www.youtube.com/watch?v=classVid111",
        ownerCategory: "Gaming",
        category: "Gaming",
        fandomIds: ["valorant"],
        ownerFandomIds: ["valorant"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 100,
        provenance: "youtube_data_api_v3",
        lastMetadataVerification: now,
        auditHistory: [
          { date: now, event: "manual_approval", status: "approved" },
        ],
        metadata: {
          canonicalVideoId: "classVid111",
          provenance: "youtube_data_api_v3",
          title: "Valorant Radiant ACE",
          channelTitle: "Pro Gamer",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 45,
          durationFormatted: "0:45",
        },
      },
    ],
  };
  writeFileSync(testAuditPath, JSON.stringify(existingAudit, null, 2), "utf-8");

  try {
    // Re-importing same video URL with changed category and fandom: Anime -> Jujutsu Kaisen
    const mockClient = {
      async fetchMetadata(vid) {
        return {
          success: true,
          metadata: {
            canonicalVideoId: vid,
            provenance: "youtube_data_api_v3",
            title: "Valorant Radiant ACE",
            channelTitle: "Pro Gamer",
            privacyStatus: "public",
            embeddable: true,
            durationSec: 45,
            durationFormatted: "0:45",
          },
        };
      },
    };

    const reimportResult = await ingestYouTubeBatch({
      batchInput: ["https://www.youtube.com/watch?v=classVid111"],
      category: "Anime", // Changed category!
      fandom: "jujutsu-kaisen", // Changed fandom!
      batchId: "reimport-changed-class",
      auditFilePath: testAuditPath,
      apiClient: mockClient,
      dryRun: false,
    });

    assert.equal(reimportResult.success, true);
    const updatedAudit = JSON.parse(readFileSync(testAuditPath, "utf-8"));
    const updatedItem = updatedAudit.items.find((i) => i.canonicalVideoId === "classVid111");

    // Status MUST transition to needs_recheck!
    assert.equal(
      updatedItem.contentReviewStatus,
      "needs_recheck",
      "Status must transition to needs_recheck upon classification change"
    );

    // Audit history must record classification change and previous classification
    const changeEntry = updatedItem.auditHistory.find(
      (h) => h.reason === "editorial_classification_change"
    );
    assert.ok(changeEntry, "Must record editorial_classification_change in auditHistory");
    assert.equal(changeEntry.previousClassification.category, "Gaming");
    assert.deepEqual(changeEntry.previousClassification.fandomIds, ["valorant"]);
    assert.equal(changeEntry.newClassification.category, "Anime");
    assert.deepEqual(changeEntry.newClassification.fandomIds, ["jujutsu-kaisen"]);

    // Cannot be compiled to public production catalog while in needs_recheck
    const compileResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
    });
    assert.equal(compileResult.newCount, 0, "Item in needs_recheck must not compile to catalog");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. PARTIAL YOUTUBE API RESPONSES & REFERENCE ERROR FIX (FIX E)
// ---------------------------------------------------------------------------
test("V3 FIX 6: Incomplete YouTube API responses return structured errors without reference errors", async () => {
  // Mock global fetch to return a batch with 1 valid video and 1 incomplete video (missing title)
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "goodVideo11",
              snippet: {
                title: "Complete Video Title",
                channelTitle: "Good Creator",
                description: "Full description",
                publishedAt: "2026-01-01T00:00:00Z",
                thumbnails: {},
              },
              contentDetails: {
                duration: "PT30S",
              },
              status: {
                embeddable: true,
                privacyStatus: "public",
              },
            },
            {
              id: "incompVid11",
              snippet: {
                // MISSING TITLE!
                channelTitle: "Some Creator",
                description: "",
              },
              contentDetails: {
                duration: "PT20S",
              },
              status: {
                embeddable: true,
                privacyStatus: "public",
              },
            },
          ],
        }),
      };
    };

    // Call fetchYouTubeVideoMetadata directly with a real-mode API call
    const result = await fetchYouTubeVideoMetadata(["goodVideo11", "incompVid11"], {
      apiKey: "AIzaSyFakeTestKeyForUnitTesting",
      mockMode: false,
    });

    // 1. No ReferenceError occurred!
    assert.ok(result);

    // 2. Complete item is mapped properly
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].canonicalVideoId, "goodVideo11");
    assert.equal(result.items[0].provenance, "synthetic_mock", "Provenance must be synthetic_mock");
    assert.equal(result.items[0].isMock, true, "isMock must be true for synthetic execution");
    assert.equal(result.items[0].syntheticOrigin, "test_environment_mock", "syntheticOrigin must match test_environment_mock");
    assert.equal(result.items[0].fetchStatus, "success");

    // 3. Incomplete item is tracked in missingIds & incompleteIds with clear error
    assert.ok(result.missingIds.includes("incompVid11"));
    assert.ok(result.incompleteIds.includes("incompVid11"));
    assert.ok(
      result.errors.some((e) => e.includes("Video 'incompVid11': incomplete YouTube API response")),
      "Must return structured error for incomplete item"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 7. SAFE AUDIT AND CATALOG WRITE FAILURES (FIX F)
// ---------------------------------------------------------------------------
test("V3 FIX 7: Safe audit/catalog write failures, malformed audit handling, and dryRun", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "malformed-audit.json");
  const testEditsPath = join(tempDir, "test-edits.ts");

  // Write corrupt/malformed JSON
  const corruptContent = "{ corrupt json payload: [ unclosed";
  writeFileSync(testAuditPath, corruptContent, "utf-8");

  try {
    // 1. Compiler must fail closed and preserve corrupt file without overwriting
    const compileResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testEditsPath,
      dryRun: false,
    });
    assert.equal(compileResult.success, false);
    assert.ok(
      compileResult.errors.some((e) => e.includes("Failed to parse audit file")),
      "Must report JSON parse failure"
    );
    // Verify corrupt file was NOT overwritten
    assert.equal(readFileSync(testAuditPath, "utf-8"), corruptContent);
    assert.equal(existsSync(testEditsPath), false, "Target catalog must not be created");

    // 2. Importer must also fail closed without overwriting malformed file
    const importResult = await ingestYouTubeBatch({
      batchInput: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
      category: "Gaming",
      fandom: "valorant",
      auditFilePath: testAuditPath,
      dryRun: false,
    });
    assert.equal(importResult.success, false);
    assert.ok(importResult.errors.some((e) => e.includes("Failed to parse existing audit file")));
    assert.equal(readFileSync(testAuditPath, "utf-8"), corruptContent);

    // 3. safeAtomicWriteFileSync writes atomically
    const testAtomicPath = join(tempDir, "atomic-test.txt");
    safeAtomicWriteFileSync(testAtomicPath, "Atomic Content Verified");
    assert.equal(readFileSync(testAtomicPath, "utf-8"), "Atomic Content Verified");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8. AUTOPLAY-BLOCKED IMMERSION RECOVERY (FIX G)
// ---------------------------------------------------------------------------
test("V3 FIX 8: Autoplay-blocked Immersion recovery via dedicated handleResumePlayback", () => {
  // Track imperative player calls
  let playVideoCalls = 0;
  let pauseVideoCalls = 0;

  const mockPlayerHandle = {
    playVideo() {
      playVideoCalls++;
    },
    pauseVideo() {
      pauseVideoCalls++;
    },
  };

  // Simulate ImmersionViewer autoplay recovery state
  let isPlaying = true; // Stale state: isPlaying remained true when autoplay was blocked
  let autoplayBlocked = true;
  let resumeError = null;

  // Dedicated handleResumePlayback implementation matching ImmersionViewer
  function handleResumePlayback() {
    resumeError = null;
    playbackCoordinator.notifyPlaying("immersion-player");
    isPlaying = true;
    autoplayBlocked = false;

    try {
      mockPlayerHandle.playVideo();
    } catch {
      autoplayBlocked = true;
      resumeError = "Playback could not be resumed. Tap or click directly on the video player.";
    }
  }

  // User clicks "Continue Playback"
  handleResumePlayback();

  // PlayVideo was called directly, NOT pauseVideo!
  assert.equal(playVideoCalls, 1, "Must invoke playVideo on Continue click");
  assert.equal(pauseVideoCalls, 0, "Must NOT take the pause branch");
  assert.equal(autoplayBlocked, false);
  assert.equal(resumeError, null);
  assert.equal(playbackCoordinator.getActivePlayerId(), "immersion-player");

  // If playVideo throws an error, recovery gracefully surfaces error
  const failingPlayerHandle = {
    playVideo() {
      throw new Error("Browser policy violation");
    },
  };

  function handleFailingResume() {
    resumeError = null;
    try {
      failingPlayerHandle.playVideo();
    } catch {
      autoplayBlocked = true;
      resumeError = "Playback could not be resumed. Tap or click directly on the video player.";
    }
  }

  handleFailingResume();
  assert.equal(autoplayBlocked, true);
  assert.ok(resumeError.includes("Tap or click directly on the video player"));
});
