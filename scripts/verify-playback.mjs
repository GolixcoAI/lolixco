/** Offline real-browser component verification. See docs/product/STAGE4_PLAYBACK.md. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";

// Fail closed unless launched in a kernel network namespace with only loopback.
assert.ok(
  readFileSync("/proc/net/dev", "utf8")
    .split("\n")
    .filter((x) => x.includes(":"))
    .every((x) => x.trim().startsWith("lo:")),
  "Run in the documented isolated namespace",
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
  process.env.VERIFY_OUTPUT_DIR || "../stage4-browser-evidence",
);
mkdirSync(output, { recursive: true });
const envDir = mkdtempSync(join(tmpdir(), "lolixco-browser-empty-env-"));
const server = await createServer({
  configFile: false,
  envDir,
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
let browser;
const results = [],
  pageErrors = [];
try {
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://www.youtube.com/iframe_api")
      return route.fulfill({
        body: "/* controlled API loaded by harness */",
        contentType: "text/javascript",
      });
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await context.addInitScript(() => {
    const liveListeners = new Map();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const tracked = new Set([
      "visibilitychange",
      "keydown",
      "fullscreenchange",
    ]);
    EventTarget.prototype.addEventListener = function (
      type,
      listener,
      options,
    ) {
      if ((this === document || this === window) && tracked.has(type)) {
        if (!liveListeners.has(type)) liveListeners.set(type, new Set());
        liveListeners.get(type).add(listener);
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (
      type,
      listener,
      options,
    ) {
      if (this === document || this === window)
        liveListeners.get(type)?.delete(listener);
      return remove.call(this, type, listener, options);
    };
    const observers = new Set();
    const OriginalObserver = IntersectionObserver;
    window.IntersectionObserver = class extends OriginalObserver {
      constructor(...args) {
        super(...args);
        observers.add(this);
      }
      disconnect() {
        observers.delete(this);
        super.disconnect();
      }
    };
    const rafs = new Set(),
      raf = requestAnimationFrame,
      cancel = cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      const id = raf((time) => {
        rafs.delete(id);
        callback(time);
      });
      rafs.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      rafs.delete(id);
      cancel(id);
    };
    window.lifecycleResources = () => ({
      listeners: [...liveListeners.values()].reduce(
        (sum, set) => sum + set.size,
        0,
      ),
      observers: observers.size,
      frames: rafs.size,
    });
    const originalPlay = HTMLMediaElement.prototype.play;
    window.deferredMedia = [];
    window.deferMedia = false;
    window.rejectMedia = false;
    HTMLMediaElement.prototype.play = function () {
      if (window.rejectMedia)
        return Promise.reject(
          new DOMException("Synthetic autoplay rejection", "NotAllowedError"),
        );
      if (window.deferMedia)
        return new Promise((resolve, reject) =>
          window.deferredMedia.push({ element: this, resolve, reject }),
        );
      return originalPlay.call(this);
    };
    window.resumeDeferred = async () => {
      const pending = window.deferredMedia.splice(0);
      for (const item of pending) {
        // A stale operation resolves after its old element was disposed.
        item.resolve();
        item.element.dispatchEvent(new Event("playing"));
      }
      await Promise.resolve();
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const boot = async (query = "") => {
    await page.goto(
      `http://127.0.0.1:5173/tests/browser/playback.html${query}`,
    );
    await page.waitForFunction(() => !!window.playbackTest);
  };
  const render = (props) =>
    page.evaluate((props) => window.playbackTest.render(props), props);
  const active = () => page.evaluate(() => window.playbackTest.active());
  const mediaPaused = (selector) =>
    page.locator(selector).evaluate((v) => v.paused);
  const check = async (name, run) => {
    await boot();
    const resourcesBefore = await page.evaluate(() =>
      window.lifecycleResources(),
    );
    await run();
    await page.evaluate(() => window.playbackTest.unmount());
    assert.deepEqual(
      await page.evaluate(() => window.lifecycleResources()),
      resourcesBefore,
      "No application listeners, observers or animation frames survive unmount",
    );
    assert.equal(await active(), null);
    assert.deepEqual(pageErrors, []);
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  };

  await check(
    "Featured YouTube mounts without a native node; source switches dispose media",
    async () => {
      await render({ featured: "youtube" });
      await page.waitForSelector("iframe");
      assert.equal(await page.locator("video").count(), 0);
      assert.equal(await active(), null);
      await page.evaluate(() => window.playbackTest.fake.instances[0].emit(1));
      assert.ok(await active());
      await render({ featured: "native" });
      await page.waitForFunction(
        () => document.querySelector("video").readyState >= 1,
      );
      assert.equal(
        await page.evaluate(
          () => window.playbackTest.fake.instances[0].destroyed,
        ),
        true,
      );
      await page
        .getByRole("button", { name: "Play video", exact: true })
        .click();
      await page.waitForFunction(() => !!window.playbackTest.active());
      await render({ featured: "youtube2" });
      assert.equal(await page.locator("video").count(), 0);
      await render({ featured: "native2" });
      assert.equal(
        await page
          .getByRole("button", { name: "Loop Segment", exact: true })
          .count(),
        0,
      );
      assert.equal(await active(), null);
    },
  );

  await check(
    "Native featured controls, markers, errors and position reset for another edit",
    async () => {
      await render({ featured: "native" });
      await page.waitForFunction(
        () => document.querySelector("video").readyState >= 1,
      );
      await page.getByRole("button", { name: "A–B Loop", exact: true }).click();
      await page
        .getByRole("spinbutton", { name: "Loop start seconds" })
        .fill("1");
      await page
        .getByRole("spinbutton", { name: "Loop end seconds" })
        .fill("2");
      await page
        .getByRole("button", { name: "Loop Segment", exact: true })
        .click();
      await page.waitForFunction(() => !!window.playbackTest.active());
      await page.waitForTimeout(1300);
      const position = await page
        .locator("video")
        .evaluate((v) => v.currentTime);
      assert.ok(position >= 1 && position < 2.2);
      await render({ featured: "native2" });
      await page.waitForFunction(
        () => document.querySelector("video").readyState >= 1,
      );
      assert.ok(await mediaPaused("video"));
      await page.getByRole("button", { name: "A–B Loop", exact: true }).click();
      assert.equal(
        await page
          .getByRole("spinbutton", { name: "Loop start seconds" })
          .inputValue(),
        "",
      );
      assert.ok(
        await page
          .getByRole("button", { name: "Loop Segment", exact: true })
          .isDisabled(),
      );
    },
  );

  for (const featured of ["native", "youtube"]) {
    await check(
      `${featured} featured pauses for overlay and stays paused after close`,
      async () => {
        await render({ featured });
        if (featured === "native") {
          await page
            .getByRole("button", { name: "Play video", exact: true })
            .click();
          await page.waitForFunction(() => !!window.playbackTest.active());
        } else
          await page.evaluate(() =>
            window.playbackTest.fake.instances[0].emit(1),
          );
        await render({ featured, overlay: true });
        assert.equal(await active(), null);
        if (featured === "native") assert.ok(await mediaPaused("video"));
        else {
          await page.evaluate(() =>
            window.playbackTest.fake.instances[0].emit(1),
          );
          assert.equal(await active(), null);
        }
        await render({ featured, overlay: false });
        assert.equal(await active(), null);
      },
    );
  }

  await check(
    "Shorts reservation pauses featured; native and YouTube starts are exclusive; close stops media",
    async () => {
      await render({ featured: "native" });
      await page
        .getByRole("button", { name: "Play video", exact: true })
        .click();
      await page.waitForFunction(() => !!window.playbackTest.active());
      await render({ featured: "native", viewer: "shorts" });
      assert.ok(await mediaPaused(".player video"));
      assert.equal(await active(), null);
      await page.locator(".shorts-viewer-overlay").focus();
      await page.keyboard.press("k");
      await page.waitForFunction(() => !!window.playbackTest.active());
      await page
        .getByRole("button", { name: "Next short", exact: true })
        .click();
      assert.equal(await active(), null);
      await page.evaluate(() =>
        window.playbackTest.fake.instances.at(-1).emit(1),
      );
      assert.ok(await active());
      assert.ok(await mediaPaused(".player video"));
      await page.getByRole("button", { name: "Close shorts viewer" }).click();
      assert.equal(await active(), null);
      assert.equal(
        await page.evaluate(
          () => window.playbackTest.fake.instances.at(-1).destroyed,
        ),
        true,
      );
      assert.ok(await mediaPaused(".player video"));
    },
  );

  await check(
    "Rapid Shorts next/previous and consistent completion stop at the last Short",
    async () => {
      await render({ featured: false, viewer: "shorts" });
      for (let i = 0; i < 4; i++) {
        await page
          .getByRole("button", { name: "Next short", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Previous short", exact: true })
          .click();
      }
      await page
        .locator("video")
        .evaluate((v) => v.dispatchEvent(new Event("ended")));
      await page.waitForSelector("iframe");
      await page.evaluate(() =>
        window.playbackTest.fake.instances.at(-1).emit(0),
      );
      await page.waitForSelector("video");
      assert.ok(
        await page
          .getByRole("button", { name: "Next short", exact: true })
          .isDisabled(),
      );
      await page
        .locator("video")
        .evaluate((v) => v.dispatchEvent(new Event("ended")));
      assert.equal(
        await page.locator(".shorts-viewer-index").textContent(),
        "3 / 3",
      );
      assert.equal(await active(), null);
      assert.equal(await page.locator("video").evaluate((v) => v.loop), false);
    },
  );

  await check(
    "Deferred native play after navigation/unmount cannot resume or pause a replacement",
    async () => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => {
        window.deferMedia = true;
      });
      await render({ featured: false, viewer: "shorts" });
      await page.waitForFunction(() => window.deferredMedia.length > 0);
      await page
        .getByRole("button", { name: "Next short", exact: true })
        .click();
      await page.waitForFunction(() => !!window.playbackTest.active());
      const owner = await active();
      await page.evaluate(() => window.resumeDeferred());
      assert.equal(await active(), owner);
      await page
        .getByRole("button", { name: "Next short", exact: true })
        .click();
      await page.waitForFunction(() => window.deferredMedia.length > 0);
      await page.evaluate(() => window.playbackTest.unmount());
      await page.evaluate(() => window.resumeDeferred());
      assert.equal(await active(), null);
      await page.emulateMedia({ reducedMotion: "reduce" });
    },
  );

  await check(
    "Immersion mixed navigation, completion, sound, close and focus restoration",
    async () => {
      await page.locator("#opener").focus();
      await render({ featured: "youtube", viewer: "immersion" });
      assert.equal(await active(), null);
      assert.equal(
        await page
          .locator(".immersion-overlay")
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.press("k");
      await page.waitForFunction(() => !!window.playbackTest.active());
      await page
        .getByRole("button", { name: "Unmute audio (m)", exact: true })
        .first()
        .click();
      assert.equal(await page.locator("video").evaluate((v) => v.muted), false);
      await page
        .locator("video")
        .evaluate((v) => v.dispatchEvent(new Event("ended")));
      await page.waitForFunction(
        () => window.playbackTest.fake.instances.length >= 2,
      );
      for (let i = 0; i < 3; i++) {
        await page
          .getByRole("button", { name: "Previous edit (Left Arrow)" })
          .click();
        await page
          .getByRole("button", { name: "Next edit (Right Arrow)" })
          .click();
      }
      await page.evaluate(() =>
        window.playbackTest.fake.instances.at(-1).emit(1),
      );
      assert.ok(await active());
      await page
        .getByRole("button", { name: "Exit Immersion Mode (Esc)" })
        .click();
      assert.equal(await active(), null);
      await page.waitForFunction(
        () => document.activeElement === document.getElementById("opener"),
      );
    },
  );

  await check(
    "Immersion native rejection offers explicit resume and bounded errors stop recovery",
    async () => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => {
        window.rejectMedia = true;
      });
      await render({ featured: false, viewer: "immersion", catalog: "native" });
      await page.getByRole("button", { name: "Continue Playback" }).waitFor();
      assert.equal(await active(), null);
      await page.evaluate(() => {
        window.rejectMedia = false;
      });
      await page.getByRole("button", { name: "Continue Playback" }).click();
      await page.waitForFunction(() => !!window.playbackTest.active());
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (let i = 0; i < 4; i++) {
        await page
          .locator("video")
          .evaluate((v) => v.dispatchEvent(new Event("error")));
      }
      await page
        .getByText("Queue Playback Complete", { exact: true })
        .waitFor();
      assert.equal(await page.locator("video").count(), 0);
      assert.equal(await active(), null);
      await page.getByRole("button", { name: "Restart Immersion" }).click();
      await page.waitForSelector("video");
    },
  );

  await check(
    "Single-item Immersion session remounts on completion and bounds repeat failures",
    async () => {
      await render({ featured: false, viewer: "immersion", catalog: "single" });
      await page.locator("video").evaluate((v) => {
        window.oldVideo = v;
        v.dispatchEvent(new Event("ended"));
      });
      assert.equal(
        await page.locator("video").evaluate((v) => v !== window.oldVideo),
        true,
      );
      for (let i = 0; i < 4; i++)
        await page
          .locator("video")
          .evaluate((v) => v.dispatchEvent(new Event("error")));
      await page
        .getByText("Queue Playback Complete", { exact: true })
        .waitFor();
    },
  );

  await check(
    "YouTube blocked autoplay, resume, mute props, errors and canonical fallback",
    async () => {
      await page.evaluate(() => {
        window.playbackTest.fake.blockNext = true;
      });
      await render({ featured: false, adapter: true, autoPlay: true });
      await page.getByRole("button", { name: "Resume Playback" }).waitFor();
      assert.equal(await active(), null);
      await page.getByRole("button", { name: "Resume Playback" }).click();
      assert.ok(await active());
      await render({
        featured: false,
        adapter: true,
        autoPlay: true,
        muted: false,
      });
      assert.equal(
        await page.evaluate(() => window.playbackTest.fake.instances.length),
        1,
      );
      assert.equal(
        await page.evaluate(() => window.playbackTest.fake.instances[0].muted),
        false,
      );
      for (const code of [100, 101, 150, 2]) {
        await page.evaluate(
          (code) => window.playbackTest.fake.instances[0].error(code),
          code,
        );
        assert.equal(await active(), null);
        const fallback = page.getByRole("link", { name: "Watch on YouTube" });
        assert.equal(
          await fallback.getAttribute("href"),
          "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        );
        assert.equal(await fallback.getAttribute("rel"), "noopener noreferrer");
      }
    },
  );

  await check(
    "YouTube identity switches discard stale callbacks and preserve React host",
    async () => {
      await render({ featured: false, adapter: true });
      await render({ featured: false, adapter: true, videoId: "bbbbbbbbbbb" });
      assert.equal(await page.locator("iframe").count(), 1);
      await page.evaluate(() => {
        const [old, current] = window.playbackTest.fake.instances;
        current.emit(1);
        old.emit(0);
        old.emit(2);
        old.error(150);
        old.ready();
      });
      assert.ok(await active());
      assert.equal(await page.evaluate(() => window.ended || 0), 0);
      assert.equal(
        await page.getByRole("link", { name: "Watch on YouTube" }).count(),
        0,
      );
    },
  );

  await check(
    "Latest overlay intent prevents late iframe readiness autoplay",
    async () => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => {
        window.playbackTest.fake.deferReady = true;
      });
      await render({ featured: "youtube" });
      await render({ featured: "youtube", overlay: true });
      await page.evaluate(() => window.playbackTest.fake.instances[0].ready());
      assert.equal(
        await page.evaluate(
          () => window.playbackTest.fake.instances[0].playCalls,
        ),
        0,
      );
      assert.equal(await active(), null);
      await page.emulateMedia({ reducedMotion: "reduce" });
    },
  );

  await check(
    "Native unavailable media, retry, fullscreen rejection and visibility pause",
    async () => {
      await render({ featured: "native" });
      await page.locator("video").evaluate((v) => {
        v.src = "/media/missing-stage4.webm";
        v.load();
      });
      await page.getByRole("button", { name: "Retry video" }).waitFor();
      await page.evaluate(() => {
        const v = document.querySelector("video");
        v.src = "/media/motion-study.webm";
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent === "Retry video")
          .click();
      });
      await page.waitForFunction(
        () => document.querySelector("video").readyState >= 1,
      );
      await page.evaluate(() => {
        document.querySelector(".player").requestFullscreen = () =>
          Promise.reject(new Error("Denied"));
      });
      await page
        .getByRole("button", { name: "Fullscreen", exact: true })
        .click();
      await page
        .getByText("Fullscreen is unavailable in this browser.")
        .waitFor();
      await page.locator(".player").focus();
      await page.keyboard.press("k");
      await page.waitForFunction(() => !!window.playbackTest.active());
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await active(), null);
      assert.ok(await mediaPaused("video"));
    },
  );

  await check(
    "Modal focus trap and native button keyboard actions do not trigger duplicate shortcuts",
    async () => {
      await page.locator("#opener").focus();
      await render({ featured: false, viewer: "shorts" });
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "Next short", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "Play short", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.activeElement === document.getElementById("opener"),
      );
      await render({ featured: false, viewer: "immersion", catalog: "native" });
      await page
        .getByRole("button", { name: "Play (Space)", exact: true })
        .focus();
      await page.keyboard.press("Space");
      await page.waitForFunction(() => !!window.playbackTest.active());
      assert.ok(!(await mediaPaused("video")));
    },
  );

  await check(
    "Save-data suppresses native and YouTube viewer autoplay",
    async () => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() =>
        Object.defineProperty(navigator, "connection", {
          configurable: true,
          value: { saveData: true },
        }),
      );
      await render({ featured: false, viewer: "shorts" });
      assert.ok(await mediaPaused("video"));
      assert.equal(await active(), null);
      await page
        .getByRole("button", { name: "Next short", exact: true })
        .click();
      assert.equal(
        await page.evaluate(
          () => window.playbackTest.fake.instances[0].playCalls,
        ),
        0,
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
    },
  );

  await check(
    "StrictMode teardown and replay dispose each iframe once",
    async () => {
      await render({ featured: "youtube", strict: true });
      await page.waitForSelector("iframe");
      assert.equal(await page.locator("iframe").count(), 1);
      await page.evaluate(() => window.playbackTest.unmount());
      assert.equal(
        await page.evaluate(() =>
          window.playbackTest.fake.instances.every((p) => p.destroyed),
        ),
        true,
      );
    },
  );

  await check(
    "A cancelled pending iframe start cannot steal ownership from native playback",
    async () => {
      await page.evaluate(() => {
        window.playbackTest.fake.deferPlaying = true;
      });
      await render({ featured: "native", adapter: true, autoPlay: true });
      assert.equal(await active(), null);
      await page
        .getByRole("button", { name: "Play video", exact: true })
        .click();
      await page.waitForFunction(() => !!window.playbackTest.active());
      const owner = await active();
      await page.waitForFunction(
        () => window.playbackTest.fake.instances[0].destroyed,
      );
      await page.evaluate(() => window.playbackTest.fake.instances[0].emit(1));
      assert.equal(await active(), owner);
      assert.ok(!(await mediaPaused("video")));
      assert.equal(
        await page.evaluate(
          () => window.playbackTest.fake.instances.at(-1).playCalls,
        ),
        0,
      );
    },
  );

  await check(
    "YouTube Shorts error preserves attribution and retry recreates a working player",
    async () => {
      await render({ featured: false, viewer: "shorts", shorts: "youtube" });
      await page.evaluate(() =>
        window.playbackTest.fake.instances[0].error(150),
      );
      await page.getByRole("link", { name: "Watch on YouTube" }).waitFor();
      await page
        .getByRole("button", { name: "Retry playback", exact: true })
        .click();
      await page.waitForFunction(
        () => window.playbackTest.fake.instances.length === 2,
      );
      assert.equal(
        await page.evaluate(
          () => window.playbackTest.fake.instances[0].destroyed,
        ),
        true,
      );
      await page.evaluate(() => window.playbackTest.fake.instances[1].emit(1));
      assert.ok(await active());
    },
  );

  await check(
    "Invalid YouTube identity shows a safe error without constructing an iframe",
    async () => {
      await render({
        featured: false,
        adapter: true,
        videoId: "bad&id=<invalid>",
      });
      await page.getByText("Invalid YouTube video ID parameter.").waitFor();
      assert.equal(await page.locator("iframe").count(), 0);
      assert.equal(await active(), null);
      assert.equal(
        await page
          .getByRole("link", { name: "Watch on YouTube" })
          .getAttribute("href"),
        "https://www.youtube.com/watch?v=bad%26id%3D%3Cinvalid%3E",
      );
    },
  );

  // API loader test needs a fresh module instance and intentionally delayed API availability.
  await boot("?lateApi=1");
  await render({ featured: "youtube", adapter: true });
  assert.equal(
    await page
      .locator('script[src="https://www.youtube.com/iframe_api"]')
      .count(),
    1,
  );
  await page.evaluate(() => window.playbackTest.unmount());
  await page.evaluate(() => window.playbackTest.installFake());
  assert.equal(
    await page.evaluate(() => window.playbackTest.fake.instances.length),
    0,
  );
  results.push({
    name: "Shared API loads once; late readiness after all unmounts creates no players",
    passed: true,
  });

  // Existing seven viewports, with the production application and local demo media.
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 1,
  );
  const viewports = [];
  for (const [width, height] of [
    [1672, 941],
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
    await page.screenshot({
      path: join(output, `${width}x${height}.png`),
      fullPage: true,
    });
    viewports.push({ width, height, overflow: false });
  }
  for (const viewport of viewports) {
    const { width, height } = viewport;
    await boot();
    await page.setViewportSize({ width, height });
    for (const viewer of ["shorts", "immersion"]) {
      await render({ featured: false, viewer, catalog: "native" });
      await page.waitForFunction(
        () => document.querySelector("video")?.readyState >= 1,
      );
      const dialog = page.getByRole("dialog");
      const bounds = await dialog.boundingBox();
      assert.ok(
        bounds.x >= -1 &&
          bounds.y >= -1 &&
          bounds.width <= width + 1 &&
          bounds.height <= height + 1,
        `${viewer} fits ${width}x${height}`,
      );
      const controlsFit = await page
        .locator(
          ".shorts-control-btn, .shorts-nav-arrow, .immersion-controls button, .immersion-top-actions button",
        )
        .evaluateAll((buttons) =>
          buttons.every((button) => {
            const bounds = button.getBoundingClientRect();
            return (
              bounds.width >= 38 &&
              bounds.height >= 38 &&
              bounds.x >= 0 &&
              bounds.right <= innerWidth &&
              bounds.y >= 0 &&
              bounds.bottom <= innerHeight
            );
          }),
        );
      assert.ok(
        controlsFit,
        `${viewer} controls are visible and inside ${width}x${height}`,
      );
      await dialog.focus();
      await page.keyboard.press("Shift+Tab");
      assert.ok(
        await dialog.evaluate(
          (el) =>
            el !== document.activeElement &&
            el.contains(document.activeElement) &&
            document.activeElement.getClientRects().length > 0,
        ),
      );
      viewport[`${viewer}Fits`] = true;
      await page.screenshot({
        path: join(output, `${viewer}-${width}x${height}.png`),
      });
      await page.evaluate(() => window.playbackTest.unmount());
    }
  }
  assert.deepEqual(pageErrors, []);
  writeFileSync(
    join(output, "results.json"),
    JSON.stringify(
      {
        browser: await browser.version(),
        cases: results,
        viewports,
        pageErrors,
        genuineYouTubeCertification: false,
      },
      null,
      2,
    ),
  );
  console.log(
    `${results.length} browser lifecycle cases and ${viewports.length} viewports passed`,
  );
} catch (error) {
  writeFileSync(
    join(output, "failure.json"),
    JSON.stringify(
      { completed: results, pageErrors, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  await server.close();
  rmSync(envDir, { recursive: true, force: true });
}
