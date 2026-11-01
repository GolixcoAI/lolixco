import { useSyncExternalStore } from "react";
// Tab-memory preference: a fresh page starts muted. No autoplay permission is implied.
let muted = true;
const listeners = new Set<() => void>();
export function setSessionMuted(value: boolean | ((previous: boolean) => boolean)) {
  const next = typeof value === "function" ? value(muted) : value;
  if (next === muted) return;
  muted = next;
  listeners.forEach((notify) => notify());
}
const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
};
export function useSessionAudio(): [boolean, typeof setSessionMuted] {
  return [useSyncExternalStore(subscribe, () => muted, () => true), setSessionMuted];
}
