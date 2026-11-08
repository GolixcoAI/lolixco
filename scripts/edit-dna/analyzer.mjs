/**
 * LOLIXCO EDIT DNA — SIGNAL PROCESSING & EDITING BASELINE ANALYZER
 * Part of Antigravity Mission 1 (AI Edit Analyzer R&D)
 *
 * Deterministic analysis engine calculating shot pacing, cut densities,
 * transition distributions, and millisecond cut-to-beat audio synchronization.
 */

/**
 * Categorize the precision of a cut relative to an audio beat.
 * @param {number} deltaMs Difference in milliseconds between cut and closest beat.
 * @returns {'tight' | 'acceptable' | 'off_beat'}
 */
export function classifySyncDelta(deltaMs) {
  if (deltaMs <= 33.34) {
    // Within 1 frame at 30 fps (~33.3ms) or 2 frames at 60 fps
    return "tight";
  }
  if (deltaMs <= 75.0) {
    // Within ~2.2 frames at 30fps
    return "acceptable";
  }
  return "off_beat";
}

/**
 * Compute the closest beat timestamp and distance for each cut.
 * @param {number[]} cutTimestamps Array of cut timestamps in seconds.
 * @param {number[]} beatTimestamps Array of beat timestamps in seconds.
 * @returns {{
 *   syncedCuts: Array<{ cutTime: number, closestBeatTime: number, deltaMs: number, classification: string }>,
 *   tightCount: number,
 *   acceptableCount: number,
 *   offBeatCount: number,
 *   meanSyncDeltaMs: number,
 *   beatSyncIndex: number
 * }}
 */
export function calculateCutToBeatSync(cutTimestamps, beatTimestamps) {
  if (!cutTimestamps || cutTimestamps.length === 0) {
    return {
      syncedCuts: [],
      tightCount: 0,
      acceptableCount: 0,
      offBeatCount: 0,
      meanSyncDeltaMs: 0,
      beatSyncIndex: 0,
    };
  }

  if (!beatTimestamps || beatTimestamps.length === 0) {
    return {
      syncedCuts: cutTimestamps.map((c) => ({
        cutTime: c,
        closestBeatTime: 0,
        deltaMs: 999.0,
        classification: "off_beat",
      })),
      tightCount: 0,
      acceptableCount: 0,
      offBeatCount: cutTimestamps.length,
      meanSyncDeltaMs: 999.0,
      beatSyncIndex: 1.0,
    };
  }

  let totalDeltaMs = 0;
  let tightCount = 0;
  let acceptableCount = 0;
  let offBeatCount = 0;

  const syncedCuts = cutTimestamps.map((cutTime) => {
    // Find closest beat
    let closestBeatTime = beatTimestamps[0];
    let minDelta = Math.abs(cutTime - closestBeatTime);

    for (let i = 1; i < beatTimestamps.length; i++) {
      const delta = Math.abs(cutTime - beatTimestamps[i]);
      if (delta < minDelta) {
        minDelta = delta;
        closestBeatTime = beatTimestamps[i];
      }
    }

    const deltaMs = Number((minDelta * 1000).toFixed(2));
    totalDeltaMs += deltaMs;

    const classification = classifySyncDelta(deltaMs);
    if (classification === "tight") tightCount++;
    else if (classification === "acceptable") acceptableCount++;
    else offBeatCount++;

    return {
      cutTime,
      closestBeatTime,
      deltaMs,
      classification,
    };
  });

  const totalCuts = cutTimestamps.length;
  const meanSyncDeltaMs = Number((totalDeltaMs / totalCuts).toFixed(2));

  // Beat Sync Index (0 - 10 scale)
  // 100% tight cuts = 10.0
  // Acceptable cuts yield 65% credit, off-beat yields 10% credit
  const weightedScore =
    (tightCount * 1.0 + acceptableCount * 0.65 + offBeatCount * 0.1) / totalCuts;
  const beatSyncIndex = Number((weightedScore * 10).toFixed(2));

  return {
    syncedCuts,
    tightCount,
    acceptableCount,
    offBeatCount,
    meanSyncDeltaMs,
    beatSyncIndex,
  };
}

