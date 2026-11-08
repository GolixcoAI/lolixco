import { useEffect, useRef } from "react";

/** Bound stalled media requests without pretending that a loading delay is progress. */
export function useMediaWaitTimeout(waiting: boolean, identity: string, onTimeout: () => void) {
  const latest = useRef(onTimeout);
  latest.current = onTimeout;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => latest.current(), 20000);
    return () => clearTimeout(timer);
  }, [waiting, identity]);
}
