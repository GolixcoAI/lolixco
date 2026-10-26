import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import {
  composeHomeFeed,
  rankCatalogVideos,
  groupVideoCategories,
} from "../src/data/feedComposition.ts";
import { selectEditOfTheMoment } from "../src/utils/editOfTheMoment.ts";
import { publicSource } from "../src/utils/publicSource.ts";
import {
  computeLocalFallback,
  fetchRecommendations,
} from "../src/api/recommendations.ts";
import { useRecommendations } from "../src/hooks/useRecommendations.ts";
import { searchEdits } from "../src/data/searchEngine.ts";
import { edits } from "../src/data/edits.ts";
import {
  youtube,
  hosted,
  shorts,
  mixed,
} from "./fixtures/stage5-public-catalog.ts";
import { setupMountedDom } from "./mounted-dom.mjs";
import App from "../src/App.tsx";

const ids = (items) => items.map((e) => e.id);
const compose = (catalog, options = {}) =>
  composeHomeFeed({ catalog, recommendedVideos: [], ...options });
const date = new Date("2026-10-26T12:00:00Z");

for (const [name, catalog, expected] of [
  ["demo", edits, ["recommended-edits", "more-to-discover"]],
  ["youtube", youtube, ["youtube-videos", "more-to-discover"]],
  ["hosted", hosted, ["lolixco-uploads", "more-to-discover"]],
  [
    "mixed",
    mixed,
    ["youtube-videos", "curated-shorts", "lolixco-uploads", "more-to-discover"],
  ],
  ["shorts", shorts, ["curated-shorts"]],
  ["empty", [], []],
])
  test(`STAGE5 composition: ${name} has only populated, distinct, format-safe sections`, () => {
    const sections = compose(catalog);
    assert.deepEqual(
      sections.map((s) => s.id),
      expected,
    );
    const all = sections.flatMap((s) => s.items);
    assert.equal(new Set(ids(all)).size, all.length);
    for (const section of sections) {
      assert.ok(section.items.length);
      assert.ok(
        section.items.every(
          (e) => (e.format === "short") === (section.type === "shorts_shelf"),
        ),
      );
      for (const group of section.groups ?? []) assert.ok(group.items.length);
    }
  });

test("STAGE5 demo catalog stays frozen at 17 and defaults to ID 0 regardless of order/day/shuffle", () => {
  assert.equal(edits.length, 17);
  for (const time of ["2026-01-01", "2026-12-31"])
    for (const offset of [0, 1, 100]) {
      assert.equal(
        selectEditOfTheMoment([...edits].reverse(), new Date(time), offset),
        edits[0],
      );
    }
  assert.equal(selectEditOfTheMoment(edits.slice(1)), null);
});

test("STAGE5 source previews keep catalog order and category subgroups are stable", () => {
  const sections = compose([...youtube, ...hosted], {
    recommendedVideos: [...hosted, ...youtube].reverse(),
  });
  assert.deepEqual(ids(sections[0].items), [100, 101, 102, 103, 104, 105]);
  assert.deepEqual(
    sections[0].groups.map((g) => g.title),
    ["Anime", "Movies", "Series", "Multifandom", "Gaming", "Phonk"],
  );
  assert.deepEqual(ids(sections[1].items), [300, 301, 302, 303, 304, 305]);
  assert.deepEqual(ids(sections[2].items), [107, 106, 307, 306]);
});

test("STAGE5 ranked residuals reject foreign/short/duplicate IDs and display canonical records", () => {
  const candidates = [999, 200, 307, 106, 307, 107, 306].map((id) => ({
    id,
    title: "INJECTED",
    source: "s3://private",
  }));
  const sections = compose([...youtube, ...hosted, ...shorts], {
    recommendedVideos: candidates,
  });
  const more = sections.find((s) => s.id === "more-to-discover");
  assert.deepEqual(ids(more.items), [307, 106, 107, 306]);
  assert.equal(more.items[0], hosted[7]);
  assert.equal(JSON.stringify(sections).includes("INJECTED"), false);
});