/**
 * Compute pacing metrics across a sequence of shot lengths.
 * @param {number[]} shotLengths Array of shot durations in seconds.
 * @param {number} totalDuration Total video duration in seconds.
 * @returns {{
 *   totalShots: number,
 *   averageShotLength: number,
 *   cutDensityCps: number,
 *   pacingVariance: number,
 *   pacingDynamic: 'rapid_phonk_pace' | 'balanced_action_pace' | 'slow_emotional_pace'
 * }}
 */
export function calculatePacingMetrics(shotLengths, totalDuration) {
  if (!shotLengths || shotLengths.length === 0) {
    return {
      totalShots: 0,
      averageShotLength: totalDuration || 0,
      cutDensityCps: 0,
      pacingVariance: 0,
      pacingDynamic: "slow_emotional_pace",
    };
  }

  const totalShots = shotLengths.length;
  const asl = totalDuration / totalShots;

  // Sample variance of shot lengths
  const meanLength = shotLengths.reduce((sum, len) => sum + len, 0) / totalShots;
  const variance =
    totalShots > 1
      ? shotLengths.reduce((acc, len) => acc + Math.pow(len - meanLength, 2), 0) /
        (totalShots - 1)
      : 0;

  const cutDensityCps = totalDuration > 0 ? totalShots / totalDuration : 0;

  let pacingDynamic = "balanced_action_pace";
  if (asl < 0.95) {
    pacingDynamic = "rapid_phonk_pace";
  } else if (asl > 2.8) {
    pacingDynamic = "slow_emotional_pace";
  }

  return {
    totalShots,
    averageShotLength: Number(asl.toFixed(2)),
    cutDensityCps: Number(cutDensityCps.toFixed(2)),
    pacingVariance: Number(variance.toFixed(4)),
    pacingDynamic,
  };
}

/**
 * Analyze an editing signal profile and produce baseline technical telemetry.
 * @param {object} input
 * @param {number} input.durationSeconds
 * @param {number[]} input.cutTimestamps
 * @param {number[]} [input.beatTimestamps]
 * @param {Array<{ type: string, timestamp: number }>} [input.transitions]
 * @param {object} [input.audioEngineering]
 * @returns {object} Full deterministic editing baseline.
 */
export function analyzeEditingSignal(input) {
  const {
    durationSeconds,
    cutTimestamps = [],
    beatTimestamps = [],
    transitions = [],
    audioEngineering = {
      integratedLufs: -14.0,
      truePeakDbtp: -1.0,
      loudnessRangeLra: 5.0,
      clippingDetected: false,
    },
  } = input;

  // Derive shot lengths from cut timestamps
  const shotLengths = [];
  let prevTime = 0;
  for (const cutTime of cutTimestamps) {
    const len = Number((cutTime - prevTime).toFixed(3));
    if (len > 0) shotLengths.push(len);
    prevTime = cutTime;
  }
  if (durationSeconds > prevTime) {
    shotLengths.push(Number((durationSeconds - prevTime).toFixed(3)));
  }

  const pacing = calculatePacingMetrics(shotLengths, durationSeconds);
  const sync = calculateCutToBeatSync(cutTimestamps, beatTimestamps);

  // Transition breakdown
  const transitionsBreakdown = {
    hardCuts: 0,
    flashTransitions: 0,
    whipPanMotionBlur: 0,
    dissolves: 0,
  };

  if (transitions.length > 0) {
    for (const tr of transitions) {
      if (tr.type === "flash") transitionsBreakdown.flashTransitions++;
      else if (tr.type === "whip_pan") transitionsBreakdown.whipPanMotionBlur++;
      else if (tr.type === "dissolve") transitionsBreakdown.dissolves++;
      else transitionsBreakdown.hardCuts++;
    }
  } else {
    // Default to hard cuts if unspecified
    transitionsBreakdown.hardCuts = cutTimestamps.length;
  }

  return {
    durationSeconds,
    shotLengths,
    pacing,
    synchronization: sync,
    transitionsBreakdown,
    audioEngineering,
  };
}

