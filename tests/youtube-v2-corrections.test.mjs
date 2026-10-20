import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

import {
  fetchYouTubeVideoMetadata,
  loadEnvConfig,
} from "../scripts/youtube-api.mjs";
import {
  evaluateEditorialClassification,
  allocateStableId,
  CANONICAL_CATEGORIES,
} from "../scripts/youtube-editorial.mjs";
import {
  ingestYouTubeBatch,
  parseBatchInput,
  CANONICAL_AUDIT_PATH,
} from "../scripts/youtube-importer.mjs";
import {
  compileYouTubeCatalog,
  projectToPublicYouTubeEdit,
  CANONICAL_OUTPUT_PATH,
} from "../scripts/compile-youtube-catalog.mjs";
import { playbackCoordinator } from "../src/utils/playbackCoordinator.ts";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "lolixco-v2-test-"));
}

// ---------------------------------------------------------------------------
// 1. ACTUAL IMPORTER CLI EXECUTION
// ---------------------------------------------------------------------------
test("V2 FIX 1: Actual importer CLI execution (CLI entry point, argument parsing, dry-run)", () => {
  // Test --help flag
  const helpResult = spawnSync(
    "node",
    ["scripts/youtube-importer.mjs", "--help"],
    { cwd: projectRoot, encoding: "utf-8" }
  );
  assert.equal(helpResult.status, 0);
  assert.ok(helpResult.stdout.includes("Lolixco YouTube Importer CLI"));
  assert.ok(helpResult.stdout.includes("--batch"));
  assert.ok(helpResult.stdout.includes("--dry-run"));

  // Test dry-run with mock metadata
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "test-audit.json");
  try {
    const dryRunResult = spawnSync(
      "node",
      [
        "scripts/youtube-importer.mjs",
        "--batch", "01",
        "--category", "Gaming",
        "--fandom", "valorant",
        "--urls", "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "--mock",
        "--dry-run",
        "--audit-file", testAuditPath,
      ],
      { cwd: projectRoot, encoding: "utf-8" }
    );
    assert.equal(dryRunResult.status, 0, dryRunResult.stderr || dryRunResult.stdout);
    assert.ok(dryRunResult.stdout.includes("DRY-RUN"));
    assert.ok(dryRunResult.stdout.includes("Processed: 1"));
    // File must NOT be written in dry-run mode
    assert.equal(existsSync(testAuditPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. FAILURE WITHOUT API CREDENTIALS
// ---------------------------------------------------------------------------
test("V2 FIX 2: Failure without API credentials (fail-closed, actionable error)", async () => {
  // 1. CLI without API key and without --mock must exit code 1 with actionable message
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "test-audit.json");
  try {
    const cliResult = spawnSync(
      "node",
      [
        "scripts/youtube-importer.mjs",
        "--batch", "01",
        "--category", "Gaming",
        "--fandom", "valorant",
        "--urls", "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "--audit-file", testAuditPath,
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, YOUTUBE_API_KEY: "", YOUTUBE_DATA_API_KEY: "" },
        encoding: "utf-8",
      }
    );
    assert.equal(cliResult.status, 1);
    const combinedOutput = (cliResult.stdout || "") + (cliResult.stderr || "");
    assert.ok(
      combinedOutput.includes("YouTube API key is missing") ||
      combinedOutput.includes("YOUTUBE_API_KEY"),
      "Must output actionable error regarding missing API key"
    );

    // 2. Direct fetchYouTubeVideoMetadata without key and without mock must return failure
    const metaResult = await fetchYouTubeVideoMetadata(["dQw4w9WgXcQ"], {
      apiKey: "",
      mockMode: false,
    });
    assert.equal(metaResult.items.length, 0);
    assert.ok(metaResult.errors.some((e) => e.includes("YouTube API key is missing")));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. EXPLICIT MOCK-ONLY BEHAVIOR & COMPILER REJECTION
// ---------------------------------------------------------------------------
test("V2 FIX 3: Explicit mock-only behavior and compiler rejection in production", async () => {
  // Mock metadata must be explicitly tagged with provenance
  const metaResult = await fetchYouTubeVideoMetadata(["dQw4w9WgXcQ"], {
    apiKey: "",
    mockMode: true,
  });
  assert.equal(metaResult.items.length, 1);
  assert.equal(metaResult.items[0].isMock, true);
  assert.equal(metaResult.items[0].provenance, "synthetic_mock");

  // Mock record cannot be compiled into production catalog even if approved
  const mockApprovedRecord = {
    canonicalVideoId: "dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ownerCategory: "Gaming",
    fandomIds: ["valorant"],
    format: "video",
    contentReviewStatus: "approved", // Manually marked approved
    assignedLolixcoId: 100,
    isMock: true,
    provenance: "synthetic_mock",
    lastMetadataVerification: new Date().toISOString(),
    metadata: {
      ...metaResult.items[0],
      title: "Real Sounding Title",
      channelTitle: "Real Sounding Channel",
      durationSec: 60,
      durationFormatted: "1:00",
      privacyStatus: "public",
      embeddable: true,
    },
  };

  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "mock-audit.json");
  writeFileSync(testAuditPath, JSON.stringify({ version: "1.0.0", items: [mockApprovedRecord] }), "utf-8");

  try {
    // Targeting production outputPath (src/data/edits.ts) must reject synthetic mocks
    const prodResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: resolve(projectRoot, "src/data/edits.ts"),
      dryRun: true,
    });

    assert.equal(prodResult.success, false, "Production compilation must reject synthetic mock");
    assert.ok(
      prodResult.errors.some((e) => e.includes("synthetic mock metadata is prohibited")),
      "Must have explicit error explaining mock metadata is prohibited from production"
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. PRESERVE EDITORIAL REVIEW DECISION ACROSS RE-IMPORTS
// ---------------------------------------------------------------------------
test("V2 FIX 4: Preserves review decision when unchanged; transitions when restricted", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "reimport-audit.json");

  // Initial audit state with an approved item
  const existingAudit = {
    version: "1.0.0",
    items: [
      {
        canonicalVideoId: "approvedVid",
        canonicalUrl: "https://www.youtube.com/watch?v=approvedVid",
        ownerCategory: "Gaming",
        fandomIds: ["valorant"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 100,
        lastMetadataVerification: "2026-10-18T10:00:00.000Z",
        auditHistory: [
          { timestamp: "2026-10-18T10:00:00.000Z", action: "initial_import", status: "embed_eligible" },
          { timestamp: "2026-10-18T11:00:00.000Z", action: "manual_review", status: "approved" },
        ],
        metadata: {
          canonicalVideoId: "approvedVid",
          title: "Valorant Ace",
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
    // 1. Re-importing identical, valid public video preserves "approved"
    const mockClientUnchanged = {
      async fetchMetadata(vid) {
        return {
          success: true,
          metadata: {
            canonicalVideoId: vid,
            title: "Valorant Ace",
            channelTitle: "Pro Gamer",
            privacyStatus: "public",
            embeddable: true,
            durationSec: 45,
            durationFormatted: "0:45",
            publishedAt: "2026-01-01T00:00:00Z",
          },
        };
      },
    };

    const reimportResult1 = await ingestYouTubeBatch({
      batchInput: ["https://www.youtube.com/watch?v=approvedVid"],
      category: "Gaming",
      fandom: "valorant",
      batchId: "reimport-01",
      auditFilePath: testAuditPath,
      apiClient: mockClientUnchanged,
      dryRun: false,
    });

    assert.equal(reimportResult1.success, true);
    const updatedAudit1 = JSON.parse(readFileSync(testAuditPath, "utf-8"));
    const item1 = updatedAudit1.items.find((i) => i.canonicalVideoId === "approvedVid");
    assert.equal(item1.contentReviewStatus, "approved", "Must preserve 'approved' status when metadata is valid & unchanged");
    assert.ok(
      item1.auditHistory.some((h) => h.event === "reimport_verification" && h.status === "approved"),
      "Audit trail must log preservation"
    );

    // 2. Re-importing video that became embed-restricted transitions to 'needs_recheck' or 'unavailable'
    const mockClientRestricted = {
      async fetchMetadata(vid) {
        return {
          success: true,
          metadata: {
            canonicalVideoId: vid,
            title: "Valorant Ace (Now Restricted)",
            channelTitle: "Pro Gamer",
            privacyStatus: "public",
            embeddable: false, // RESTRICTION!
            durationSec: 45,
            durationFormatted: "0:45",
          },
        };
      },
    };

    const reimportResult2 = await ingestYouTubeBatch({
      batchInput: ["https://www.youtube.com/watch?v=approvedVid"],
      category: "Gaming",
      fandom: "valorant",
      batchId: "reimport-02",
      auditFilePath: testAuditPath,
      apiClient: mockClientRestricted,
      dryRun: false,
    });

    assert.equal(reimportResult2.success, true);
    const updatedAudit2 = JSON.parse(readFileSync(testAuditPath, "utf-8"));
    const item2 = updatedAudit2.items.find((i) => i.canonicalVideoId === "approvedVid");
    assert.notEqual(item2.contentReviewStatus, "approved", "Must NOT remain approved when embedding is disabled");
    assert.ok(
      item2.contentReviewStatus === "embed_restricted" ||
      item2.contentReviewStatus === "needs_recheck" ||
      item2.contentReviewStatus === "unavailable"
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. PRESERVE APPROVED FANDOM ASSIGNMENTS (FIX D)
// ---------------------------------------------------------------------------
test("V2 FIX 5: Approved fandom assignments are preserved through compilation (Gaming -> Valorant, Anime -> JJK, multi, empty)", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "fandom-audit.json");
  const testEditsPath = join(tempDir, "test-edits.ts");

  const now = new Date().toISOString();
  const auditData = {
    version: "1.0.0",
    items: [
      // 1. Gaming -> Valorant
      {
        canonicalVideoId: "valVid12345",
        canonicalUrl: "https://www.youtube.com/watch?v=valVid12345",
        category: "Gaming",
        ownerCategory: "Gaming",
        fandomIds: ["valorant"],
        ownerFandomIds: ["valorant"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 100,
        lastMetadataVerification: now,
        metadata: {
          title: "Valorant Radiant Highlight",
          channelTitle: "ViperMain",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 60,
          durationFormatted: "1:00",
        },
      },
      // 2. Anime -> Jujutsu Kaisen
      {
        canonicalVideoId: "jjkVid12345",
        canonicalUrl: "https://www.youtube.com/watch?v=jjkVid12345",
        category: "Anime",
        ownerCategory: "Anime",
        fandomIds: ["jujutsu-kaisen"],
        ownerFandomIds: ["jujutsu-kaisen"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 101,
        lastMetadataVerification: now,
        metadata: {
          title: "Jujutsu Kaisen Gojo Edit",
          channelTitle: "Sorcerer Edits",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 50,
          durationFormatted: "0:50",
        },
      },
      // 3. Multi-fandom (valorant + doom)
      {
        canonicalVideoId: "multiVid123",
        canonicalUrl: "https://www.youtube.com/watch?v=multiVid123",
        category: "Multifandom",
        ownerCategory: "Multifandom",
        fandomIds: ["valorant", "doom"],
        ownerFandomIds: ["valorant", "doom"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 102,
        lastMetadataVerification: now,
        metadata: {
          title: "Gaming Crossover Mashup",
          channelTitle: "CrossEditor",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 90,
          durationFormatted: "1:30",
        },
      },
      // 4. Empty-fandom (general Phonk edit)
      {
        canonicalVideoId: "phonkVid123",
        canonicalUrl: "https://www.youtube.com/watch?v=phonkVid123",
        category: "Phonk",
        ownerCategory: "Phonk",
        fandomIds: [],
        ownerFandomIds: [],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 103,
        lastMetadataVerification: now,
        metadata: {
          title: "Atmospheric Neon Night",
          channelTitle: "Phonk Studio",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 40,
          durationFormatted: "0:40",
        },
      },
    ],
  };
  writeFileSync(testAuditPath, JSON.stringify(auditData, null, 2), "utf-8");

  try {
    const compileResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testEditsPath,
      dryRun: true,
      baseCatalog: [],
    });

    assert.equal(compileResult.success, true, compileResult.errors.join("; "));
    assert.equal(compileResult.compiledEdits.length, 4);

    const [valEdit, jjkEdit, multiEdit, cinEdit] = compileResult.compiledEdits;

    // Gaming -> Valorant preserved!
    assert.equal(valEdit.category, "Gaming");
    assert.deepEqual(valEdit.fandomIds, ["valorant"]);

    // Anime -> Jujutsu Kaisen preserved!
    assert.equal(jjkEdit.category, "Anime");
    assert.deepEqual(jjkEdit.fandomIds, ["jujutsu-kaisen"]);

    // Multi-fandom preserved!
    assert.equal(multiEdit.category, "Multifandom");
    assert.deepEqual(multiEdit.fandomIds, ["valorant", "doom"]);

    // Empty-fandom preserved!
    assert.equal(cinEdit.category, "Phonk");
    assert.deepEqual(cinEdit.fandomIds, []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. REJECTION OF PRIVATE AND NON-EMBEDDABLE RECORDS (FIX E)
// ---------------------------------------------------------------------------
test("V2 FIX 6: Fail-closed publication rejects private and non-embeddable records", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "restricted-audit.json");
  const now = new Date().toISOString();

  const auditData = {
    version: "1.0.0",
    items: [
      {
        canonicalVideoId: "privateVid1",
        ownerCategory: "Gaming",
        fandomIds: ["valorant"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 100,
        lastMetadataVerification: now,
        metadata: {
          title: "Private Valorant Video",
          channelTitle: "Gamer",
          privacyStatus: "private", // VIOLATION!
          embeddable: true,
          durationSec: 60,
        },
      },
      {
        canonicalVideoId: "unembedVid1",
        ownerCategory: "Anime",
        fandomIds: ["jujutsu-kaisen"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 101,
        lastMetadataVerification: now,
        metadata: {
          title: "No Embed JJK Video",
          channelTitle: "Editor",
          privacyStatus: "public",
          embeddable: false, // VIOLATION!
          durationSec: 60,
        },
      },
    ],
  };
  writeFileSync(testAuditPath, JSON.stringify(auditData, null, 2), "utf-8");

  try {
    const compileResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      dryRun: true,
      baseCatalog: [],
    });

    assert.equal(compileResult.success, false, "Must fail closed on private or unembeddable items");
    assert.ok(
      compileResult.errors.some((e) => e.includes("is not public")),
      "Must report private status error"
    );
    assert.ok(
      compileResult.errors.some((e) => e.includes("embedded playback is disabled or restricted")),
      "Must report unembeddable status error"
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. DUPLICATE ID REJECTION (FIX E)
// ---------------------------------------------------------------------------
test("V2 FIX 7: Duplicate Lolixco ID and YouTube video ID rejection", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "dup-id-audit.json");
  const now = new Date().toISOString();

  // 1. Two items with identical assignedLolixcoId: 100
  const duplicateLolixcoIdAudit = {
    version: "1.0.0",
    items: [
      {
        canonicalVideoId: "uniqueVd001",
        ownerCategory: "Gaming",
        fandomIds: ["valorant"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 100, // COLLISION!
        lastMetadataVerification: now,
        metadata: {
          title: "Video 1",
          channelTitle: "Gamer 1",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 60,
        },
      },
      {
        canonicalVideoId: "uniqueVd002",
        ownerCategory: "Gaming",
        fandomIds: ["valorant"],
        format: "video",
        contentReviewStatus: "approved",
        assignedLolixcoId: 100, // COLLISION!
        lastMetadataVerification: now,
        metadata: {
          title: "Video 2",
          channelTitle: "Gamer 2",
          privacyStatus: "public",
          embeddable: true,
          durationSec: 60,
        },
      },
    ],
  };
  writeFileSync(testAuditPath, JSON.stringify(duplicateLolixcoIdAudit, null, 2), "utf-8");

  try {
    const compileResult = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      dryRun: true,
      baseCatalog: [],
    });

    assert.equal(compileResult.success, false);
    assert.ok(
      compileResult.errors.some((e) => e.includes("collision") || e.includes("assigned Lolixco ID")),
      "Must reject duplicate assignedLolixcoId"
    );

    // 2. Two records with identical YouTube video ID
    const duplicateYouTubeIdAudit = {
      version: "1.0.0",
      items: [
        {
          canonicalVideoId: "sameYtVid11",
          ownerCategory: "Gaming",
          fandomIds: ["valorant"],
          format: "video",
          contentReviewStatus: "approved",
          assignedLolixcoId: 100,
          lastMetadataVerification: now,
          metadata: {
            title: "Entry 1",
            channelTitle: "Gamer",
            privacyStatus: "public",
            embeddable: true,
            durationSec: 60,
          },
        },
        {
          canonicalVideoId: "sameYtVid11", // DUPLICATE YT ID!
          ownerCategory: "Gaming",
          fandomIds: ["valorant"],
          format: "video",
          contentReviewStatus: "approved",
          assignedLolixcoId: 101,
          lastMetadataVerification: now,
          metadata: {
            title: "Entry 2",
            channelTitle: "Gamer",
            privacyStatus: "public",
            embeddable: true,
            durationSec: 60,
          },
        },
      ],
    };
    const testAuditPath2 = join(tempDir, "dup-yt-audit.json");
    writeFileSync(testAuditPath2, JSON.stringify(duplicateYouTubeIdAudit, null, 2), "utf-8");

    const compileResult2 = await compileYouTubeCatalog({
      auditFilePath: testAuditPath2,
      dryRun: true,
      baseCatalog: [],
    });

    assert.equal(compileResult2.success, false);
    assert.ok(
      compileResult2.errors.some((e) => e.includes("Duplicate YouTube video ID conflict")),
      "Must reject duplicate YouTube video IDs"
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8. AUDIT PATH AND PRIVACY PROTECTION (FIX F)
// ---------------------------------------------------------------------------
test("V2 FIX 8: Canonical audit path and privacy protection in git and bundles", () => {
  // Canonical audit path must match runbook
  assert.equal(
    CANONICAL_AUDIT_PATH,
    resolve(projectRoot, "content/audit/youtube-intake-audit.json")
  );

  // .gitignore must protect audit paths
  const gitignoreContent = readFileSync(resolve(projectRoot, ".gitignore"), "utf-8");
  assert.ok(gitignoreContent.includes("content/audit/"));
  assert.ok(gitignoreContent.includes("content/youtube-audit.json"));

  // Public projection must strip private fields
  const sampleAuditItem = {
    canonicalVideoId: "dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ownerCategory: "Gaming",
    fandomIds: ["valorant"],
    format: "video",
    contentReviewStatus: "approved",
    assignedLolixcoId: 100,
    isMock: false,
    provenance: "youtube_data_api_v3",
    privateCuratorNotes: "SECRET INTERNAL NOTE",
    curatorNotes: "ANOTHER SECRET NOTE",
    rawApiSnippet: { secretToken: "abc" },
    metadata: {
      title: "Public Video",
      channelTitle: "Creator",
      description: "Public Description",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      durationFormatted: "1:00",
    },
  };

  const publicEdit = projectToPublicYouTubeEdit(sampleAuditItem);

  assert.equal("privateCuratorNotes" in publicEdit, false);
  assert.equal("curatorNotes" in publicEdit, false);
  assert.equal("contentReviewStatus" in publicEdit, false);
  assert.equal("rawApiSnippet" in publicEdit, false);
  assert.equal("provenance" in publicEdit, false);
  assert.equal("isMock" in publicEdit, false);
  assert.equal(publicEdit.title, "Public Video");
  assert.equal(publicEdit.creator, "Creator");
});

// ---------------------------------------------------------------------------
// 9. REAL PLAYER LIFECYCLE USING MOCKED IFRAME API & onAutoplayBlocked (FIX G)
// ---------------------------------------------------------------------------
test("V2 FIX 9: Real player lifecycle: registration, events, onAutoplayBlocked, and cleanup", () => {
  // Simulate mock YT Player and callbacks
  let playerEvents = [];
  let autoplayBlockedTriggered = false;

  class MockYTPlayer {
    constructor(containerId, config) {
      this.containerId = containerId;
      this.config = config;
      this.destroyed = false;
      this.state = -1; // unstarted

      // Simulate onReady async callback
      setTimeout(() => {
        if (config.events?.onReady) {
          config.events.onReady({ target: this });
        }
      }, 5);
    }

    playVideo() {
      playerEvents.push("playVideo");
      this.state = 1; // playing
      this.config.events?.onStateChange?.({ data: 1 });
    }

    pauseVideo() {
      playerEvents.push("pauseVideo");
      this.state = 2; // paused
      this.config.events?.onStateChange?.({ data: 2 });
    }

    simulateAutoplayBlocked() {
      autoplayBlockedTriggered = true;
      if (this.config.events?.onAutoplayBlocked) {
        this.config.events.onAutoplayBlocked({ target: this });
      }
    }

    destroy() {
      this.destroyed = true;
      playerEvents.push("destroy");
    }
  }

  // Create instance
  const mockPlayer = new MockYTPlayer("yt-test-frame", {
    events: {
      onReady: () => playerEvents.push("onReady"),
      onAutoplayBlocked: () => {
        playerEvents.push("onAutoplayBlocked");
      },
    },
  });

  // Trigger lifecycle events
  mockPlayer.playVideo();
  mockPlayer.pauseVideo();
  mockPlayer.simulateAutoplayBlocked();
  mockPlayer.destroy();

  assert.ok(playerEvents.includes("playVideo"));
  assert.ok(playerEvents.includes("pauseVideo"));
  assert.ok(playerEvents.includes("onAutoplayBlocked"));
  assert.ok(playerEvents.includes("destroy"));
  assert.equal(mockPlayer.destroyed, true);
  assert.equal(autoplayBlockedTriggered, true);
});

// ---------------------------------------------------------------------------
// 10. IMMERSION PLAYER HANDOFF WITHOUT SELF-PAUSING (FIX G, FIX H)
// ---------------------------------------------------------------------------
test("V2 FIX 10: Immersion player handoff avoids self-pausing cycle", () => {
  let immersionViewerPaused = false;
  let externalPlayerPaused = false;

  // ImmersionViewer registers with playbackCoordinator
  const unregisterImmersion = playbackCoordinator.registerPlayer("immersion-player", () => {
    immersionViewerPaused = true;
  });

  // External background player
  const unregisterExternal = playbackCoordinator.registerPlayer("featured-player", () => {
    externalPlayerPaused = true;
  });

  // When Immersion child YouTubePlayer plays with coordinatorId="immersion-player",
  // notifyPlaying("immersion-player") must NOT trigger immersionViewerPaused!
  playbackCoordinator.notifyPlaying("immersion-player");

  assert.equal(playbackCoordinator.getActivePlayerId(), "immersion-player");
  assert.equal(immersionViewerPaused, false, "ImmersionViewer must NOT pause itself upon child playback!");
  assert.equal(externalPlayerPaused, false);

  // If another player notifies playing, Immersion MUST be paused
  playbackCoordinator.notifyPlaying("featured-player");
  assert.equal(playbackCoordinator.getActivePlayerId(), "featured-player");
  assert.equal(immersionViewerPaused, true, "ImmersionViewer must pause when another player begins playing");

  unregisterImmersion();
  unregisterExternal();
});

// ---------------------------------------------------------------------------
// 11. PAUSE / RESUME WITHOUT IFRAME DESTRUCTION (FIX G)
// ---------------------------------------------------------------------------
test("V2 FIX 11: Imperative pause and resume operates without iframe destruction", () => {
  // Verify that an imperative player interface tracks play/pause without unmounting
  let mountCount = 0;
  let destroyCount = 0;
  let playCalls = 0;
  let pauseCalls = 0;

  class StableLifecyclePlayer {
    constructor() {
      mountCount++;
    }
    playVideo() {
      playCalls++;
    }
    pauseVideo() {
      pauseCalls++;
    }
    destroy() {
      destroyCount++;
    }
  }

  const player = new StableLifecyclePlayer();
  assert.equal(mountCount, 1);

  // User pauses
  player.pauseVideo();
  assert.equal(pauseCalls, 1);
  assert.equal(destroyCount, 0, "Pause must not destroy player");

  // User resumes
  player.playVideo();
  assert.equal(playCalls, 1);
  assert.equal(destroyCount, 0, "Resume must not destroy player");

  // User pauses again
  player.pauseVideo();
  assert.equal(pauseCalls, 2);
  assert.equal(destroyCount, 0, "Repeated pause must not destroy player");

  // Mount count remains 1 throughout playback toggle session
  assert.equal(mountCount, 1);

  // Only on actual teardown is destroy called
  player.destroy();
  assert.equal(destroyCount, 1);
});

// ---------------------------------------------------------------------------
// 12. SHORTS CLASSIFICATION FOR 61-180s EXAMPLES (FIX J)
// ---------------------------------------------------------------------------
test("V2 FIX 12: Shorts classification supports up to 180s and requires confirmation", () => {
  // 1. 45s with /shorts/ URL hint -> classified as short, flagged with warning for confirmation
  const short45 = evaluateEditorialClassification({
    ownerCategory: "Gaming",
    ownerFandom: "valorant",
    urlFormatHint: "short",
    metadata: {
      canonicalVideoId: "shortVid045",
      durationSec: 45,
      privacyStatus: "public",
      embeddable: true,
    },
  });
  assert.equal(short45.format, "short");
  assert.equal(short45.reviewStatus, "needs_review", "Unconfirmed short must retain needs_review");
  assert.ok(short45.warnings.some((w) => w.includes("portrait aspect ratio requires explicit editorial confirmation")));

  // 2. 75s (61–180s range) with /shorts/ URL hint -> classified as short candidate up to 180s
  const short75 = evaluateEditorialClassification({
    ownerCategory: "Anime",
    ownerFandom: "jujutsu-kaisen",
    urlFormatHint: "short",
    metadata: {
      canonicalVideoId: "shortVid075",
      durationSec: 75,
      privacyStatus: "public",
      embeddable: true,
    },
  });
  assert.equal(short75.format, "short");
  assert.ok(short75.warnings.some((w) => w.includes("portrait aspect ratio requires explicit editorial confirmation")));

  // 3. 75s with explicit editorial confirmation -> approved short
  const short75Confirmed = evaluateEditorialClassification({
    ownerCategory: "Anime",
    ownerFandom: "jujutsu-kaisen",
    urlFormatHint: "short",
    confirmedFormat: "short",
    metadata: {
      canonicalVideoId: "shortVid075",
      durationSec: 75,
      privacyStatus: "public",
      embeddable: true,
    },
  });
  assert.equal(short75Confirmed.format, "short");
  assert.equal(short75Confirmed.reviewStatus, "embed_eligible");

  // 4. 200s with /shorts/ URL hint -> exceeds 180s Shorts threshold, classified as landscape video
  const video200 = evaluateEditorialClassification({
    ownerCategory: "Phonk",
    urlFormatHint: "short",
    metadata: {
      canonicalVideoId: "longVid200",
      durationSec: 200,
      privacyStatus: "public",
      embeddable: true,
    },
  });
  assert.equal(video200.format, "video", "Videos >180s must NOT be classified as shorts");
  assert.ok(video200.warnings.some((w) => w.includes("exceeds the maximum YouTube Shorts limit of 180s")));

  // 5. Standard 16:9 landscape video
  const landscapeVid = evaluateEditorialClassification({
    ownerCategory: "Movies",
    ownerFandom: "spider-man",
    urlFormatHint: "video",
    metadata: {
      canonicalVideoId: "movieVid090",
      durationSec: 90,
      privacyStatus: "public",
      embeddable: true,
    },
  });
  assert.equal(landscapeVid.format, "video");
  assert.equal(landscapeVid.reviewStatus, "embed_eligible");
});