test("STAGE5 featured exclusion is global and duplicate catalog records do not duplicate cards", () => {
  const sections = compose([...mixed, ...mixed], { currentEditId: 100 });
  const all = sections.flatMap((s) => s.items);
  assert.ok(!ids(all).includes(100));
  assert.equal(new Set(ids(all)).size, all.length);
});

test("STAGE5 grouping handles unknown, missing categories and preserves within-category order", () => {
  const groups = groupVideoCategories([
    { ...youtube[0], category: "Unregistered" },
    youtube[1],
    youtube[0],
    { ...youtube[2], category: "" },
    youtube[6],
  ]);
  assert.deepEqual(
    groups.map((g) => g.title),
    ["Anime", "Movies", "Unregistered", "Other"],
  );
  assert.deepEqual(ids(groups[0].items), [100, 106]);
});

test("STAGE5 duration never turns landscape records into Shorts; zero shelf budget omits shelf", () => {
  assert.ok(
    compose(youtube.map((e) => ({ ...e, duration: "0:01" }))).every(
      (s) => s.type === "video_row",
    ),
  );
  assert.deepEqual(compose(shorts, { config: { maxShortsPerShelf: 0 } }), []);
});

for (const [name, catalog] of [
  ["YouTube", youtube],
  ["hosted", hosted],
  ["mixed", [...hosted, ...youtube]],
]) {
  test(`STAGE5 featured ${name}: all sources participate equally in daily rotation and manual shuffle`, () => {
    const seen = new Set();
    let previous;
    for (let i = 0; i < 400; i++) {
      const day = new Date(Date.UTC(2026, 0, 1 + i));
      const picked = selectEditOfTheMoment(catalog, day);
      assert.notEqual(picked.id, previous);
      assert.equal(
        selectEditOfTheMoment([...catalog].reverse(), day).id,
        picked.id,
      );
      previous = picked.id;
      seen.add(picked.id);
    }
    assert.deepEqual(
      [...seen].sort((a, b) => a - b),
      ids(catalog).sort((a, b) => a - b),
    );
    const shuffled = Array.from(
      { length: catalog.length },
      (_, i) => selectEditOfTheMoment(catalog, date, i).id,
    );
    assert.equal(new Set(shuffled).size, catalog.length);
    assert.equal(
      selectEditOfTheMoment(catalog, date, catalog.length).id,
      shuffled[0],
    );
  });
}

test("STAGE5 featured UTC midnight and equivalent timezone instants", () => {
  const catalog = [youtube[0], hosted[0]];
  assert.notEqual(
    selectEditOfTheMoment(catalog, new Date("2026-12-31T23:59:59.999Z")).id,
    selectEditOfTheMoment(catalog, new Date("2027-01-01T00:00:00Z")).id,
  );
  assert.equal(
    selectEditOfTheMoment(catalog, new Date("2026-10-26T23:00:00Z")).id,
    selectEditOfTheMoment(catalog, new Date("2026-10-27T04:30:00+05:30")).id,
  );
});

test("STAGE5 featured: missing demo, empty, all-Shorts and single-item pools", () => {
  for (const catalog of [
    [],
    shorts,
    edits.slice(1),
    [{ ...edits[0], format: "short" }],
  ])
    assert.equal(selectEditOfTheMoment(catalog, date), null);
  assert.equal(selectEditOfTheMoment([hosted[0]], date, 20), hosted[0]);
  assert.equal(selectEditOfTheMoment([...shorts, hosted[0]], date), hosted[0]);
});

test("STAGE5 public labels use only reviewed channel title, never creator or popularity", () => {
  assert.deepEqual(
    [youtube[0], hosted[0], ...shorts, edits[0]].map(
      (e) => publicSource(e).label,
    ),
    ["YouTube", "Lolixco", "YouTube Short", "Lolixco Short", "Demo / Sample"],
  );
  assert.equal(publicSource(youtube[0]).attribution, "Synthetic channel 100");
  assert.equal(
    publicSource({ ...youtube[0], channelTitle: " ", creator: "Do not infer" })
      .attribution,
    null,
  );
  assert.equal(
    publicSource({ ...hosted[0], channelTitle: "Not a YouTube channel" })
      .attribution,
    null,
  );
});

