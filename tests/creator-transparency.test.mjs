import test from "node:test";
import assert from "node:assert/strict";
import { publicSource } from "../src/utils/publicSource.ts";
import { createRightsCase } from "../scripts/rights-report.mjs";
test("reviewed hosted creator credit is displayed without implying channel ownership", () => {
  assert.equal(
    publicSource({
      sourceType: "licensed_local_media",
      creator: "Reviewed Editor",
    }).attribution,
    "Reviewed Editor",
  );
  for (const creator of ["", " ", "Attribution pending"])
    assert.equal(
      publicSource({ sourceType: "licensed_local_media", creator }).attribution,
      null,
    );
  assert.equal(
    publicSource({
      sourceType: "youtube_embed",
      creator: "Fallback",
      channelTitle: "",
    }).attribution,
    null,
  );
});
test("local rights cases preserve evidence and start with human review, not automatic removal", () => {
  const report = {
    contentUrl: "https://lol.golixco.com/?edit=300",
    contact: "Reporter supplied contact",
    kind: "attribution",
    claimedRights: "Editor credit",
    supportingInformation: "Source link and correction request",
  };
  const before = JSON.stringify(report),
    record = createRightsCase(report);
  assert.equal(JSON.stringify(report), before);
  assert.equal(record.status, "received");
  assert.notEqual(record.report, report);
  assert.ok(record.caseId);
  assert.equal(record.events.length, 1);
  for (const change of [
    { contentUrl: "javascript:alert(1)" },
    { contact: "" },
    { kind: "delete-everything" },
  ])
    assert.throws(() => createRightsCase({ ...report, ...change }));
});
