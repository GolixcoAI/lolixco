import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifySyncDelta,
  calculateCutToBeatSync,
  calculatePacingMetrics,
  analyzeEditingSignal,
} from "../scripts/edit-dna/analyzer.mjs";

import {
  ScoringEngine,
  BradleyTerryPreferenceModel,
  ActiveLearningSelector,
  DEFAULT_PROVISIONAL_WEIGHTS,
  normalizeWeights,
} from "../scripts/edit-dna/preference-engine.mjs";

import {
  compileEditDnaReport,
  renderAsciiSummary,
  RESULT_STATES,
} from "../scripts/edit-dna/report-compiler.mjs";

test("Lolixco Edit DNA — Signal Analyzer: Sync delta classification", () => {
  assert.equal(classifySyncDelta(0.0), "tight");
  assert.equal(classifySyncDelta(33.0), "tight");
  assert.equal(classifySyncDelta(35.0), "acceptable");
  assert.equal(classifySyncDelta(75.0), "acceptable");
  assert.equal(classifySyncDelta(76.0), "off_beat");
  assert.equal(classifySyncDelta(150.0), "off_beat");
});

test("Lolixco Edit DNA — Signal Analyzer: Cut-to-beat synchronization calculation", () => {
  // Beats occurring at 0.5s, 1.0s, 1.5s, 2.0s
  const beatTimestamps = [0.5, 1.0, 1.5, 2.0];

  // Cuts:
  // 1: 0.51s (10ms off -> tight)
  // 2: 1.05s (50ms off -> acceptable)
  // 3: 1.62s (120ms off -> off_beat)
  const cutTimestamps = [0.51, 1.05, 1.62];

  const result = calculateCutToBeatSync(cutTimestamps, beatTimestamps);

  assert.equal(result.syncedCuts.length, 3);
  assert.equal(result.tightCount, 1);
  assert.equal(result.acceptableCount, 1);
  assert.equal(result.offBeatCount, 1);
  assert.equal(result.syncedCuts[0].deltaMs, 10.0);
  assert.equal(result.syncedCuts[1].deltaMs, 50.0);
  assert.equal(result.syncedCuts[2].deltaMs, 120.0);

  // Mean delta = (10 + 50 + 120) / 3 = 60ms
  assert.equal(result.meanSyncDeltaMs, 60.0);

  // Expected BSI: (1 * 1.0 + 1 * 0.65 + 1 * 0.1) / 3 * 10 = (1.75 / 3) * 10 = 5.83
  assert.equal(result.beatSyncIndex, 5.83);
});

test("Lolixco Edit DNA — Signal Analyzer: Handles edge cases (empty cuts/beats)", () => {
  const emptyCuts = calculateCutToBeatSync([], [1.0, 2.0]);
  assert.equal(emptyCuts.tightCount, 0);
  assert.equal(emptyCuts.beatSyncIndex, 0);

  const emptyBeats = calculateCutToBeatSync([1.0, 2.0], []);
  assert.equal(emptyBeats.offBeatCount, 2);
  assert.equal(emptyBeats.beatSyncIndex, 1.0);
});

test("Lolixco Edit DNA — Signal Analyzer: Pacing metrics and dynamic classification", () => {
  // Rapid phonk edit: 30 shots across 15 seconds (ASL = 0.5s)
  const rapidLengths = new Array(30).fill(0.5);
  const rapid = calculatePacingMetrics(rapidLengths, 15.0);
  assert.equal(rapid.totalShots, 30);
  assert.equal(rapid.averageShotLength, 0.5);
  assert.equal(rapid.cutDensityCps, 2.0);
  assert.equal(rapid.pacingDynamic, "rapid_phonk_pace");

  // Slow emotional edit: 4 shots across 20 seconds (ASL = 5.0s)
  const slowLengths = [4.0, 6.0, 5.0, 5.0];
  const slow = calculatePacingMetrics(slowLengths, 20.0);
  assert.equal(slow.averageShotLength, 5.0);
  assert.equal(slow.pacingDynamic, "slow_emotional_pace");
});

test("Lolixco Edit DNA — Signal Analyzer: Full signal integration", () => {
  const signal = analyzeEditingSignal({
    durationSeconds: 10.0,
    cutTimestamps: [1.0, 2.0, 3.5, 5.0, 7.0],
    beatTimestamps: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0],
    transitions: [
      { type: "hard_cut", timestamp: 1.0 },
      { type: "flash", timestamp: 2.0 },
      { type: "hard_cut", timestamp: 3.5 },
      { type: "whip_pan", timestamp: 5.0 },
      { type: "hard_cut", timestamp: 7.0 },
    ],
  });

  assert.equal(signal.durationSeconds, 10.0);
  assert.equal(signal.shotLengths.length, 6);
  assert.equal(signal.transitionsBreakdown.hardCuts, 3);
  assert.equal(signal.transitionsBreakdown.flashTransitions, 1);
  assert.equal(signal.transitionsBreakdown.whipPanMotionBlur, 1);
  assert.equal(signal.synchronization.tightCount, 4); // 1.0, 2.0, 5.0, 7.0 land exactly on beats!
});

