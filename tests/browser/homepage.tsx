/** Explicit synthetic public-catalog injection. Never imported by production. */
import React from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import App from "../../src/App";
import { edits } from "../../src/data/edits";
import {
  youtube,
  hosted,
  shorts,
  mixed,
} from "../fixtures/stage5-public-catalog";
import { playbackCoordinator } from "../../src/utils/playbackCoordinator";
import "../../src/styles/index.css";
// Test double only: no request to YouTube and no real embedding certification.
class FakePlayer {
  element: HTMLIFrameElement;
  events: any;
  constructor(target: HTMLElement, config: any) {
    this.events = config.events;
    this.element = document.createElement("iframe");
    this.element.title = "Synthetic YouTube player";
    this.element.style.cssText = "width:100%;height:100%;border:0";
    target.replaceWith(this.element);
    queueMicrotask(() => this.events.onReady());
  }
  playVideo() {
    this.events.onStateChange({ data: 1 });
  }
  pauseVideo() {
    this.events.onStateChange({ data: 2 });
  }
  stopVideo() {
    this.pauseVideo();
  }
  mute() {}
  unMute() {}
  isMuted() {
    return true;
  }
  seekTo() {}
  destroy() {
    this.element.remove();
  }
}
(window as any).YT = {
  Player: FakePlayer,
  PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
};
const catalogs = {
  demo: edits,
  youtube,
  hosted,
  mixed,
  shorts,
  empty: [],
  single: [hosted[0]],
  missingDemo: edits.slice(1),
  missingMetadata: [
    { ...hosted[0], poster: "" },
    { ...youtube[0], channelTitle: undefined, poster: "" },
  ],
};
const root = createRoot(document.getElementById("root")!);
function render(name: keyof typeof catalogs = "mixed") {
  flushSync(() => root.render(<App initialEdits={catalogs[name]} />));
}
(window as any).homepageTest = {
  render,
  catalogs,
  coordinator: playbackCoordinator,
};
render(
  (new URLSearchParams(location.search).get(
    "catalog",
  ) as keyof typeof catalogs) || "mixed",
);
