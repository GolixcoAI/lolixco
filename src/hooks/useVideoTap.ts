import {useRef, type PointerEvent} from 'react';

/** A tap is distinct from a pan, seek, long press or control activation. */
export function useVideoTap(toggle: () => void, enabled = true) {
  const start = useRef<{x: number; y: number; time: number; id: number} | null>(null);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const target = event.target as HTMLElement;
      if (!enabled || event.button !== 0 || target.closest('button,a,input,select,[role="slider"],.shorts-viewer-meta')) return;
      start.current = {x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId};
    },
    onPointerCancel() { start.current = null; },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const tap = start.current;
      start.current = null;
      if (enabled && tap && tap.id === event.pointerId && performance.now() - tap.time < 500 &&
          Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 9) toggle();
    },
  };
}
