import { useId, useLayoutEffect, type RefObject } from "react";
import { playbackCoordinator } from "../utils/playbackCoordinator";
import {acquirePageLock, restoreOverlayFocus} from '../utils/pageLock';

export function usePlaybackDialog(
  ref: RefObject<HTMLDivElement | null>,
  enabled = true,
) {
  const scope = useId();
  useLayoutEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement as HTMLElement | null;
    const release = playbackCoordinator.acquireOverlay(scope);
    const container = ref.current;
    const unlock = acquirePageLock(container);
    container?.focus();
    return () => {
      release();
      unlock();
      const restore = () => {
        restoreOverlayFocus(previous);
      };
      if (document.fullscreenElement === container && document.exitFullscreen) {
        void document
          .exitFullscreen()
          .catch(() => {})
          .finally(restore);
      } else restore();
    };
  }, [ref, scope, enabled]);
  return scope;
}

export function trapDialogTab(
  event: KeyboardEvent,
  container: HTMLElement | null,
) {
  if (event.key !== "Tab" || !container) return;
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((node) => !node.getClientRects || node.getClientRects().length > 0);
  const first = nodes[0],
    last = nodes[nodes.length - 1];
  if (!first) {
    event.preventDefault();
    container.focus();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === container)
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === container)
  ) {
    event.preventDefault();
    first.focus();
  }
}
