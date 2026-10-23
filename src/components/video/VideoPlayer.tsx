import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Repeat2,
  Settings2,
  PictureInPicture2,
  Award,
  Shuffle,
} from "lucide-react";
import type { Edit } from "../../data/edits";
import { validLoop, loopSeek } from "../../data/logic.js";
import { YouTubePlayer } from "./YouTubePlayer";
const time = (n: number) =>
  `${Math.floor(n / 60)}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
export default function VideoPlayer({
  edit,
  isOverlayActive,
  onShuffle,
}: {
  edit: Edit;
  isOverlayActive?: boolean;
  onShuffle?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    container = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(true),
    [duration, setDuration] = useState(0),
    [position, setPosition] = useState(0),
    [buffered, setBuffered] = useState(0),
    [error, setError] = useState(""),
    [waiting, setWaiting] = useState(false),
    [menu, setMenu] = useState(""),
    [a, setA] = useState<number | null>(null),
    [b, setB] = useState<number | null>(null),
    [loop, setLoop] = useState(false),
    [notice, setNotice] = useState(""),
    [quality, setQuality] = useState("");
  const state = useRef({ a, b, loop });
  state.current = { a, b, loop };
  const valid = a !== null && b !== null && validLoop(a, b, duration);
  const overlayActiveRef = useRef(!!isOverlayActive);
  const playRequestId = useRef(0);

  useEffect(() => {
    const v = video.current!;
    let frame = 0;
    const update = () => {
      const s = state.current;
      const next = loopSeek(v.currentTime, s.a, s.b, s.loop);
      if (next !== v.currentTime) v.currentTime = next;
      setPosition(v.currentTime);
      frame = requestAnimationFrame(update);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const stop = () => cancelAnimationFrame(frame);
    v.addEventListener("play", start);
    v.addEventListener("pause", stop);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) v.pause();
      },
      { threshold: 0.1 },
    );
    observer.observe(v);
    const hide = () => {
      if (document.hidden) v.pause();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", hide);
      v.removeEventListener("play", start);
      v.removeEventListener("pause", stop);
    };
  }, []);

  // Guarantee background video pauses when modal overlay is active (e.g. ShortsViewer)
  useEffect(() => {
    overlayActiveRef.current = !!isOverlayActive;
    if (isOverlayActive) {
      playRequestId.current++;
      if (video.current) {
        video.current.pause();
      }
      setPlaying(false);
    }
  }, [isOverlayActive]);

  async function play() {
    if (isOverlayActive || overlayActiveRef.current) return;
    const req = ++playRequestId.current;
    try {
      await video.current!.play();
      if (req === playRequestId.current && !overlayActiveRef.current && !isOverlayActive) {
        setNotice("");
      } else if ((overlayActiveRef.current || isOverlayActive) && video.current) {
        video.current.pause();
      }
    } catch {
      if (req === playRequestId.current && !overlayActiveRef.current && !isOverlayActive) {
        setNotice(
          "Playback could not start. Try again or reload the local media.",
        );
      }
    }
  }
  function seek(n: number) {
    const v = video.current!;
    v.currentTime = Math.max(
      0,
      Math.min(
        duration,
        loop && valid ? Math.max(a!, Math.min(b! - 0.05, n)) : n,
      ),
    );
    setPosition(v.currentTime);
  }
  function setMarker(which: "a" | "b", n: number) {
    const clamped = Math.max(0, Math.min(duration, n));
    setLoop(false);
    if (which === "a") setA(clamped);
    else setB(clamped);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.current!.requestFullscreen();
    } catch {
      setNotice("Fullscreen is unavailable in this browser.");
    }
  }
  if (edit.sourceType === "youtube_embed" && edit.youtubeVideoId) {
    return (
      <div
        ref={container}
        className="player youtube-featured"
        tabIndex={0}
        aria-label={`${edit.title} video player`}
      >
        <YouTubePlayer
          videoId={edit.youtubeVideoId}
          title={edit.title}
          poster={edit.poster}
          aspectRatio="16:9"
          autoPlay={!isOverlayActive}
          controls={true}
        />
        <div className="player-shade" style={{ pointerEvents: "none" }} />
        <div className="hero-info" style={{ pointerEvents: "none" }}>
          <span className="eyebrow">
            <Award size={15} /> EDIT OF THE MOMENT
            {onShuffle && (
              <button
                type="button"
                className="shuffle-moment-btn"
                style={{ pointerEvents: "auto", position: "relative", zIndex: 10, cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onShuffle();
                }}
                title="Shuffle Edit of the Moment"
                aria-label="Shuffle Edit of the Moment"
              >
                <Shuffle size={13} /> Shuffle
              </button>
            )}
          </span>
          <h1>{edit.title}</h1>
          <div className="hero-meta">
            <span>{edit.category} · Curated edit</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={container}
      className={`player ${playing ? "playing" : ""}`}
      tabIndex={0}
      aria-label={`${edit.title} video player`}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("button,input,select")) return;
        if ([" ", "k", "m", "f", "ArrowLeft", "ArrowRight"].includes(e.key))
          e.preventDefault();
        if (e.key === " " || e.key === "k") {
          if (isOverlayActive || overlayActiveRef.current) return;
          playing ? video.current!.pause() : void play();
        }
        if (e.key === "m") video.current!.muted = !muted;
        if (e.key === "f") void fullscreen();
        if (e.key === "ArrowLeft") seek(position - 5);
        if (e.key === "ArrowRight") seek(position + 5);
      }}
    >
      <video
        ref={video}
        src={edit.source}
        poster={edit.poster}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={() => {
          setError("");
          const v = video.current!;
          setDuration(v.duration);
          setQuality(`${v.videoHeight}p · original source`);
          const save = typeof navigator !== "undefined" && (
            navigator as Navigator & { connection?: { saveData?: boolean } }
          ).connection?.saveData;
          if (
            !isOverlayActive &&
            !overlayActiveRef.current &&
            !matchMedia("(prefers-reduced-motion: reduce)").matches &&
            !save
          ) {
            const req = ++playRequestId.current;
            v.play()
              .then(() => {
                if ((overlayActiveRef.current || isOverlayActive) && video.current) {
                  video.current.pause();
                }
              })
              .catch(() => {});
          }
        }}
        onPlay={() => {
          if (overlayActiveRef.current || isOverlayActive) {
            video.current?.pause();
            setPlaying(false);
            return;
          }
          setPlaying(true);
          setWaiting(false);
        }}
        onPause={() => setPlaying(false)}
        onVolumeChange={() => setMuted(video.current!.muted)}
        onTimeUpdate={() => {
          const v = video.current!;
          const next = loopSeek(v.currentTime, a, b, loop);
          if (next !== v.currentTime) v.currentTime = next;
          setPosition(v.currentTime);
        }}
        onProgress={() => {
          const v = video.current!;
          if (v.buffered.length)
            setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onEnded={() => {
          if (!overlayActiveRef.current && !isOverlayActive && loop && valid) {
            seek(a!);
            void play();
          } else setPlaying(false);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onError={() => {
          setError("Demo video unavailable. Retry to load the local clip.");
          setWaiting(false);
        }}
      />
      <div className="player-shade" />
      <div className="hero-info">
        <span className="eyebrow">
          <Award size={15} /> EDIT OF THE MOMENT
          {onShuffle && (
            <button
              type="button"
              className="shuffle-moment-btn"
              style={{ pointerEvents: "auto", position: "relative", zIndex: 10, cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onShuffle();
              }}
              title="Shuffle Edit of the Moment"
              aria-label="Shuffle Edit of the Moment"
            >
              <Shuffle size={13} /> Shuffle
            </button>
          )}
        </span>
        <h1>{edit.title}</h1>
        <div className="hero-meta">
          <span>{edit.category} · Sample edit</span>
        </div>
        <button
          className="primary watch"
          onClick={() => {
            if (isOverlayActive || overlayActiveRef.current) return;
            playing ? video.current!.pause() : void play();
          }}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}{" "}
          {playing ? "Pause" : "Watch Now"}
        </button>
      </div>
      {(error || waiting) && (
        <div role="status" className="player-status">
          {error || "Buffering…"}
          {error && (
            <button
              onClick={() => {
                setError("");
                setWaiting(true);
                video.current!.load();
              }}
            >
              Retry video
            </button>
          )}
        </div>
      )}
      <div className="player-bottom">
        {notice && (
          <p role="status" className="player-notice">
            {notice}
          </p>
        )}
        {menu && (
          <div className="player-menu">
            {menu === "loop" ? (
              <>
                <strong>A–B Loop</strong>
                <div className="loop-actions">
                  <button
                    disabled={!duration}
                    onClick={() => setMarker("a", position)}
                  >
                    Set Start (A)
                  </button>
                  <button
                    disabled={!duration}
                    onClick={() => setMarker("b", position)}
                  >
                    Set End (B)
                  </button>
                </div>
                <div className="loop-inputs">
                  <label>
                    A{" "}
                    <input
                      aria-label="Loop start seconds"
                      type="number"
                      min="0"
                      max={duration}
                      step="0.1"
                      value={a ?? ""}
                      onChange={(e) =>
                        e.target.value === ""
                          ? setA(null)
                          : setMarker("a", +e.target.value)
                      }
                    />
                  </label>
                  <label>
                    B{" "}
                    <input
                      aria-label="Loop end seconds"
                      type="number"
                      min="0"
                      max={duration}
                      step="0.1"
                      value={b ?? ""}
                      onChange={(e) =>
                        e.target.value === ""
                          ? setB(null)
                          : setMarker("b", +e.target.value)
                      }
                    />
                  </label>
                </div>
                <p>
                  {valid
                    ? `${time(a!)} → ${time(b!)}`
                    : "Choose A before B, at least 0.5 seconds apart."}
                </p>
                <div className="loop-actions">
                  <button
                    className={loop ? "primary" : ""}
                    disabled={!valid}
                    aria-pressed={loop}
                    onClick={() => {
                      setLoop(!loop);
                      if (!loop) {
                        video.current!.currentTime = a!;
                        void play();
                      }
                    }}
                  >
                    {loop ? "Exit loop" : "Loop Segment"}
                  </button>
                  <button
                    onClick={() => {
                      setA(null);
                      setB(null);
                      setLoop(false);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : (
              <>
                <strong>Quality</strong>
                <p>{quality || "Waiting for video metadata"}</p>
                <small>One local source. No adaptive streaming.</small>
              </>
            )}
          </div>
        )}
        <div className="timeline">
          <div
            className="buffer"
            style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }}
          />
          {a !== null && b !== null && valid && (
            <div
              className="loop-region"
              style={{
                left: `${(a / duration) * 100}%`,
                width: `${((b - a) / duration) * 100}%`,
              }}
            />
          )}
          {duration > 0 && a !== null && (
            <button
              className="marker"
              aria-label="Seek to loop start A"
              onClick={() => seek(a)}
              style={{ left: `${(a / duration) * 100}%` }}
            >
              A
            </button>
          )}
          {duration > 0 && b !== null && (
            <button
              className="marker"
              aria-label="Seek to loop end B"
              onClick={() => seek(b)}
              style={{ left: `${(b / duration) * 100}%` }}
            >
              B
            </button>
          )}
          <input
            aria-label="Seek video"
            type="range"
            min="0"
            max={duration || 1}
            step="0.01"
            value={position}
            disabled={!duration || !!error}
            style={{
              background: `linear-gradient(to right,var(--yellow) ${duration ? (position / duration) * 100 : 0}%,transparent 0)`,
            }}
            onChange={(e) => seek(+e.target.value)}
          />
        </div>
        <div className="controls">
          <button
            className="icon-button"
            disabled={!!error}
            aria-label={playing ? "Pause video" : "Play video"}
            title="Play / Pause (K)"
            onClick={() => (playing ? video.current!.pause() : void play())}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button
            className="icon-button"
            aria-label={muted ? "Unmute video" : "Mute video"}
            title="Mute (M)"
            onClick={() => (video.current!.muted = !muted)}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
          <span className="time">
            {time(position)} / {time(duration)}
          </span>
          <div className="control-spacer" />
          <button
            className={`icon-button ${loop ? "accent" : ""}`}
            aria-label="A–B Loop"
            aria-expanded={menu === "loop"}
            title="A–B Loop"
            onClick={() => setMenu(menu === "loop" ? "" : "loop")}
          >
            <Repeat2 />
          </button>
          <button
            className="icon-button"
            aria-label="Video quality"
            aria-expanded={menu === "quality"}
            onClick={() => setMenu(menu === "quality" ? "" : "quality")}
          >
            <Settings2 />
          </button>
          {document.pictureInPictureEnabled && (
            <button
              className="icon-button pip"
              aria-label="Picture in picture"
              onClick={async () => {
                try {
                  if (document.pictureInPictureElement)
                    await document.exitPictureInPicture();
                  else await video.current!.requestPictureInPicture();
                } catch {
                  setNotice("Picture in picture is unavailable.");
                }
              }}
            >
              <PictureInPicture2 />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Fullscreen"
            title="Fullscreen (F)"
            onClick={fullscreen}
          >
            <Maximize />
          </button>
        </div>
      </div>
    </div>
  );
}
