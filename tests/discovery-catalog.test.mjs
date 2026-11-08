import test from "node:test";
import assert from "node:assert/strict";
import { discoveryCatalog } from "../src/utils/discoveryCatalog.ts";
import { edits } from "../src/data/edits.ts";
import { youtube, hosted, shorts } from "./fixtures/stage5-public-catalog.ts";
import { selectEditOfTheMoment } from "../src/utils/editOfTheMoment.ts";
import { composeHomeFeed, filterShorts } from "../src/data/feedComposition.ts";

test("real discovery excludes protected demos from every downstream surface without mutating the pair", () => {
  const paired = [...edits, ...youtube, ...hosted, ...shorts];
  const before = JSON.stringify(paired);
  const publicCatalog = discoveryCatalog(paired);
  assert.deepEqual(publicCatalog, [...youtube, ...hosted, ...shorts]);
  assert.equal(JSON.stringify(paired), before);
  assert.ok(
    selectEditOfTheMoment(publicCatalog, new Date("2026-11-02")).id >= 100,
  );
  const sections = composeHomeFeed({
    catalog: publicCatalog,
    recommendedVideos: edits,
    currentEditId: 100,
  });
  assert.ok(sections.flatMap((s) => s.items).every((e) => e.id >= 100));
  assert.ok(filterShorts(publicCatalog).every((e) => e.id >= 100));
});
test("demo-only and empty builds retain the original catalog; Shorts-only real discovery never falls back to a demo", () => {
  assert.equal(discoveryCatalog(edits), edits);
  assert.deepEqual(discoveryCatalog([]), []);
  const onlyShorts = discoveryCatalog([...edits, ...shorts]);
  assert.deepEqual(onlyShorts, shorts);
  const rotation = onlyShorts.map((_, offset) => selectEditOfTheMoment(onlyShorts, new Date("2026-11-02"), offset));
  assert.deepEqual(new Set(rotation), new Set(shorts));
  assert.ok(rotation.every(edit => edit.sourceType !== "local_demo"));
});
