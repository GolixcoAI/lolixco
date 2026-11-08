import { mediaAssets, assetUrl } from "../../data/media-assets.js";

export function BrandLogo({ onHome }: { onHome: () => void }) {
  return (
    <span className="brand-lockup"><a
      className="brand"
      href="#main"
      onClick={onHome}
      aria-label="Lolixco home, beta"
    >
      <img
        src={assetUrl(mediaAssets.wordmark, import.meta.env?.BASE_URL ?? "/")}
        alt="Lolixco"
      />
    </a><span className="brand-beta" aria-hidden="true">BETA</span></span>
  );
}

export function BrandIcon() {
  return (
    <img
      className="brand-icon"
      src={assetUrl(mediaAssets.icon, import.meta.env?.BASE_URL ?? "/")}
      alt="Lolixco"
    />
  );
}
