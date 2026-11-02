import test from "node:test";
import assert from "node:assert/strict";
import { compileCatalog } from "../scripts/compile-catalog.mjs";
import { youtube, hosted, NOW, ORIGIN } from "./catalog-fixtures.mjs";
import { edits } from "../src/data/edits.ts";
import { discoveryCatalog } from "../src/utils/discoveryCatalog.ts";

test("synthetic full-release rehearsal compiles 75 protected+real records and discovers exactly 58", async () => {
  const yt = [
    ...Array.from({ length: 13 }, (_, n) =>
      youtube(100 + n, `yt${String(n).padStart(9, "0")}`),
    ),
    ...Array.from({ length: 15 }, (_, n) =>
      youtube(200 + n, `ys${String(n).padStart(9, "0")}`),
    ),
  ];
  const media = [
    ...Array.from({ length: 20 }, (_, n) => hosted(300 + n)),
    ...Array.from({ length: 10 }, (_, n) => hosted(400 + n)),
  ];
  const options = {
    youtubeAudit: { items: yt },
    hostedAudit: { items: media },
    previousCatalog: edits,
    policy: { approvedOrigins: [ORIGIN] },
    now: NOW,
    catalogVersion: "catalog-v2",
  };
  const result = await compileCatalog(options);
  assert.equal(result.success, true, result.errors?.join("; "));
  assert.equal(result.written, false);
  assert.equal(result.catalog.length, 75);
  assert.deepEqual(result.catalog.slice(0, 17), edits);
  assert.equal(discoveryCatalog(result.catalog).length, 58);
  assert.equal(JSON.parse(result.snapshot).catalog_version, "catalog-v2");
  for (const mutate of [
    (r) => {
      r.rights.audioDistribution = false;
    },
    (r) => {
      r.mediaVerification.width = 1440;
    },
    (r) => {
      r.playbackVerification.status = "pending";
    },
  ]) {
    const bad = structuredClone(options);
    mutate(bad.hostedAudit.items[0]);
    assert.equal((await compileCatalog(bad)).success, false);
  }
});
