import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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
  const ratingsPath = resolve(projectRoot, "data/edit-dna/synthetic_ratings.json");

  // Clean test key if present
  const initialDb = JSON.parse(readFileSync(ratingsPath, "utf8"));
  if (initialDb.ratings && initialDb.ratings["test_edit_asset_99"]) {
    delete initialDb.ratings["test_edit_asset_99"];
    writeFileSync(ratingsPath, JSON.stringify(initialDb, null, 2));
  }

  // Record rating into synthetic partition
  execFileSync(
    pythonBin,
    [
      scriptPath,
      "rate",
      "test_edit_asset_99",
      "--scope", "synthetic",
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
      "--scope", "synthetic",
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

  const db = JSON.parse(readFileSync(ratingsPath, "utf8"));
  const record = db.ratings["test_edit_asset_99"];

  assert.ok(record, "Expected record to exist in database");
  assert.equal(record.overall_subjective_score, 8.9);
  assert.equal(record.revision_count, 2);
  assert.equal(record.free_text_notes, "Revised: better sync than initially credited");
  assert.equal(record.telemetry_provenance, "local_offline_dsp_measured");
});

test("Lolixco Edit DNA — Phase 2: Web Lab API endpoints and anti-bias blind reveal", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const testScript = `
import sys
sys.path.insert(0, "${projectRoot}/scripts/edit-dna")
from fastapi.testclient import TestClient
import web_lab

client = TestClient(web_lab.app)

# 1. Verify SPA delivery
res = client.get("/")
assert res.status_code == 200
assert "Lolixco Edit DNA // Owner Rating Lab" in res.text

# 2. Verify synthetic benchmarks list
res = client.get("/api/ratings?scope=synthetic")
assert res.status_code == 200
data = res.json()
assert "bench_01_clean_hard_cuts" in data["ratings"]

# 3. Verify blind reveal on new rating submission
res = client.post("/api/ratings", json={
    "asset_id": "test_web_asset_01",
    "intake_type": "local_asset",
    "scope": "synthetic",
    "component_scores": {
        "beat_synchronization": 8.0,
        "transitions": 8.0,
        "pacing": 8.0,
        "visual_quality": 8.0,
        "storytelling_emotion": 8.0,
        "originality_creativity": 8.0
    },
    "overall_score": 8.5,
    "notes": "Testing blind reveal via web api"
})
assert res.status_code == 200
data = res.json()
assert data["status"] == "success"
reveal = data["ai_prediction_reveal"]
assert "predicted_score" in reveal
assert "score_delta" in reveal
assert reveal["score_delta"] == round(8.5 - reveal["predicted_score"], 2)

# Clean up test asset
client.delete("/api/ratings/test_web_asset_01?scope=synthetic")
print("WEB_LAB_TEST_PASS")
`;

  const stdout = execFileSync(
    pythonBin,
    ["-c", testScript],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("WEB_LAB_TEST_PASS"));
});

test("Lolixco Edit DNA — Phase 3: Editorial annotation extracts timestamp intervals & criteria tags", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const testScript = `
import sys
sys.path.insert(0, "${projectRoot}/scripts/edit-dna")
from editorial_annotator import extract_editorial_tags

sample_text = (
    "[0:00 - 0:23] Pacing & Storytelling: Deliberate, atmospheric slow pacing. "
    "At [0:14], the edit achieves high-impact beat sync, perfectly locking visual hits to audio transients. "
    "However, transitions rely heavily on repetitive zoom effects and automated templates."
)

result = extract_editorial_tags(sample_text)
assert len(result["intervals"]) >= 2
assert "atmospheric_tension_pacing" in result["positive_tags"]
assert "kinetic_transient_sync" in result["positive_tags"]
assert "repetitive_template_transitions" in result["negative_tags"]
print("EDITORIAL_ANNOTATOR_PASS")
`;

  const stdout = execFileSync(
    pythonBin,
    ["-c", testScript],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("EDITORIAL_ANNOTATOR_PASS"));
});

test("Lolixco Edit DNA — Phase 3: Personalized preference model trains on 11 real reviews without collapsing", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const testScript = `
import sys
sys.path.insert(0, "${projectRoot}/scripts/edit-dna")
from preference_learner import train_owner_preference_model, preference_model

report = train_owner_preference_model()
assert report["samples_count"] == 11
assert report["comparisons_count"] == 4
assert report["pairwise_ranking_accuracy"] == 1.0

# Verify non-collapsing dynamic range: lowest score and highest score predictions
lo_pred = preference_model.predict_mode_a({
    "beat_synchronization": 3.9,
    "transitions": 2.5,
    "pacing": 3.9,
    "visual_quality": 0.5,
    "storytelling_emotion": 2.0,
    "originality_creativity": 2.4
})
hi_pred = preference_model.predict_mode_a({
    "beat_synchronization": 9.8,
    "transitions": 9.6,
    "pacing": 8.8,
    "visual_quality": 7.7,
    "storytelling_emotion": 5.7,
    "originality_creativity": 7.0
})

# Low must be <= 4.0, High must be >= 8.0 (spread > 4.0 points, no collapse to 7.0)
assert lo_pred["predicted_score"] <= 4.0
assert hi_pred["predicted_score"] >= 8.0
assert hi_pred["predicted_score"] - lo_pred["predicted_score"] >= 4.0

# Verify Mode B strictly avoids data leakage on raw YouTube URL
mode_b_eval = preference_model.predict_mode_b(signal_metrics=None, intake_type="youtube_url")
assert mode_b_eval["status"] == "unmeasured_signal"
assert mode_b_eval["independent_technical_score"] is None
assert "anti-leakage" in mode_b_eval["statement"]

print("PREFERENCE_LEARNER_PASS")
`;

  const stdout = execFileSync(
    pythonBin,
    ["-c", testScript],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("PREFERENCE_LEARNER_PASS"));
});

