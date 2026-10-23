/**
 * Content format, taxonomy, public and private contract type definitions for Lolixco.
 * 
 * Separates:
 * - Content format (video vs. short)
 * - Source types (local_demo, youtube_embed, licensed_local_media)
 * - ID partitions across sources and formats
 * - Canonical production categories vs. legacy demo categories
 * - Public media contracts vs. private editorial and audit contracts
 */

export type ContentFormat = "video" | "short";

/**
 * Distinguishes the underlying playback mechanism:
 * - local_demo: Sample geometric motion study served locally (baseline demos 0-16)
 * - youtube_embed: Curated external YouTube edit played via official IFrame API
 * - licensed_local_media: Future creator-hosted direct video files
 */
export type VideoSourceType =
  | "local_demo"
  | "youtube_embed"
  | "licensed_local_media";

/**
 * Production primary categories for the curated Lolixco catalog.
 */
export type CanonicalCategory =
  | "Anime"
  | "Movies"
  | "Series"
  | "Multifandom"
  | "Gaming"
  | "Phonk";

/**
 * Legacy demo category preserved for backward compatibility with initial sample assets.
 * Cinematic is NOT aliased to Movies or Multifandom.
 */
export type LegacyCategory = "Cinematic";

/**
 * All recognized content categories across canonical and legacy items.
 */
export type ContentCategory = CanonicalCategory | LegacyCategory;

/**
 * Category bar navigation choices: "All" represents global browsing mode,
 * alongside individual content categories.
 */
export type BrowsingCategory = "All" | ContentCategory;

/**
 * ID Partition boundaries across content sources and formats.
 */
export const ID_PARTITIONS = {
  DEMO: { min: 0, max: 16, description: "Baseline demo edits" },
  RESERVED_TEST: { min: 17, max: 99, description: "Internal test harness" },
  YOUTUBE_VIDEO: { min: 100, max: 199, description: "Curated landscape YouTube videos" },
  YOUTUBE_SHORT: { min: 200, max: 299, description: "Curated portrait YouTube shorts" },
  HOSTED_VIDEO: { min: 300, max: 399, description: "Licensed hosted landscape videos" },
  HOSTED_SHORT: { min: 400, max: 499, description: "Licensed hosted portrait shorts" },
  RESERVED_UPPER: { min: 500, max: Infinity, description: "Unallocated / reserved" },
} as const;

/**
 * Public catalog edit record presented to visitors and rendered by client components.
 * Format and sourceType are optional for backward compatibility with frozen demo items 0-16.
 * All internal review statuses, S3 keys, and audit history are strictly excluded.
 */
export interface PublicEdit {
  id: number;
  title: string;
  category: ContentCategory | string;
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
}

/**
 * Public metadata presented to visitors.
 * Intentionally excludes creator names, private ratings, or platform view metrics.
 */
export interface PublicMediaMetadata {
  id: number;
  format: ContentFormat;
  title: string;
  description: string;
  category: ContentCategory;
  fandomIds?: string[];
  tags: string[];
  poster: string;
  source: string;
  duration: string;
  sourceType?: VideoSourceType;
  youtubeVideoId?: string;
  channelTitle?: string;
  channelId?: string;
  sourceUrl?: string;
}

/**
 * Optional private editorial metadata preserved for administration or curation.
 */
export interface EditorialMetadata {
  curatorNotes?: string;
  reviewStatus?: "draft" | "reviewed" | "approved" | "rejected" | "published";
  rightsCleared?: boolean;
  sourceAttribution?: string;
  ownerAssetRef?: string;
  originalAspectRatio?: "16:9" | "9:16" | "4:3" | "2.39:1";
  legacyCreatorId?: string;
}

/**
 * Common private editorial/provenance audit fields.
 */
export interface BaseAuditRecord {
  assignedLolixcoId?: number;
  category?: ContentCategory | string;
  ownerCategory?: string;
  fandomIds?: string[];
  ownerFandomIds?: string[];
  ownerFandom?: string;
  contentReviewStatus?:
    | "draft"
    | "metadata_collected"
    | "embed_eligible"
    | "needs_recheck"
    | "approved"
    | "rejected"
    | "unavailable"
    | "published";
  auditHistory?: Array<{
    date: string;
    event: string;
    status?: string;
    assignedLolixcoId?: number;
    notes?: string;
  }>;
  curatorNotes?: string;
}

/**
 * YouTube intake and audit record contract (describes existing private audit records).
 */
export interface YouTubeAuditRecord extends BaseAuditRecord {
  sourceType?: "youtube_embed";
  canonicalVideoId: string;
  canonicalUrl?: string;
  format?: ContentFormat;
  formatConfirmed?: boolean;
  confirmedFormat?: ContentFormat;
  provenance?: string;
  metadataFetchStatus?: string;
  lastMetadataVerification?: string;
  isMock?: boolean;
  syntheticOrigin?: string;
  metadata?: {
    canonicalVideoId?: string;
    title?: string;
    description?: string;
    channelTitle?: string;
    channelId?: string;
    durationSec?: number;
    durationSeconds?: number;
    durationFormatted?: string;
    thumbnailUrl?: string;
    privacyStatus?: "public" | "unlisted" | "private";
    embeddable?: boolean;
    provenance?: string;
    isMock?: boolean;
    syntheticOrigin?: string;
    tags?: string[];
    hashtags?: string[];
  };
  trending?: boolean;
}

/**
 * Hosted licensed media intake and audit record contract.
 */
export interface HostedAuditRecord extends BaseAuditRecord {
  sourceType: "licensed_local_media";
  assetRef: string;
  format: ContentFormat;
  rightsCleared: boolean;
  rightsDocumentation: string;
  playbackVerifiedAt?: string;
  media?: {
    aspectRatio: "16:9" | "9:16" | "4:3" | "2.39:1";
    width: number;
    height: number;
    codec: string;
    audioCodec?: string;
    frameRate?: number;
    bitrateKbps?: number;
    loudnessLkfs?: number;
  };
  deliveryUrl?: string;
  posterDeliveryUrl?: string;
}

/**
 * Union of all private audit records.
 */
export type PrivateAuditRecord = YouTubeAuditRecord | HostedAuditRecord;

/**
 * Format-aware feed section model.
 * Distinguishes landscape video rows from portrait shorts shelves.
 */
export type FeedSection<T = import("../data/edits").Edit> =
  | {
      type: "video_row";
      id: string;
      title: string;
      items: T[];
    }
  | {
      type: "shorts_shelf";
      id: string;
      title: string;
      items: T[];
    };
