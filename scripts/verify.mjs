import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
const outputDirectory =
  process.env.VERIFY_OUTPUT_DIR || "docs/product/verification";
mkdirSync(outputDirectory, { recursive: true });
import assert from "node:assert/strict";
const require = createRequire(process.env.RUNTIME_MODULES + "/package.json");
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({
  viewport: { width: 1672, height: 941 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
await page.waitForFunction(
  () => document.querySelector("video").readyState >= 1,
);
console.log(
  "metadata",
  await page.locator("video").evaluate((v) => ({
    duration: v.duration,
    width: v.videoWidth,
    height: v.videoHeight,
  })),
);
const sizes = [
  [1672, 941],
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [360, 800],
];
const report = [];
for (const [width, height] of sizes) {
  await page.setViewportSize({ width, height });
  await page.screenshot({
    path: `${outputDirectory}/${width}x${height}.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false, `overflow at ${width}`);
  report.push({ width, height, overflow });
}
await page.setViewportSize({ width: 1672, height: 941 });
await page.getByRole("button", { name: "Toggle navigation" }).click();
assert.equal(
  await page
    .getByRole("button", { name: "Toggle navigation" })
    .getAttribute("aria-expanded"),
  "false",
);
await page.getByRole("button", { name: "Toggle navigation" }).click();
await page
  .getByRole("textbox", { name: "Search", exact: true })
  .fill("red horizon");
await page.getByRole("button", { name: "Watch Red Horizon" }).click();
await page.waitForFunction(
  () => document.querySelector("video").readyState >= 1,
);
await page.getByRole("button", { name: "Anime", exact: true }).click();
assert.ok((await page.getByRole("button", { name: /Watch / }).count()) > 0);
await page.getByRole("button", { name: "All", exact: true }).click();
// The current discovery header has Help rather than the retired member preview.
assert.equal(
  await page.getByRole("button", { name: "Create", exact: true }).count(),
  0,
);
await page.getByRole("button", { name: "Help and shortcuts", exact: true }).click();
assert.ok(await page.getByRole("dialog", { name: "Help", exact: true }).isVisible());
await page.keyboard.press("Escape");
assert.equal(await page.getByRole("dialog").count(), 0);
await page.getByRole("button", { name: "A–B Loop", exact: true }).click();
await page.getByRole("spinbutton", { name: "Loop start seconds" }).fill("1");
await page.getByRole("spinbutton", { name: "Loop end seconds" }).fill("2");
await page.getByRole("button", { name: "Loop Segment", exact: true }).click();
await page.waitForTimeout(2900);
const t = await page.locator("video").evaluate((v) => v.currentTime);
assert.ok(t >= 1 && t < 2.1, `loop time ${t}`);
await page.getByRole("button", { name: "Exit loop" }).click();
await page.getByRole("button", { name: "Clear", exact: true }).click();
assert.ok(
  await page
    .getByRole("button", { name: "Loop Segment", exact: true })
    .isDisabled(),
);
await page.getByRole("button", { name: "A–B Loop", exact: true }).click();
await page.getByRole("button", { name: "Pause video", exact: true }).click();
await page.getByRole("button", { name: "Unmute video" }).click();
assert.equal(await page.locator("video").evaluate((v) => v.muted), false);
await page.getByRole("slider", { name: "Seek video" }).fill("5");
assert.ok(
  Math.abs((await page.locator("video").evaluate((v) => v.currentTime)) - 5) <
    0.2,
);
await page.getByRole("button", { name: "Video quality" }).click();
assert.ok(await page.getByText("540p · original source").isVisible());
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Toggle navigation" }).click();
assert.ok(await page.getByRole("dialog").isVisible());
await page.keyboard.press("Escape");
assert.equal(await page.getByRole("dialog").count(), 0);
await page.getByRole("textbox", { name: "Search", exact: true }).fill("zzzzzz");
assert.ok(await page.getByText("No matching edits").isVisible());
assert.deepEqual(errors, []);
writeFileSync(
  `${outputDirectory}/results.json`,
  JSON.stringify(
    { viewports: report, interactions: "passed", pageErrors: errors },
    null,
    2,
  ),
);
console.log("Responsive and interaction checks passed");
await browser.close();
