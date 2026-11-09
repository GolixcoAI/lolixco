let orientationHeld = false;
let orientationRequest = 0;
type LockableOrientation = ScreenOrientation & {lock?: (mode: 'landscape') => Promise<void>};

export async function alignImmersiveOrientation(portrait: boolean) {
  const request = ++orientationRequest;
  const orientation = globalThis.screen?.orientation as LockableOrientation | undefined;
  if (portrait) { releaseImmersiveOrientation(); return; }
  if (!document.fullscreenElement || !orientation?.lock) return;
  try {
    await orientation.lock('landscape');
    if (request !== orientationRequest || !document.fullscreenElement) orientation.unlock?.();
    else orientationHeld = true;
  } catch { /* Use the viewport fallback. */ }
}
export function releaseImmersiveOrientation() {
  orientationRequest++;
  if (orientationHeld) {globalThis.screen?.orientation?.unlock?.(); orientationHeld = false;}
}
/** Called synchronously by the actual Enter/Fullscreen click, never by an effect. */
export async function enterImmersiveFullscreen(container: HTMLElement | null, portrait: boolean) {
  if (!container) return;
  try {
    if (!document.fullscreenElement && container.requestFullscreen) await container.requestFullscreen();
    else if (!document.fullscreenElement) {
      const video = container.querySelector('video') as (HTMLVideoElement & {webkitEnterFullscreen?: () => void}) | null;
      video?.webkitEnterFullscreen?.();
    }
    if (container.isConnected) await alignImmersiveOrientation(portrait);
    else if (document.fullscreenElement === container) await document.exitFullscreen?.();
  } catch { /* Full-viewport CSS remains usable when browser policy denies fullscreen. */ }
}
