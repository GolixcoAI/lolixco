/** Read-only review of the complete source audits against the approved selection.
 * Never loads credentials, refreshes evidence, or writes the production pair.
 * node --import ./tests/register-ts.mjs scripts/stage9-catalog-readiness.mjs YOUTUBE.json HOSTED.json
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { compileCatalog } from "./compile-catalog.mjs";

export async function reviewStage9(
  youtubeAudit,
  hostedAudit,
  { policy = { approvedOrigins: [] }, requireFullRelease = false } = {},
) {
  assert.equal(
    hostedAudit?.items?.length,
    30,
    "Complete 30-item hosted audit required for this batch review",
  );
  const selection = JSON.parse(
    readFileSync(
      new URL("../content/stage9/youtube-selection.json", import.meta.url),
      "utf8",
    ),
  ).items;
  const result = await compileCatalog({
    youtubeAudit,
    hostedAudit,
    policy,
    catalogVersion: "catalog-v2",
  });
  assert.equal(
    result.success,
    true,
    result.error || "Unified compiler rejected complete audits",
  );
  assert.equal(result.written, false);
  const real = result.catalog.slice(17);
  const youtube = real.filter((e) => e.sourceType === "youtube_embed");
  const hosted = real.filter((e) => e.sourceType === "licensed_local_media");
  assert.equal(
    youtube.length,
    28,
    "Exactly the approved 28 YouTube edits are required",
  );
  assert.deepEqual(
    youtube.map((e) => ({
      id: e.id,
      youtubeVideoId: e.youtubeVideoId,
      title: e.title,
      category: e.category,
      format: e.format,
      duration: e.duration,
    })),
    selection,
  );
  assert.ok(
    youtube.every(
      (e) =>
        e.sourceType === "youtube_embed" &&
        e.source === `https://www.youtube.com/watch?v=${e.youtubeVideoId}`,
    ),
  );
  if (requireFullRelease)
    assert.equal(
      real.length,
      58,
      "Full release requires 28 YouTube plus 30 eligible hosted edits; partial release forbidden",
    );
  return {
    result,
    report: {
      status: "dry-run passed; publication decision pending",
      total: result.catalog.length,
      protectedDemos: 17,
      youtubeVideos: youtube.filter((e) => e.format === "video").length,
      youtubeShorts: youtube.filter((e) => e.format === "short").length,
      hostedPublished: hosted.length,
      targetRealEdits: 58,
      eligibleRealEdits: real.length,
      remainingHosted: 30 - hosted.length,
      completeReleaseReady: real.length === 58,
      hostedAuditItems: hostedAudit.items.length,
      sourceSha256: createHash("sha256").update(result.source).digest("hex"),
      snapshotSha256: createHash("sha256")
        .update(result.snapshot)
        .digest("hex"),
      written: false,
    },
  };
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  assert.equal(
    process.argv.length,
    4,
    "Supply explicit complete YouTube and hosted audit paths; no publication flags supported",
  );
  const { report } = await reviewStage9(
    ...process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, "utf8"))),
  );
  console.log(JSON.stringify(report, null, 2));
}
