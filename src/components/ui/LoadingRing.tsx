import { useId } from "react";

export interface LoadingRingProps {
  label?: string;
  size?: "small" | "medium" | "large";
  className?: string;
}

/** One lightweight, reduced-motion-aware loading mark for asynchronous work. */
export function LoadingRing({ label = "Loading", size = "medium", className = "" }: LoadingRingProps) {
  const gradient = `loading-gold-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return <span className={`loading-ring loading-ring--${size} ${className}`}
    role={label ? "status" : undefined} aria-live={label ? "polite" : undefined}
    aria-hidden={label ? undefined : true}>
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <defs><linearGradient id={gradient} x1="7" y1="5" x2="40" y2="42" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fffca1"/><stop offset=".38" stopColor="#fff027"/><stop offset="1" stopColor="#d99a12"/>
      </linearGradient></defs>
      <circle className="loading-ring__track" cx="24" cy="24" r="18.5" strokeWidth="3.5"/>
      <circle className="loading-ring__arc" cx="24" cy="24" r="18.5" stroke={`url(#${gradient})`}
        strokeWidth="3.5" strokeLinecap="round" strokeDasharray="86 31"/>
      <circle className="loading-ring__inner" cx="24" cy="24" r="13" strokeWidth=".6"/>
    </svg>
    {label && <span className="loading-ring__label">{label}</span>}
  </span>;
}

export default LoadingRing;
