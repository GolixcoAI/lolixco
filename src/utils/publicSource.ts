import type { Edit } from "../data/edits";

/** Display only reviewed public fields. Creator/metrics are never inferred. */
export function publicSource(edit: Edit): {
  label: string;
  attribution: string | null;
} {
  if (edit.sourceType === "youtube_embed")
    return {
      label: edit.format === "short" ? "YouTube Short" : "YouTube",
      attribution: edit.channelTitle?.trim() || null,
    };
  if (edit.sourceType === "licensed_local_media")
    return {
      label: edit.format === "short" ? "Lolixco Short" : "Lolixco",
      attribution: null,
    };
  return { label: "Demo / Sample", attribution: null };
}
