import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { setupMountedDom } from "./mounted-dom.mjs";
import { playbackCoordinator as coordinator } from "../src/utils/playbackCoordinator.ts";
import VideoPlayer from "../src/components/video/VideoPlayer.tsx";
import YouTubePlayer from "../src/components/video/YouTubePlayer.tsx";
import { ShortsViewer } from "../src/components/shorts/ShortsViewer.tsx";
import ImmersionViewer from "../src/components/immersion/ImmersionViewer.tsx";
import { edits } from "../src/data/edits.ts";

const native = {
  ...edits[0],
  id: 17,
  title: "Synthetic native",
  source: "/media/motion-study.webm",
};
const embed = {
  ...native,
  id: 18,
  sourceType: "youtube_embed",
  youtubeVideoId: "aaaaaaaaaaa",
  source: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
};
const node = (env, tag) => env.container.querySelectorAll(tag)[0];
afterEach(() => {
  coordinator.reset();
  delete globalThis.YT;
});

function installYT() {
  const instances = [];
  globalThis.YT = {
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
    Player: class {
      constructor(target, config) {
        this.target = target;
        this.events = config.events;
        this.playCalls = 0;
        this.pauseCalls = 0;
        this.destroyCalls = 0;
        this.muted = true;
        instances.push(this);
      }
      playVideo() {
        this.playCalls++;
      }
      pauseVideo() {
        this.pauseCalls++;
      }
      stopVideo() {
        this.pauseCalls++;
      }
      destroy() {
        this.destroyCalls++;
      }
      mute() {
        this.muted = true;
      }
      unMute() {
        this.muted = false;
      }
      isMuted() {
        return this.muted;
      }
      emit(data) {
        this.events.onStateChange({ data });
      }
    },
  };
  return instances;
}

for (const method of ["playing", "paused", "dispose"]) {
  test(`STAGE4 lease: old ${method} cannot affect a replacement with the same id`, () => {
    let newerPaused = 0;
    const old = coordinator.registerPlayer("same", () => {});
    const newer = coordinator.registerPlayer("same", () => newerPaused++);
    assert.equal(newer.playing(), true);
    if (method === "dispose") old();
    else old[method]();
    assert.equal(coordinator.getActivePlayerId(), "same");
    assert.equal(newerPaused, 0);
    newer();
    assert.equal(newerPaused, 1);
  });
}

test("STAGE4 coordinator: unregistered events and paused mounts cannot claim ownership", () => {
  assert.equal(coordinator.notifyPlaying("missing"), false);
  const dispose = coordinator.registerPlayer("mounted", () => {});
  assert.equal(coordinator.getActivePlayerId(), null);
  dispose();
  assert.equal(dispose.playing(), false);
});

test("STAGE4 coordinator: modal reservation blocks pending featured playback without claiming audio", () => {
  let featuredPaused = 0;
  const featured = coordinator.registerPlayer(
    "featured",
    () => featuredPaused++,
  );
  const close = coordinator.acquireOverlay("viewer");
  const modal = coordinator.registerPlayer("modal", () => {}, "viewer");
  assert.equal(coordinator.getActivePlayerId(), null);
  assert.equal(featured.playing(), false);
  assert.ok(featuredPaused >= 2);
  assert.equal(modal.playing(), true);
  close();
  assert.equal(coordinator.getActivePlayerId(), null);
  assert.equal(featured.canPlay(), true);
  featured();
  modal();
});

test("STAGE4 coordinator: a new start cancels pending operations in all other surfaces", () => {
  let cancelled = 0;
  const pending = coordinator.registerPlayer("pending", () => cancelled++);
  const active = coordinator.registerPlayer("active", () => {});
  active.playing();
  assert.equal(cancelled, 1);
  pending.paused();
  assert.equal(coordinator.getActivePlayerId(), "active");
  pending();
  active();
});

test("STAGE4 component: featured native → YouTube → native resets state and removes old listeners", async () => {
  const env = setupMountedDom();
  const yt = installYT();
  await act(async () =>
    env.root.render(React.createElement(VideoPlayer, { edit: native })),
  );
  const oldVideo = node(env, "video");
  assert.ok(oldVideo);
  const initialListeners = oldVideo._listeners.get("playing").length;
  assert.ok(initialListeners >= 2);
  await act(async () =>
    env.root.render(React.createElement(VideoPlayer, { edit: embed })),
  );
  assert.equal(node(env, "video"), undefined);
  assert.equal(yt.length, 1);
  assert.equal(
    oldVideo._listeners.get("playing").length,
    initialListeners - 2,
    "Both application listeners are removed; React retains its element listener",
  );
  assert.equal(oldVideo.paused, true);
  await act(async () => yt[0].emit(1));
  assert.ok(coordinator.getActivePlayerId());
  await act(async () =>
    env.root.render(React.createElement(VideoPlayer, { edit: native })),
  );
  assert.equal(yt[0].destroyCalls, 1);
  assert.ok(node(env, "video"));
  assert.equal(coordinator.getActivePlayerId(), null);
  await env.cleanup();
});

