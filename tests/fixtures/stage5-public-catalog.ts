/** Synthetic public-catalog shape for isolated UI tests only. NOT published media,
 * owner approval, rights evidence, or an input to the production compiler. */
import type { Edit } from "../../src/data/edits";
import { edits } from "../../src/data/edits";
const categories = [
  "Anime",
  "Movies",
  "Series",
  "Multifandom",
  "Gaming",
  "Phonk",
  "Anime",
  "Gaming",
];
export function publicFixture(
  id: number,
  sourceType: "youtube_embed" | "licensed_local_media",
  format: "video" | "short",
  category = "Anime",
): Edit {
  const youtubeVideoId = `fixture${String(id).padStart(4, "0")}`;
  return {
    id,
    title: `Synthetic ${sourceType === "youtube_embed" ? "YouTube" : "Lolixco"} ${id}`,
    category,
    tags: ["fixture", category.toLowerCase()],
    description:
      "Synthetic public catalog UI fixture; not genuine published content.",
    creator: "",
    duration: "0:12",
    trending: false,
    format,
    sourceType,
    fandomIds: category === "Anime" ? ["jujutsu-kaisen"] : [],
    source:
      sourceType === "youtube_embed"
        ? `https://www.youtube.com/watch?v=${youtubeVideoId}`
        : `https://media.example.invalid/optimized/fixture-${id}.mp4`,
    poster:
      sourceType === "youtube_embed"
        ? `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`
        : `https://media.example.invalid/posters/fixture-${id}.jpg`,
    ...(sourceType === "youtube_embed"
      ? {
          youtubeVideoId,
          channelTitle: `Synthetic channel ${id}`,
          channelId: "UCabcdefghijklmnopqrstuv",
          sourceUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
        }
      : {}),
  };
}
export const youtube = categories.map((category, i) =>
  publicFixture(100 + i, "youtube_embed", "video", category),
);
export const hosted = categories.map((category, i) =>
  publicFixture(300 + i, "licensed_local_media", "video", category),
);
export const shorts = [
  publicFixture(200, "youtube_embed", "short"),
  publicFixture(400, "licensed_local_media", "short", "Gaming"),
];
export const mixed = [...edits, ...youtube, ...hosted, ...shorts];
