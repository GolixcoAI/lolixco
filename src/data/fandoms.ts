import type {
  CanonicalCategory,
  LegacyCategory,
  BrowsingCategory,
} from "../types/content";

export interface Fandom {
  /** Stable slug identifier, e.g. 'jujutsu-kaisen', 'valorant' */
  id: string;
  /** Human-readable display label, e.g. 'Jujutsu Kaisen', 'Valorant' */
  title: string;
  /** Primary categories this fandom belongs to */
  categories: CanonicalCategory[];
  /** Optional descriptive summary */
  description?: string;
}

/**
 * Explicit registry of recognized fandoms.
 * Decouples stable IDs from human-readable labels and avoids freeform string guessing.
 */
export const FANDOM_REGISTRY: readonly Fandom[] = [
  {
    id: "jujutsu-kaisen",
    title: "Jujutsu Kaisen",
    categories: ["Anime"],
    description: "Supernatural sorcery, high-impact combat, and domain expansions.",
  },
  {
    id: "demon-slayer",
    title: "Demon Slayer",
    categories: ["Anime"],
    description: "Breathing styles, blades, and kinetic action choreography.",
  },
  {
    id: "spider-man",
    title: "Spider-Man",
    categories: ["Movies"],
    description: "Multiverse web-slinging, kinetic aerial stunts, and cinematic heroics.",
  },
  {
    id: "valorant",
    title: "Valorant",
    categories: ["Gaming"],
    description: "Tactical ability shooters, clutch plays, and vibrant agent syncs.",
  },
  {
    id: "doom",
    title: "Doom",
    categories: ["Gaming"],
    description: "Relentless heavy metal rhythm, demon slaying, and visceral motion.",
  },
] as const;

/**
 * Production canonical categories.
 */
export const PRIMARY_CATEGORIES: readonly CanonicalCategory[] = [
  "Anime",
  "Movies",
  "Series",
  "Multifandom",
  "Gaming",
  "Phonk",
  "Motivation",
] as const;

/**
 * Legacy demo category preserved for demo artwork compatibility.
 * NOT aliased to Movies or Multifandom.
 */
export const LEGACY_CATEGORIES: readonly LegacyCategory[] = [
  "Cinematic",
] as const;

/**
 * Complete set of category navigation choices for Level 1 browsing.
 */
export const NAVIGATION_CATEGORIES: readonly BrowsingCategory[] = [
  "All",
  ...PRIMARY_CATEGORIES,
  ...LEGACY_CATEGORIES,
] as const;

/**
 * Retrieve registered fandoms belonging to the specified category.
 * If category is 'All' or has no registered sub-fandoms, returns an empty array.
 */
export function getFandomsForCategory(category: string): Fandom[] {
  if (!category || category === "All") return [];
  return FANDOM_REGISTRY.filter((fandom) =>
    fandom.categories.some((cat) => cat.toLowerCase() === category.toLowerCase())
  );
}

/**
 * Find fandom metadata by its canonical slug ID.
 */
export function getFandomById(fandomId: string): Fandom | undefined {
  if (!fandomId) return undefined;
  const normalized = fandomId.trim().toLowerCase();
  return FANDOM_REGISTRY.find((f) => f.id === normalized);
}

/**
 * Check if a fandom ID is compatible with an active category.
 * Note: 'All' is a top-level category overview without sub-fandom navigation chips.
 * Under 'All', no fandom filter can be active, ensuring all active filters are visible.
 */
export function isFandomCompatibleWithCategory(
  fandomId: string,
  category: string
): boolean {
  if (!fandomId || !category || category === "All") return false;
  const fandom = getFandomById(fandomId);
  if (!fandom) return false;
  return fandom.categories.some(
    (cat) => cat.toLowerCase() === category.toLowerCase()
  );
}

/**
 * Validate whether a string is a recognized navigation category.
 */
export function isValidBrowsingCategory(category: string): category is BrowsingCategory {
  return NAVIGATION_CATEGORIES.some(
    (c) => c.toLowerCase() === category.trim().toLowerCase()
  );
}

/**
 * Canonical display casing for a category string.
 */
export function normalizeCategoryCase(category: string): BrowsingCategory | undefined {
  const match = NAVIGATION_CATEGORIES.find(
    (c) => c.toLowerCase() === category.trim().toLowerCase()
  );
  return match;
}