test("Lolixco Edit DNA — Phase 4: Privacy audit guarantees zero private ratings or notes are tracked or leaked", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/verify_privacy.py")],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("AUDIT RESULT: PASSED"));
});

test("Lolixco Edit DNA — Phase 4: Honest model validation audits weight sensitivity & empirical coverage", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/audit_model.py")],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("LEAVE-ONE-OUT WEIGHT STABILITY"));
  assert.ok(stdout.includes("EMPIRICAL COVERAGE OF NOMINAL 90% PREDICTION INTERVALS"));
  assert.ok(stdout.includes("TRAINING VS. HELD-OUT PAIRWISE RANKING PERFORMANCE"));
});

test("Lolixco Edit DNA — Phase 4: Permissioned recognition engine identifies source footage, music variants, and abstains on unknowns", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/run_recognition_benchmark.py")],
    { encoding: "utf8", timeout: 25000 }
  );

  assert.ok(stdout.includes("BENCHMARK SUMMARY METRICS"));
  assert.ok(stdout.includes("Out-of-Catalog FP Rate    : 0.0%"));
  assert.ok(stdout.includes("Accuracy=1.000"));
});

test("Lolixco Edit DNA — Phase 4: Genuine real-world media recognition experiment with ORB keypoint correspondence", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/test_real_media_recognition.py")],
    { encoding: "utf8", timeout: 20000 }
  );

  assert.ok(stdout.includes("Real Media Recognition Accuracy: 100.0%"));
  assert.ok(stdout.includes("Real Negative Control Rejection: 100.0%"));
});

test("Lolixco Edit DNA — Phase 4: Multi-source mixed edit analyzer generates segment-level timeline & holistic summary", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/test_mixed_edit.py")],
    { encoding: "utf8", timeout: 25000 }
  );

  assert.ok(stdout.includes("Mixed-Source Edit: True"));
  assert.ok(stdout.includes("Shot-Level Visual Timeline"));
  assert.ok(stdout.includes("Windowed Music Timeline"));
  assert.ok(stdout.includes("Identified Visual Sources"));
});

test("Lolixco Edit DNA — Phase 5: Gemini video provider abstraction & fallback handling", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/test_gemini_experiment.py")],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("EXPERIMENT 1: GEMINI VIDEO UNDERSTANDING"));
  assert.ok(stdout.includes("Target YouTube URL : https://youtu.be/_yrPlcZY2jw"));
  assert.ok(stdout.includes("Report written to data/edit-dna/gemini_youtube_experiment_report.json"));
});

test("Lolixco Edit DNA — Phase 5: Semantic visual representation benchmark evaluates blur, overlays & negatives", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/test_semantic_visual_benchmark.py")],
    { encoding: "utf8", timeout: 25000 }
  );

  assert.ok(stdout.includes("SEMANTIC VISUAL vs GEOMETRIC BASELINE BENCHMARK"));
  assert.ok(stdout.includes("Semantic Accuracy"));
  assert.ok(stdout.includes("Detailed benchmark report saved"));
});

test("Lolixco Edit DNA — Phase 5: Real music identifier evaluates authorized master recordings & abstains on unknowns", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/real_music_identifier.py")],
    { encoding: "utf8", timeout: 25000 }
  );

  assert.ok(stdout.includes("REAL MUSIC IDENTIFICATION EXPERIMENT"));
  assert.ok(stdout.includes("Symphony No. 5"));
  assert.ok(stdout.includes("Brandenburg Concerto No. 3"));
  assert.ok(stdout.includes("UNKNOWN / ABSTAIN"));
});

