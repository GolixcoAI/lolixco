import { useState } from "react";
import { Film } from "lucide-react";
import type { Edit } from "../../data/edits";
import { publicSource } from "../../utils/publicSource";

export { CategoryBar } from "./CategoryBar";

export interface VideoCardProps {
  edit: Edit;
  onSelect: (e: Edit) => void;
  onSelectShort?: (short: Edit) => void;
  onTagClick?: (tag: string) => void;
  compact?: boolean;
}

export function VideoCard({
  edit,
  onSelect,
  onSelectShort,
  onTagClick,
  compact = false,
}: VideoCardProps) {
  const [failedPoster, setFailedPoster] = useState<string | null>(null);

  const source = publicSource(edit);

  const handleClick = () => {
    if (edit.format === "short" && onSelectShort) {
      onSelectShort(edit);
    } else {
      onSelect(edit);
    }
  };

  return (
    <article
      className={compact ? "video-card compact" : "video-card"}
      aria-label={edit.title}
    >
      <button
        type="button"
        className="card-watch-trigger"
        onClick={handleClick}
        aria-label={`Watch ${edit.title}`}
      >
        <div className="thumbnail">
          {!edit.poster || failedPoster === edit.poster ? (
            <span
              className="thumbnail-fallback"
              role="img"
              aria-label={`Thumbnail unavailable for ${edit.title}`}
            >
              <Film aria-hidden="true" />
              <span>Thumbnail unavailable</span>
            </span>
          ) : (
            <img
              loading="lazy"
              src={edit.poster}
              alt=""
              onError={() => setFailedPoster(edit.poster)}
            />
          )}
          {edit.format === "short" && (
            <span className="shorts-badge">Short</span>
          )}
          <span className="duration">{edit.duration}</span>
        </div>
        <div className="card-copy">
          <h3>{edit.title}</h3>
          <small>
            {edit.category} ·{" "}
            <span className="source-label">{source.label}</span>
          </small>
          {source.attribution && (
            <small className="source-attribution">{source.attribution}</small>
          )}
        </div>
      </button>

      {!compact && edit.tags && edit.tags.length > 0 && (
        <div
          className="card-tags"
          role="group"
          aria-label={`Tags for ${edit.title}`}
        >
          {edit.tags.slice(0, 3).map((tag) => (
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

export function ContentSection({
  title,
  items,
  groups,
  onSelect,
  onSelectShort,
  onTagClick,
}: {
  title: string;
  items: Edit[];
  groups?: { id: string; title: string; items: Edit[] }[];
  onSelect: (e: Edit) => void;
  onSelectShort?: (short: Edit) => void;
  onTagClick?: (tag: string) => void;
}) {
  return (
    <section className="content-section" aria-label={title}>
      <h2>{title}</h2>
      <div className={groups ? "category-groups" : undefined}>
        {(groups ?? [{ id: "all", title: "", items }]).map((group) => (
          <div className="content-category" key={group.id}>
            {group.title && <h3 className="category-heading">{group.title}</h3>}
            <div className="video-grid">
              {group.items.map((edit) => (
                <VideoCard
                  key={edit.id}
                  edit={edit}
                  onSelect={onSelect}
                  onSelectShort={onSelectShort}
                  onTagClick={onTagClick}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export { VideoCardSkeleton } from "./VideoCardSkeleton";
export { DiscoveryGridSkeleton } from "./DiscoveryGridSkeleton";
