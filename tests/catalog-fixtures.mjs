import { edits } from "../src/data/edits.ts";
export const NOW = "2026-10-25T12:00:00Z";
export const ORIGIN = "https://cdn.fixture.invalid";
export function youtube(id = 100, videoId = "12345678901") {
  const format = id >= 200 ? "short" : "video";
  return {
    canonicalVideoId: videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    assignedLolixcoId: id,
    category: "Anime",
    format,
    formatConfirmed: true,
    confirmedFormat: format,
    contentReviewStatus: "approved",
    provenance: "youtube_data_api_v3",
    metadataFetchStatus: "fetched",
    lastMetadataVerification: NOW,
    playbackVerification: {
      identity: videoId,
      status: "passed",
      verifiedAt: NOW,
    },
    metadata: {
      canonicalVideoId: videoId,
      title: "Offline compiler fixture",
      description: "A fixture made only for isolated tests.",
      channelTitle: "Fixture creator",
      channelId: "UC_FIXTURE_CREATOR",
      durationSec: 30,
      durationFormatted: "0:30",
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      tags: ["anime edit"],
      privacyStatus: "public",
      embeddable: true,
      provenance: "youtube_data_api_v3",
    },
  };
}
export function hosted(id = 300) {
  const format = id >= 400 ? "short" : "video",
    direction = format === "short" ? "portrait" : "landscape",
    key = `asset-${id}`;
  const source = `${ORIGIN}/optimized/${direction}/${key}.mp4`,
    poster = `${ORIGIN}/posters/${direction}/${key}.webp`;
  return {
    assetRef: key,
    assignedLolixcoId: id,
    sourceType: "licensed_local_media",
    format,
    contentReviewStatus: "approved",
    provenance: "owner_direct_upload",
    formatConfirmed: true,
    confirmedFormat: format,
    rightsCleared: true,
    rightsDocumentation: "offline-license-fixture",
    rights: {
      videoDistribution: true,
      audioDistribution: true,
      documentationRef: "offline-license-fixture",
    },
    title: "Hosted fixture",
    description: "Offline hosted fixture only.",
    creator: "Fixture owner",
    category: "Anime",
    tags: ["anime"],
    duration: "0:30",
    deliveryUrl: source,
    posterDeliveryUrl: poster,
    mediaVerification: {
      assetRef: key,
      source,
      poster,
      format,
      sha256: "a".repeat(64),
      decodeVerified: true,
      verifiedAt: NOW,
      width: format === "short" ? 1080 : 1920,
      height: format === "short" ? 1920 : 1080,
      codec: "h264",
      audioCodec: "aac",
      durationSec: 30,
    },
    playbackVerification: { identity: key, status: "passed", verifiedAt: NOW },
  };
}
export function inputs(paths) {
  return {
    youtubeAudit: { items: [youtube(), youtube(200, "abcdefghijk")] },
    hostedAudit: { items: [hosted(), hosted(400)] },
    previousCatalog: structuredClone(edits),
    policy: { approvedOrigins: [ORIGIN] },
    now: NOW,
    outputPath: paths[0],
    snapshotPath: paths[1],
  };
}
