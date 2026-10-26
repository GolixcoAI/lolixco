import type { Edit } from "./edits";
import { PRIMARY_CATEGORIES } from "./fandoms";
import type { FeedSection } from "../types/content";

export interface CompositionConfig {
  maxRecommendedVideos?: number;
  maxShortsPerShelf?: number;
  maxMoreVideos?: number;
  recommendedTitle?: string;
  shortsTitle?: string;
  moreTitle?: string;
}

const DEFAULT_CONFIG: Required<CompositionConfig> = {
  maxRecommendedVideos: 6,
  maxShortsPerShelf: 10,
  maxMoreVideos: 8,
  recommendedTitle: "Recommended Edits",
  shortsTitle: "Curated Shorts",
  moreTitle: "More to Discover",
};

/**
 * Determines whether an edit is formatted as a vertical short.
 * Missing format or format === "video" defaults to standard video for legacy compatibility.
 * An edit is NEVER classified as a Short merely because of short duration.
 */
export function isShort(edit: Edit | null | undefined): boolean {
  if (!edit) return false;
  return edit.format === "short";
}

/**
 * Determines whether an edit is a standard landscape video edit.
 */
export function isVideo(edit: Edit | null | undefined): boolean {
  if (!edit) return false;
  return !isShort(edit);
}

export interface ComposeHomeFeedOptions {
  recommendedVideos: Edit[];
  catalog: Edit[];
  currentEditId?: number | null;
  config?: CompositionConfig;
}

/** Resolve ranked IDs against the supplied public catalog, never server media objects.
 * Publication approval belongs to the compiler. This function accepts only its
 * public output (or explicitly injected synthetic public catalogs in tests).
 */
export function rankCatalogVideos(
  catalog: Edit[],
  candidates: readonly { id: number }[],
): Edit[] {
  const canonical = new Map<number, Edit>();
  for (const edit of catalog) {
    if (isVideo(edit) && !canonical.has(edit.id)) canonical.set(edit.id, edit);
  }
  const ordered: Edit[] = [];
  const seen = new Set<number>();
  for (const candidate of [...candidates, ...canonical.values()]) {
    const edit = canonical.get(candidate?.id);
    if (edit && !seen.has(edit.id)) {
      ordered.push(edit);
      seen.add(edit.id);
    }
  }
  return ordered;
}

const CATEGORY_ORDER: readonly string[] = PRIMARY_CATEGORIES;

/** Canonical category order; unknown/legacy categories retain first-seen order. */
export function groupVideoCategories(items: Edit[]) {
  const groups = new Map<string, Edit[]>();
  for (const item of items) {
    const title = item.category.trim() || "Other";
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title)!.push(item);
  }
  return [
    ...CATEGORY_ORDER,
    ...[...groups.keys()].filter((key) => !CATEGORY_ORDER.includes(key)),
  ]
    .filter((key) => groups.has(key))
    .map((title) => ({ id: title, title, items: groups.get(title)! }));
}

/** Source partitioning is independent of recommendation ranking and deduplication.
 * Source previews retain catalog order; ranked residuals populate More to Discover.
 * Demos retain their original discovery layout when no real landscape is present.
 */
export function composeHomeFeed({
  recommendedVideos,
  catalog,
  currentEditId,
  config = {},
}: ComposeHomeFeedOptions): FeedSection[] {
  const settings = { ...DEFAULT_CONFIG, ...config };
  const sections: FeedSection[] = [];
  const used = new Set<number>(
    typeof currentEditId === "number" ? [currentEditId] : [],
  );
  const videos = rankCatalogVideos(catalog, []);
  const ranked = rankCatalogVideos(catalog, recommendedVideos);
  const take = (pool: Edit[], limit: number) => {
    const items: Edit[] = [];
    for (const item of pool) {
      if (items.length >= limit) break;
      if (!used.has(item.id)) {
        used.add(item.id);
        items.push(item);
      }
    }
    return items;
  };
  const addRow = (
    id: string,
    title: string,
    items: Edit[],
    grouped = false,
  ) => {
    if (items.length)
      sections.push({
        type: "video_row",
        id,
        title,
        items,
        ...(grouped ? { groups: groupVideoCategories(items) } : {}),
      });
  };
  const real = videos.some(
    (e) =>
      e.sourceType === "youtube_embed" ||
      e.sourceType === "licensed_local_media",
  );
  if (real) {
    addRow(
      "youtube-videos",
      "Videos from YouTube",
      take(
        videos.filter((e) => e.sourceType === "youtube_embed"),
        settings.maxRecommendedVideos,
      ),
      true,
    );
  } else {
    addRow(
      "recommended-edits",
      settings.recommendedTitle,
      take(ranked, settings.maxRecommendedVideos),
    );
  }
  const shortIds = new Set<number>();
  const shorts = catalog
    .filter((e) => {
      if (!isShort(e) || shortIds.has(e.id)) return false;
      shortIds.add(e.id);
      return true;
    })
    .slice(0, Math.max(0, settings.maxShortsPerShelf));
  if (shorts.length)
    sections.push({
      type: "shorts_shelf",
      id: "curated-shorts",
      title: settings.shortsTitle,
      items: shorts,
    });
  if (real)
    addRow(
      "lolixco-uploads",
      "Lolixco Uploads",
      take(
        videos.filter((e) => e.sourceType === "licensed_local_media"),
        settings.maxRecommendedVideos,
      ),
      true,
    );
  addRow(
    "more-to-discover",
    settings.moreTitle,
    take(ranked, settings.maxMoreVideos),
  );
  return sections;
}

/**
 * Filter Shorts by category, fandom, and search text while preserving format safety.
 */
export function filterShorts(
  catalog: Edit[],
  options?: { category?: string; fandomId?: string; query?: string },
): Edit[] {
  let list = catalog.filter((e) => isShort(e));

  if (!options) return list;

  const { category, fandomId, query } = options;

  if (category && category !== "All") {
    list = list.filter((e) => e.category === category);
  }

  if (fandomId && fandomId !== "all") {
    list = list.filter((e) => e.fandomIds && e.fandomIds.includes(fandomId));
  }

  if (query && query.trim()) {
    const qLower = query.trim().toLowerCase();
    list = list.filter(
      (e) =>
        e.title.toLowerCase().includes(qLower) ||
        e.tags.some((t) => t.toLowerCase().includes(qLower)) ||
        e.description.toLowerCase().includes(qLower),
    );
  }

  return list;
}

/**
 * Separates mixed search or category results into landscape videos and portrait shorts
 * without altering each group's relative relevance ranking.
 */
export function splitMixedResults(items: Edit[]): {
  videos: Edit[];
  shorts: Edit[];
} {
  const videos: Edit[] = [];
  const shorts: Edit[] = [];

  for (const item of items) {
    if (isShort(item)) {
      shorts.push(item);
    } else {
      videos.push(item);
    }
  }

  return { videos, shorts };
}