test("Lolixco Edit DNA — Preference Engine: Weight normalization and slider updates", () => {
  const engine = new ScoringEngine();
  const initialWeights = engine.getWeights();
  assert.equal(initialWeights.beat_synchronization, 0.25);
  assert.equal(initialWeights.transitions, 0.2);

  // Owner customizes sliders
  engine.setWeights({
    beat_synchronization: 40,
    transitions: 20,
    pacing: 10,
    visual_quality: 10,
    storytelling_emotion: 10,
    originality_creativity: 10,
  });

  const updatedWeights = engine.getWeights();
  assert.equal(updatedWeights.beat_synchronization, 0.4);
  assert.equal(updatedWeights.transitions, 0.2);
  assert.equal(updatedWeights.pacing, 0.1);

  // Composite calculation
  const composite = engine.calculateCompositeScore({
    beat_synchronization: 10.0,
    transitions: 8.0,
    pacing: 6.0,
    visual_quality: 8.0,
    storytelling_emotion: 7.0,
    originality_creativity: 5.0,
  });

  // Expected: 0.40*10 + 0.20*8 + 0.10*6 + 0.10*8 + 0.10*7 + 0.10*5 = 4.0 + 1.6 + 0.6 + 0.8 + 0.7 + 0.5 = 8.2
  assert.equal(composite, 8.2);
});

test("Lolixco Edit DNA — Preference Engine: Objective technical score calculation", () => {
  const engine = new ScoringEngine();

  const goodTelemetry = {
    pacing: { averageShotLength: 1.2 },
    synchronization: { beatSyncIndex: 9.5 },
    transitionsBreakdown: { hardCuts: 10, flashTransitions: 2 },
    audioEngineering: { clippingDetected: false, integratedLufs: -14.0 },
  };

  const goodScore = engine.calculateObjectiveTechnicalScore(goodTelemetry);
  assert.ok(goodScore >= 8.5, `Expected good score >= 8.5, got ${goodScore}`);

  const badTelemetry = {
    pacing: { averageShotLength: 0.2 }, // Spastic cuts
    synchronization: { beatSyncIndex: 2.0 }, // Desynced
    transitionsBreakdown: { hardCuts: 10, flashTransitions: 0 },
    audioEngineering: { clippingDetected: true, integratedLufs: -4.0 }, // Clipping
  };

  const badScore = engine.calculateObjectiveTechnicalScore(badTelemetry);
  assert.ok(badScore < 5.0, `Expected penalizing score < 5.0, got ${badScore}`);
});

test("Lolixco Edit DNA — Bradley-Terry Pairwise Preference Model convergence", () => {
  const bt = new BradleyTerryPreferenceModel(["beat_sync", "pacing", "visuals"]);

  // Edit A: High beat sync (9.0), moderate visuals (6.0)
  // Edit B: Low beat sync (4.0), high visuals (9.0)
  const featA = [9.0, 8.0, 6.0];
  const featB = [4.0, 6.0, 9.0];

  // Owner consistently prefers Edit A because owner prioritizes beat sync!
  for (let i = 0; i < 20; i++) {
    bt.addComparison(featA, featB, "A");
  }

  // Before fit, neutral prior ~0.50
  // Fit model
  bt.fit(80, 0.1, 0.01);

  const probAPreferred = bt.predictPreference(featA, featB);
  assert.ok(
    probAPreferred > 0.85,
    `Expected P(A > B) > 0.85 after consistent owner wins, got ${probAPreferred}`
  );

  const weights = bt.getWeights();
  assert.ok(
    weights.beat_sync > weights.visuals,
    `Expected beat_sync weight > visuals weight, got ${JSON.stringify(weights)}`
  );
});

test("Lolixco Edit DNA — Active Learning: Uncertainty sampling ranks ambiguous pairs first", () => {
  const bt = new BradleyTerryPreferenceModel(["feat1", "feat2"]);
  const active = new ActiveLearningSelector(bt);

  // Clear winner pair (P approx 0.95 -> low uncertainty)
  const clearWinner = {
    idA: "edit_pro",
    idB: "edit_poor",
    featuresA: [10.0, 10.0],
    featuresB: [1.0, 1.0],
  };

  // Close, ambiguous pair (P approx 0.50 -> high uncertainty)
  const closePair = {
    idA: "edit_style1",
    idB: "edit_style2",
    featuresA: [7.0, 7.2],
    featuresB: [7.1, 7.0],
  };

  const ranked = active.rankMostInformativePairs([clearWinner, closePair]);

  assert.equal(ranked[0].idA, "edit_style1");
  assert.ok(ranked[0].uncertainty > ranked[1].uncertainty);
});

