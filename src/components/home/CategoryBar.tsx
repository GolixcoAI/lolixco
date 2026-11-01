import {
  Star,
  Cat,
  Clapperboard,
  Tv,
  Gamepad2,
  Music,
  Film,
  Sparkles,
  Flame,
  type LucideIcon,
} from "lucide-react";
import {
  NAVIGATION_CATEGORIES,
  getFandomsForCategory,
} from "../../data/fandoms";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  All: Star,
  Anime: Cat,
  Movies: Clapperboard,
  Series: Tv,
  Multifandom: Sparkles,
  Gaming: Gamepad2,
  Phonk: Music,
  Motivation: Flame,
  Cinematic: Film,
};

export interface CategoryBarProps {
  category: string;
  onSelectCategory: (category: string) => void;
  fandomId?: string;
  onSelectFandom: (fandomId: string) => void;
}

export function CategoryBar({
  category,
  onSelectCategory,
  fandomId,
  onSelectFandom,
}: CategoryBarProps) {
  const currentCategory = category || "All";
  const availableFandoms = getFandomsForCategory(currentCategory);
  const isAllFandomSelected = !fandomId || fandomId === "all";

  return (
    <div className="topic-navigation">
      <nav className="categories" aria-label="Content categories">
        {NAVIGATION_CATEGORIES.map((catName) => {
          const Icon = CATEGORY_ICONS[catName] || Sparkles;
          const isSelected =
            currentCategory.toLowerCase() === catName.toLowerCase() ||
            (catName === "All" && currentCategory === "Featured");

          return (
            <button
              key={catName}
              type="button"
              className={isSelected ? "primary" : ""}
              aria-pressed={isSelected}
              onClick={() => onSelectCategory(catName)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{catName}</span>
            </button>
          );
        })}
      </nav>

      {availableFandoms.length > 0 && (
        <nav
          className="fandoms-bar"
          aria-label={`${currentCategory} fandoms`}
        >
          <button
            type="button"
            className={`fandom-chip ${isAllFandomSelected ? "primary" : ""}`}
            aria-pressed={isAllFandomSelected}
            onClick={() => onSelectFandom("all")}
          >
            <span>All {currentCategory}</span>
          </button>
          {availableFandoms.map((fandom) => {
            const isSelected =
              fandomId?.toLowerCase() === fandom.id.toLowerCase();
            return (
              <button
                key={fandom.id}
                type="button"
                className={`fandom-chip ${isSelected ? "primary" : ""}`}
                aria-pressed={isSelected}
                onClick={() => onSelectFandom(fandom.id)}
              >
                <span>{fandom.title}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
