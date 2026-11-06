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
  assert.ok(stdout.includes("Offline by default"));
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

test("Lolixco Edit DNA — Phase 7: Seven rating dimensions strictly enforce ordering, identifiers, and bounds", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from presentation_adapter import EditDNAPresentationAdapter, ORDERED_DIMENSIONS, PRESENTATION_SCHEMA_VERSION

expected = [
    "beat_synchronization",
    "cuts_and_transitions",
    "pacing",
    "visual_measurements",
    "storytelling_interpretation",
    "originality_creativity",
    "personalized_owner_fit"
]
actual = [dim[0] for dim in ORDERED_DIMENSIONS]
assert actual == expected, f"Ordering mismatch: {actual} vs {expected}"

# Test bounds checking: score > 10.0 must raise AssertionError
invalid_doc = {
    "schema_version": PRESENTATION_SCHEMA_VERSION,
    "media_id": "test.mp4",
    "analysis_status": "COMPLETE",
    "overall_score_0_10": 11.5,
    "overall_score_status": "CALCULATED_PERSONALIZED",
    "overall_score_method": "test",
    "gauge_presentation": {"min": 0.0, "max": 10.0, "display_text": "11.5"},
    "assessment_sections": [
        {
            "section_id": sid,
            "dimension_id": sid,
            "section_name": sname,
            "display_name": sname,
            "score_0_10": 5.0,
            "evidence_status": "MEASURED_SIGNAL",
            "evidence_refs": {},
            "timestamps": [],
            "method_version": "v7.0",
            "limitations": [],
            "creator_explanation": "Valid test explanation."
        }
        for sid, sname in ORDERED_DIMENSIONS
    ]
}

failed = False
try:
    EditDNAPresentationAdapter.validate_presentation_report(invalid_doc)
except AssertionError:
    failed = True
assert failed, "Expected AssertionError on out-of-bounds score 11.5"

print("PHASE7_SEVEN_DIMENSIONS_ORDER_AND_BOUNDS_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE7_SEVEN_DIMENSIONS_ORDER_AND_BOUNDS_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 7: Overall score eligibility withholding rule prevents fabricated grades", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from presentation_adapter import EditDNAPresentationAdapter, ORDERED_DIMENSIONS

# 1. Unassessed semantic dimensions -> overall score MUST be None
unassessed_sections = [
    {
        "section_id": sid,
        "score_0_10": 8.0 if sid == "beat_synchronization" else None,
        "evidence_status": "MEASURED_SIGNAL" if sid == "beat_synchronization" else "NOT_YET_ASSESSED"
    }
    for sid, _ in ORDERED_DIMENSIONS
]
score, status, explanation = EditDNAPresentationAdapter.evaluate_overall_score_eligibility(unassessed_sections)
assert score is None, f"Expected None, got {score}"
assert status == "NOT_YET_ASSESSED"
assert "critical subjective dimensions" in explanation

# 2. All dimensions assessed -> overall score computed
scored_sections = [
    {
        "section_id": sid,
        "score_0_10": 7.50,
        "evidence_status": "EVALUATED_SEMANTIC"
    }
    for sid, _ in ORDERED_DIMENSIONS
]
score_full, status_full, _ = EditDNAPresentationAdapter.evaluate_overall_score_eligibility(scored_sections)
assert score_full == 7.50
assert status_full == "CALCULATED_PERSONALIZED"

print("PHASE7_OVERALL_SCORE_ELIGIBILITY_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE7_OVERALL_SCORE_ELIGIBILITY_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 7: Backward-compatible adapter converts v6.0.0 reports without data loss", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import json
sys.path.insert(0, "scripts/edit-dna")
from presentation_adapter import EditDNAPresentationAdapter
from edit_dna_schema_v6 import EditDNASchemaV6

# Create canonical v6 report
v6 = EditDNASchemaV6.create_report(
    media_id="test_edit.mp4",
    media_type="authorized_video_bytes",
    section_a_visual={"status": "UNKNOWN", "provenance": "orb_matcher"},
    section_b_music={"status": "CONFLICT", "provenance": "music_evidence_resolver"},
    section_c_physical={
        "provenance": "measured_signal",
        "cuts_per_second": 1.5,
        "cut_transitions_count": 20,
        "rhythm_alignment": {"primary_grid_tight_percent": 75.0, "double_time_tight_percent": 90.0},
        "video_signals": {"width": 1920, "height": 1080, "fps": 30.0, "mean_sharpness_laplacian": 450.0},
        "audio_signals": {"rms_db": -10.0, "clipping_detected": False},
        "accessibility_signals": {"intra_shot_flashes_count": 3, "flash_rate_per_sec": 0.15, "strobe_warning": False}
    },
    section_d_semantic={"status": "NOT_YET_ASSESSED", "provenance": "unassessed"},
    section_e_personalized={"status": "NOT_YET_ASSESSED", "provenance": "personalized_estimate"},
    section_f_boundaries={"unverified_elements": ["Semantic dimensions unassessed."]},
)

# Convert to presentation document
pres = EditDNAPresentationAdapter.from_v6_report(v6)
assert pres["schema_version"] == "7.0.0-presentation"
assert len(pres["assessment_sections"]) == 7
assert pres["assessment_sections"][0]["score_0_10"] is None  # Beat sync in unassessed scorecard
assert pres["overall_score_0_10"] is None
assert pres["overall_score_status"] == "NOT_YET_ASSESSED"
assert pres["gauge_presentation"]["gauge_state"] == "unassessed_standby"
assert "context_evidence" in pres
assert pres["context_evidence"]["music_recognition"]["status"] == "CONFLICT"

print("PHASE7_V6_ADAPTER_BACKWARD_COMPAT_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE7_V6_ADAPTER_BACKWARD_COMPAT_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 7: All nine safe demo fixtures validate against presentation contract", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import os
import json
sys.path.insert(0, "scripts/edit-dna")
from presentation_adapter import EditDNAPresentationAdapter

fixtures_dir = "data/edit-dna/fixtures"
expected_files = [
    "fixture_a_all_scored_strong.json",
    "fixture_b_partially_scored_dhurandhar.json",
    "fixture_c_all_unassessed.json",
    "fixture_d_no_overall_score.json",
    "fixture_e_music_conflict.json",
    "fixture_f_unknown_source.json",
    "fixture_g_owner_fit_unavailable.json",
    "fixture_h1_low_scoring_weak.json",
    "fixture_h2_high_scoring_exceptional.json",
]

for fname in expected_files:
    fpath = os.path.join(fixtures_dir, fname)
    assert os.path.isfile(fpath), f"Missing fixture file: {fpath}"
    with open(fpath, "r", encoding="utf-8") as f:
        doc = json.load(f)
    assert doc.get("is_synthetic_fixture") is True, f"Fixture {fname} missing is_synthetic_fixture flag"
    assert doc.get("for_frontend_testing_only") is True
    EditDNAPresentationAdapter.validate_presentation_report(doc)

print("PHASE7_ALL_9_DEMO_FIXTURES_VALIDATED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE7_ALL_9_DEMO_FIXTURES_VALIDATED"));
});

test("Lolixco Edit DNA — Phase 7: Presentation report contract integrity and Web Lab API compatibility", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import os
import json
sys.path.insert(0, "scripts/edit-dna")
from presentation_adapter import EditDNAPresentationAdapter

# Check Dhurandhar v6 report conversion
v6_path = "data/edit-dna/owner_evaluations/dhurandhar_v6_evidence_report.json"
if os.path.isfile(v6_path):
    with open(v6_path, "r", encoding="utf-8") as f:
        v6_data = json.load(f)
    pres = EditDNAPresentationAdapter.from_v6_report(v6_data)
    assert pres["assessment_sections"][0]["score_0_10"] is not None
    assert pres["assessment_sections"][1]["score_0_10"] is None
    assert pres["overall_score_0_10"] is None
    assert pres["gauge_presentation"]["display_text"] == "N/A"
    assert len(pres["reaction_bubbles"]) > 0

print("PHASE7_REPORT_CONTRACT_INTEGRITY_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE7_REPORT_CONTRACT_INTEGRITY_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8: Local analysis service health and inbox discovery endpoints", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from fastapi.testclient import TestClient
from local_service import app

client = TestClient(app)

# 1. Health check
res_h = client.get("/api/v8/health")
assert res_h.status_code == 200
data_h = res_h.json()
assert data_h["status"] == "ok"
assert data_h["service"] == "lolixco-edit-dna"
assert data_h["version"] == "8.0.0"

# 2. Inbox discovery
res_inbox = client.get("/api/v8/inbox")
assert res_inbox.status_code == 200
data_inbox = res_inbox.json()
assert "files" in data_inbox
filenames = [f["filename"] for f in data_inbox["files"]]
assert any("dhurandhar" in fn.lower() for fn in filenames), "Expected Dhurandhar in inbox files"

print("PHASE8_SERVICE_HEALTH_AND_INBOX_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("PHASE8_SERVICE_HEALTH_AND_INBOX_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8: Security boundaries reject unauthorized paths and directory traversal", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from fastapi.testclient import TestClient
from local_service import app

client = TestClient(app)

# 1. Path traversal attempt
res_bad1 = client.post("/api/v8/jobs/start", json={"inbox_filename": "../../../etc/passwd"})
assert res_bad1.status_code == 400
assert "not found or not in authorized directories" in res_bad1.json()["detail"]

# 2. Arbitrary external path attempt
res_bad2 = client.post("/api/v8/jobs/start", json={"media_path": "/var/log/syslog"})
assert res_bad2.status_code == 400

print("PHASE8_SECURITY_BOUNDARIES_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE8_SECURITY_BOUNDARIES_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8: Progressive event engine records real timestamps, latencies, and section events", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import os
sys.path.insert(0, "scripts/edit-dna")
from local_service import AnalysisEngine, AnalysisJob, AnalysisJobStatus

test_media = "test-assets/benchmarks/bench_01_clean_hard_cuts.mp4"
assert os.path.isfile(test_media)

job = AnalysisJob("test_progressive_job", test_media)
AnalysisEngine.execute_job(job)

assert job.status == AnalysisJobStatus.COMPLETE
assert job.duration_seconds > 0.0

event_types = [e["event_type"] for e in job.events]
assert AnalysisJobStatus.RUNNING in event_types
assert AnalysisJobStatus.SECTION_COMPLETED in event_types
assert AnalysisJobStatus.SECTION_UNASSESSED in event_types
assert AnalysisJobStatus.COMPLETE in event_types

# Check section completion for beat sync
beat_sec = job.progressive_sections.get("beat_synchronization")
assert beat_sec is not None
assert beat_sec["score_0_10"] is not None

# Check unassessed transitions
trans_sec = job.progressive_sections.get("cuts_and_transitions")
assert trans_sec is not None
assert trans_sec["score_0_10"] is None
assert trans_sec["evidence_status"] == "NOT_YET_ASSESSED"

print("PHASE8_PROGRESSIVE_EVENTS_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 20000 }
  );

  assert.ok(stdout.includes("PHASE8_PROGRESSIVE_EVENTS_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8: Job cancellation stops execution cleanly and cleans temporary assets", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from local_service import AnalysisJob, AnalysisEngine, AnalysisJobStatus

job = AnalysisJob("test_cancel_job", "test-assets/benchmarks/bench_01_clean_hard_cuts.mp4")
job.cancel_event.set()  # Signal cancellation immediately
AnalysisEngine.execute_job(job)

assert job.status == AnalysisJobStatus.CANCELLED
assert job.current_stage == "Cancelled"

print("PHASE8_JOB_CANCELLATION_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  assert.ok(stdout.includes("PHASE8_JOB_CANCELLATION_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8: End-to-end report generation outputs valid v6 and Phase 7 presentations", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from local_service import AnalysisEngine, AnalysisJob
from edit_dna_schema_v6 import EditDNASchemaV6
from presentation_adapter import EditDNAPresentationAdapter

job = AnalysisJob("test_dual_reports_job", "test-assets/benchmarks/bench_01_clean_hard_cuts.mp4")
AnalysisEngine.execute_job(job)

assert job.v6_report is not None
EditDNASchemaV6.validate(job.v6_report)

assert job.presentation_report is not None
EditDNAPresentationAdapter.validate_presentation_report(job.presentation_report)

assert len(job.presentation_report["assessment_sections"]) == 7
assert job.presentation_report["schema_version"] == "7.0.0-presentation"

print("PHASE8_DUAL_REPORT_GENERATION_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 20000 }
  );

  assert.ok(stdout.includes("PHASE8_DUAL_REPORT_GENERATION_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8: Service hardening pass enforces restricted CORS and evidence wording", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import os
import json
sys.path.insert(0, "scripts/edit-dna")
from fastapi.testclient import TestClient
from local_service import app
from presentation_adapter import EditDNAPresentationAdapter

client = TestClient(app)

# 1. Test CORS restrictions: Allowed local origin
res_allowed = client.options(
    "/api/v8/health",
    headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"}
)
assert res_allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"

# 2. Test CORS restrictions: Malicious/untrusted external origin rejected
res_blocked = client.options(
    "/api/v8/health",
    headers={"Origin": "https://malicious-external-site.com", "Access-Control-Request-Method": "GET"}
)
assert "access-control-allow-origin" not in res_blocked.headers

# 3. Test Beat Sync wording in Presentation Adapter:
# Confirms that 4.21/10 is labeled as a measured beat-alignment assessment, not a validated overall artistic judgment
v6_path = "data/edit-dna/owner_evaluations/dhurandhar_v6_evidence_report.json"
if os.path.isfile(v6_path):
    with open(v6_path, "r", encoding="utf-8") as f:
        v6_data = json.load(f)
    pres = EditDNAPresentationAdapter.from_v6_report(v6_data)
    beat_dim = pres["assessment_sections"][0]
    assert "objective timing alignment measurement" in beat_dim["limitations"][0]
    assert "not validated artistic musicality" in beat_dim["creator_explanation"]

print("PHASE8_HARDENING_AND_EVIDENCE_WORDING_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("PHASE8_HARDENING_AND_EVIDENCE_WORDING_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8.1: Multi-grid rhythmic analysis evaluates 16th subdivisions, onsets & flash sync", () => {
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

# Simulate cuts on 16th-note offbeats and transients
# 120 BPM -> beat period = 0.5s, 8th note offbeat = 0.25s (delta = 250ms > 150ms unaligned on primary grid)
beats = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
# Cuts: 0.250 (8th offbeat, unaligned on primary), 0.502 (downbeat), 1.250 (8th offbeat), 1.503 (downbeat)
cuts = [0.250, 0.502, 1.250, 1.503]
onsets = [0.248, 0.500, 1.251, 1.500]
flashes = [0.501, 1.502]

rhythm = engine.evaluate_multi_grid_rhythm(
    internal_cuts=cuts,
    beat_timestamps=beats,
    primary_bpm=120.0,
    audio_onsets=onsets,
    flash_timestamps=flashes
)

# 1. Primary grid only catches downbeats (50%), offbeats are > 150ms unaligned
assert rhythm["primary_grid"]["tight_sync_percent"] == 50.0
assert rhythm["primary_grid"]["loose_sync_percent"] == 0.0

# 2. 16th-note subdivision grid catches all 4 cuts (100%)
assert rhythm["subdivision_16th_grid"]["tight_sync_percent"] == 100.0

# 3. Acoustic onset transient hits catch all 4 cuts (100%)
assert rhythm["onset_alignment"]["tight_sync_percent"] == 100.0

# 4. Compound sync is 100%
assert rhythm["compound_sync"]["tight_sync_percent"] == 100.0

# 5. Intra-shot flash sync is 100% (both flashes hit beats/onsets)
assert rhythm["intra_shot_flash_sync_percent"] == 100.0

# 6. Scorecard evaluates compound score alongside rigid score
scorecard = engine.evaluate_scorecard(
    cuts_reconciliation={"shots_count": 5, "cut_transitions_count": 4, "flash_rate_per_second": 0.0},
    rhythm_evaluation=rhythm,
    video_signals={},
    audio_signals={}
)
beat_card = scorecard["scorecard"]["beat_synchronization"]
assert beat_card["status"] == StatusTag.MEASURED_SIGNAL
assert beat_card["artistic_quality"] == StatusTag.NOT_YET_ASSESSED
assert beat_card["metric_details"]["rigid_grid_score"] == 5.0
assert beat_card["metric_details"]["compound_alignment_score"] == 10.0
assert beat_card["score"] == 10.0

print("PHASE8_1_BEAT_SYNC_ENGINE_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("PHASE8_1_BEAT_SYNC_ENGINE_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8.1: Host and origin validation middleware blocks unauthorized access", () => {
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
sys.path.insert(0, "scripts/edit-dna")
from fastapi.testclient import TestClient
from local_service import app

client = TestClient(app)

# 1. Host header validation: Disallowed host rejected with 403
res_bad_host = client.get("/api/v8/health", headers={"Host": "malicious-host.com"})
assert res_bad_host.status_code == 403
assert "Forbidden host header" in res_bad_host.json()["detail"]

# 2. Origin validation: Unauthorized external origin rejected with 403 on API call
res_bad_orig = client.get("/api/v8/inbox", headers={"Origin": "https://unauthorized-site.com"})
assert res_bad_orig.status_code == 403
assert "Forbidden origin" in res_bad_orig.json()["detail"]

# 3. Valid local request succeeds
res_ok = client.get("/api/v8/health", headers={"Host": "127.0.0.1:5055", "Origin": "http://localhost:5173"})
assert res_ok.status_code == 200

print("PHASE8_1_HOST_ORIGIN_SECURITY_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("PHASE8_1_HOST_ORIGIN_SECURITY_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8.1: Thread-safe SSE events with monotonic IDs and resume cursor", () => {
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import json
sys.path.insert(0, "scripts/edit-dna")
from local_service import AnalysisJob, AnalysisJobStatus, job_manager

job = AnalysisJob("test_sse_resume", "test-assets/benchmarks/bench_01_clean_hard_cuts.mp4")

# Add several events
job.add_event(AnalysisJobStatus.QUEUED, payload={"step": 1})
job.add_event(AnalysisJobStatus.RUNNING, payload={"step": 2})
job.add_event(AnalysisJobStatus.SECTION_COMPLETED, "beat_synchronization", {"score": 9.5})
job.add_event(AnalysisJobStatus.COMPLETE, payload={"step": 4})

assert len(job.events) == 4
# Check strictly monotonic event_ids
ids = [e["event_id"] for e in job.events]
assert ids == [1, 2, 3, 4]

# Immediate cancellation test
cancelled = job.cancel_event.is_set()
assert not cancelled
job_manager.jobs[job.job_id] = job
job_manager.cancel_job(job.job_id, "Testing immediate cancel")
assert job.status == AnalysisJobStatus.CANCELLED
last_evt = job.events[-1]
assert last_evt["event_type"] == AnalysisJobStatus.CANCELLED
assert last_evt["event_id"] == 5
assert last_evt["payload"]["acknowledged"] is True

print("PHASE8_1_SSE_MONOTONIC_AND_CANCEL_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("PHASE8_1_SSE_MONOTONIC_AND_CANCEL_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 8.1: Rhythm annotation submission and private owner feedback API", () => {
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import json
from pathlib import Path
from tempfile import TemporaryDirectory
sys.path.insert(0, "scripts/edit-dna")
from fastapi.testclient import TestClient
import local_service

storage = TemporaryDirectory()
local_service.PRIVATE_ANNOTATIONS_DIR = storage.name
feedback = {
    "owner_rating_midpoint": 7.5,
    "annotated_timestamps": [{"timestamp_sec": t} for t in (1.0, 2.0, 3.0)],
}
(Path(storage.name) / "owner_feedback_dhurandhar.json").write_text(json.dumps(feedback))
client = TestClient(local_service.app)

# 1. Resolve synthetic feedback from private annotation storage
res_owner = client.get("/api/v8/annotations/Best Dhurandhar edit . mp4")
assert res_owner.status_code == 200
data_owner = res_owner.json()
assert data_owner["owner_rating_midpoint"] == 7.5
assert len(data_owner["annotated_timestamps"]) >= 3

# 2. Submit new rhythm annotations
payload = {
    "media_filename": "test_sample_video.mp4",
    "evaluator": "Editor A",
    "owner_rating": 8.5,
    "annotations": [
        {"timestamp_sec": 1.5, "tag": "downbeat_lock", "delta_ms": 2.1, "notes": "Solid cut"},
        {"timestamp_sec": 3.2, "tag": "onset_hit", "delta_ms": 12.0, "notes": "Snare alignment"}
    ]
}
res_sub = client.post("/api/v8/annotations/sync-timestamps", json=payload)
assert res_sub.status_code == 200
assert res_sub.json()["status"] == "success"

# 3. Retrieve submitted annotations
res_get = client.get("/api/v8/annotations/test_sample_video.mp4")
assert res_get.status_code == 200
assert res_get.json()["annotations_count"] == 2

storage.cleanup()
print("PHASE8_1_ANNOTATION_API_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("PHASE8_1_ANNOTATION_API_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 9: Quality Engine full 7-dimension evaluation and Monte Carlo null model", () => {
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import numpy as np
sys.path.insert(0, "scripts/edit-dna")
from phase9_quality_engine import Phase9QualityEngine

engine = Phase9QualityEngine()

# 1. Synthesize known rhythmic audio + aligned cuts
sr = 22050
duration = 10.0
t = np.linspace(0, duration, int(sr * duration), endpoint=False)
bpm = 120.0
beat_period = 60.0 / bpm  # 0.5s

# Create audio click track at 120 BPM
audio_y = np.zeros_like(t)
for b in np.arange(0.5, duration - 0.5, beat_period):
    idx = int(b * sr)
    if idx + 200 < len(audio_y):
        audio_y[idx:idx+200] = np.sin(2 * np.pi * 1000 * np.linspace(0, 0.01, 200))

# Create cuts aligned to beat grid
aligned_cuts = [float(b) for b in np.arange(1.0, duration - 1.0, beat_period)]
shot_durations = [0.5] * len(aligned_cuts)

# Evaluate Beat Synchronization with Monte Carlo null model
sync_eval = engine.evaluate_beat_synchronization(aligned_cuts, audio_y, sr, duration)
assert sync_eval["score_0_10"] >= 7.0, f"Expected high sync score, got {sync_eval['score_0_10']}"
metrics = sync_eval["metrics"]
assert "excess_synchronization_lift_percent" in metrics
assert metrics["excess_synchronization_lift_percent"] > 0.0
assert metrics["z_score_significance"] > 1.96
assert metrics["standardized_uniform_control_difference"] > 1.96
assert "uniform_control_tail_fraction" in metrics
assert "circular_shift_control" in metrics
assert metrics["circular_shift_control"]["plus_one_tail_fraction"] <= 1.0
assert metrics["observed_multi_sync_percent"] > metrics["monte_carlo_random_baseline_percent"]

# 2. Evaluate full edit quality across 7 dimensions (verifying score eligibility withholding)
full_res = engine.evaluate_full_edit_quality(
    internal_cuts=aligned_cuts,
    shot_durations=shot_durations,
    cut_continuity_correlations=[0.5] * len(aligned_cuts),
    flash_frames=[],
    sharpness_values=[80.0] * 20,
    contrast_values=[40.0] * 20,
    audio_y=audio_y,
    sr=sr,
    duration=duration,
    width=1280,
    height=720,
    fps=30.0
)

# Autonomous evaluation cleanly withholds overall score when subjective dimensions are unassessed
assert full_res["overall_score_0_10"] is None
assert full_res["overall_score_status"] == "NOT_YET_ASSESSED"
assert full_res["overall_score_tier"] == "Unassessed"
assert len(full_res["dimensions"]) == 7
assert full_res["dimensions"]["storytelling_interpretation"]["score_0_10"] is None
assert full_res["dimensions"]["originality_creativity"]["score_0_10"] is None
assert full_res["dimensions"]["personalized_owner_fit"]["score_0_10"] is None
assert full_res["dimensions"]["beat_synchronization"]["score_0_10"] is not None

# When semantic overrides are provided, overall composite is calculated
sem_res = engine.evaluate_full_edit_quality(
    internal_cuts=aligned_cuts,
    shot_durations=shot_durations,
    cut_continuity_correlations=[0.5] * len(aligned_cuts),
    flash_frames=[],
    sharpness_values=[80.0] * 20,
    contrast_values=[40.0] * 20,
    audio_y=audio_y,
    sr=sr,
    duration=duration,
    width=1280,
    height=720,
    fps=30.0,
    semantic_overrides={"storytelling": {"score": 7.5}, "originality": {"score": 8.0}}
)
assert sem_res["overall_score_0_10"] is not None
assert 0.0 <= sem_res["overall_score_0_10"] <= 10.0
assert sem_res["overall_score_status"] == "CALCULATED_EXPERIMENTAL_V9"

print("PHASE9_QUALITY_ENGINE_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 25000 }
  );

  assert.ok(stdout.includes("PHASE9_QUALITY_ENGINE_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 9: Quality discrimination across counterexamples (drift, flat pacing, strobe spam)", () => {
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import numpy as np
sys.path.insert(0, "scripts/edit-dna")
from phase9_quality_engine import Phase9QualityEngine

engine = Phase9QualityEngine()

# 1. Pacing discrimination: Dynamic pacing vs Flat metronome
dynamic_shots = [0.3, 0.4, 0.8, 2.5, 0.35, 1.2, 0.45, 3.1]
flat_shots = [1.0] * len(dynamic_shots)
duration = 10.0
audio_dummy = np.zeros(22050 * int(duration))

pacing_dyn = engine.evaluate_pacing(dynamic_shots, audio_dummy, 22050, duration)
pacing_flat = engine.evaluate_pacing(flat_shots, audio_dummy, 22050, duration)
assert pacing_dyn["score_0_10"] > pacing_flat["score_0_10"]
assert pacing_dyn["metrics"]["dynamic_duration_ratio"] > 4.0
assert pacing_flat["metrics"]["dynamic_duration_ratio"] == 1.0

# 2. Transition safety discrimination: Controlled flash accents vs Strobe spam
safe_flashes = [1.0, 5.0]  # 2 flashes in 10s = 0.2/s (safe)
strobe_flashes = list(np.arange(0.5, 9.5, 0.15))  # 60 flashes in 10s = 6.0/s (dangerous)
cuts_dummy = list(np.cumsum(dynamic_shots))

trans_safe = engine.evaluate_cuts_and_transitions(
    [0.6] * len(dynamic_shots), safe_flashes, cuts_dummy, duration, len(dynamic_shots)
)
trans_strobe = engine.evaluate_cuts_and_transitions(
    [0.6] * len(dynamic_shots), strobe_flashes, cuts_dummy, duration, len(dynamic_shots)
)

assert trans_safe["metrics"]["strobe_warning"] is False
assert trans_strobe["metrics"]["strobe_warning"] is True
assert trans_safe["score_0_10"] > trans_strobe["score_0_10"]

# 3. Discrete shot duration entropy (diversity proxy)
orig_eval = engine.evaluate_originality(dynamic_shots)
assert "shot_duration_entropy_bits" in orig_eval["metrics"]
assert 0.0 <= orig_eval["metrics"]["shot_duration_entropy_bits"] <= 3.0

print("PHASE9_DISCRIMINATION_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 20000 }
  );

  assert.ok(stdout.includes("PHASE9_DISCRIMINATION_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 9: Local service execution in quality_mode='phase9' delivers 7-dimension scoring", () => {
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import os
sys.path.insert(0, "scripts/edit-dna")
from local_service import AnalysisEngine, AnalysisJob, AnalysisJobStatus
from edit_dna_schema_v6 import EditDNASchemaV6
from presentation_adapter import EditDNAPresentationAdapter

owner_media = "/home/rohan/lolixco-owner-media/inbox/Best Dhurandhar edit.mp4"
assert os.path.isfile(owner_media)

job = AnalysisJob("test_phase9_service_job", owner_media, quality_mode="phase9")
AnalysisEngine.execute_job(job)

assert job.status == AnalysisJobStatus.COMPLETE
assert job.duration_seconds > 0.0

# Verify progressive section completion and honest unassessed withholding
completed_ids = [e["section_id"] for e in job.events if e["event_type"] == AnalysisJobStatus.SECTION_COMPLETED]
assert "beat_synchronization" in completed_ids
assert "cuts_and_transitions" in completed_ids
assert "pacing" in completed_ids
assert "visual_measurements" in completed_ids

unassessed_ids = [e["section_id"] for e in job.events if e["event_type"] == AnalysisJobStatus.SECTION_UNASSESSED]
assert "storytelling_interpretation" in unassessed_ids
assert "originality_creativity" in unassessed_ids
assert "personalized_owner_fit" in unassessed_ids

# In events, verify null scores for subjective dimensions
for e in job.events:
    if e.get("section_id") in ("storytelling_interpretation", "originality_creativity", "personalized_owner_fit"):
        assert e["payload"]["score_0_10"] is None
        assert e["payload"]["evidence_status"] == "NOT_YET_ASSESSED"

# Verify presentation report: overall score withheld in unassessed_standby
pres = job.presentation_report
assert pres is not None
assert pres["schema_version"] == "7.0.0-presentation"
assert pres["overall_score_0_10"] is None
assert pres["overall_score_status"] == "NOT_YET_ASSESSED"
assert pres["overall_score_tier"] == "Unassessed"
assert pres["gauge_presentation"]["gauge_state"] == "unassessed_standby"
assert pres.get("experimental_phase9") is True
assert pres.get("mode") == "phase9"
assert pres.get("analysis_mode") == "phase9"
assert pres.get("engine_version") == "phase9_quality_engine_v9.0"

# Verify Phase 9 explanation, metrics, and method version on beat_synchronization
beat_sec = pres["assessment_sections"][0]
assert beat_sec["method_version"] == "phase9_timing_engine_v9.0"
assert "56.5%" in beat_sec["creator_explanation"]
assert "97.1%" not in beat_sec["creator_explanation"]

# Verify first 4 sections have numeric scores, last 3 have null
assert len(pres["assessment_sections"]) == 7
for s in pres["assessment_sections"][:4]:
    assert s["score_0_10"] is not None
    assert 0.0 <= s["score_0_10"] <= 10.0

for s in pres["assessment_sections"][4:]:
    assert s["score_0_10"] is None
    assert s["evidence_status"] == "NOT_YET_ASSESSED"

# Verify shot-duration entropy is retained as a measurement
assert pres["assessment_sections"][5]["evidence_refs"]["shot_duration_entropy_bits"] is not None

# Verify canonical v6 schema and presentation contract
EditDNASchemaV6.validate(job.v6_report)
EditDNAPresentationAdapter.validate_presentation_report(pres)

print("PHASE9_SERVICE_SCORING_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 35000 }
  );

  assert.ok(stdout.includes("PHASE9_SERVICE_SCORING_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 9: Timing engine rejects silence, zero threshold, and short clips (<= 1.0s)", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import numpy as np
sys.path.insert(0, "scripts/edit-dna")
from phase9_quality_engine import Phase9QualityEngine, STATUS_NOT_YET_ASSESSED

eng = Phase9QualityEngine()

# 1. All-zero audio input (5.0s, 3 cuts)
res_zero = eng.evaluate_beat_synchronization([1.0, 2.0, 3.0], np.zeros(22050 * 5), 22050, 5.0)
assert res_zero["score_0_10"] is None
assert res_zero["evidence_status"] == STATUS_NOT_YET_ASSESSED
assert res_zero["metrics"]["top_transient_coverage_percent"] == 0.0

# 2. 0.5-second clip (3 cuts)
res_short = eng.evaluate_beat_synchronization([0.1, 0.2, 0.3], np.zeros(11025), 22050, 0.5)
assert res_short["score_0_10"] is None
assert res_short["evidence_status"] == STATUS_NOT_YET_ASSESSED
assert res_short["metrics"]["top_transient_coverage_percent"] == 0.0

# 3. Pacing with clip <= 1.0s
res_pacing_short = eng.evaluate_pacing([0.2, 0.3], np.zeros(11025), 22050, 0.5)
assert res_pacing_short["score_0_10"] is None
assert res_pacing_short["evidence_status"] == STATUS_NOT_YET_ASSESSED

# 4. Low amplitude noise below 1e-4
res_silent_noise = eng.evaluate_beat_synchronization([1.0, 2.0], np.ones(22050 * 3) * 1e-5, 22050, 3.0)
assert res_silent_noise["score_0_10"] is None
assert res_silent_noise["evidence_status"] == STATUS_NOT_YET_ASSESSED

print("TIMING_SILENCE_AND_SHORT_CLIPS_REJECTED")
      `,
    ],
    { encoding: "utf8", timeout: 15000 }
  );

  assert.ok(stdout.includes("TIMING_SILENCE_AND_SHORT_CLIPS_REJECTED"));
});

test("Lolixco Edit DNA — Phase 9: Service statistical controls match reference null distributions and diagnostic label", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import numpy as np
sys.path.insert(0, "scripts/edit-dna")
from local_service import AnalysisEngine, AnalysisJob

owner_media = "/home/rohan/lolixco-owner-media/inbox/Best Dhurandhar edit.mp4"
job = AnalysisJob("test_stat_controls", owner_media, quality_mode="phase9")
AnalysisEngine.execute_job(job)

pres = job.presentation_report
beat_refs = pres["assessment_sections"][0]["evidence_refs"]

# Uniform control verification (500 draws, seed 42)
assert beat_refs["uniform_control_draw_count"] == 500
assert beat_refs["uniform_control_ties_or_exceedances"] == 39
assert abs(beat_refs["uniform_control_tail_fraction"] - 40 / 501) < 1e-5

# Circular shift control verification (500 draws, seed 42, default_rng)
circ = beat_refs["circular_shift_control"]
assert circ["diagnostic_label"] == "spacing_preserving_circular_shift"
assert circ["draw_count"] == 500
assert circ["ties_or_exceedances"] == 55
assert abs(circ["plus_one_tail_fraction"] - 56 / 501) < 1e-5
assert abs(circ["mean_percent"] - 46.574) < 0.05
assert abs(circ["sd_percentage_points"] - 7.715) < 0.05

# In progressive event stream
event_refs = job.progressive_sections["beat_synchronization"]["evidence_refs"]
assert event_refs["circular_shift_control"]["diagnostic_label"] == "spacing_preserving_circular_shift"
assert event_refs["circular_shift_control"]["ties_or_exceedances"] == 55

print("PHASE9_STATISTICAL_CONTROLS_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 35000 }
  );

  assert.ok(stdout.includes("PHASE9_STATISTICAL_CONTROLS_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 9: Full service short-clip pipeline test with unassessed event stream and report exports", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import os
import subprocess
import json
sys.path.insert(0, "scripts/edit-dna")
from local_service import AnalysisEngine, AnalysisJob, AnalysisJobStatus, PRIVATE_JOBS_DIR
from edit_dna_schema_v6 import EditDNASchemaV6
from presentation_adapter import EditDNAPresentationAdapter

# 1. Generate 0.5-second silent MP4 test asset
test_clip = "/tmp/test_service_short_silent.mp4"
gen_cmd = [
    "ffmpeg", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=320x240:d=0.5",
    "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
    "-t", "0.5",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    test_clip
]
subprocess.run(gen_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
assert os.path.isfile(test_clip)

try:
    # 2. Run full AnalysisEngine job in phase9 quality mode
    job = AnalysisJob("test_short_clip_export_job", test_clip, quality_mode="phase9")
    AnalysisEngine.execute_job(job)

    # 3. Verify job finished completely without uncaught KeyError or crash
    assert job.status == AnalysisJobStatus.COMPLETE
    assert job.duration_seconds > 0.0

    # 4. Verify unassessed events emitted for null scores
    unassessed_events = [e for e in job.events if e["event_type"] == AnalysisJobStatus.SECTION_UNASSESSED]
    assert len(unassessed_events) >= 6
    for e in unassessed_events:
        assert e["payload"]["score_0_10"] is None
        assert e["payload"]["evidence_status"] == "NOT_YET_ASSESSED"
        assert len(e["payload"]["creator_explanation"]) > 0

    # 5. Verify presentation report root provenance & withholding
    pres = job.presentation_report
    assert pres is not None
    assert pres["schema_version"] == "7.0.0-presentation"
    assert pres["experimental_phase9"] is True
    assert pres["mode"] == "phase9"
    assert pres["analysis_mode"] == "phase9"
    assert pres["engine_version"] == "phase9_quality_engine_v9.0"
    assert pres["overall_score_0_10"] is None
    assert pres["overall_score_status"] == "NOT_YET_ASSESSED"
    assert pres["overall_score_tier"] == "Unassessed"
    assert pres["gauge_presentation"]["gauge_state"] == "unassessed_standby"

    # 6. Verify all 7 sections present with valid explanations
    assert len(pres["assessment_sections"]) == 7
    for s in pres["assessment_sections"]:
        assert len(s["creator_explanation"]) > 0
        assert "method_version" in s
        if s["score_0_10"] is None:
            assert s["evidence_status"] == "NOT_YET_ASSESSED"

    # 7. Validate schemas
    EditDNASchemaV6.validate(job.v6_report)
    EditDNAPresentationAdapter.validate_presentation_report(pres)

    # 8. Verify report exports to private disk storage
    job_dir = os.path.join(PRIVATE_JOBS_DIR, job.job_id)
    v6_file = os.path.join(job_dir, "report_v6.json")
    pres_file = os.path.join(job_dir, "report_presentation.json")
    assert os.path.isfile(v6_file)
    assert os.path.isfile(pres_file)

    with open(pres_file, "r", encoding="utf-8") as f:
        exported_pres = json.load(f)
    assert exported_pres["experimental_phase9"] is True
    assert exported_pres["mode"] == "phase9"
    assert len(exported_pres["assessment_sections"]) == 7

    print("FULL_SERVICE_SHORT_CLIP_EXPORT_VERIFIED")

finally:
    if os.path.isfile(test_clip):
        os.remove(test_clip)
      `,
    ],
    { encoding: "utf8", timeout: 20000 }
  );

  assert.ok(stdout.includes("FULL_SERVICE_SHORT_CLIP_EXPORT_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 9: Full service pipeline handles valid MP4 without audio track (-an), continues video measurements, marks audio unassessed", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";

  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import sys
import os
import subprocess
import json
sys.path.insert(0, "scripts/edit-dna")
from local_service import AnalysisEngine, AnalysisJob, AnalysisJobStatus, PRIVATE_JOBS_DIR
from edit_dna_schema_v6 import EditDNASchemaV6
from presentation_adapter import EditDNAPresentationAdapter

# 1. Generate 2.0-second test MP4 with video frames and NO audio track (-an)
test_clip = "/tmp/test_service_no_audio.mp4"
gen_cmd = [
    "ffmpeg", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2.0",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-an",
    test_clip
]
subprocess.run(gen_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
assert os.path.isfile(test_clip)

# Verify with ffprobe that audio stream is absent
probe_cmd = ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", test_clip]
probe_out = subprocess.check_output(probe_cmd).decode("utf-8").strip()
assert probe_out == "", f"Expected no audio stream, got: {probe_out}"

try:
    # 2. Run full AnalysisEngine job in phase9 quality mode
    job = AnalysisJob("test_no_audio_export_job", test_clip, quality_mode="phase9")
    AnalysisEngine.execute_job(job)

    # 3. Verify job finished successfully without FFmpeg crash or stream extraction error
    assert job.status == AnalysisJobStatus.COMPLETE
    assert job.duration_seconds > 0.0

    # 4. Verify physical signals explicitly reflect missing audio stream
    audio_sig = job.v6_report["section_c_physical_signals"]["audio_signals"]
    assert audio_sig["has_audio_stream"] is False
    assert audio_sig["bpm"] == 0.0
    assert audio_sig["onsets_count"] == 0
    assert audio_sig["peak_amplitude"] == 0.0
    assert audio_sig["rms_db"] == -120.0

    # 5. Verify video measurements continued successfully
    video_sig = job.v6_report["section_c_physical_signals"]["video_signals"]
    assert video_sig["duration_sec"] >= 1.9
    assert video_sig["fps"] == 25.0

    pres = job.presentation_report
    assert pres is not None
    sec_map = {s["dimension_id"]: s for s in pres["assessment_sections"]}

    # Visual measurements evaluated from real video frames
    vis_sec = sec_map["visual_measurements"]
    assert vis_sec["score_0_10"] is not None
    assert vis_sec["score_0_10"] > 0.0
    assert vis_sec["evidence_status"] == "MEASURED_SIGNAL"

    # Cuts and transitions evaluated from real video frames
    trans_sec = sec_map["cuts_and_transitions"]
    assert trans_sec["evidence_status"] in ("MEASURED_SIGNAL", "EVALUATED_SEMANTIC_EXPERIMENTAL", "NOT_YET_ASSESSED")

    # 6. Audio-dependent findings unassessed with honest explanations
    beat_sec = sec_map["beat_synchronization"]
    assert beat_sec["score_0_10"] is None
    assert beat_sec["evidence_status"] == "NOT_YET_ASSESSED"
    assert "no audio track" in beat_sec["creator_explanation"].lower() or "missing" in beat_sec["creator_explanation"].lower()

    # Music recognition unassessed / UNKNOWN
    sec_b = job.v6_report["section_b_music_recognition"]
    assert sec_b["status"] == "UNKNOWN"
    assert "does not contain an audio track" in sec_b["audit_note"]

    # Pacing: cadence correlation unassessed without audio
    pacing_sec = sec_map["pacing"]
    assert pacing_sec["score_0_10"] is None
    assert pacing_sec["evidence_status"] == "NOT_YET_ASSESSED"

    # Overall score withheld in unassessed standby
    assert pres["overall_score_0_10"] is None
    assert pres["overall_score_status"] == "NOT_YET_ASSESSED"
    assert pres["gauge_presentation"]["gauge_state"] == "unassessed_standby"

    # 7. Validate canonical v6 and presentation schemas
    EditDNASchemaV6.validate(job.v6_report)
    EditDNAPresentationAdapter.validate_presentation_report(pres)

    # 8. Verify report exports to private disk storage
    job_dir = os.path.join(PRIVATE_JOBS_DIR, job.job_id)
    v6_file = os.path.join(job_dir, "report_v6.json")
    pres_file = os.path.join(job_dir, "report_presentation.json")
    assert os.path.isfile(v6_file)
    assert os.path.isfile(pres_file)

    # 9. Verify legacy Phase 8 mode also handles video without audio track
    job_p8 = AnalysisJob("test_no_audio_legacy_job", test_clip, quality_mode="legacy")
    AnalysisEngine.execute_job(job_p8)
    assert job_p8.status == AnalysisJobStatus.COMPLETE
    assert job_p8.presentation_report["assessment_sections"][0]["score_0_10"] is None
    assert job_p8.presentation_report["assessment_sections"][0]["evidence_status"] == "NOT_YET_ASSESSED"
    EditDNASchemaV6.validate(job_p8.v6_report)
    EditDNAPresentationAdapter.validate_presentation_report(job_p8.presentation_report)

    print("FULL_SERVICE_NO_AUDIO_TRACK_VERIFIED")

finally:
    if os.path.isfile(test_clip):
        os.remove(test_clip)
      `,
    ],
    { encoding: "utf8", timeout: 25000 }
  );

  assert.ok(stdout.includes("FULL_SERVICE_NO_AUDIO_TRACK_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 10: Media Inspector stream detection and edge-case classification (A through L)", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";
  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import os
import sys
import subprocess
sys.path.insert(0, ${JSON.stringify(resolve(projectRoot, "scripts/edit-dna"))})
from media_inspector import MediaInspector

# Case A: Normal audiovisual edit (Dhurandhar MP4)
dhurandhar_path = "/home/rohan/lolixco-owner-media/inbox/Best Dhurandhar edit.mp4"
insp_a = MediaInspector.inspect(dhurandhar_path)
assert insp_a["is_supported"] is True
assert insp_a["classification_tag"] == "NORMAL_AUDIOVISUAL"
assert insp_a["capabilities"]["has_video_stream"] is True
assert insp_a["capabilities"]["has_audio_stream"] is True
assert "cuts_and_transitions" in insp_a["supported_analyses"]
assert "beat_synchronization" in insp_a["supported_analyses"]

# Case B: Video without audio stream
clip_b = "/tmp/test_case_b_no_audio.mp4"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1.5:r=25", "-an", "-c:v", "libx264", clip_b], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
insp_b = MediaInspector.inspect(clip_b)
assert insp_b["classification_tag"] == "NO_AUDIO_STREAM"
assert insp_b["capabilities"]["has_audio_stream"] is False
assert "beat_synchronization" in insp_b["unsupported_analyses"]

# Case C: Video with silent audio stream
clip_c = "/tmp/test_case_c_silent_audio.mp4"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1.5", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", "1.5", "-c:v", "libx264", "-c:a", "aac", clip_c], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
insp_c = MediaInspector.inspect(clip_c)
assert insp_c["classification_tag"] == "AUDIO_PRESENT_BUT_SILENT"
assert insp_c["capabilities"]["is_audio_silent"] is True

# Case D: Video with black frames and audio
clip_d = "/tmp/test_case_d_black_screen.mp4"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=1.5:r=25", "-f", "lavfi", "-i", "sine=f=440:d=1.5", "-c:v", "libx264", "-c:a", "aac", clip_d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
insp_d = MediaInspector.inspect(clip_d)
assert insp_d["classification_tag"] == "VIDEO_STREAM_PRESENT_BUT_BLACK"
assert insp_d["capabilities"]["is_video_black"] is True

# Case E: Audio-only container (MP3)
clip_e = "/tmp/test_case_e_audio_only.mp3"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=f=440:d=1.5", "-c:a", "libmp3lame", clip_e], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
insp_e = MediaInspector.inspect(clip_e)
assert insp_e["classification_tag"] == "NO_VIDEO_STREAM"
assert insp_e["capabilities"]["has_video_stream"] is False
assert "visual_measurements" in insp_e["unsupported_analyses"]

# Case F: Video with static image slide
clip_f = "/tmp/test_case_f_static_slide.mp4"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1.5:r=25", "-f", "lavfi", "-i", "sine=f=440:d=1.5", "-c:v", "libx264", "-c:a", "aac", clip_f], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
insp_f = MediaInspector.inspect(clip_f)
assert insp_f["classification_tag"] == "VIDEO_PRESENT_BUT_STATIC"
assert insp_f["capabilities"]["is_video_static"] is True

# Case J: Corrupted / invalid bytes
clip_j = "/tmp/test_case_j_corrupt.mp4"
with open(clip_j, "wb") as f:
    f.write(b"NOT_A_VALID_MP4_HEADER_GARBAGE_BYTES_1234567890" * 8)
insp_j = MediaInspector.inspect(clip_j)
assert insp_j["is_supported"] is False
assert insp_j["classification_tag"] == "MEDIA_UNSUPPORTED"

# Case K: Short clip (0.4s)
clip_k = "/tmp/test_case_k_short_clip.mp4"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=0.4", "-f", "lavfi", "-i", "sine=f=440:d=0.4", "-c:v", "libx264", "-c:a", "aac", clip_k], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
insp_k = MediaInspector.inspect(clip_k)
assert insp_k["classification_tag"] == "SHORT_CLIP"
assert insp_k["capabilities"]["is_short_clip"] is True

# Case L: Vertical short (720x1280 9:16)
clip_l = "/tmp/test_case_l_vertical.mp4"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=25:duration=1.5", "-f", "lavfi", "-i", "sine=f=440:d=1.5", "-c:v", "libx264", "-c:a", "aac", clip_l], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
insp_l = MediaInspector.inspect(clip_l)
assert insp_l["classification_tag"] == "VERTICAL_SHORT"
assert insp_l["capabilities"]["orientation"] == "portrait"
assert insp_l["capabilities"]["aspect_ratio"] == "9:16"

# YouTube URLs
assert MediaInspector.is_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") is True
assert MediaInspector.is_youtube_url("https://youtu.be/dQw4w9WgXcQ") is True
assert MediaInspector.is_youtube_url("https://www.youtube.com/shorts/dQw4w9WgXcQ") is True
assert MediaInspector.is_youtube_url("invalid_path.mp4") is False

insp_yt = MediaInspector.inspect("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
assert insp_yt["media_type"] == "youtube_url"
assert insp_yt["is_supported"] is True
assert "multimodal_semantic_recognition" in insp_yt["supported_analyses"]

# Cleanup temporary files
for p in (clip_b, clip_c, clip_d, clip_e, clip_f, clip_j, clip_k, clip_l):
    if os.path.isfile(p):
        os.remove(p)

print("MEDIA_INSPECTOR_EDGE_CASES_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 35000 }
  );

  assert.ok(stdout.includes("MEDIA_INSPECTOR_EDGE_CASES_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 10: Full service pipeline handles audio-only (Case E) and black video (Case D)", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";
  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import os
import sys
import subprocess
sys.path.insert(0, ${JSON.stringify(resolve(projectRoot, "scripts/edit-dna"))})
from local_service import AnalysisJob, AnalysisEngine, AnalysisJobStatus
from edit_dna_schema_v6 import EditDNASchemaV6
from presentation_adapter import EditDNAPresentationAdapter

# 1. Test Audio-only MP3
audio_only = "/tmp/test_service_audio_only.mp3"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=f=440:d=2.0", "-c:a", "libmp3lame", audio_only], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

try:
    job_audio = AnalysisJob("job_audio_only_test", audio_only, quality_mode="phase9")
    AnalysisEngine.execute_job(job_audio)
    assert job_audio.status == AnalysisJobStatus.COMPLETE
    pres_a = job_audio.presentation_report
    assert pres_a is not None
    sec_map_a = {s["dimension_id"]: s for s in pres_a["assessment_sections"]}
    
    # Audio-only: Video dimensions must be unassessed (None)
    assert sec_map_a["cuts_and_transitions"]["score_0_10"] is None
    assert sec_map_a["cuts_and_transitions"]["evidence_status"] == "NOT_YET_ASSESSED"
    assert sec_map_a["pacing"]["score_0_10"] is None
    assert sec_map_a["visual_measurements"]["score_0_10"] is None
    assert sec_map_a["beat_synchronization"]["score_0_10"] is None
    assert pres_a["overall_score_0_10"] is None
    assert pres_a["overall_score_status"] == "NOT_YET_ASSESSED"
    assert pres_a["gauge_presentation"]["gauge_state"] == "unassessed_standby"

    # Validate schema
    EditDNASchemaV6.validate(job_audio.v6_report)
    EditDNAPresentationAdapter.validate_presentation_report(pres_a)
finally:
    if os.path.isfile(audio_only):
        os.remove(audio_only)

# 2. Test Black Video with Audio
black_vid = "/tmp/test_service_black_vid.mp4"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=2.0:r=25", "-f", "lavfi", "-i", "sine=f=440:d=2.0", "-c:v", "libx264", "-c:a", "aac", black_vid], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

try:
    job_black = AnalysisJob("job_black_vid_test", black_vid, quality_mode="phase9")
    AnalysisEngine.execute_job(job_black)
    assert job_black.status == AnalysisJobStatus.COMPLETE
    pres_b = job_black.presentation_report
    assert pres_b is not None
    sec_map_b = {s["dimension_id"]: s for s in pres_b["assessment_sections"]}

    # Black screen visual measurements score 0.0 with MEASURED_SIGNAL
    assert sec_map_b["visual_measurements"]["score_0_10"] == 0.0
    assert sec_map_b["visual_measurements"]["evidence_status"] == "MEASURED_SIGNAL"
    assert "black" in sec_map_b["visual_measurements"]["creator_explanation"].lower()

    # Zero cuts to synchronize
    assert sec_map_b["cuts_and_transitions"]["score_0_10"] is None
    assert sec_map_b["beat_synchronization"]["score_0_10"] is None

    EditDNASchemaV6.validate(job_black.v6_report)
    EditDNAPresentationAdapter.validate_presentation_report(pres_b)
finally:
    if os.path.isfile(black_vid):
        os.remove(black_vid)

print("SERVICE_AUDIO_ONLY_AND_BLACK_VID_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 35000 }
  );

  assert.ok(stdout.includes("SERVICE_AUDIO_ONLY_AND_BLACK_VID_VERIFIED"));
});

test("Lolixco Edit DNA — Phase 10: Ingestion endpoint, YouTube URL execution & frame detail guard", () => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const pythonBin = "/home/rohan/.venvs/lolixco-antigravity/bin/python3";
  const stdout = execFileSync(
    pythonBin,
    [
      "-c",
      `
import os
import sys
import subprocess
from fastapi.testclient import TestClient
sys.path.insert(0, ${JSON.stringify(resolve(projectRoot, "scripts/edit-dna"))})
from local_service import app, AnalysisJob, AnalysisEngine, AnalysisJobStatus
from anime_scene_resolver import AnimeSceneResolver
from edit_dna_schema_v6 import EditDNASchemaV6
from presentation_adapter import EditDNAPresentationAdapter

client = TestClient(app)

# 1. Ingestion endpoint test
sample_upload = "/tmp/sample_to_ingest.mp4"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1.0", "-f", "lavfi", "-i", "sine=f=440:d=1.0", "-c:v", "libx264", "-c:a", "aac", sample_upload], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

try:
    resp = client.post("/api/v8/jobs/ingest", json={"source_path": sample_upload, "quality_mode": "phase9"})
    assert resp.status_code == 200, f"Ingest failed: {resp.text}"
    data = resp.json()
    assert "job_id" in data
    assert data["classification_tag"] in ("NORMAL_AUDIOVISUAL", "SHORT_CLIP")
    assert "poll_url" in data
finally:
    if os.path.isfile(sample_upload):
        os.remove(sample_upload)

# 2. YouTube URL execution test (remote observation contract)
from gemini_provider import GeminiVideoProvider
GeminiVideoProvider.analyze_structured_stream = classmethod(lambda cls, url: {
    "visual_recognition": {"identified_work": "Simulated Entity", "confidence": 0.88, "visual_style_and_grading": "High contrast action styling."},
    "soundtrack_recognition": {"identified_title": "Simulated Track", "confidence": 0.85, "artist_or_composer": "Artist"},
    "macro_pacing_and_flow": {"transition_style": "kinetic cuts", "rhythm_summary": "Fast-paced montage."},
    "storytelling_interpretation": {"narrative_structure": "Hero introduction followed by confrontation."},
    "originality_and_creative_execution": {"creative_assessment": "Dynamic graphic match transitions."},
    "model_used": "gemini-3.5-flash",
})

job_yt = AnalysisJob("job_yt_contract_test", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", quality_mode="phase9")
AnalysisEngine.execute_job(job_yt)
assert job_yt.status == AnalysisJobStatus.COMPLETE
assert job_yt.v6_report["media_type"] == "public_youtube_url"
assert job_yt.v6_report["section_g_privacy_and_contract"]["license_tier"] == "youtube_public_remote"

pres_yt = job_yt.presentation_report
assert pres_yt["overall_score_0_10"] is None
assert pres_yt["overall_score_status"] == "NOT_YET_ASSESSED"
assert pres_yt["gauge_presentation"]["gauge_state"] == "unassessed_standby"

sec_map_yt = {s["dimension_id"]: s for s in pres_yt["assessment_sections"]}
assert sec_map_yt["beat_synchronization"]["score_0_10"] is None
assert "remote" in sec_map_yt["beat_synchronization"]["creator_explanation"].lower() or "unassessed" in sec_map_yt["beat_synchronization"]["creator_explanation"].lower()

EditDNASchemaV6.validate(job_yt.v6_report)
EditDNAPresentationAdapter.validate_presentation_report(pres_yt)

# 3. AnimeSceneResolver Frame Quality Guard
# Test that dark black frame is rejected before calling external API to prevent false positives
dark_clip = "/tmp/test_dark_frame_guard.mp4"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=1.0:r=25", "-c:v", "libx264", dark_clip], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
try:
    res = AnimeSceneResolver.resolve_from_video(dark_clip)
    assert res["status"] == "UNKNOWN"
    assert res["reason"] == "ambiguous_dark_or_blurry_keyframe"
finally:
    if os.path.isfile(dark_clip):
        os.remove(dark_clip)

print("INGEST_YOUTUBE_AND_FRAME_GUARD_VERIFIED")
      `,
    ],
    { encoding: "utf8", timeout: 45000 }
  );

  assert.ok(stdout.includes("INGEST_YOUTUBE_AND_FRAME_GUARD_VERIFIED"));
});


