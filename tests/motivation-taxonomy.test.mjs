import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CategoryBar } from "../src/components/home/CategoryBar.tsx";
import { PRIMARY_CATEGORIES, normalizeCategoryCase, getFandomsForCategory } from "../src/data/fandoms.ts";
import { groupVideoCategories, composeHomeFeed } from "../src/data/feedComposition.ts";
import { searchEdits } from "../src/data/searchEngine.ts";
import { publicFixture } from "./fixtures/stage5-public-catalog.ts";
import { PRIMARY_CATEGORIES as validatorCategories, contentRecordSchema, manifestSchema, validateJsonSchema, assertPublicEditIntegrity } from "../scripts/validate-content.mjs";
import { CANONICAL_CATEGORIES as editorialCategories } from "../scripts/youtube-editorial.mjs";

const motivation = { ...publicFixture(350, "licensed_local_media", "video", "Motivation"), title: "Synthetic Training Resolve", creator: "Synthetic creator", source: "https://media.example.invalid/optimized/landscape/fixture-350.mp4", poster: "https://media.example.invalid/posters/landscape/fixture-350.webp", tags: ["motivation", "training"] };
const gaming = publicFixture(351, "licensed_local_media", "video", "Gaming");

test("Motivation has aligned frontend, schema, editorial and compiler validation contracts", () => {
  assert.ok(PRIMARY_CATEGORIES.includes("Motivation"));
  assert.ok(validatorCategories.includes("Motivation"));
  assert.ok(editorialCategories.includes("Motivation"));
  assert.equal(normalizeCategoryCase("motivation"), "Motivation");
  assert.match(renderToStaticMarkup(React.createElement(CategoryBar, { category: "Motivation", onSelectCategory: () => {} })), /Motivation/);
  assert.deepEqual(getFandomsForCategory("Motivation"), []);
  assert.deepEqual(validateJsonSchema("Motivation", contentRecordSchema.properties.category, manifestSchema), []);
  assert.doesNotThrow(() => assertPublicEditIntegrity(motivation, { approvedOrigins: ["https://media.example.invalid"] }));
  assert.throws(() => assertPublicEditIntegrity({ ...motivation, category: "Cinematic" }), /legacy category/);
});

test("Motivation appears in category grouping, source feed and searchable filters", () => {
  assert.deepEqual(groupVideoCategories([motivation, gaming]).map(x => x.title), ["Gaming", "Motivation"]);
  const sections = composeHomeFeed({ catalog: [motivation, gaming], recommendedVideos: [] });
  const uploads = sections.find(x => x.id === "lolixco-uploads");
  assert.ok(uploads.groups.some(x => x.title === "Motivation" && x.items[0].id === 350));
  assert.deepEqual(searchEdits([gaming, motivation], "training", "Motivation").map(x => x.edit.id), [350]);
  assert.deepEqual(searchEdits([gaming, motivation], "", "Motivation").map(x => x.edit.id), [350]);
  assert.deepEqual(searchEdits([gaming, motivation], "training", "Gaming"), []);
});
