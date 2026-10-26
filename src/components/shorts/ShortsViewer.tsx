import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Film,
} from "lucide-react";
import type { Edit } from "../../data/edits";
import { getFandomById } from "../../data/fandoms";
import YouTubePlayer, {
  type YouTubePlayerHandle,
} from "../video/YouTubePlayer";
import {
  allowsAutoplay,
  useNativePlayback,
} from "../../hooks/useNativePlayback";
import {
  usePlaybackDialog,
  trapDialogTab,
} from "../../hooks/usePlaybackDialog";

export interface ShortsViewerProps {
  shorts: Edit[];
  initialShortId?: number;
  activeShortId?: number;
  onShortChange?: (short: Edit) => void;
  onClose: () => void;
  onTagClick?: (tag: string) => void;
}

const formatTime = (n: number) =>
  `${Math.floor(n / 60)}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;

export function ShortsViewer({
  shorts,
  initialShortId,
  activeShortId,
  onShortChange,
  onClose,
  onTagClick,
}: ShortsViewerProps) {
  const effectiveInitialId = activeShortId ?? initialShortId;
  const initialIndex = Math.max(
    0,
    shorts.findIndex((s) => s.id === effectiveInitialId),
  );

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<YouTubePlayerHandle>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const scope = usePlaybackDialog(viewerRef, !!shorts[currentIndex]);
  const [blocked, setBlocked] = useState(false);
  const lastNavTime = useRef(0);

  const currentShort = shorts[currentIndex];
  const isYouTube = currentShort?.sourceType === "youtube_embed";

  const playback = useNativePlayback(
    videoRef,
    `${currentShort?.id}:${currentShort?.source}`,
    {
      enabled: !isYouTube,
      scope,
      onPlaying: () => {
        setIsPlaying(true);
        setBlocked(false);
      },
      onPaused: () => setIsPlaying(false),
      onBlocked: () => setBlocked(true),
    },
  );

  const prevActiveShortId = useRef(activeShortId);
  const prevShortsRef = useRef(shorts);

  // Synchronize currentIndex when activeShortId prop changes OR when shorts list changes
  useEffect(() => {
    if (
      typeof activeShortId === "number" &&
      activeShortId !== prevActiveShortId.current
    ) {
      prevActiveShortId.current = activeShortId;
      const idx = shorts.findIndex((s) => s.id === activeShortId);
      if (idx !== -1) {
        setCurrentIndex(idx);
      }
    } else if (prevShortsRef.current !== shorts) {
      prevShortsRef.current = shorts;
      const currentId =
        typeof activeShortId === "number"
          ? activeShortId
          : (currentShort?.id ?? initialShortId);
      if (typeof currentId === "number") {
        const idx = shorts.findIndex((s) => s.id === currentId);
        if (idx !== -1) {
          setCurrentIndex(idx);
        } else if (currentIndex >= shorts.length && shorts.length > 0) {
          setCurrentIndex(shorts.length - 1);
        }
      }
    }
  }, [activeShortId, currentIndex, currentShort?.id, initialShortId, shorts]);

  useEffect(() => {
    setHasError(false);
    setBlocked(false);
    setIsWaiting(false);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    if (!isYouTube && allowsAutoplay()) void playback.play();
  }, [currentShort?.id, currentShort?.source, isYouTube, playback.play]);

  const togglePlay = useCallback(() => {
    if (isYouTube) {
      if (isPlaying) ytPlayerRef.current?.pauseVideo();
      else ytPlayerRef.current?.playVideo();
    } else if (!hasError) {
      if (videoRef.current?.paused) void playback.play();
      else playback.pause();
    }
  }, [hasError, isPlaying, isYouTube, playback.play, playback.pause]);

  const toggleMute = useCallback(() => {
    if (isYouTube) {
      const nextMuted = !isMuted;
      setIsMuted(nextMuted);
      if (nextMuted) {
        ytPlayerRef.current?.mute();
      } else {
        ytPlayerRef.current?.unMute();
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, [isMuted, isYouTube]);

  const handleNext = useCallback(() => {
    if (currentIndex < shorts.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      const nextShort = shorts[nextIndex];
      if (nextShort) {
        onShortChange?.(nextShort);
      }
    }
  }, [currentIndex, onShortChange, shorts]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      const prevShort = shorts[prevIndex];
      if (prevShort) {
        onShortChange?.(prevShort);
      }
    }
  }, [currentIndex, onShortChange, shorts]);

  const handleRetry = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setHasError(false);
      setBlocked(false);
      videoRef.current?.load();
      void playback.play();
    },
    [playback.play],
  );

  // Keyboard navigation & accessibility focus handling
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const activeEl = document.activeElement as HTMLElement | null;

      trapDialogTab(e, viewerRef.current);
      if (e.defaultPrevented) return;

      // Escape always closes the viewer
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // If active element or event target is a button, link, or text input, let them handle Space / Enter natively
      const isInteractive = Boolean(
        activeEl?.closest?.("button, a, input, textarea, select") ||
        (e.target as HTMLElement)?.closest?.(
          "button, a, input, textarea, select",
        ),
      );

      if (isInteractive) {
        return;
      }

      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          togglePlay();
          break;
        case "m":
        case "M":
          e.preventDefault();
          toggleMute();
          break;
        case "ArrowUp":
          e.preventDefault();
          handlePrev();
          break;
        case "ArrowDown":
          e.preventDefault();
          handleNext();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNext, handlePrev, onClose, toggleMute, togglePlay]);

  // Touch swipe support with 400ms debounce
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY === null) return;
    const touchEndY = e.changedTouches[0].clientY;
    const diff = touchStartY - touchEndY;
    const now = Date.now();

    if (now - lastNavTime.current > 400) {
      if (diff > 50) {
        lastNavTime.current = now;
        handleNext();
      } else if (diff < -50) {
        lastNavTime.current = now;
        handlePrev();
      }
    }
    setTouchStartY(null);
  };

  if (!currentShort) {
    return null;
  }

  const fandomTitle = currentShort.fandomIds?.[0]
    ? getFandomById(currentShort.fandomIds[0])?.title
    : null;

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={viewerRef}
      className="shorts-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Shorts viewer: ${currentShort.title}`}
      tabIndex={-1}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="shorts-viewer-backdrop" onClick={onClose} />
      <span className="sr-only" role="status">
        {hasError
          ? "Video unavailable"
          : isWaiting
            ? "Buffering"
            : isPlaying
              ? "Playing"
              : "Paused"}
      </span>

      <div className="shorts-viewer-container">
        {/* Top Header Controls */}
        <div className="shorts-viewer-header">
          <span className="shorts-viewer-index" aria-live="polite">
            {currentIndex + 1} / {shorts.length}
          </span>
          <div className="shorts-viewer-actions">
            <button
              type="button"
              className="icon-button shorts-control-btn"
              onClick={togglePlay}
              disabled={hasError && !isYouTube}
              aria-label={isPlaying ? "Pause short" : "Play short"}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              type="button"
              className="icon-button shorts-control-btn"
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute audio" : "Mute audio"}
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <button
              type="button"
              className="icon-button shorts-control-btn"
              onClick={onClose}
              aria-label="Close shorts viewer"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Vertical Viewport Frame */}
        <div
          className="shorts-viewer-frame"
          onClick={isYouTube ? undefined : togglePlay}
        >
          {isYouTube ? (
            <YouTubePlayer
              key={`${currentShort.id}:${currentShort.youtubeVideoId}`}
              ref={ytPlayerRef}
              videoId={currentShort.youtubeVideoId!}
              title={currentShort.title}
              poster={currentShort.poster}
              aspectRatio="9:16"
              autoPlay={allowsAutoplay()}
              muted={isMuted}
              controls={true}
              playbackScope={scope}
              onEnded={handleNext}
              onPlay={() => {
                setIsPlaying(true);
                setHasError(false);
                setBlocked(false);
              }}
              onPause={() => setIsPlaying(false)}
              onAutoplayBlocked={() => {
                setIsPlaying(false);
                setBlocked(true);
              }}
              onError={() => {
                setHasError(true);
                setIsPlaying(false);
                setIsWaiting(false);
              }}
            />
          ) : (
            /* Always keep video element mounted in DOM to guarantee ref and retry reliability for native video */
            <video
              key={`${currentShort.id}:${currentShort.source}`}
              ref={videoRef}
              src={currentShort.source}
              poster={currentShort.poster}
              className="shorts-video-element"
              style={{ display: hasError ? "none" : "block" }}
              onEnded={handleNext}
              playsInline
              muted={isMuted}
              onPause={() => setIsPlaying(false)}
              onWaiting={() => setIsWaiting(true)}
              onPlaying={() => setIsWaiting(false)}
              onTimeUpdate={() => {
                if (videoRef.current) {
                  setCurrentTime(videoRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  setDuration(videoRef.current.duration);
                }
              }}
              onError={() => {
                setHasError(true);
                setIsPlaying(false);
                setIsWaiting(false);
              }}
            />
          )}

          {blocked && !hasError && (
            <div className="player-status" role="status">
              Playback needs your permission.{" "}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
              >
                Resume playback
              </button>
            </div>
          )}
          {hasError && !isYouTube && (
            <div className="shorts-error-state" role="alert">
              <Film size={40} className="error-icon" aria-hidden="true" />
              <h3>Video unavailable</h3>
              <p>Could not load the video for {currentShort.title}.</p>
              <button type="button" className="retry-btn" onClick={handleRetry}>
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          )}

          {/* Pause overlay watermark - only for native video */}
          {!isYouTube && !isPlaying && !hasError && (
            <div className="shorts-pause-badge" aria-hidden="true">
              <Play size={44} />
            </div>
          )}

          {/* Bottom metadata and controls */}
          <div
            className="shorts-viewer-meta"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shorts-meta-badges">
              <span className="shorts-badge">Short</span>
              <span className="shorts-cat-badge">{currentShort.category}</span>
              {fandomTitle && (
                <span className="shorts-fandom-badge">{fandomTitle}</span>
              )}
            </div>

            <h1 className="shorts-viewer-title">{currentShort.title}</h1>
            <p className="shorts-viewer-desc">{currentShort.description}</p>

            {currentShort.tags && currentShort.tags.length > 0 && (
              <div className="card-tags shorts-tags">
                {currentShort.tags.slice(0, 3).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="tag-chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTagClick?.(tag);
                    }}
                    aria-label={`Filter by #${tag}`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Accessible Scrubbing progress slider - only for native video */}
          {!isYouTube && (
            <div
              className="shorts-progress-bar"
              role="slider"
              tabIndex={0}
              aria-label="Seek short video"
              aria-valuenow={Math.round(currentTime)}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration || 100)}
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(
                duration,
              )}`}
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const newTime = (clickX / rect.width) * duration;
                if (videoRef.current && isFinite(newTime)) {
                  videoRef.current.currentTime = newTime;
                  setCurrentTime(newTime);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  e.stopPropagation();
                  const nextTime = Math.max(0, currentTime - 5);
                  if (videoRef.current) videoRef.current.currentTime = nextTime;
                  setCurrentTime(nextTime);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  e.stopPropagation();
                  const nextTime = Math.min(duration, currentTime + 5);
                  if (videoRef.current) videoRef.current.currentTime = nextTime;
                  setCurrentTime(nextTime);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (videoRef.current) videoRef.current.currentTime = 0;
                  setCurrentTime(0);
                } else if (e.key === "End") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (videoRef.current) videoRef.current.currentTime = duration;
                  setCurrentTime(duration);
                }
              }}
            >
              <div
                className="shorts-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Vertical Previous / Next Navigation Arrows */}
        <div className="shorts-vertical-nav">
          <button
            type="button"
            className="icon-button shorts-nav-arrow"
            onClick={handlePrev}
            disabled={currentIndex === 0}
            aria-label="Previous short"
          >
            <ChevronUp size={24} />
          </button>
          <button
            type="button"
            className="icon-button shorts-nav-arrow"
            onClick={handleNext}
            disabled={currentIndex === shorts.length - 1}
            aria-label="Next short"
          >
            <ChevronDown size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
