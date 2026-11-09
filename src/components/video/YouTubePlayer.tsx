import { useSessionAudio, setSessionMuted } from "../../hooks/useSessionAudio";
import {
  useEffect,
  useRef,
  useState,
  useId,
  forwardRef,
  useImperativeHandle,
} from "react";
import { ExternalLink, AlertTriangle, Play } from "lucide-react";
import LoadingRing from "../ui/LoadingRing";
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
  onReady?: () => void;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onError?: (errorCode: number, message: string) => void;
  iframeReferrerPolicy?: HTMLIFrameElement["referrerPolicy"];
  onAutoplayBlocked?: () => void;
  className?: string;
}

// One shared API request; unmounted players unsubscribe while it is loading.
let isApiLoading = false;
let cancelApiLoad: (() => void) | undefined;
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
    let finished = false;
    const timer = window.setTimeout(() => { script.remove?.(); finish(false); }, 18000);
    const finish = (success: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      isApiLoading = false;
      cancelApiLoad = undefined;
      if (window.onYouTubeIframeAPIReady === handleReady) window.onYouTubeIframeAPIReady = previousHandler;
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
    const handleReady = () => {
      try {
        previousHandler?.();
      } catch {
        // A third-party readiness handler must not break this adapter.
      } finally {
        finish(true);
      }
    };
    window.onYouTubeIframeAPIReady = handleReady;
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      script.remove?.();
      finish(false);
    };
    cancelApiLoad = () => { script.remove?.(); finish(false); };
    document.head.appendChild(script);
  }
  return () => {
    readyCallbacks.delete(subscription);
    if (!readyCallbacks.size) cancelApiLoad?.();
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
    muted: controlledMuted,
    controls = true,
    coordinatorId,
    registerWithCoordinator = true,
    playbackScope,
    playbackAllowed = true,
    onReady,
    onEnded,
    onPlay,
    onPause,
    onError,
    iframeReferrerPolicy,
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
  const [sessionMuted] = useSessionAudio();
  const muted = controlledMuted ?? sessionMuted;
  const [generation, setGeneration] = useState(0);
  const leaseRef = useRef<PlaybackLease | null>(null);
  const propsRef = useRef({ autoPlay, muted, playbackAllowed });
  propsRef.current = { autoPlay, muted, playbackAllowed };
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [failureCode, setFailureCode] = useState<number | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  // Keep callback props in stable refs to avoid recreating player when handlers change (FIX G)
  const onReadyRef = useRef(onReady);
  const onEndedRef = useRef(onEnded);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onErrorRef = useRef(onError);
  const onAutoplayBlockedRef = useRef(onAutoplayBlocked);

  useEffect(() => {
    onReadyRef.current = onReady;
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
    let startupTimer: number | undefined;
    let bufferingTimer: number | undefined;
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
    setFailureCode(null);
    setAutoplayBlocked(false);
    setIsReady(false);
    setIsBuffering(false);
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
      window.clearTimeout(startupTimer);
      window.clearTimeout(bufferingTimer);
      setIsBuffering(false);
      pendingStart = false;
      pause();
      setHasError(true);
      setErrorMessage(message);
      setFailureCode(code);
      onErrorRef.current?.(code, message);
      disposed = true;
      destroy();
      containerRef.current?.replaceChildren();
    };
    startupTimer = window.setTimeout(() => {
      failed(0, "This video is taking longer to load. Try again or watch it on YouTube.");
    }, 18000);
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
            failed(2, "This YouTube link isn't valid. Try another video."),
          );
          return;
        }
        // For Studio, set the referrer policy before the initial player request.
        const playerVars = {
          autoplay: 0,
          mute: propsRef.current.muted ? 1 : 0,
          controls: controls ? 1 : 0,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        };
        const target = document.createElement(iframeReferrerPolicy ? "iframe" : "div");
        if (target instanceof HTMLIFrameElement && iframeReferrerPolicy) {
          const query = new URLSearchParams(Object.entries(playerVars).map(([key, value]) => [key, String(value)]));
          target.referrerPolicy = iframeReferrerPolicy;
          target.title = "YouTube video player";
          target.width = "100%";
          target.height = "100%";
          target.allowFullscreen = true;
          target.allow = "encrypted-media; picture-in-picture; fullscreen";
          target.style.border = "0";
          target.src = `https://www.youtube.com/embed/${videoId}?${query}`;
        }
        containerRef.current.appendChild(target);
        try {
          instance = new window.YT!.Player(target, {
            videoId,
            playerVars,
            events: {
              onReady: () => {
                if (!current()) return;
                window.clearTimeout(startupTimer);
                setIsReady(true);
                onReadyRef.current?.();
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
                window.clearTimeout(bufferingTimer);
                setIsBuffering(event.data === 3);
                if (event.data === 3) bufferingTimer = window.setTimeout(() =>
                  failed(0, "Playback stopped loading. Check your connection and retry, or watch on YouTube."), 20000);
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
                    ? "This edit isn't available. It may have been removed or made private."
                    : code === 101 || code === 150
                      ? "This video can't play here. You can watch it on YouTube."
                      : code === 153
                        ? "YouTube couldn't start playback here. Try again or watch it on YouTube."
                        : code === 2
                          ? "This YouTube link isn't valid. Try another video."
                          : "We couldn't play this video. Try again or watch it on YouTube.";
                failed(code, message);
              },
              onAutoplayBlocked: blocked,
            },
          });
          playerRef.current = instance;
        } catch {
          failed(0, "We couldn't open this video. Try again or watch it on YouTube.");
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
      window.clearTimeout(startupTimer);
      window.clearTimeout(bufferingTimer);
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
    iframeReferrerPolicy,
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

  // The iframe's built-in controls do not emit a volume-change event.
  // Observe actual state only once the API has applied the requested preference.
  useEffect(() => {
    if (!isReady || autoplayBlocked) return;
    const timer = window.setInterval(() => {
      try {
        const player = playerRef.current;
        if (player && containerRef.current?.querySelector("iframe"))
          setSessionMuted(player.isMuted());
      } catch { /* iframe teardown */ }
    }, 300);
    return () => window.clearInterval(timer);
  }, [isReady, autoplayBlocked]);

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
        height: "100%",
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

      {(!isReady || isBuffering) && !hasError && <div className={`media-loading${isReady ? " media-loading--buffering" : ""}`}><LoadingRing label={isReady ? "Buffering video" : "Loading video"}/></div>}

      {autoplayBlocked && !hasError && <span className="sr-only" role="status">Autoplay was blocked. Use the official YouTube play control.</span>}

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
          <div className="youtube-fallback-actions">
          {![2, 100, 101, 150].includes(failureCode ?? 0) && <button
            type="button"
            className="primary watch"
            onClick={() => {
              autoStart.current.allowed = true;
              setGeneration((n) => n + 1);
            }}
          >
            Retry playback
          </button>}
          {failureCode !== 2 && <a
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
          </a>}
          </div>
        </div>
      )}
    </div>
  );
});

export default YouTubePlayer;
