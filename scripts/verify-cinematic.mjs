/** Offline browser regression; run in an isolated network namespace.
 * RUNTIME_MODULES points at an existing installation containing playwright.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  readFileSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "vite";
assert.ok(
  readFileSync("/proc/net/dev", "utf8")
    .split("\n")
    .filter((x) => x.includes(":"))
    .every((x) => x.trim().startsWith("lo:")),
);
const { chromium } = createRequire(
  resolve(process.env.RUNTIME_MODULES, "package.json"),
)("playwright");
const output = resolve(process.env.VERIFY_OUTPUT_DIR || "../stage9-browser");
mkdirSync(output, { recursive: true });
const envDir = mkdtempSync(join(tmpdir(), "lolixco-cinematic-"));
const server = await createServer({
  configFile: false,
  envDir,
  server: {
    host: "127.0.0.1",
    port: 5189,
    strictPort: true,
    fs: { allow: [process.cwd(), realpathSync("node_modules")] },
  },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const source of ["native", "youtube"])
    for (const reducedMotion of ["no-preference", "reduce"]) {
      console.log("Checking", source, reducedMotion);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        reducedMotion,
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1"
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("http://127.0.0.1:5189/tests/browser/playback.html");
      await page.evaluate(
        (source) => window.playbackTest.render({ featured: source }),
        source,
      );
      await page.waitForSelector(".shuffle-moment-btn");
      if (source === "native") {
        await page.waitForFunction(
          () => document.querySelector("video")?.readyState >= 1,
        );
        await page
          .getByRole("button", { name: "Play video", exact: true })
          .click();
      } else
        await page.evaluate(() =>
          window.playbackTest.fake.instances.at(-1).playVideo(),
        );
      await page.mouse.move(700, 50);
      const info = page.locator(".hero-info");
      const shuffle = page.getByRole("button", {
        name: "Shuffle Edit of the Moment",
      });
      await page.waitForTimeout(3400);
      assert.equal(
        await info.evaluate((e) => getComputedStyle(e).opacity),
        "0",
      );
      assert.equal(
        await shuffle.evaluate((e) => getComputedStyle(e).pointerEvents),
        "none",
      );
      assert.equal(
        await shuffle.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return (
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
            e
          );
        }),
        false,
      );
      await page.screenshot({
        path: join(output, `${source}-${reducedMotion}-hidden.png`),
      });
      // A hidden action remains in keyboard navigation and reveals the entire group.
      await page.locator(".player").focus();
      for (
        let tab = 0;
        tab < 8 &&
        !(await shuffle.evaluate((e) => e === document.activeElement));
        tab++
      )
        await page.keyboard.press("Tab");
      assert.equal(
        await shuffle.evaluate((e) => e === document.activeElement),
        true,
      );
      await page.waitForTimeout(300);
      assert.equal(
        await info.evaluate((e) => getComputedStyle(e).opacity),
        "1",
      );
      await page.waitForTimeout(3400);
      assert.equal(
        await info.evaluate((e) => getComputedStyle(e).opacity),
        "1",
      );
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.shuffleCalls), 1);
      assert.equal(
        await page.locator(".player").getAttribute("data-info-hidden"),
        "false",
      );
      // Renew activity window, then verify pause and touch reveals.
      if (source === "native")
        await page.evaluate(() => document.querySelector("video").play());
      await page.locator(".player").focus();
      await page.mouse.move(800, 60);
      await page.waitForTimeout(3400);
      await page.mouse.move(0, 0);
      await page.locator(".player").hover({ position: { x: 20, y: 20 } });
      assert.equal(
        await page.locator(".player").getAttribute("data-info-hidden"),
        "false",
      );
      await page.locator(".player").dispatchEvent("touchstart");
      assert.equal(
        await page.locator(".player").getAttribute("data-info-hidden"),
        "false",
      );
      if (source === "native")
        await page.evaluate(() => document.querySelector("video").pause());
      else
        await page.evaluate(() =>
          window.playbackTest.fake.instances.at(-1).pauseVideo(),
        );
      await page.waitForTimeout(3400);
      assert.equal(
        await page.locator(".player").getAttribute("data-info-hidden"),
        "false",
      );
      if (source === "native") {
        const watch = await page.locator(".watch").boundingBox(),
          rail = await page.locator(".timeline").boundingBox();
        assert.ok(
          watch.y + watch.height < rail.y,
          "Watch Now must remain clear of seek rail",
        );
        await page
          .getByRole("button", { name: "Fullscreen", exact: true })
          .click();
        await page.waitForFunction(() => !!document.fullscreenElement);
        await page.evaluate(() => document.exitFullscreen());
      }
      assert.deepEqual(errors, []);
      results.push({ source, reducedMotion, passed: true });
      await context.close();
    }
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await page.goto("http://127.0.0.1:5189/tests/browser/playback.html");
    await page.evaluate(() =>
      window.playbackTest.render({
        featured: false,
        viewer: "shorts",
        shorts: "youtube",
      }),
    );
    const header = await page.locator(".shorts-viewer-header").boundingBox();
    const frame = await page.locator(".shorts-viewer-frame").boundingBox();
    assert.ok(
      header.y >= 0 &&
        header.x >= 0 &&
        header.x + header.width <= viewport.width + 1,
    );
    assert.ok(
      header.y + header.height <= frame.y + 1,
      "Shorts header must remain above the iframe",
    );
    await page.screenshot({
      path: join(output, `shorts-${viewport.width}.png`),
    });
    results.push({ shortsViewport: viewport, passed: true });
    await page.close();
  }
  if (process.env.STAGE9_YOUTUBE_AUDIT || process.env.STAGE9_HOSTED_AUDIT) {
    const { reviewStage9 } = await import("./stage9-catalog-readiness.mjs");
    const { result, report } = await reviewStage9(
      ...["STAGE9_YOUTUBE_AUDIT", "STAGE9_HOSTED_AUDIT"].map((k) =>
        JSON.parse(readFileSync(process.env[k], "utf8")),
      ),
    );
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await page.goto(
      "http://127.0.0.1:5189/tests/browser/homepage.html?catalog=empty",
    );
    await page.evaluate(
      (catalog) => window.homepageTest.renderCatalog(catalog),
      result.catalog,
    );
    await page.waitForSelector(".hero-info h1");
    const titles = await page
      .locator(".hero-info h1, .video-card h3, .shorts-card h3")
      .allTextContents();
    for (const demo of result.catalog.slice(0, 17))
      assert.ok(
        !titles.includes(demo.title),
        `Protected demo must not be discoverable: ${demo.id}`,
      );
    assert.ok((await page.locator(".shorts-card").count()) > 0);
    const title = await page.locator(".hero-info h1").innerText();
    await page
      .getByRole("button", { name: "Shuffle Edit of the Moment" })
      .click();
    assert.notEqual(await page.locator(".hero-info h1").innerText(), title);
    await page.screenshot({ path: join(output, "approved-28-homepage.png") });
    await page.getByRole("button", { name: "Motivation", exact: true }).click();
    await page.waitForTimeout(250);
    assert.ok(
      (await page.locator("body").innerText()).includes("David Goggins"),
    );
    results.push({
      approvedCatalog: report,
      discovery:
        "No demo titles; Shorts present; Shuffle rotates; Motivation works",
      passed: true,
    });
    await page.close();
  }
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await server.close();
  rmSync(envDir, { recursive: true, force: true });
}
