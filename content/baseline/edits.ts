import { mediaAssets, assetUrl } from "./media-assets.js";

import type { ContentFormat, VideoSourceType } from "../types/content";
export { type VideoSourceType } from "../types/content";

export type Edit = {
  id: number;
  title: string;
  category: string;
  tags: string[];
  description: string;
  creator: string;
  poster: string;
  source: string;
  duration: string;
  trending: boolean;
  format?: ContentFormat;
  fandomIds?: string[];
  sourceType?: VideoSourceType;
  youtubeVideoId?: string;
  channelTitle?: string;
  channelId?: string;
  sourceUrl?: string;
};

export function isYouTubeEmbed(edit: Edit): boolean {
  return (
    edit.sourceType === "youtube_embed" &&
    typeof edit.youtubeVideoId === "string" &&
    edit.youtubeVideoId.length === 11
  );
}

export function isLocalDemo(edit: Edit): boolean {
  return !edit.sourceType || edit.sourceType === "local_demo";
}

export function getCanonicalSourceUrl(edit: Edit): string {
  if (edit.sourceType === "youtube_embed" && edit.youtubeVideoId) {
    return `https://www.youtube.com/watch?v=${edit.youtubeVideoId}`;
  }
  return edit.source;
}
const titles = [
  "Into the Light",
  "Echoes of Tomorrow",
  "Fragments",
  "Red Horizon",
  "Silent World",
  "Neon Soul",
  "Broken Crowns",
  "Liminal",
  "Darkest Days",
  "Reflections",
  "Chasing Heaven",
  "Afterglow",
  "Cold Hearts",
  "Parallel",
  "Lost Signal",
  "Radiant",
  "Midnight City",
];
const categories = [
  "Cinematic",
  "Gaming",
  "Anime",
  "Movies",
  "Series",
  "Phonk",
];
export const edits: Edit[] = titles.map((title, id) => ({
  id,
  title,
  category: categories[id % 6],
  tags: [
    categories[id % 6].toLowerCase(),
    "original",
    "demo",
    id % 2 ? "neon" : "landscape",
  ],
  description:
    "Original geometric artwork. Silent motion study for player testing; not finished creator footage.",
  creator: "Lolixco demo",
  poster: assetUrl(mediaAssets.posters[id], import.meta.env?.BASE_URL ?? "/"),
  source: assetUrl(mediaAssets.video, import.meta.env?.BASE_URL ?? "/"),
  duration: "0:12",
  trending: id > 10,
}));
export const categoriesList = [
  "Featured",
  "Trending",
  "Anime",
  "Movies",
  "Series",
  "Gaming",
  "Phonk",
  "Cinematic",
  "New",
];
