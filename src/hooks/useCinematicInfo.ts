import { useCallback, useEffect, useRef, useState } from "react";

export const CINEMATIC_INFO_DELAY_MS = 3000;

/** Only informational overlays fade; playback ownership and controls are independent. */
export function useCinematicInfo(playing: boolean, identity: string) {
  const [shown, setShown] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reveal = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    setShown(true);
    if (playing) timer.current = setTimeout(() => setShown(false), CINEMATIC_INFO_DELAY_MS);
  }, [playing]);
  useEffect(() => {
    reveal();
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
  }, [identity, reveal]);
  return { visible: !playing || shown, reveal };
}
