import {
  useEffect,
  useRef,
  useState,
  useId,
  forwardRef,
  useImperativeHandle,
} from "react";
import { ExternalLink, AlertTriangle, Play } from "lucide-react";
import {
  playbackCoordinator,
  type PlaybackLease,
} from "../../utils/playbackCoordinator";

// Declare global YT interface for TypeScript
declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        config: Record<string, unknown>,
      ) => YouTubePlayerInstance;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YouTubePlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  isMuted: () => boolean;
  mute: () => void;
  unMute: () => void;
  destroy: () => void;
}

export interface YouTubePlayerHandle {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  destroy: () => void;
}

export interface YouTubePlayerProps {
  videoId: string;
  title?: string;
  poster?: string;
  aspectRatio?: "16:9" | "9:16";
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  coordinatorId?: string;
  registerWithCoordinator?: boolean;
  playbackScope?: string;
  playbackAllowed?: boolean;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onError?: (errorCode: number, message: string) => void;
  onAutoplayBlocked?: () => void;
  className?: string;
}

// One shared API request; unmounted players unsubscribe while it is loading.
let isApiLoading = false;
const readyCallbacks = new Set<{ ready: () => void; failed: () => void }>();
export function loadYouTubeIframeApi(callback: () => void, failed = () => {}) {
  if (typeof window === "undefined") return () => {};
  if (window.YT?.Player) {
    callback();
    return () => {};
  }
  const subscription = { ready: callback, failed };
  readyCallbacks.add(subscription);
  if (!isApiLoading) {
    isApiLoading = true;
    const previousHandler = window.onYouTubeIframeAPIReady;
    const script = document.createElement("script");
    const finish = (success: boolean) => {
      isApiLoading = false;
      const callbacks = [...readyCallbacks];
      readyCallbacks.clear();
      for (const cb of callbacks) {
        try {
          success ? cb.ready() : cb.failed();
        } catch {
          /* Isolate subscribers. */
        }
      }
    };
    window.onYouTubeIframeAPIReady = () => {
      try {
        previousHandler?.();
      } catch {
        // A third-party readiness handler must not break this adapter.
      } finally {
        finish(true);
      }
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      script.remove();
      finish(false);
    };
    document.head.appendChild(script);
  }
  return () => {
    readyCallbacks.delete(subscription);
  };
}

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function YouTubePlayer(
  {
    videoId,
    title = "Curated video",
    poster,
    aspectRatio = "16:9",
    autoPlay = false,
    muted = true,
    controls = true,
    coordinatorId,
    registerWithCoordinator = true,
    playbackScope,
    playbackAllowed = true,
    onEnded,
    onPlay,
    onPause,
    onError,
    onAutoplayBlocked,
    className = "",
  },
  ref,
) {
  const reactId = useId().replace(/:/g, "_");
  const containerId = `yt-player-${reactId}`;
  const effectiveCoordinatorId = coordinatorId || containerId;

  const commands = useRef({ play: () => {}, pause: () => {} });
  const autoStart = useRef({ videoId, allowed: true });
  const [generation, setGeneration] = useState(0);
  const leaseRef = useRef<PlaybackLease | null>(null);
  const propsRef = useRef({ autoPlay, muted, playbackAllowed });
  propsRef.current = { autoPlay, muted, playbackAllowed };
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Keep callback props in stable refs to avoid recreating player when handlers change (FIX G)
  const onEndedRef = useRef(onEnded);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onErrorRef = useRef(onError);
  const onAutoplayBlockedRef = useRef(onAutoplayBlocked);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onPlayRef.current = onPlay;
    onPauseRef.current = onPause;
    onErrorRef.current = onError;
    onAutoplayBlockedRef.current = onAutoplayBlocked;
  });

  // Expose imperative player controls to parent
  useImperativeHandle(
    ref,
    () => ({
      playVideo: () => commands.current.play(),
      pauseVideo: () => commands.current.pause(),
      stopVideo: () => {
        commands.current.pause();
        try {
          playerRef.current?.stopVideo();
        } catch {
          /* Already disposed. */
        }
      },
      seekTo: (seconds: number, allowSeekAhead?: boolean) => {
        if (playerRef.current) {
          try {
            playerRef.current.seekTo(seconds, allowSeekAhead);
          } catch {
            // Ignore
          }
        }
      },
      mute: () => {
        if (playerRef.current) {
          try {
            playerRef.current.mute();
          } catch {
            // Ignore
          }
        }
      },
      unMute: () => {
        if (playerRef.current) {
          try {
            playerRef.current.unMute();
          } catch {
            // Ignore
          }
        }
      },
      isMuted: () => {
        if (playerRef.current) {
          try {
            return playerRef.current.isMuted();
          } catch {
            return true;
          }
        }
        return true;
      },
      destroy: () => {
        leaseRef.current?.();
        if (playerRef.current) {
          try {
            playerRef.current.destroy();
          } catch {
            // Ignore
          }
          playerRef.current = null;
        }
      },
    }),
    [],
  );

  // The player, listeners and coordinator lease share one source generation.
  useEffect(() => {
    let disposed = false;
    let instance: YouTubePlayerInstance | null = null;
    let pendingStart = false;
    let destroyed = false;
    if (autoStart.current.videoId !== videoId)
      autoStart.current = { videoId, allowed: true };
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        instance?.destroy();
      } catch {
        /* Already disposed. */
      }
    };
    setHasError(false);
    setErrorMessage("");
    setAutoplayBlocked(false);
    setIsReady(false);
    const pause = () => {
      if (disposed) {
        try {
          instance?.pauseVideo();
        } catch {
          /* Already disposed. */
        }
        lease?.paused();
        return;
      }
      autoStart.current.allowed = false;
      const cancelPending = pendingStart;
      pendingStart = false;
      // A commanded start has no event token in the iframe API. Retire its
      // instance if it is cancelled before PLAYING so late events are inert.
      if (cancelPending) disposed = true;
      try {
        instance?.pauseVideo();
      } catch {
        /* A disposed iframe is harmless. */
      }
      lease?.paused();
      if (cancelPending) {
        destroy();
        setGeneration((n) => n + 1);
      }
    };
    const lease = registerWithCoordinator
      ? playbackCoordinator.registerPlayer(
          effectiveCoordinatorId,
          pause,
          playbackScope,
        )
      : null;
    leaseRef.current = lease;
    const allowed = () =>
      !disposed &&
      propsRef.current.playbackAllowed &&
      !document.hidden &&
      (!lease || lease.canPlay());
    const current = () => !disposed && instance === playerRef.current;
    const blocked = () => {
      if (!current()) return;
      pendingStart = false;
      lease?.paused();
      setAutoplayBlocked(true);
      onAutoplayBlockedRef.current?.();
    };
    const failed = (code: number, message: string) => {
      if (disposed) return;
      pendingStart = false;
      pause();
      setHasError(true);
      setErrorMessage(message);
      onErrorRef.current?.(code, message);
    };
    const play = () => {
      if (!allowed() || !instance) return;
      pendingStart = true;
      try {
        instance.playVideo();
      } catch {
        blocked();
      }
    };
    commands.current = { play, pause };
    const cancelReady = loadYouTubeIframeApi(
      () => {
        if (disposed || !containerRef.current) return;
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
          queueMicrotask(() =>
            failed(2, "Invalid YouTube video ID parameter."),
          );
          return;
        }
        // YT replaces its target. React owns the outer host, not that target.
        const target = document.createElement("div");
        containerRef.current.appendChild(target);
        try {
          instance = new window.YT!.Player(target, {
            videoId,
            playerVars: {
              autoplay: 0,
              mute: propsRef.current.muted ? 1 : 0,
              controls: controls ? 1 : 0,
              rel: 0,
              playsinline: 1,
              enablejsapi: 1,
              origin: window.location.origin,
            },
            events: {
              onReady: () => {
                if (!current()) return;
                setIsReady(true);
                try {
                  propsRef.current.muted
                    ? instance!.mute()
                    : instance!.unMute();
                  if (propsRef.current.autoPlay && autoStart.current.allowed)
                    play();
                } catch {
                  blocked();
                }
              },
              onStateChange: (event: { data: number }) => {
                if (!current()) return;
                if (event.data === 1) {
                  pendingStart = false;
                  if (!allowed() || (lease && !lease.playing())) {
                    pause();
                    return;
                  }
                  setAutoplayBlocked(false);
                  onPlayRef.current?.();
                } else if (event.data === 2 || event.data === 0) {
                  pendingStart = false;
                  lease?.paused();
                  onPauseRef.current?.();
                  if (event.data === 0) onEndedRef.current?.();
                }
              },
              onError: (event: { data: number }) => {
                if (!current()) return;
                const code = event.data;
                const message =
                  code === 100
                    ? "This video has been removed or marked private by its creator."
                    : code === 101 || code === 150
                      ? "The creator of this video does not allow embedded playback outside YouTube."
                      : code === 2
                        ? "Invalid YouTube video ID parameter."
                        : "Playback error occurred.";
                failed(code, message);
              },
              onAutoplayBlocked: blocked,
            },
          });
          playerRef.current = instance;
        } catch {
          failed(0, "Failed to initialize YouTube embedded player.");
        }
      },
      () =>
        failed(
          0,
          "YouTube could not load. Check your connection and try again.",
        ),
    );
    const hidden = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      disposed = true;
      cancelReady();
      document.removeEventListener("visibilitychange", hidden);
      pendingStart = false;
      lease?.();
      destroy();
      if (playerRef.current === instance) playerRef.current = null;
      if (leaseRef.current === lease) leaseRef.current = null;
      containerRef.current?.replaceChildren();
    };
  }, [
    videoId,
    effectiveCoordinatorId,
    controls,
    registerWithCoordinator,
    playbackScope,
    generation,
  ]);

  const previousAutoPlay = useRef(autoPlay);
  useEffect(() => {
    const changed = previousAutoPlay.current !== autoPlay;
    previousAutoPlay.current = autoPlay;
    if (!isReady || !playerRef.current) return;
    try {
      if (!playbackAllowed || document.hidden || !autoPlay) {
        commands.current.pause();
      } else if (changed) commands.current.play();
    } catch {
      /* Optional imperative support. */
    }
    // Removing an overlay does not automatically resume the background player.
  }, [autoPlay, playbackAllowed, isReady]);

  useEffect(() => {
    if (!isReady || !playerRef.current) return;
    try {
      muted ? playerRef.current.mute() : playerRef.current.unMute();
    } catch {
      /* Ignore teardown races. */
    }
  }, [muted, isReady]);

  const fallbackThumbnail =
    poster ||
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  return (
    <div
      className={`youtube-player-wrapper ${
        aspectRatio === "9:16" ? "aspect-portrait" : "aspect-landscape"
      } ${className}`}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: aspectRatio === "9:16" ? "9 / 16" : "16 / 9",
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      {/* YouTube IFrame target container */}
      <div
        ref={containerRef}
        id={containerId}
        style={{
          width: "100%",
          height: "100%",
          display: hasError ? "none" : "block",
        }}
      />

      {/* Autoplay Blocked Overlay */}
      {autoplayBlocked && !hasError && (
        <div
          role="status"
          className="autoplay-blocked-overlay"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.75)",
            zIndex: 10,
          }}
        >
          <button
            type="button"
            className="primary watch"
            onClick={() => {
              if (
                playerRef.current &&
                propsRef.current.playbackAllowed &&
                !document.hidden &&
                (!leaseRef.current || leaseRef.current.canPlay())
              ) {
                try {
                  commands.current.play();
                } catch {
                  // Ignore
                }
              }
              setAutoplayBlocked(false);
            }}
          >
            <Play size={18} /> Resume Playback
          </button>
        </div>
      )}

      {/* Fallback Error Overlay */}
      {hasError && (
        <div
          role="alert"
          className="youtube-error-fallback"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            textAlign: "center",
            color: "#fff",
            backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.9)), url(${fallbackThumbnail})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <AlertTriangle
            size={32}
            color="#f87171"
            style={{ marginBottom: "0.75rem" }}
          />
          <h3
            style={{
              fontSize: "1.1rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
            }}
          >
            {title}
          </h3>
          <p
            style={{
              fontSize: "0.9rem",
              color: "#d1d5db",
              maxWidth: "420px",
              marginBottom: "1rem",
            }}
          >
            {errorMessage}
          </p>
          <button
            type="button"
            className="primary watch"
            onClick={() => {
              autoStart.current.allowed = true;
              setGeneration((n) => n + 1);
            }}
          >
            Retry playback
          </button>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="primary watch"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              textDecoration: "none",
            }}
          >
            Watch on YouTube <ExternalLink size={16} />
          </a>
        </div>
      )}
    </div>
  );
});

export default YouTubePlayer;