test("Lolixco Edit DNA — Report Compiler: Result states & abstentions", () => {
  // State 1: Public playable complete
  const rep1 = compileEditDnaReport({
    resultState: RESULT_STATES.PUBLIC_PLAYABLE,
  });
  assert.equal(rep1.result_state, RESULT_STATES.PUBLIC_PLAYABLE);
  assert.equal(rep1.source_intelligence.top_match.franchise, "Jujutsu Kaisen");

  // State 2: Unavailable video
  const rep2 = compileEditDnaReport({
    resultState: RESULT_STATES.UNAVAILABLE,
  });
  assert.equal(rep2.result_state, RESULT_STATES.UNAVAILABLE);
  assert.equal(rep2.error_code, "YT_RESTRICTED_ACCESS");

  // State 3: Audio unidentified
  const rep3 = compileEditDnaReport({
    resultState: RESULT_STATES.AUDIO_UNIDENTIFIED,
  });
  assert.equal(rep3.music_intelligence.status, "unmatched_transformed_audio");
  assert.equal(rep3.music_intelligence.track.title, "Unknown / Unmatched Audio");

  // State 4: Franchise only (honest abstention on episode)
  const rep4 = compileEditDnaReport({
    resultState: RESULT_STATES.FRANCHISE_ONLY,
  });
  assert.equal(rep4.source_intelligence.episode_attribution, null);

  // State 7: Owner override
  const rep7 = compileEditDnaReport({
    ownerOverride: {
      corrected_character: "Yuta Okkotsu",
      rationale: "Volume 0 flashback scene",
    },
  });
  assert.equal(rep7.result_state, RESULT_STATES.OWNER_OVERRIDE);
  assert.equal(rep7.owner_override.corrected_character, "Yuta Okkotsu");
});

test("Lolixco Edit DNA — ASCII summary card generator", () => {
  const rep = compileEditDnaReport({
    analysisId: "dna_test_001",
  });
  const text = renderAsciiSummary(rep);

  assert.ok(text.includes("LOLIXCO EDIT DNA — ANALYSIS REPORT"));
  assert.ok(text.includes("dna_test_001"));
  assert.ok(text.includes("Jujutsu Kaisen"));
  assert.ok(text.includes("Beat Sync:"));
});

test("Lolixco Edit DNA — Phase 2: Offline analyzer processes real video bytes", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";
  const scriptPath = resolve(projectRoot, "scripts/edit-dna/offline_analyzer.py");
  const testVideo = resolve(projectRoot, "test-assets/benchmarks/bench_07_silent_video.mp4");

  const stdout = execFileSync(
    pythonBin,
    [scriptPath, testVideo, "--format", "json"],
    { encoding: "utf8", timeout: 15000 }
  );

  const report = JSON.parse(stdout);
  assert.equal(report.target_file, "bench_07_silent_video.mp4");
  assert.equal(report.technical_metadata.has_audio, false);
  assert.equal(report.editing_pacing.total_cuts, 3);
  assert.equal(report.editing_pacing.detected_cut_timestamps.length, 3);
  assert.ok(report.execution_telemetry.runtime_seconds < 5.0);
  assert.ok(report.execution_telemetry.peak_ram_mb > 10.0);
});

test("Lolixco Edit DNA — Phase 2: Owner rating lab records and revises ratings", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";
  const scriptPath = resolve(projectRoot, "scripts/edit-dna/rating_lab.py");

  // Record rating
  execFileSync(
    pythonBin,
    [
      scriptPath,
      "rate",
      "test_edit_asset_99",
      "--sync", "9.0",
      "--trans", "8.0",
      "--pacing", "8.5",
      "--visuals", "9.0",
      "--story", "7.5",
      "--orig", "8.0",
      "--overall", "8.7",
      "--notes", "Initial review"
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  // Revise rating
  execFileSync(
    pythonBin,
    [
      scriptPath,
      "rate",
      "test_edit_asset_99",
      "--sync", "9.5",
      "--trans", "8.5",
      "--pacing", "8.5",
      "--visuals", "9.0",
      "--story", "7.5",
      "--orig", "8.0",
      "--overall", "8.9",
      "--notes", "Revised: better sync than initially credited"
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  const ratingsPath = resolve(projectRoot, "data/edit-dna/owner_ratings.json");
  const db = JSON.parse(readFileSync(ratingsPath, "utf8"));
  const record = db.ratings["test_edit_asset_99"];

  assert.ok(record, "Expected record to exist in database");
  assert.equal(record.overall_subjective_score, 8.9);
  assert.equal(record.revision_count, 2);
  assert.equal(record.free_text_notes, "Revised: better sync than initially credited");
  assert.equal(record.telemetry_provenance, "local_offline_dsp_measured");
});