test("STAGE4 component: late YouTube states after source change cannot call current callbacks", async () => {
  const env = setupMountedDom();
  const yt = installYT();
  let oldEnds = 0,
    newEnds = 0;
  await act(async () =>
    env.root.render(
      React.createElement(YouTubePlayer, {
        videoId: "aaaaaaaaaaa",
        coordinatorId: "embed",
        onEnded: () => oldEnds++,
      }),
    ),
  );
  const old = yt[0];
  await act(async () =>
    env.root.render(
      React.createElement(YouTubePlayer, {
        videoId: "bbbbbbbbbbb",
        coordinatorId: "embed",
        onEnded: () => newEnds++,
      }),
    ),
  );
  await act(async () => {
    yt[1].emit(1);
    old.emit(0);
    old.emit(2);
    old.events.onError({ data: 150 });
  });
  assert.equal(coordinator.getActivePlayerId(), "embed");
  assert.equal(oldEnds + newEnds, 0);
  assert.ok(!env.container.textContent.includes("does not allow"));
  await env.cleanup();
});

test("STAGE4 component: callback updates preserve the same iframe; PAUSED and ENDED release it", async () => {
  const env = setupMountedDom();
  const yt = installYT();
  let count = 0;
  await act(async () =>
    env.root.render(
      React.createElement(YouTubePlayer, {
        videoId: "aaaaaaaaaaa",
        coordinatorId: "embed",
      }),
    ),
  );
  await act(async () =>
    env.root.render(
      React.createElement(YouTubePlayer, {
        videoId: "aaaaaaaaaaa",
        coordinatorId: "embed",
        onEnded: () => count++,
      }),
    ),
  );
  assert.equal(yt.length, 1);
  await act(async () => yt[0].emit(1));
  assert.equal(coordinator.getActivePlayerId(), "embed");
  await act(async () => yt[0].emit(2));
  assert.equal(coordinator.getActivePlayerId(), null);
  await act(async () => {
    yt[0].emit(1);
    yt[0].emit(0);
  });
  assert.equal(count, 1);
  assert.equal(coordinator.getActivePlayerId(), null);
  await env.cleanup();
});

test("STAGE4 component: late API readiness after unmount never creates a player", async () => {
  const env = setupMountedDom();
  await act(async () =>
    env.root.render(
      React.createElement(YouTubePlayer, { videoId: "aaaaaaaaaaa" }),
    ),
  );
  assert.equal(document.head.childNodes.length, 1);
  await env.cleanup();
  const yt = installYT();
  window.onYouTubeIframeAPIReady();
  assert.equal(yt.length, 0);
});

test("STAGE4 component: reduced motion mounts native Shorts and Immersion paused without ownership", async () => {
  const env = setupMountedDom();
  window.matchMedia = () => ({ matches: true });
  const shorts = [{ ...native, format: "short" }];
  await act(async () =>
    env.root.render(
      React.createElement(ShortsViewer, { shorts, onClose() {} }),
    ),
  );
  assert.equal(node(env, "video")._playCalls, 0);
  assert.equal(coordinator.getActivePlayerId(), null);
  await act(async () =>
    env.root.render(
      React.createElement(ImmersionViewer, { catalog: [native], onClose() {} }),
    ),
  );
  assert.equal(node(env, "video")._playCalls, 0);
  assert.equal(coordinator.getActivePlayerId(), null);
  await env.cleanup();
});

test("STAGE4 component: native actual PLAYING claims ownership; unmount cancels delayed play", async () => {
  const env = setupMountedDom();
  await act(async () =>
    env.root.render(React.createElement(VideoPlayer, { edit: native })),
  );
  const video = node(env, "video");
  let resolve;
  video.play = () =>
    new Promise((done) => {
      resolve = done;
      video.paused = false;
    });
  await act(async () =>
    video.dispatchEvent({ type: "loadedmetadata", bubbles: false }),
  );
  assert.equal(coordinator.getActivePlayerId(), null);
  await act(async () =>
    video.dispatchEvent({ type: "playing", bubbles: false }),
  );
  assert.ok(coordinator.getActivePlayerId());
  await env.cleanup();
  video.paused = false;
  await act(async () => resolve());
  assert.equal(video.paused, true);
  assert.equal(coordinator.getActivePlayerId(), null);
});

test("STAGE4 component: an empty Shorts list does not reserve playback or lock scrolling", async () => {
  const env = setupMountedDom();
  const featured = coordinator.registerPlayer("featured", () => {});
  featured.playing();
  const overflow = document.body.style.overflow;
  await act(async () =>
    env.root.render(
      React.createElement(ShortsViewer, { shorts: [], onClose() {} }),
    ),
  );
  assert.equal(coordinator.getActivePlayerId(), "featured");
  assert.equal(document.body.style.overflow, overflow);
  await act(async () =>
    env.root.render(
      React.createElement(ShortsViewer, {
        shorts: [{ ...native, format: "short" }],
        onClose() {},
      }),
    ),
  );
  assert.equal(
    coordinator.getActivePlayerId(),
    null,
    "A later non-empty list acquires the modal reservation",
  );
  assert.equal(document.body.style.overflow, "hidden");
  await env.cleanup();
  assert.equal(document.body.style.overflow, overflow);
  featured();
});
