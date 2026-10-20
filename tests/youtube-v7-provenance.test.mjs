import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

import {
  compileYouTubeCatalog,
  CANONICAL_OUTPUT_PATH,
} from "../scripts/compile-youtube-catalog.mjs";
import {
  ingestYouTubeBatch,
} from "../scripts/youtube-importer.mjs";
import {
  approveReviewItem,
} from "../scripts/review-youtube-batch.mjs";
import {
  fetchYouTubeVideoMetadata,
} from "../scripts/youtube-api.mjs";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "lolixco-v7-test-"));
}

// =========================================================================
// V7 FIX: COMPLETE METADATA PROVENANCE BOUNDARY
// =========================================================================

test("V7 PATHWAY 1: Injected options.metadataFetcher cannot bypass synthetic provenance boundary", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "audit-pathway-1.json");
  const testCatalogPath = join(tempDir, "edits-pathway-1.ts");

  try {
    // 1. Import fictional video metadata claiming real API provenance via options.metadataFetcher
    const fictionalMetadata = {
      canonicalVideoId: "injectVid01",
      title: "Fictional Injected Edit 001",
      description: "Fictional edit claiming real API provenance",
      channelId: "UC_fake_channel_1",
      channelTitle: "Fictional Creator",
      durationSec: 45,
      durationFormatted: "0:45",
      embeddable: true,
      privacyStatus: "public",
      isMock: false, // Claimed genuine!
      provenance: "youtube_data_api_v3", // Claimed real API provenance!
      fetchStatus: "success",
    };

    const importResult = await ingestYouTubeBatch(
      ["https://www.youtube.com/watch?v=injectVid01"],
      {
        auditFilePath: testAuditPath,
        category: "Gaming",
        fandom: "valorant",
        dryRun: false,
        metadataFetcher: async (vid) => ({
          success: true,
          data: fictionalMetadata,
        }),
      }
    );

    assert.equal(importResult.success, true);

    // 2. Inspect the stored audit record: provenance cannot be disguised
    const auditDoc = JSON.parse(readFileSync(testAuditPath, "utf8"));
    const storedItem = auditDoc.items.find((i) => i.canonicalVideoId === "injectVid01");
    assert.ok(storedItem, "Stored audit record must exist");

    assert.equal(storedItem.isMock, true, "Top-level isMock must be forced to true");
    assert.equal(storedItem.provenance, "synthetic_mock", "Top-level provenance must be synthetic_mock");
    assert.equal(storedItem.syntheticOrigin, "injected_metadata_fetcher", "syntheticOrigin must identify injected metadataFetcher");

    assert.equal(storedItem.metadata.isMock, true, "Payload metadata.isMock must be forced to true");
    assert.equal(storedItem.metadata.provenance, "synthetic_mock", "Payload metadata.provenance must be synthetic_mock");
    assert.equal(storedItem.metadata.syntheticOrigin, "injected_metadata_fetcher");

    // 3. Attempt owner approval: must fail closed
    const approveRes = await approveReviewItem("injectVid01", {
      auditFilePath: testAuditPath,
      format: "video",
    });
    assert.equal(approveRes.success, false, "Owner approval must fail for injected metadataFetcher");
    assert.ok(
      approveRes.errors.some((e) => e.includes("synthetic mock metadata")),
      "Approval error must cite synthetic mock metadata rejection"
    );

    // 4. Attempt compilation with dryRun: false into an isolated catalog path
    const compileRes = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testCatalogPath,
      dryRun: false,
    });
    assert.equal(compileRes.success, false, "Compilation must fail for unapproved/synthetic metadata");
    assert.equal(existsSync(testCatalogPath), false, "Public catalog file must not be written");

    // 5. Tamper attempt: even if contentReviewStatus is forced to 'approved', compilation must fail closed
    storedItem.contentReviewStatus = "approved";
    writeFileSync(testAuditPath, JSON.stringify(auditDoc, null, 2), "utf8");

    const tamperedCompileRes = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testCatalogPath,
      dryRun: false,
    });
    assert.equal(tamperedCompileRes.success, false, "Compilation of tampered synthetic record must fail");
    assert.ok(
      tamperedCompileRes.errors.some((e) => e.includes("synthetic mock metadata is prohibited from production")),
      "Compiler must explicitly prohibit synthetic mock metadata"
    );
    assert.equal(existsSync(testCatalogPath), false, "No public catalog must be written for tampered record");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("V7 PATHWAY 2: Injected options.fetchMetadata cannot bypass synthetic provenance boundary", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "audit-pathway-2.json");
  const testCatalogPath = join(tempDir, "edits-pathway-2.ts");

  try {
    // 1. Import fictional video metadata claiming real API provenance via options.fetchMetadata
    const fictionalMetadata = {
      canonicalVideoId: "injectVid02",
      title: "Fictional Injected Edit 002",
      description: "Fictional edit claiming real API provenance via fetchMetadata",
      channelId: "UC_fake_channel_2",
      channelTitle: "Fictional Creator 2",
      durationSec: 50,
      durationFormatted: "0:50",
      embeddable: true,
      privacyStatus: "public",
      isMock: false, // Claimed genuine!
      provenance: "youtube_data_api_v3", // Claimed real API provenance!
      fetchStatus: "success",
    };

    const importResult = await ingestYouTubeBatch(
      ["https://www.youtube.com/watch?v=injectVid02"],
      {
        auditFilePath: testAuditPath,
        category: "Anime",
        fandom: "jujutsu-kaisen",
        dryRun: false,
        fetchMetadata: async (ids) => ({
          items: [fictionalMetadata],
          missingIds: [],
          incompleteIds: [],
          confirmedUnavailableIds: [],
          retryableIds: [],
          errors: [],
        }),
      }
    );

    assert.equal(importResult.success, true);

    // 2. Inspect the stored audit record: provenance cannot be disguised
    const auditDoc = JSON.parse(readFileSync(testAuditPath, "utf8"));
    const storedItem = auditDoc.items.find((i) => i.canonicalVideoId === "injectVid02");
    assert.ok(storedItem, "Stored audit record must exist");

    assert.equal(storedItem.isMock, true, "Top-level isMock must be forced to true");
    assert.equal(storedItem.provenance, "synthetic_mock", "Top-level provenance must be synthetic_mock");
    assert.equal(storedItem.syntheticOrigin, "injected_fetch_metadata", "syntheticOrigin must identify injected fetchMetadata");

    assert.equal(storedItem.metadata.isMock, true, "Payload metadata.isMock must be forced to true");
    assert.equal(storedItem.metadata.provenance, "synthetic_mock", "Payload metadata.provenance must be synthetic_mock");
    assert.equal(storedItem.metadata.syntheticOrigin, "injected_fetch_metadata");

    // 3. Attempt owner approval: must fail closed
    const approveRes = await approveReviewItem("injectVid02", {
      auditFilePath: testAuditPath,
      format: "video",
    });
    assert.equal(approveRes.success, false, "Owner approval must fail for injected fetchMetadata");
    assert.ok(
      approveRes.errors.some((e) => e.includes("synthetic mock metadata")),
      "Approval error must cite synthetic mock metadata rejection"
    );

    // 4. Attempt compilation with dryRun: false into an isolated catalog path
    const compileRes = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testCatalogPath,
      dryRun: false,
    });
    assert.equal(compileRes.success, false, "Compilation must fail for unapproved/synthetic metadata");
    assert.equal(existsSync(testCatalogPath), false, "Public catalog file must not be written");

    // 5. Tamper attempt: even if contentReviewStatus is forced to 'approved', compilation must fail closed
    storedItem.contentReviewStatus = "approved";
    writeFileSync(testAuditPath, JSON.stringify(auditDoc, null, 2), "utf8");

    const tamperedCompileRes = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testCatalogPath,
      dryRun: false,
    });
    assert.equal(tamperedCompileRes.success, false, "Compilation of tampered synthetic record must fail");
    assert.ok(
      tamperedCompileRes.errors.some((e) => e.includes("synthetic mock metadata is prohibited from production")),
      "Compiler must explicitly prohibit synthetic mock metadata"
    );
    assert.equal(existsSync(testCatalogPath), false, "No public catalog must be written for tampered record");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("V7 PATHWAY 3: Injected options.apiClient.fetchMetadata cannot bypass synthetic provenance boundary", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "audit-pathway-3.json");
  const testCatalogPath = join(tempDir, "edits-pathway-3.ts");

  try {
    // 1. Import fictional video metadata claiming real API provenance via options.apiClient.fetchMetadata
    const fictionalMetadata = {
      canonicalVideoId: "injectVid03",
      title: "Fictional Injected Edit 003",
      description: "Fictional edit claiming real API provenance via apiClient.fetchMetadata",
      channelId: "UC_fake_channel_3",
      channelTitle: "Fictional Creator 3",
      durationSec: 60,
      durationFormatted: "1:00",
      embeddable: true,
      privacyStatus: "public",
      isMock: false, // Claimed genuine!
      provenance: "youtube_data_api_v3", // Claimed real API provenance!
      fetchStatus: "success",
    };

    const importResult = await ingestYouTubeBatch(
      ["https://www.youtube.com/watch?v=injectVid03"],
      {
        auditFilePath: testAuditPath,
        category: "Movies",
        fandom: "spider-man",
        dryRun: false,
        apiClient: {
          fetchMetadata: async (vid) => ({
            success: true,
            data: fictionalMetadata,
          }),
        },
      }
    );

    assert.equal(importResult.success, true);

    // 2. Inspect the stored audit record: provenance cannot be disguised
    const auditDoc = JSON.parse(readFileSync(testAuditPath, "utf8"));
    const storedItem = auditDoc.items.find((i) => i.canonicalVideoId === "injectVid03");
    assert.ok(storedItem, "Stored audit record must exist");

    assert.equal(storedItem.isMock, true, "Top-level isMock must be forced to true");
    assert.equal(storedItem.provenance, "synthetic_mock", "Top-level provenance must be synthetic_mock");
    assert.equal(storedItem.syntheticOrigin, "injected_api_client", "syntheticOrigin must identify injected apiClient");

    assert.equal(storedItem.metadata.isMock, true, "Payload metadata.isMock must be forced to true");
    assert.equal(storedItem.metadata.provenance, "synthetic_mock", "Payload metadata.provenance must be synthetic_mock");
    assert.equal(storedItem.metadata.syntheticOrigin, "injected_api_client");

    // 3. Attempt owner approval: must fail closed
    const approveRes = await approveReviewItem("injectVid03", {
      auditFilePath: testAuditPath,
      format: "video",
    });
    assert.equal(approveRes.success, false, "Owner approval must fail for injected apiClient");
    assert.ok(
      approveRes.errors.some((e) => e.includes("synthetic mock metadata")),
      "Approval error must cite synthetic mock metadata rejection"
    );

    // 4. Attempt compilation with dryRun: false into an isolated catalog path
    const compileRes = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testCatalogPath,
      dryRun: false,
    });
    assert.equal(compileRes.success, false, "Compilation must fail for unapproved/synthetic metadata");
    assert.equal(existsSync(testCatalogPath), false, "Public catalog file must not be written");

    // 5. Tamper attempt: even if contentReviewStatus is forced to 'approved', compilation must fail closed
    storedItem.contentReviewStatus = "approved";
    writeFileSync(testAuditPath, JSON.stringify(auditDoc, null, 2), "utf8");

    const tamperedCompileRes = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testCatalogPath,
      dryRun: false,
    });
    assert.equal(tamperedCompileRes.success, false, "Compilation of tampered synthetic record must fail");
    assert.ok(
      tamperedCompileRes.errors.some((e) => e.includes("synthetic mock metadata is prohibited from production")),
      "Compiler must explicitly prohibit synthetic mock metadata"
    );
    assert.equal(existsSync(testCatalogPath), false, "No public catalog must be written for tampered record");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("V7 PATHWAY 3B: Injected options.apiClient direct function cannot bypass synthetic provenance boundary", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "audit-pathway-3b.json");
  const testCatalogPath = join(tempDir, "edits-pathway-3b.ts");

  try {
    const fictionalMetadata = {
      canonicalVideoId: "injectVid3b",
      title: "Fictional Injected Edit 003B",
      description: "Fictional edit claiming real API provenance via function apiClient",
      channelId: "UC_fake_channel_3b",
      channelTitle: "Fictional Creator 3B",
      durationSec: 65,
      durationFormatted: "1:05",
      embeddable: true,
      privacyStatus: "public",
      isMock: false,
      provenance: "youtube_data_api_v3",
      fetchStatus: "success",
    };

    const importResult = await ingestYouTubeBatch(
      ["https://www.youtube.com/watch?v=injectVid3b"],
      {
        auditFilePath: testAuditPath,
        category: "Movies",
        fandom: "spider-man",
        dryRun: false,
        apiClient: async (vid) => ({
          success: true,
          data: fictionalMetadata,
        }),
      }
    );

    assert.equal(importResult.success, true);

    const auditDoc = JSON.parse(readFileSync(testAuditPath, "utf8"));
    const storedItem = auditDoc.items.find((i) => i.canonicalVideoId === "injectVid3b");
    assert.ok(storedItem, "Stored audit record must exist");

    assert.equal(storedItem.isMock, true, "Top-level isMock must be forced to true");
    assert.equal(storedItem.provenance, "synthetic_mock", "Top-level provenance must be synthetic_mock");
    assert.equal(storedItem.syntheticOrigin, "injected_api_client");

    const approveRes = await approveReviewItem("injectVid3b", {
      auditFilePath: testAuditPath,
      format: "video",
    });
    assert.equal(approveRes.success, false, "Owner approval must fail for injected function apiClient");

    const compileRes = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testCatalogPath,
      dryRun: false,
    });
    assert.equal(compileRes.success, false, "Compilation must fail");
    assert.equal(existsSync(testCatalogPath), false, "Public catalog file must not be written");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("V7 PATHWAY 4: Replaced global fetch cannot launder provenance; simulated API data is marked synthetic and fails approval & publication", async () => {
  const tempDir = createTempDir();
  const testAuditPath = join(tempDir, "audit-genuine.json");
  const testCatalogPath = join(tempDir, "edits-genuine.ts");

  // Save and set environment variable for simulated official YouTube Data API call
  const originalKey = process.env.YOUTUBE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = "AIzaSyFakeKeyForTestVerificationOnly";

  try {
    // Intercept globalThis.fetch to simulate Google YouTube Data API v3 endpoint response
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("googleapis.com/youtube/v3/videos")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: "genuVid0001",
                snippet: {
                  title: "Genuine High-Quality Edit",
                  description: "Verified edit from YouTube Data API v3 #action #anime",
                  channelId: "UC_genuine_creator",
                  channelTitle: "Genuine Studio",
                  publishedAt: "2026-01-10T15:00:00Z",
                  thumbnails: {
                    high: { url: "https://i.ytimg.com/vi/genuVid0001/hqdefault.jpg" },
                  },
                },
                contentDetails: {
                  duration: "PT45S",
                },
                status: {
                  embeddable: true,
                  privacyStatus: "public",
                },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, text: async () => "Not Found" };
    };

    // 1. Ingest via official YouTube Data API client pathway (neither mockMode nor injected hooks passed)
    const importResult = await ingestYouTubeBatch(
      ["https://www.youtube.com/watch?v=genuVid0001"],
      {
        auditFilePath: testAuditPath,
        category: "Anime",
        fandom: "demon-slayer",
        dryRun: false,
      }
    );

    assert.equal(importResult.success, true, importResult.errors.join("; "));

    // 2. Inspect the stored audit record: replaced global fetch MUST NOT launder provenance
    const auditDoc = JSON.parse(readFileSync(testAuditPath, "utf8"));
    const genuineItem = auditDoc.items.find((i) => i.canonicalVideoId === "genuVid0001");
    assert.ok(genuineItem, "Audit record must exist");

    assert.equal(genuineItem.isMock, true, "Replaced global fetch must be synthetic by construction");
    assert.equal(genuineItem.provenance, "synthetic_mock", "Replaced global fetch must receive synthetic_mock provenance");
    assert.equal(genuineItem.syntheticOrigin, "test_environment_mock", "Synthetic origin must be test_environment_mock");
    assert.equal(genuineItem.metadataFetchStatus, "fetched");

    assert.equal(genuineItem.metadata.isMock, true);
    assert.equal(genuineItem.metadata.provenance, "synthetic_mock");
    assert.equal(genuineItem.metadata.syntheticOrigin, "test_environment_mock");

    // 3. Attempt owner approval: simulated synthetic data CANNOT pass owner approval
    const approveRes = await approveReviewItem("genuVid0001", {
      auditFilePath: testAuditPath,
      format: "video",
      notes: "Simulated editorial approval",
    });
    assert.equal(approveRes.success, false, "Approval must fail closed for simulated mock data");
    assert.ok(
      approveRes.errors.some((e) => e.includes("synthetic mock metadata")),
      "Approval error must cite synthetic mock metadata protection"
    );

    // 4. Attempt compilation into catalog: simulated synthetic data CANNOT pass catalog compilation
    const compileRes = await compileYouTubeCatalog({
      auditFilePath: testAuditPath,
      outputPath: testCatalogPath,
      dryRun: false,
    });
    assert.equal(compileRes.success, false, "Compilation of synthetic data must fail-closed");
    assert.ok(
      compileRes.errors.some((e) => e.includes("synthetic") || e.includes("Mock")),
      "Compilation must reject synthetic records"
    );
    assert.equal(existsSync(testCatalogPath), false, "Catalog file must not be written for synthetic data");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = originalKey;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
