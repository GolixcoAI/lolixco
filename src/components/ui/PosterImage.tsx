import { useEffect, useRef, useState } from "react";
import { Film } from "lucide-react";

/** A thumbnail reserves its geometry throughout the real image request. */
export function PosterImage({ src, title, portrait = false }: { src?: string; title: string; portrait?: boolean }) {
  const image = useRef<HTMLImageElement>(null);
  const [settled, setSettled] = useState<{ source: string; state: "ready" | "unavailable" } | null>(null);
  const state = !src ? "unavailable" : settled?.source === src ? settled.state : "loading";
  useEffect(() => {
    const element = image.current;
    if (!src || !element) return;
    if (element.complete) {
      setSettled({ source: src, state: element.naturalWidth > 0 ? "ready" : "unavailable" });
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const armTimeout = () => {
      if (timeout) return;
      timeout = setTimeout(() => setSettled(previous => previous?.source === src && previous.state === "ready"
        ? previous : { source: src, state: "unavailable" }), 20000);
    };
    // Lazy images outside the viewport must not time out before their request starts.
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { armTimeout(); observer?.disconnect(); }
    }, { rootMargin: "400px" });
    if (observer) observer.observe(element); else armTimeout();
    return () => { observer?.disconnect(); clearTimeout(timeout); };
  }, [src]);
  return <span className={`poster-image poster-image--${state}`} data-media-state={state}>
    {src && <img ref={image} loading="lazy" decoding="async" src={src} alt=""
      onLoad={() => setSettled({ source: src, state: "ready" })}
      onError={() => setSettled({ source: src, state: "unavailable" })}/>}
    {state === "loading" && <span className="poster-image__skeleton skeleton-thumb" aria-hidden="true"><span className="skeleton-shimmer"/></span>}
    {state === "unavailable" && <span className={`thumbnail-fallback${portrait ? " portrait" : ""}`} role="img"
      aria-label={`Thumbnail unavailable for ${title}`}><Film aria-hidden="true"/><span>Thumbnail unavailable</span></span>}
  </span>;
}

export default PosterImage;
