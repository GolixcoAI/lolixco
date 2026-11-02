import type { Edit } from "../data/edits";

/** Keep protected demos in the compiled pair, but omit them from real discovery.
 * A demo-only build retains its existing experience until publication is approved.
 */
export function discoveryCatalog(catalog: Edit[]): Edit[] {
  const real = catalog.filter(
    (edit) =>
      edit.sourceType === "youtube_embed" ||
      edit.sourceType === "licensed_local_media",
  );
  return real.length ? real : catalog;
}
