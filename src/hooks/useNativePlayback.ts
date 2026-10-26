import { useCallback, useEffect, useId, useRef, type RefObject } from "react";
import {
  playbackCoordinator,
  type PlaybackLease,
} from "../utils/playbackCoordinator";

export function allowsAutoplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !(
      typeof navigator !== "undefined" &&
      (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection?.saveData
    )
  );
}

/** Captures the exact DOM element and lease for every asynchronous play attempt. */
export function useNativePlayback(
  ref: RefObject<HTMLVideoElement | null>,
  identity: string,
  options: {
    enabled?: boolean;
    allowed?: boolean;
    scope?: string;
    onPlaying?: () => void;
    onPaused?: () => void;
    onBlocked?: () => void;
  } = {},
) {
  const id = useId();
  const latest = useRef(options);
  latest.current = options;
  const session = useRef<{
    video: HTMLVideoElement;
    lease: PlaybackLease;
    request: number;
    wanted: boolean;
  } | null>(null);
  const pause = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.request++;
    s.wanted = false;
    s.video.pause();
    s.lease.paused();
    latest.current.onPaused?.();
  }, []);
  const play = useCallback(async () => {
    const s = session.current;
    const allowed = () => latest.current.allowed !== false && !document.hidden;
    if (!s || !s.lease.canPlay() || !allowed()) return;
    const request = ++s.request;
    s.wanted = true;
    try {
      await s.video.play();
      // Pause the captured old element, never a newer ref after a source change.
      if (
        session.current !== s ||
        !s.wanted ||
        !s.lease.canPlay() ||
        !allowed()
      )
        s.video.pause();
    } catch {
      if (session.current === s && request === s.request) {
        s.wanted = false;
        s.lease.paused();
        latest.current.onPaused?.();
        latest.current.onBlocked?.();
      }
    }
  }, []);
  useEffect(() => {
    const video = ref.current;
    if (!video || options.enabled === false) return;
    const lease = playbackCoordinator.registerPlayer(id, pause, options.scope);
    const s = { video, lease, request: 0, wanted: false };
    session.current = s;
    const playing = () => {
      if (
        session.current !== s ||
        !s.wanted ||
        latest.current.allowed === false ||
        document.hidden ||
        !lease.playing()
      ) {
        video.pause();
        return;
      }
      latest.current.onPlaying?.();
    };
    const stopped = (event: Event) => {
      if (session.current !== s || (event.type === "pause" && !video.paused))
        return;
      s.wanted = false;
      s.request++;
      lease.paused();
      latest.current.onPaused?.();
    };
    const hidden = () => {
      if (document.hidden) pause();
    };
    video.addEventListener("playing", playing);
    for (const event of ["pause", "ended", "error"])
      video.addEventListener(event, stopped);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      s.request++;
      s.wanted = false;
      video.removeEventListener("playing", playing);
      for (const event of ["pause", "ended", "error"])
        video.removeEventListener(event, stopped);
      document.removeEventListener("visibilitychange", hidden);
      lease();
      video.pause();
      if (session.current === s) session.current = null;
    };
  }, [id, identity, options.enabled, options.scope, pause, ref]);
  useEffect(() => {
    if (options.allowed === false) pause();
  }, [options.allowed, pause]);
  return { play, pause };
}
