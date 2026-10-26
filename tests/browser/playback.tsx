/** Synthetic component harness. Never imported by the application or catalog. */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import VideoPlayer from "../../src/components/video/VideoPlayer";
import YouTubePlayer from "../../src/components/video/YouTubePlayer";
import { ShortsViewer } from "../../src/components/shorts/ShortsViewer";
import ImmersionViewer from "../../src/components/immersion/ImmersionViewer";
import { playbackCoordinator } from "../../src/utils/playbackCoordinator";
import { edits } from "../../src/data/edits";
import "../../src/styles/index.css";

const native = {
  ...edits[0],
  id: 17,
  title: "Synthetic native one",
  source: "/media/motion-study.webm",
};
const native2 = { ...native, id: 18, title: "Synthetic native two" };
const youtube = {
  ...native,
  id: 100,
  title: "Synthetic YouTube",
  sourceType: "youtube_embed" as const,
  youtubeVideoId: "aaaaaaaaaaa",
};
const youtube2 = {
  ...youtube,
  id: 101,
  youtubeVideoId: "bbbbbbbbbbb",
  title: "Synthetic YouTube two",
};
const short = { ...native, format: "short" as const };
const shortYT = { ...youtube, format: "short" as const };
const short2 = { ...native2, format: "short" as const };

const fake = {
  instances: [] as FakePlayer[],
  blockNext: false,
  deferReady: false,
  deferPlaying: false,
};
class FakePlayer {
  events: any;
  element: HTMLIFrameElement;
  destroyed = false;
  playing = false;
  muted = true;
  playCalls = 0;
  pauseCalls = 0;
  videoId: string;
  constructor(target: HTMLElement, config: any) {
    this.events = config.events;
    this.videoId = config.videoId;
    this.element = document.createElement("iframe");
    this.element.title = "Simulated official YouTube iframe";
    this.element.style.cssText = "width:100%;height:100%;border:0";
    target.replaceWith(this.element);
    fake.instances.push(this);
    if (!fake.deferReady) queueMicrotask(() => this.ready());
  }
  ready() {
    this.events.onReady();
  }
  playVideo() {
    this.playCalls++;
    if (fake.blockNext) {
      fake.blockNext = false;
      this.events.onAutoplayBlocked();
    } else if (!fake.deferPlaying) this.emit(1);
  }
  pauseVideo() {
    this.pauseCalls++;
    this.emit(2);
  }
  stopVideo() {
    this.pauseVideo();
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
  seekTo() {}
  destroy() {
    this.destroyed = true;
    this.playing = false;
    this.element.remove();
  }
  emit(data: number) {
    if (!this.destroyed) this.playing = data === 1;
    this.events.onStateChange({ data });
  }
  error(code: number) {
    this.events.onError({ data: code });
  }
}
function installFake() {
  (window as any).YT = {
    Player: FakePlayer,
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
  };
  window.onYouTubeIframeAPIReady?.();
}
if (!location.search.includes("lateApi")) installFake();
const root = createRoot(document.getElementById("root")!);
let props: any = {};
const close = () => render({ ...props, viewer: null });
function render(next: any = {}) {
  props = next;
  const featured =
    next.featured === "youtube"
      ? youtube
      : next.featured === "youtube2"
        ? youtube2
        : next.featured === "native2"
          ? native2
          : native;
  const shorts =
    next.shorts === "youtube" ? [shortYT, short2] : [short, shortYT, short2];
  const catalog =
    next.catalog === "youtube"
      ? [youtube, youtube2]
      : next.catalog === "native"
        ? [native, native2]
        : next.catalog === "single"
          ? [native]
          : [native, youtube, native2];
  const controls = (
    <>
      {next.featured !== false && (
        <VideoPlayer
          edit={featured}
          isOverlayActive={!!next.viewer || next.overlay}
        />
      )}
      {next.adapter && (
        <YouTubePlayer
          videoId={next.videoId || "aaaaaaaaaaa"}
          autoPlay={next.autoPlay}
          muted={next.muted ?? true}
          onEnded={() => {
            (window as any).ended = ((window as any).ended || 0) + 1;
          }}
        />
      )}
      {next.viewer === "shorts" && (
        <ShortsViewer shorts={shorts} onClose={close} />
      )}
      {next.viewer === "immersion" && (
        <ImmersionViewer
          catalog={catalog}
          initialContext={{ currentEditId: catalog[0].id }}
          onClose={close}
        />
      )}
    </>
  );
  flushSync(() =>
    root.render(
      next.strict ? <React.StrictMode>{controls}</React.StrictMode> : controls,
    ),
  );
}
(window as any).playbackTest = {
  render,
  close,
  fake,
  installFake,
  coordinator: playbackCoordinator,
  unmount: () => flushSync(() => root.render(null)),
  active: () => playbackCoordinator.getActivePlayerId(),
};
render({ featured: false });
