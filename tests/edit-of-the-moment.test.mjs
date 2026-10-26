import test from "node:test";
import assert from "node:assert/strict";

import {
  selectEditOfTheMoment,
  getUtcDaySeed,
} from "../src/utils/editOfTheMoment.ts";
import { youtube, hosted } from "./fixtures/stage5-public-catalog.ts";
import { edits as baseEdits } from "../src/data/edits.ts";

test("EDIT OF THE MOMENT: returns consistent, stable item across multiple calls on the same UTC day", () => {
  const date = new Date("2026-10-19T14:30:00Z");
  const first = selectEditOfTheMoment(baseEdits, date);
  const second = selectEditOfTheMoment(baseEdits, date);

  assert.ok(first);
  assert.equal(first.id, second?.id, "Same UTC date must return exact same edit ID");
});

test("EDIT OF THE MOMENT: avoids selecting identical edit on consecutive UTC days", () => {
  const day1 = new Date("2026-10-19T12:00:00Z");
  const day2 = new Date("2026-10-20T12:00:00Z");

  const editDay1 = selectEditOfTheMoment([...youtube, ...hosted], day1);
  const editDay2 = selectEditOfTheMoment([...youtube, ...hosted], day2);

  assert.ok(editDay1);
  assert.ok(editDay2);
  assert.notEqual(editDay1.id, editDay2.id, "Consecutive days must select different edits when pool >= 2");
});

test("EDIT OF THE MOMENT: manual shuffleOffset cycles through eligible items", () => {
  const date = new Date("2026-10-19T12:00:00Z");
  const initial = selectEditOfTheMoment([...youtube, ...hosted], date, 0);
  const shuffled1 = selectEditOfTheMoment([...youtube, ...hosted], date, 1);
  const shuffled2 = selectEditOfTheMoment([...youtube, ...hosted], date, 2);

  assert.ok(initial);
  assert.ok(shuffled1);
  assert.ok(shuffled2);

  assert.notEqual(initial.id, shuffled1.id, "Offset 1 must shift to different edit");
  assert.notEqual(shuffled1.id, shuffled2.id, "Offset 2 must shift to different edit");
});

test("EDIT OF THE MOMENT: selects real landscape edits ahead of demos", () => {
  const mixedCatalog = [
    ...baseEdits, // 17 demo edits (IDs 0-16)
    {
      id: 100,
      title: "Curated YouTube Edit One",
      category: "Gaming",
      tags: ["gaming"],
      description: "YouTube edit",
      creator: "Creator 1",
      poster: "poster.jpg",
      source: "https://www.youtube.com/watch?v=11111111111",
      duration: "0:30",
      trending: true,
      format: "video",
      sourceType: "youtube_embed",
      youtubeVideoId: "11111111111",
    },
    {
      id: 101,
      title: "Curated YouTube Edit Two",
      category: "Anime",
      tags: ["anime"],
      description: "YouTube edit",
      creator: "Creator 2",
      poster: "poster.jpg",
      source: "https://www.youtube.com/watch?v=22222222222",
      duration: "0:45",
      trending: false,
      format: "video",
      sourceType: "youtube_embed",
      youtubeVideoId: "22222222222",
    },
  ];

  const date = new Date("2026-10-19T12:00:00Z");
  const selected = selectEditOfTheMoment(mixedCatalog, date);

  assert.ok(selected);
  assert.equal(selected.sourceType, "youtube_embed");
  assert.equal([100, 101].includes(selected.id), true, "Must pick from curated YouTube pool (100 or 101)");
});

test("EDIT OF THE MOMENT: gracefully falls back on empty catalog or invalid inputs", () => {
  assert.equal(selectEditOfTheMoment([]), null);
  assert.equal(selectEditOfTheMoment(null), null);
});