test("STAGE5 public catalog supports title/description/hashtag/category/fandom search", () => {
  assert.ok(searchEdits(mixed, "#fixture").length === 18);
  assert.deepEqual(
    ids(searchEdits(mixed, "Synthetic YouTube 100").map((r) => r.edit)),
    [100],
  );
  assert.ok(searchEdits(mixed, "published").length === 18);
  assert.ok(
    searchEdits(mixed, "", "Gaming").every((r) => r.edit.category === "Gaming"),
  );
  assert.ok(searchEdits(mixed, "", "Anime", "jujutsu-kaisen").length > 0);
});

const envelope = (id) => ({
  schema_version: "1.0",
  request_id: "synthetic",
  surface: "home",
  mode_used: "baseline",
  catalog_version: "catalog-v2",
  policy_version: "test",
  as_of: "2026-10-26T00:00:00Z",
  items: [
    {
      rank: 1,
      score: 1,
      edit_id: id,
      reason_codes: [],
      edit: { id, title: "UNTRUSTED", source: "s3://private" },
    },
  ],
  total_eligible: 1,
  has_more: false,
  next_cursor: null,
  diagnostics: { warnings: [], fallback_reason: null },
});

test("STAGE5 API mapping and fallback use the supplied public catalog", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => envelope(300),
    });
    const result = await fetchRecommendations(
      { surface: "home" },
      undefined,
      hosted,
    );
    assert.equal(result.source, "api");
    assert.equal(result.edits[0], hosted[0]);
    assert.deepEqual(
      ids(
        computeLocalFallback(
          { surface: "up_next", currentEditId: 300, limit: 2 },
          hosted,
        ).edits,
      ),
      [301, 302],
    );
    const absent = await fetchRecommendations(
      { surface: "home" },
      undefined,
      youtube,
    );
    assert.deepEqual(absent.edits, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("STAGE5 out-of-order responses cannot revive a previous catalog", async () => {
  const env = setupMountedDom();
  const original = globalThis.fetch;
  const pending = [];
  let state;
  function Probe({ catalog }) {
    state = useRecommendations({ surface: "home" }, true, catalog);
    return null;
  }
  try {
    globalThis.fetch = () => new Promise((resolve) => pending.push(resolve));
    await act(async () =>
      env.root.render(React.createElement(Probe, { catalog: youtube })),
    );
    await act(async () =>
      env.root.render(React.createElement(Probe, { catalog: hosted })),
    );
    assert.equal(state.edits[0], hosted[0]);
    await act(async () =>
      pending[1]({ ok: true, json: async () => envelope(301) }),
    );
    assert.equal(state.edits[0], hosted[1]);
    await act(async () =>
      pending[0]({ ok: true, json: async () => envelope(100) }),
    );
    assert.equal(state.edits[0], hosted[1]);
  } finally {
    await env.cleanup();
    globalThis.fetch = original;
  }
});

test("STAGE5 App catalog replacement updates hero, Up Next and feed without stale records", async () => {
  const env = setupMountedDom();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false });
    await act(async () =>
      env.root.render(React.createElement(App, { initialEdits: edits })),
    );
    assert.ok(env.container.textContent.includes("Into the Light"));
    await act(async () =>
      env.root.render(React.createElement(App, { initialEdits: hosted })),
    );
    assert.ok(env.container.textContent.includes("Lolixco Uploads"));
    assert.equal(env.container.textContent.includes("Into the Light"), false);
    await act(async () =>
      env.root.render(React.createElement(App, { initialEdits: [] })),
    );
    assert.equal(env.container.querySelectorAll("video").length, 0);
    assert.ok(env.container.textContent.includes("Immersion"));
  } finally {
    await env.cleanup();
    globalThis.fetch = original;
  }
});
