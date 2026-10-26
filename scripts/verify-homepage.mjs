/** Offline Stage 5 browser acceptance; run after trusted preflight in a network namespace. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
assert.ok(
  readFileSync("/proc/net/dev", "utf8")
    .split("\n")
    .filter((x) => x.includes(":"))
    .every((x) => x.trim().startsWith("lo:")),
);
assert.equal(
  readFileSync("/proc/net/route", "utf8").trim().split("\n").length,
  1,
);
const require = createRequire(
  resolve(process.env.RUNTIME_MODULES, "package.json"),
);
const { chromium } = require("playwright");
const output = resolve(
  process.env.VERIFY_OUTPUT_DIR || "../stage5-browser-evidence",
);
mkdirSync(output, { recursive: true });
const envDir = mkdtempSync(join(tmpdir(), "lolixco-home-empty-env-"));
const server = await createServer({
  configFile: false,
  envDir,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [process.cwd(), realpathSync("node_modules")] },
  },
});
await server.listen();
let browser;
const results = [],
  pageErrors = [];
const sizes = [
  [1672, 941],
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [360, 800],
];
try {
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/recommendations")
      return route.fulfill({ status: 503, body: "offline fallback" });
    if (
      url.hostname === "media.example.invalid" ||
      url.hostname === "i.ytimg.com"
    ) {
      const media = url.pathname.endsWith(".mp4");
      return route.fulfill({
        body: readFileSync(
          media
            ? "public/media/motion-study.webm"
            : "public/media/art-0.svg",
        ),
        contentType: media ? "video/webm" : "image/svg+xml",
      });
    }
    if (url.href === "https://www.youtube.com/iframe_api")
      return route.fulfill({
        body: "/* fake API */",
        contentType: "text/javascript",
      });
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const go = async (name) => {
    await page.goto(
      `http://127.0.0.1:5173/tests/browser/homepage.html?catalog=${name}`,
    );
    await page.waitForFunction(() => !!window.homepageTest);
    await page.evaluate(() => document.fonts.ready);
  };
  const fits = async () =>
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "page must not overflow horizontally",
    );
  const hero = () => page.locator(".hero-info h1");
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const name of [
      "demo",
      "youtube",
      "hosted",
      "mixed",
      "shorts",
      "empty",
    ]) {
      await go(name);
      await fits();
      const headings = await page
        .locator(".content-section > h2, .shorts-shelf h2")
        .allTextContents();
      assert.ok(
        !headings.includes("Videos from YouTube") ||
          ["youtube", "mixed"].includes(name),
      );
      assert.ok(
        !headings.includes("Lolixco Uploads") ||
          ["hosted", "mixed"].includes(name),
      );
      assert.equal(
        await page.locator(".shorts-shelf").count(),
        ["mixed", "shorts"].includes(name) ? 1 : 0,
      );
      assert.equal(
        await hero().count(),
        ["shorts", "empty"].includes(name) ? 0 : 1,
      );
      if (name === "demo")
        assert.equal(await hero().textContent(), "Into the Light");
      if (name === "hosted")
        assert.equal(await page.locator(".featured-row video").count(), 1);
      if (name === "youtube")
        assert.equal(await page.locator(".featured-row iframe").count(), 1);
      if (["mixed", "youtube", "hosted"].includes(name)) {
        const cards = await page
          .locator(".content-section .card-watch-trigger")
          .allTextContents();
        assert.equal(new Set(cards).size, cards.length);
        const labels = await page
          .locator(".content-section .source-label")
          .allTextContents();
        if (name !== "hosted") assert.ok(labels.includes("YouTube"));
        if (name !== "youtube") assert.ok(labels.includes("Lolixco"));
        for (const group of await page.locator(".content-category").all())
          assert.ok((await group.locator(".video-card").count()) > 0);
      }
      await page
        .getByRole("button", { name: "Enter Immersion", exact: true })
        .scrollIntoViewIfNeeded();
      assert.ok(
        await page
          .getByRole("button", { name: "Enter Immersion", exact: true })
          .isVisible(),
      );
      if (name === "mixed") {
        assert.ok(
          (await page.locator(".source-attribution").allTextContents()).some(
            (s) => s.includes("Synthetic channel"),
          ),
        );
        const target = page
          .locator(".content-section .card-watch-trigger")
          .first();
        const title = await target.locator("h3").textContent();
        await target.focus();
        await page.keyboard.press("Enter");
        assert.equal(await hero().textContent(), title);
        await page
          .getByRole("button", {
            name: "Watch short: Synthetic Lolixco 400",
            exact: true,
          })
          .click();
        await page.waitForSelector('[role="dialog"]');
        assert.ok(page.url().includes("short=400"));
        assert.equal(await page.locator('[role="dialog"] video').count(), 1);
        await page.keyboard.press("Escape");
        await page.waitForSelector('[role="dialog"]', { state: "detached" });
        await page
          .getByRole("button", {
            name: "Watch short: Synthetic YouTube 200",
            exact: true,
          })
          .click();
        assert.ok(page.url().includes("short=200"));
        await page.waitForSelector('[role="dialog"] iframe');
        await page.keyboard.press("Escape");
        await page.waitForSelector('[role="dialog"]', { state: "detached" });
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: join(output, `${name}-${width}x${height}.png`),
        fullPage: true,
      });
      results.push({ catalog: name, width, height, passed: true });
    }
  }
  // Catalog changes preserve canonical data, remove old players and keep navigation usable.
  await page.setViewportSize({ width: 1440, height: 900 });
  await go("demo");
  for (const name of [
    "hosted",
    "youtube",
    "shorts",
    "empty",
    "missingDemo",
    "single",
    "missingMetadata",
  ]) {
    await page.evaluate((name) => window.homepageTest.render(name), name);
    await fits();
    if (["shorts", "empty", "missingDemo"].includes(name))
      assert.equal(await hero().count(), 0);
    if (name === "single")
      assert.equal(await hero().textContent(), "Synthetic Lolixco 300");
    if (name === "missingMetadata")
      assert.ok((await page.locator(".thumbnail-fallback").count()) > 0);
  }
  results.push({
    case: "catalog replacement and missing metadata",
    passed: true,
  });
  await go("mixed");
  const shuffled = new Set();
  for (let i = 0; i < 16; i++) {
    await page
      .getByRole("button", { name: "Shuffle Edit of the Moment", exact: true })
      .click();
    shuffled.add(await hero().textContent());
  }
  assert.equal(shuffled.size, 16);
  results.push({ case: "manual shuffle covers both sources", passed: true });
  // Search routes, category/fandom and direct Short route use real App handlers.
  await page.goto(
    "http://127.0.0.1:5173/tests/browser/homepage.html?catalog=mixed&view=explore&q=%23fixture",
  );
  await page.waitForFunction(() => !!window.homepageTest);
    await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator(".content-section .video-card").count(), 16);
  assert.equal(await page.locator(".shorts-card").count(), 2);
  await page.goto(
    "http://127.0.0.1:5173/tests/browser/homepage.html?catalog=mixed&category=Anime&fandom=jujutsu-kaisen",
  );
  await page.waitForFunction(() => !!window.homepageTest);
    await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator(".content-section .video-card").count(), 4);
  await page.goto(
    "http://127.0.0.1:5173/tests/browser/homepage.html?catalog=mixed&view=shorts&short=400",
  );
  await page.waitForSelector('[role="dialog"] video');
  await page.evaluate(() => window.homepageTest.render("empty"));
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
  results.push({
    case: "search, fandom and Shorts routes; removed active Short closes",
    passed: true,
  });
  // The actual production entry still renders all 17 demos through Explore.
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForSelector(".hero-info h1");
  assert.equal(await hero().textContent(), "Into the Light");
  await page.goto("http://127.0.0.1:5173/?view=explore");
  await page.waitForSelector(".content-section");
  assert.equal(await page.locator(".content-section .video-card").count(), 17);
  results.push({ case: "production entry and all 17 demos", passed: true });
  assert.deepEqual(pageErrors, []);
  writeFileSync(
    join(output, "results.json"),
    JSON.stringify(
      {
        browser: await browser.version(),
        results,
        viewports: sizes,
        pageErrors,
        genuineYouTubeCertification: false,
      },
      null,
      2,
    ),
  );
  console.log(
    `${results.length} homepage browser cases passed across ${sizes.length} viewports`,
  );
} catch (error) {
  writeFileSync(
    join(output, "failure.json"),
    JSON.stringify({ results, pageErrors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  await server.close();
  rmSync(envDir, { recursive: true, force: true });
}
