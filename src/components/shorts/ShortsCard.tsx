import PosterImage from "../ui/PosterImage";
import type { Edit } from "../../data/edits";
import { publicSource } from "../../utils/publicSource";
import { getFandomById } from "../../data/fandoms";

export interface ShortsCardProps {
  short: Edit;
  onSelect: (short: Edit) => void;
  onTagClick?: (tag: string) => void;
  compact?: boolean;
}

export function ShortsCard({
  short,
  onSelect,
  onTagClick,
  compact = false,
}: ShortsCardProps) {
  const source = publicSource(short);
  const fandomTitle = short.fandomIds?.[0]
    ? getFandomById(short.fandomIds[0])?.title
    : null;

  return (
    <article
      className={compact ? "shorts-card compact" : "shorts-card"}
      aria-label={`Short: ${short.title}`}
    >
      <button
        type="button"
        className="shorts-watch-trigger"
        onClick={() => onSelect(short)}
        aria-label={`Watch short: ${short.title}`}
      >
        <div className="shorts-thumbnail">
          <PosterImage src={short.poster} title={short.title} portrait/>
          {short.duration && (
            <span className="shorts-duration">{short.duration}</span>
          )}

          <div className="shorts-card-info">
            <span className="shorts-badge">{source.label}</span>
            <h3>{short.title}</h3>
            <small>
              {fandomTitle ? `${fandomTitle} · ` : ""}
              {short.category}
            </small>
            {source.attribution && (
              <small className="source-attribution">{source.attribution}</small>
            )}
          </div>
        </div>
      </button>

      {!compact && short.tags && short.tags.length > 0 && (
        <div
          className="card-tags shorts-tags"
          role="group"
          aria-label={`Tags for ${short.title}`}
        >
          {short.tags.slice(0, 2).map((tag) => (
            <button
              key={tag}
              type="button"
              className="tag-chip"
              onClick={(e) => {
                e.stopPropagation();
                onTagClick?.(tag);
              }}
              aria-label={`Filter by #${tag}`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
