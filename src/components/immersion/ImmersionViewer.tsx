import React, { useState, useEffect, useRef, useCallback } from "react";
import type { Edit } from "../../data/edits";
import { isYouTubeEmbed } from "../../data/edits";
import {
  type ImmersionContext,
  type ImmersionQueueState,
  createImmersionSession,
  advanceImmersionNext,
  advanceImmersionPrevious,
  skipUnavailableImmersionEdit,
} from "../../utils/immersionQueue";
import {
  allowsAutoplay,
  useNativePlayback,
} from "../../hooks/useNativePlayback";
import {
  usePlaybackDialog,
  trapDialogTab,
} from "../../hooks/usePlaybackDialog";
import YouTubePlayer, {
  type YouTubePlayerHandle,
} from "../video/YouTubePlayer";
import {
  X,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Maximize,
  Minimize,
  AlertCircle,
  Volume2,
  VolumeX,
} from "lucide-react";

export interface ImmersionViewerProps {
  catalog: readonly Edit[];
  initialContext?: ImmersionContext;
  onClose: () => void;
  onTagClick?: (tag: string) => void;
}

export default function ImmersionViewer({
  catalog,
  initialContext = {},
  onClose,
  onTagClick,
}: ImmersionViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nativeVideoRef = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<YouTubePlayerHandle>(null);

  const [session, setSession] = useState<{
    currentEdit: Edit | null;
    state: ImmersionQueueState;
  }>(() => createImmersionSession(catalog, initialContext));

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [consecutiveSkips, setConsecutiveSkips] = useState<number>(0);
  const [isExhausted, setIsExhausted] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);

  const currentEdit = session.currentEdit;
  const state = session.state;
  const scope = usePlaybackDialog(containerRef);
  const [wantsPlayback, setWantsPlayback] = useState(allowsAutoplay);
  const handledError = useRef(false);
  const playback = useNativePlayback(
    nativeVideoRef,
    `${state.currentIndex}:${currentEdit?.id}:${currentEdit?.source}`,
    {
      enabled: !!currentEdit && !isYouTubeEmbed(currentEdit) && !isExhausted,
      scope,
      onPlaying: () => {
        setIsPlaying(true);
        setAutoplayBlocked(false);
        setConsecutiveSkips(0);
      },
      onPaused: () => setIsPlaying(false),
      onBlocked: () => {
        setIsPlaying(false);
        setAutoplayBlocked(true);
      },
    },
  );
  useEffect(() => {
    handledError.current = false;
    setIsPlaying(false);
    setAutoplayBlocked(false);
    setResumeError(null);
    if (
      currentEdit &&
      !isYouTubeEmbed(currentEdit) &&
      wantsPlayback &&
      !isExhausted
    ) {
      void playback.play();
    }
  }, [currentEdit, state.currentIndex, isExhausted, playback.play]);

  // Request fullscreen on start if supported
  useEffect(() => {
    const container = containerRef.current;
    let disposed = false;
    try {
      if (
        containerRef.current &&
        document.fullscreenEnabled &&
        !document.fullscreenElement
      ) {
        containerRef.current
          .requestFullscreen()
          .then(() => {
            if (disposed && document.fullscreenElement === container)
              void document.exitFullscreen?.().catch(() => {});
          })
          .catch(() => {
            // Fullscreen request denied or not allowed by browser policy - graceful fallback
          });
      }
    } catch {
      // Ignored
    }

    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === container);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      disposed = true;
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Navigation: Next
  const handleNext = useCallback(() => {
    setAutoplayBlocked(false);
    setResumeError(null);
    setConsecutiveSkips(0);
    const { nextEdit, nextState } = advanceImmersionNext(catalog, state);
    if (!nextEdit) {
      setIsExhausted(true);
      return;
    }
    setSession({ currentEdit: nextEdit, state: nextState });
    setWantsPlayback(allowsAutoplay());
  }, [catalog, state]);

  // Navigation: Previous
  const handlePrevious = useCallback(() => {
    setAutoplayBlocked(false);
    setResumeError(null);
    const { prevEdit, nextState } = advanceImmersionPrevious(state);
    if (prevEdit) {
      setSession({ currentEdit: prevEdit, state: nextState });
      setWantsPlayback(allowsAutoplay());
      setIsExhausted(false);
    }
  }, [state]);

  // UI state follows actual media events; intent never claims coordinator ownership.
  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      setWantsPlayback(false);
      playback.pause();
      ytPlayerRef.current?.pauseVideo();
    } else {
      setWantsPlayback(true);
      setAutoplayBlocked(false);
      setResumeError(null);
      if (currentEdit && isYouTubeEmbed(currentEdit))
        ytPlayerRef.current?.playVideo();
      else void playback.play();
    }
  }, [isPlaying, currentEdit, playback.play, playback.pause]);

  const handleResumePlayback = useCallback(() => {
    setResumeError(null);
    setWantsPlayback(true);
    setAutoplayBlocked(false);
    setIsMuted(false);
    if (currentEdit && isYouTubeEmbed(currentEdit)) {
      ytPlayerRef.current?.unMute();
      ytPlayerRef.current?.playVideo();
    } else {
      if (nativeVideoRef.current) nativeVideoRef.current.muted = false;
      void playback.play();
    }
  }, [currentEdit, playback.play]);

  // User-controlled sound and unmute toggle
  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Handle Playback Error with bounded skip retry
  const handlePlaybackError = useCallback(() => {
    if (handledError.current) return;
    handledError.current = true;
    playback.pause();
    ytPlayerRef.current?.pauseVideo();
    setIsPlaying(false);
    const { nextEdit, nextState, exhausted } = skipUnavailableImmersionEdit(
      catalog,
      state,
      consecutiveSkips,
      3,
    );

    if (exhausted || !nextEdit) {
      setIsExhausted(true);
    } else {
      setConsecutiveSkips((prev) => prev + 1);
      setSession({ currentEdit: nextEdit, state: nextState });
      setWantsPlayback(allowsAutoplay());
    }
  }, [catalog, consecutiveSkips, state, playback.pause]);

  // Toggle Fullscreen manually
  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      trapDialogTab(e, containerRef.current);
      if (e.defaultPrevented) return;
      if (
        e.key !== "Escape" &&
        (e.target as HTMLElement)?.closest?.(
          "button,a,input,textarea,select,[contenteditable]",
        )
      ) {
        return;
      }

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case " ":
        case "k":
          e.preventDefault();
          handleTogglePlay();
          break;
        case "ArrowRight":
        case "j":
        case "n":
          e.preventDefault();
          handleNext();
          break;
        case "ArrowLeft":
        case "p":
          e.preventDefault();
          handlePrevious();
          break;
        case "f":
          e.preventDefault();
          handleToggleFullscreen();
          break;
        case "m":
          e.preventDefault();
          handleToggleMute();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleNext,
    handlePrevious,
    handleToggleFullscreen,
    handleTogglePlay,
    handleToggleMute,
    onClose,
  ]);

  // Determine stage label
  const stageLabel =
    state.openingQueue.length > 0 || state.currentIndex < 3
      ? `Opening (${state.currentIndex + 1}/3)`
      : `Discovery (${state.currentIndex + 1})`;

  const isPortrait = currentEdit?.format === "short";
  const isEmbed = currentEdit ? isYouTubeEmbed(currentEdit) : false;

  return (
    <div
      ref={containerRef}
      className="immersion-overlay"
      role="dialog"
      aria-label="Immersion Mode Viewer"
      aria-modal="true"
      tabIndex={-1}
    >
      {/* Top Bar Navigation */}
      <header className="immersion-topbar">
        <div className="immersion-meta-info">
          <span className="immersion-badge">
            {currentEdit?.category || "IMMERSION"}
          </span>
          <span className="immersion-stage-pill" aria-live="polite">
            {stageLabel}
          </span>
          <div className="immersion-title-group">
            <span className="immersion-title">
              {currentEdit?.title || "Curated Edit"}
            </span>
            {currentEdit?.channelTitle && (
              <span className="immersion-channel">
                by {currentEdit.channelTitle}
              </span>
            )}
          </div>
        </div>

        <div className="immersion-top-actions">
          <button
            type="button"
            className="immersion-btn"
            onClick={handleToggleMute}
            aria-label={isMuted ? "Unmute audio (m)" : "Mute audio (m)"}
            title={isMuted ? "Unmute audio (m)" : "Mute audio (m)"}
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button
            type="button"
            className="immersion-btn"
            onClick={handleToggleFullscreen}
            aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            title={
              isFullscreen ? "Exit Fullscreen (f)" : "Enter Fullscreen (f)"
            }
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <button
            type="button"
            className="immersion-btn"
            onClick={onClose}
            aria-label="Exit Immersion Mode (Esc)"
            title="Exit Immersion Mode (Esc)"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Main Playback Area */}
      <main className="immersion-main-area">
        {isExhausted || !currentEdit ? (
          <div className="immersion-prompt-overlay">
            <AlertCircle size={44} color="#f87171" />
            <h2 style={{ color: "#fff", margin: "4px 0" }}>
              Queue Playback Complete
            </h2>
            <p style={{ color: "rgba(255, 255, 255, 0.7)", maxWidth: 440 }}>
              No more eligible edits could be loaded. You can restart Immersion
              Mode or return to normal browsing.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                className="immersion-prompt-btn"
                onClick={() => {
                  setConsecutiveSkips(0);
                  handledError.current = false;
                  setIsExhausted(false);
                  setSession(createImmersionSession(catalog, initialContext));
                  setWantsPlayback(allowsAutoplay());
                }}
              >
                Restart Immersion
              </button>
              <button
                type="button"
                className="immersion-btn"
                style={{ width: "auto", borderRadius: 24, padding: "0 18px" }}
                onClick={onClose}
              >
                Exit
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`immersion-video-wrapper ${
              isPortrait ? "portrait" : "landscape"
            }`}
          >
            {isEmbed ? (
              <YouTubePlayer
                ref={ytPlayerRef}
                key={`${state.currentIndex}:${currentEdit.id}`}
                videoId={currentEdit.youtubeVideoId || ""}
                title={currentEdit.title}
                aspectRatio={isPortrait ? "9:16" : "16:9"}
                autoPlay={wantsPlayback}
                muted={isMuted}
                controls={true}
                playbackScope={scope}
                onEnded={handleNext}
                onError={() => handlePlaybackError()}
                onPlay={() => {
                  setIsPlaying(true);
                  setAutoplayBlocked(false);
                  setConsecutiveSkips(0);
                }}
                onPause={() => setIsPlaying(false)}
                onAutoplayBlocked={() => {
                  setIsPlaying(false);
                  setAutoplayBlocked(true);
                }}
              />
            ) : (
              <video
                ref={nativeVideoRef}
                key={`${state.currentIndex}:${currentEdit.id}`}
                src={currentEdit.source}
                poster={currentEdit.poster}
                muted={isMuted}
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: "#000",
                }}
                onEnded={handleNext}
                onError={handlePlaybackError}
              />
            )}

            {autoplayBlocked && (
              <div className="immersion-prompt-overlay" role="status">
                <button
                  type="button"
                  className="immersion-prompt-btn"
                  onClick={handleResumePlayback}
                >
                  Continue Playback
                </button>
                {resumeError && (
                  <p
                    style={{
                      color: "#f87171",
                      fontSize: "0.85rem",
                      marginTop: 8,
                    }}
                  >
                    {resumeError}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom Bar Controls & Discovery Tags */}
      <footer className="immersion-bottombar">
        <div className="immersion-controls">
          <button
            type="button"
            className="immersion-btn"
            onClick={handlePrevious}
            disabled={state.currentIndex <= 0}
            aria-label="Previous edit (Left Arrow)"
            title="Previous edit (Left Arrow)"
          >
            <SkipBack size={18} />
          </button>
          <button
            type="button"
            className="immersion-btn"
            onClick={handleTogglePlay}
            aria-label={isPlaying ? "Pause (Space)" : "Play (Space)"}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button
            type="button"
            className="immersion-btn"
            onClick={handleNext}
            aria-label="Next edit (Right Arrow)"
            title="Next edit (Right Arrow)"
          >
            <SkipForward size={18} />
          </button>
          <button
            type="button"
            className="immersion-btn"
            onClick={handleToggleMute}
            aria-label={isMuted ? "Unmute audio (m)" : "Mute audio (m)"}
            title={isMuted ? "Unmute audio (m)" : "Mute audio (m)"}
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>

        {currentEdit?.tags && currentEdit.tags.length > 0 && (
          <div className="immersion-tag-list" aria-label="Edit tags">
            {currentEdit.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="immersion-tag"
                onClick={() => {
                  onClose();
                  onTagClick?.(tag);
                }}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}
