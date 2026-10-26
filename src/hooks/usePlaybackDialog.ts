import { useId, useLayoutEffect, type RefObject } from "react";
import { playbackCoordinator } from "../utils/playbackCoordinator";

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
    // Inert background siblings also contain focus when Tab leaves an iframe.
    const siblings: Array<[HTMLElement, boolean]> = [];
    let ancestor: HTMLElement | null = container;
    while (ancestor?.parentElement) {
      for (const sibling of Array.from(ancestor.parentElement.children)) {
        if (sibling !== ancestor && sibling instanceof HTMLElement) {
          siblings.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      }
      if (ancestor.parentElement === document.body) break;
      ancestor = ancestor.parentElement;
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    container?.focus();
    return () => {
      release();
      for (const [sibling, inert] of siblings) sibling.inert = inert;
      document.body.style.overflow = overflow;
      const restore = () => {
        if (previous?.isConnected !== false) previous?.focus?.();
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
