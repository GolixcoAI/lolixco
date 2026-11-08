import { useEffect, useState } from "react";

export default function ConnectionNotice() {
  const [state, setState] = useState<"offline" | "restored" | null>(() => typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const offline = () => { clearTimeout(timer); setState("offline"); };
    const online = () => { setState("restored"); clearTimeout(timer); timer = setTimeout(() => setState(null), 6000); };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => { clearTimeout(timer); window.removeEventListener("offline", offline); window.removeEventListener("online", online); };
  }, []);
  return state ? <div className={`connection-notice ${state}`} role="status" aria-live="polite">
    <div><strong>{state === "offline" ? "You're offline" : "Connection restored"}</strong>
      <span>{state === "offline" ? "Videos may not load. Check your connection, then retry." : "You can retry any video or analysis that stopped."}</span></div>
    {state === "restored" && <button type="button" onClick={() => setState(null)} aria-label="Dismiss connection notice">Dismiss</button>}
  </div> : null;
}
