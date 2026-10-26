import type { Edit } from "../data/edits";

export function getUtcDaySeed(date: Date = new Date()): number {
  return (
    date.getUTCFullYear() * 10000 +
    (date.getUTCMonth() + 1) * 100 +
    date.getUTCDate()
  );
}

/** Consumes compiler-verified public records, never private intake/audit records.
 * Source type describes playback, not approval. Tests may explicitly inject a
 * synthetic public catalog; that does not authorize publication of those fixtures.
 * A UTC epoch-day cycle guarantees distinct consecutive days for pools > 1,
 * including month/year boundaries. Source-neutral ID ordering stabilizes rotation.
 */
export function selectEditOfTheMoment(
  catalog: Edit[],
  date: Date = new Date(),
  shuffleOffset: number = 0,
): Edit | null {
  if (!catalog?.length) return null;
  const landscape = catalog.filter((e) => e.format === "video" || !e.format);
  const pool = [
    ...new Map(
      landscape
        .filter(
          (e) =>
            e.format === "video" &&
            (e.sourceType === "youtube_embed" ||
              e.sourceType === "licensed_local_media"),
        )
        .map((e) => [e.id, e]),
    ).values(),
  ].sort((a, b) => a.id - b.id);
  // Never substitute an arbitrary demo or a portrait item when Demo 0 is absent.
  if (!pool.length)
    return (
      landscape.find(
        (e) => e.id === 0 && (!e.sourceType || e.sourceType === "local_demo"),
      ) ?? null
    );
  const day = Number.isFinite(date.getTime())
    ? Math.floor(date.getTime() / 86400000)
    : 0;
  const offset = Number.isSafeInteger(shuffleOffset) ? shuffleOffset : 0;
  const index =
    ((((day % pool.length) + (offset % pool.length)) % pool.length) +
      pool.length) %
    pool.length;
  return pool[index];
}
