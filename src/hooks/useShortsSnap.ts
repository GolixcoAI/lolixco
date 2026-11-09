import {useLayoutEffect, useRef} from 'react';

/** Native scroll owns touch momentum, including scroll chaining from an iframe.
 * Only the settled adjacent page navigates; distant pages contain posters only.
 */
export function useShortsSnap(identity: number | undefined, hasPrevious: boolean, previous: () => void, next: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({previous, next});
  callbacks.current = {previous, next};
  const settling = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finish = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const center = () => {
      settling.current = true;
      clearTimeout(timer.current);
      node.scrollTo({top: hasPrevious ? node.clientHeight : 0, behavior: 'instant'});
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {settling.current = false;});
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(node);
    const ended = () => finish.current();
    node.addEventListener('scrollend', ended);
    return () => {node.removeEventListener('scrollend',ended); observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer.current);};
  }, [identity, hasPrevious]);
  finish.current = () => {
    const node = ref.current;
    if (!node || settling.current || !node.clientHeight) return;
    const center = hasPrevious ? 1 : 0;
    const page = Math.round(node.scrollTop / node.clientHeight);
    if (page === center) return;
    settling.current = true;
    if (page < center) callbacks.current.previous();
    else callbacks.current.next();
  };
  const onScroll = () => {
    if (settling.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => finish.current(), 140);
  };
  return {ref, onScroll};
}
