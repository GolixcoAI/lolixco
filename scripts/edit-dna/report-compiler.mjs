/**
 * LOLIXCO EDIT DNA — REPORT COMPILER & STATE MACHINE
 * Part of Antigravity Mission 1 (AI Edit Analyzer R&D)
 *
 * Compiles normalized Edit DNA JSON payloads conforming to the
 * Lolixco Edit DNA Specification and manages the 7 analysis result states.
 */

import { ScoringEngine, DEFAULT_PROVISIONAL_WEIGHTS } from "./preference-engine.mjs";

export const RESULT_STATES = {
  PUBLIC_PLAYABLE: "PUBLIC_PLAYABLE_ANALYSIS_COMPLETE",
  UNAVAILABLE: "VIDEO_UNAVAILABLE_OR_RESTRICTED",
  AUDIO_UNIDENTIFIED: "AUDIO_IDENTIFICATION_UNAVAILABLE",
  FRANCHISE_ONLY: "SOURCE_FRANCHISE_ONLY",
  URL_MODE_APPROX: "URL_MODE_APPROXIMATE_METRICS",
  QUOTA_EXCEEDED: "API_QUOTA_OR_RATE_LIMIT_EXCEEDED",
  OWNER_OVERRIDE: "OWNER_CORRECTED_OVERRIDE",
};

/**
 * Compiles a full Lolixco Edit DNA Report.
 * @param {object} params
 * @returns {object} Validated Lolixco Edit DNA Report JSON.
 */
export function compileEditDnaReport(params) {
  const {
    analysisId = `dna_${Date.now()}`,
    resultState = RESULT_STATES.PUBLIC_PLAYABLE,
    intakeMode = "local_permissioned_file",
    assetMetadata = {
      filename: "sample_edit.mp4",
      durationSeconds: 30.0,
      dimensions: { width: 1080, height: 1920, aspectRatio: "9:16" },
      framerateFps: 30.0,
      videoCodec: "h264",
      audioCodec: "aac",
      bitrateKbps: 9500,
    },
    sourceIntelligence = {
      status: "identified",
      franchise: "Jujutsu Kaisen",
      canonicalTitle: "Jujutsu Kaisen Season 2 (Shibuya Incident)",
      characterFocus: ["Ryomen Sukuna"],
      confidence: 0.92,
      episodeAttribution: "Season 2 Episode 16",
    },
    musicIntelligence = {
      status: "identified",
      title: "Murder in My Mind",
      artist: "Kordhell",
      isPitchShifted: false,
      estimatedBpm: 128.0,
      integratedLufs: -12.5,
      truePeakDbtp: -0.9,
    },
    telemetry = null,
    componentRatings = {
      beat_synchronization: 8.5,
      transitions: 8.0,
      pacing: 8.0,
      visual_quality: 8.5,
      storytelling_emotion: 7.5,
      originality_creativity: 7.0,
    },
    ownerOverride = null,
    scoringWeights = DEFAULT_PROVISIONAL_WEIGHTS,
  } = params;

  // Handle error / quota states
  if (resultState === RESULT_STATES.UNAVAILABLE) {
    return {
      $schema: "https://lolixco.com/schemas/edit-dna.v1.json",
      analysis_id: analysisId,
      result_state: RESULT_STATES.UNAVAILABLE,
      error_code: "YT_RESTRICTED_ACCESS",
      message: "The target video is private, deleted, or geo-restricted.",
      actionable_guidance: "Verify video privacy is set to Public or upload a local file.",
    };
  }

  if (resultState === RESULT_STATES.QUOTA_EXCEEDED) {
    return {
      $schema: "https://lolixco.com/schemas/edit-dna.v1.json",
      analysis_id: analysisId,
      result_state: RESULT_STATES.QUOTA_EXCEEDED,
      retry_after_seconds: 60,
      message: "Model API quota temporarily exhausted. Please retry or run offline DSP.",
    };
  }

  const scoring = new ScoringEngine(scoringWeights);
  const compositeScore = scoring.calculateCompositeScore(componentRatings);
  const objectiveScore = telemetry
    ? scoring.calculateObjectiveTechnicalScore(telemetry)
    : compositeScore;

  // Adjust status based on state
  let resolvedSource = { ...sourceIntelligence };
  if (resultState === RESULT_STATES.FRANCHISE_ONLY) {
    resolvedSource.episodeAttribution = null;
    resolvedSource.confidence = 0.74;
    resolvedSource.status = "franchise_only_episode_unverified";
  }

  let resolvedMusic = { ...musicIntelligence };
  if (resultState === RESULT_STATES.AUDIO_UNIDENTIFIED) {
    resolvedMusic.status = "unmatched_transformed_audio";
    resolvedMusic.title = "Unknown / Unmatched Audio";
    resolvedMusic.artist = "Unidentified Artist";
  }

  const report = {
    $schema: "https://lolixco.com/schemas/edit-dna.v1.json",
    analysis_id: analysisId,
    result_state: resultState,
    analyzed_at: new Date().toISOString(),
    intake_mode: intakeMode,
    asset_metadata: {
      filename: assetMetadata.filename,
      duration_seconds: assetMetadata.durationSeconds,
      dimensions: assetMetadata.dimensions,
      framerate_fps: assetMetadata.framerateFps,
      video_codec: assetMetadata.videoCodec,
      audio_codec: assetMetadata.audioCodec,
      bitrate_kbps: assetMetadata.bitrateKbps,
    },
    source_intelligence: {
      status: resolvedSource.status,
      top_match: {
        franchise: resolvedSource.franchise,
        canonical_title: resolvedSource.canonicalTitle,
        character_focus: resolvedSource.characterFocus,
        confidence: resolvedSource.confidence,
      },
      episode_attribution: resolvedSource.episodeAttribution,
    },
    music_intelligence: {
      status: resolvedMusic.status,
      track: {
        title: resolvedMusic.title,
        artist: resolvedMusic.artist,
        is_pitch_shifted: resolvedMusic.isPitchShifted,
      },
      musical_characteristics: {
        estimated_bpm: resolvedMusic.estimatedBpm,
      },
      audio_engineering: {
        integrated_loudness_lufs: resolvedMusic.integratedLufs,
        true_peak_dbtp: resolvedMusic.truePeakDbtp,
      },
    },
    technical_editing_metrics: telemetry
      ? {
          total_shots: telemetry.pacing.totalShots,
          average_shot_length_seconds: telemetry.pacing.averageShotLength,
          cut_density_cps: telemetry.pacing.cutDensityCps,
          pacing_variance: telemetry.pacing.pacingVariance,
          pacing_dynamic: telemetry.pacing.pacingDynamic,
          transitions_breakdown: telemetry.transitionsBreakdown,
          synchronization: {
            beat_sync_index: telemetry.synchronization.beatSyncIndex,
            tight_cuts_count: telemetry.synchronization.tightCount,
            acceptable_cuts_count: telemetry.synchronization.acceptableCount,
            off_beat_cuts_count: telemetry.synchronization.offBeatCount,
            mean_sync_delta_ms: telemetry.synchronization.meanSyncDeltaMs,
          },
        }
      : {
          synchronization: {
            status: "unmeasured_url_mode",
            explanation: "Frame-accurate sub-millisecond sync requires local audio stream demuxing.",
          },
        },
    quality_scoring: {
      provisional_weights: scoring.getWeights(),
      component_scores: componentRatings,
      aggregate_scores: {
        objective_technical_score: objectiveScore,
        general_editorial_estimate: Number(((compositeScore + objectiveScore) / 2).toFixed(2)),
        owner_predicted_preference: compositeScore,
      },
    },
  };

  if (ownerOverride) {
    report.result_state = RESULT_STATES.OWNER_OVERRIDE;
    report.owner_override = {
      overridden_at: new Date().toISOString(),
      ...ownerOverride,
    };
  }

  return report;
}

