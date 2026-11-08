import {
  ArrowRight,
  Infinity,
  Headphones,
} from "lucide-react";
export default function ImmersionBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="immersion">
      <div className="immersion-art">
        <Headphones />
      </div>
      <div className="immersion-copy">
        <h2>IMMERSION MODE</h2>
        <p>Settle into a continuous stream of great edits.</p>
      </div>
      <div className="feature">
        <Infinity />
        <span>
          Non-Stop Edits<small>Continuous discovery</small>
        </span>
      </div>
      <button className="primary" onClick={onOpen}>
        Enter Immersion
        <ArrowRight size={18} />
      </button>
    </section>
  );
}