test("Lolixco Edit DNA — Phase 5: Unified 5-part Edit DNA report separates facts, hypotheses, and unknowns", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from edit_dna_report import EditDNAReportCompiler

compiler = EditDNAReportCompiler()
rep = compiler.compile_report(
    media_id="test_edit.mp4",
    media_type="authorized_video_bytes",
    visual_recognition={"status": "identified", "matched_entity": {"title": "Test"}},
    music_recognition={"status": "identified", "matched_entity": {"title": "Beethoven"}},
    technical_measurements={"duration_seconds": 15.0, "cuts_count": 8, "cuts_per_second": 0.53, "beat_sync_percent": 87.5},
)

assert "section_a_visual_recognition" in rep
assert "section_b_music_recognition" in rep
assert "section_c_technical_measurements" in rep
assert "section_d_personalized_preferences" in rep
assert "section_e_unknowns_and_boundaries" in rep
assert rep["section_d_personalized_preferences"]["predicted_owner_overall_score"] is not None
print("REPORT_SECTIONS_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("REPORT_SECTIONS_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 6: Evidence scoring engine withdraws subjective heuristics to NOT_YET_ASSESSED", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from evidence_scoring_engine import EvidenceScoringEngine, StatusTag

engine = EvidenceScoringEngine()
cuts = engine.reconcile_cuts_and_shots([1.2, 2.5, 4.0, 5.8], 8.0, [2.0])
rhythm = engine.evaluate_multi_grid_rhythm(cuts["internal_cut_timestamps"], [1.2, 2.4, 3.6, 4.8, 6.0], 100.0)
card = engine.evaluate_scorecard(cuts, rhythm, {"width": 1280, "height": 720, "fps": 30.0}, {"rms_db": -12.0})

assert card["scorecard"]["beat_synchronization"]["status"] == StatusTag.MEASURED_SIGNAL
assert card["scorecard"]["pacing"]["status"] == StatusTag.NOT_YET_ASSESSED
assert card["scorecard"]["pacing"]["score"] is None
assert card["scorecard"]["visual_quality"]["status"] == StatusTag.NOT_YET_ASSESSED
assert card["scorecard"]["storytelling_emotion"]["status"] == StatusTag.NOT_YET_ASSESSED
assert card["scorecard"]["originality_creativity"]["status"] == StatusTag.NOT_YET_ASSESSED
assert card["overall_prediction"]["status"] == StatusTag.NOT_YET_ASSESSED
assert card["overall_prediction"]["predicted_score"] is None
print("PHASE6_EVIDENCE_SCORING_WITHDRAWAL_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE6_EVIDENCE_SCORING_WITHDRAWAL_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 6: Music evidence resolver flags acoustic contradiction as CONFLICT and retracts false matches", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from music_evidence_resolver import MusicEvidenceResolver

resolver = MusicEvidenceResolver()
# Classical reference candidate matching loud modern clipped trailer audio
res = resolver.resolve_recognition(
    raw_candidates=[{"ref_id": "bach_ref", "title": "Bach Brandenburg 3", "artist": "J.S. Bach", "similarity": 0.72}],
    measured_bpm=112.3,
    measured_rms_db=-9.0,
    has_clipping=True,
    audio_duration_sec=36.4
)

assert res["status"] == "CONFLICT"
assert res["matched_track"] is None
assert res["conflict_details"]["reason"] == "acoustic_genre_and_loudness_contradiction"
print("PHASE6_MUSIC_CONFLICT_RESOLUTION_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE6_MUSIC_CONFLICT_RESOLUTION_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 6: Cut/beat reconciliation accounts for shots vs transitions and evaluates multi-tempo grids", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from evidence_scoring_engine import EvidenceScoringEngine

engine = EvidenceScoringEngine()
# Test reconciliation on 10 cut timestamps dividing a 10s video
raw_cuts = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
recon = engine.reconcile_cuts_and_shots(raw_cuts, 10.0, [2.5, 5.5])

assert recon["shots_count"] == 10
assert recon["cut_transitions_count"] == 9
assert recon["intra_shot_flashes_count"] == 2

# Test rhythm on primary, half-time, and double-time grids
beats = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
rhythm = engine.evaluate_multi_grid_rhythm(recon["internal_cut_timestamps"], beats, 120.0)

assert rhythm["primary_bpm"] == 120.0
assert rhythm["half_time_bpm"] == 60.0
assert rhythm["double_time_bpm"] == 240.0
assert rhythm["primary_grid"]["tight_sync_percent"] == 100.0
print("PHASE6_CUT_RHYTHM_RECONCILIATION_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE6_CUT_RHYTHM_RECONCILIATION_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 6: Honest evaluation framework computes LOOCV errors without false calibration claims", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/evaluate_owner_model.py")],
    { encoding: "utf8", timeout: 25000 }
  );

  assert.ok(stdout.includes("OWNER MODEL HONEST EVALUATION REPORT"));
  assert.ok(stdout.includes("Total Owner Reviews: 11"));
  assert.ok(stdout.includes("LOOCV Prediction Errors:"));
  assert.ok(stdout.includes("Preference Model:"));
  assert.ok(stdout.includes("Mean Predictor Base:"));
  assert.ok(stdout.includes("Uniform Rubric Base:"));
  assert.ok(stdout.includes("A/B Ranking Accuracy:"));
});

test("Lolixco Edit DNA — Phase 6: Production Schema v6.0 validator enforces per-field status and provenance contract", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [resolve(projectRoot, "scripts/edit-dna/edit_dna_schema_v6.py")],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("Schema v6.0.0 validation passed successfully."));
});