/**
 * Format report as a sleek terminal ASCII summary card.
 * @param {object} report
 * @returns {string}
 */
export function renderAsciiSummary(report) {
  if (report.result_state === RESULT_STATES.UNAVAILABLE) {
    return `[LOLIXCO EDIT DNA] Video Unavailable: ${report.message}`;
  }

  const franchise = report.source_intelligence?.top_match?.franchise || "Unknown";
  const song = report.music_intelligence?.track?.title || "Unknown";
  const bpm = report.music_intelligence?.musical_characteristics?.estimated_bpm || "N/A";
  const score = report.quality_scoring?.aggregate_scores?.owner_predicted_preference || "N/A";
  const techScore = report.quality_scoring?.aggregate_scores?.objective_technical_score || "N/A";

  return `
============================================================
              LOLIXCO EDIT DNA — ANALYSIS REPORT
============================================================
 ID: ${report.analysis_id}
 STATE: ${report.result_state}
 INTAKE: ${report.intake_mode}
------------------------------------------------------------
 SOURCE:     ${franchise} (${report.source_intelligence?.top_match?.canonical_title || "N/A"})
 TRACK:      ${song} by ${report.music_intelligence?.track?.artist || "N/A"}
 BPM:        ${bpm} | LUFS: ${report.music_intelligence?.audio_engineering?.integrated_loudness_lufs} dB
------------------------------------------------------------
 COMPONENT RATINGS:
   Beat Sync:    ${report.quality_scoring?.component_scores?.beat_synchronization} / 10
   Transitions:  ${report.quality_scoring?.component_scores?.transitions} / 10
   Pacing:       ${report.quality_scoring?.component_scores?.pacing} / 10
   Visual:       ${report.quality_scoring?.component_scores?.visual_quality} / 10
   Story:        ${report.quality_scoring?.component_scores?.storytelling_emotion} / 10
   Originality:  ${report.quality_scoring?.component_scores?.originality_creativity} / 10
------------------------------------------------------------
 AGGREGATE QUALITY SCORES:
   Objective Technical Score:       ${techScore} / 10
   Owner Predicted Preference:     ${score} / 10
============================================================
`;
}

