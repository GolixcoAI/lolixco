#!/usr/bin/env python3
"""
Lolixco Edit DNA — Evidence-Based Scoring Engine (Phase 6)
Replaces subjective proxy heuristics with strictly evidence-bearing classifications.

Core Principles:
  1. MEASURED_SIGNAL: Deterministic physical facts (cut timestamps, RMS, tempo, resolution).
  2. EVALUATED_SEMANTIC: Requires human critique or multi-modal semantic evaluation.
     If semantic evidence is absent, status is explicitly NOT_YET_ASSESSED (no preset grades).
  3. PERSONALIZED_ESTIMATE: Derived from owner weights only on evaluated criteria.
  4. Rhythmic Grids: Evaluates primary (e.g. 112.3 BPM), half-time (56.1 BPM),
     and double-time (224.6 BPM) grids without penalizing syncopated/anticipatory cuts.
  5. Cut & Shot Reconciliation: Precisely accounts for N shots, N-1 cut transitions,
     and separates cut transitions from intra-shot flash/strobe frames.
"""

import math
from typing import Dict, Any, List, Optional, Tuple
import numpy as np


class StatusTag:
    MEASURED_SIGNAL = "MEASURED_SIGNAL"
    EVALUATED_SEMANTIC = "EVALUATED_SEMANTIC"
    PERSONALIZED_ESTIMATE = "PERSONALIZED_ESTIMATE"
    NOT_YET_ASSESSED = "NOT_YET_ASSESSED"
    UNKNOWN = "UNKNOWN"
    CONFLICT = "CONFLICT"


class EvidenceScoringEngine:
    """
    Computes rigorous signal measurements and enforces honest evidence boundaries.
    Never manufactures subjective scores from resolution, cuts-per-second, or dynamic range.
    """

    def __init__(self, owner_weights: Optional[Dict[str, float]] = None):
        self.owner_weights = owner_weights or {
            "beat_synchronization": 0.340,
            "transitions": 0.181,
            "pacing": 0.176,
            "storytelling_emotion": 0.165,
            "originality_creativity": 0.112,
            "visual_quality": 0.026,
        }

    def reconcile_cuts_and_shots(
        self,
        cut_timestamps: List[float],
        duration_sec: float,
        flash_timestamps: Optional[List[float]] = None
    ) -> Dict[str, Any]:
        """
        Reconciles shot count, internal cut transitions, and separates transitions
        from mid-shot flash/strobe events.
        
        Rule: A video of duration D with internal cut timestamps has:
          shots_count = len(internal_cuts) + 1
          transitions_count = len(internal_cuts)
          all transitions_count are evaluated against rhythm grids.
        """
        # Ensure clean internal cuts (exclude 0.0 and duration_sec endpoints)
        clean_internal_cuts = []
        for c in cut_timestamps:
            if 0.05 < c < (duration_sec - 0.05):
                # Avoid duplicates within 100ms
                if not clean_internal_cuts or (c - clean_internal_cuts[-1]) >= 0.10:
                    clean_internal_cuts.append(round(float(c), 3))

        shots = []
        prev_t = 0.0
        for i, c_t in enumerate(clean_internal_cuts):
            shots.append({
                "shot_index": i + 1,
                "start_time": round(prev_t, 3),
                "end_time": round(c_t, 3),
                "duration": round(c_t - prev_t, 3)
            })
            prev_t = c_t
        
        # Final shot
        shots.append({
            "shot_index": len(clean_internal_cuts) + 1,
            "start_time": round(prev_t, 3),
            "end_time": round(duration_sec, 3),
            "duration": round(duration_sec - prev_t, 3)
        })

        # Separate mid-shot flashes from actual cut transitions
        flashes = flash_timestamps or []
        distinct_flashes = []
        for f in flashes:
            # If flash timestamp is > 100ms away from any cut transition, it's an intra-shot flash
            is_near_cut = any(abs(f - c) <= 0.10 for c in clean_internal_cuts)
            if not is_near_cut:
                distinct_flashes.append(round(float(f), 3))

        cps = len(shots) / duration_sec if duration_sec > 0 else 0.0
        shot_durations = [s["duration"] for s in shots]

        return {
            "status": StatusTag.MEASURED_SIGNAL,
            "duration_seconds": round(duration_sec, 2),
            "shots_count": len(shots),
            "cut_transitions_count": len(clean_internal_cuts),
            "cuts_per_second": round(cps, 2),
            "internal_cut_timestamps": clean_internal_cuts,
            "shots": shots,
            "shot_duration_mean": round(float(np.mean(shot_durations)), 3) if shot_durations else 0.0,
            "shot_duration_std_dev": round(float(np.std(shot_durations)), 3) if shot_durations else 0.0,
            "shot_duration_min": round(float(np.min(shot_durations)), 3) if shot_durations else 0.0,
            "shot_duration_max": round(float(np.max(shot_durations)), 3) if shot_durations else 0.0,
            "intra_shot_flashes_count": len(distinct_flashes),
            "intra_shot_flash_timestamps": distinct_flashes[:30],
            "flash_rate_per_second": round(len(distinct_flashes) / duration_sec, 2) if duration_sec > 0 else 0.0,
        }

    def evaluate_multi_grid_rhythm(
        self,
        internal_cuts: List[float],
        beat_timestamps: List[float],
        primary_bpm: float,
        audio_onsets: Optional[List[float]] = None,
        flash_timestamps: Optional[List[float]] = None
    ) -> Dict[str, Any]:
        """
        Evaluates cut timing against multiple rhythmic interpretations:
          1. Primary Grid (primary_bpm)
          2. Half-Time Grid (primary_bpm / 2, e.g. 56.1 BPM for slow heavy pulses)
          3. Double-Time Grid (primary_bpm * 2, e.g. 224.6 BPM for 16th-note syncopation)
          4. 16th-note subdivision grid (4 subdivisions per beat)
          5. Acoustic onset / transient alignment (snare hits, bass drops, trailer risers)
          6. Intra-shot flash synchronization (visual rhythm without cuts)
        
        Classifies cut timing into:
          - tight_sync: |delta| <= 70ms
          - loose_sync: 70ms < |delta| <= 150ms
          - syncopated_anticipatory: -120ms <= delta < -50ms (intentional beat lead-in)
          - unaligned_offbeat: |delta| > 150ms without syncopation pattern
        """
        if not internal_cuts or not beat_timestamps or primary_bpm <= 0:
            return {
                "status": StatusTag.UNKNOWN,
                "reason": "Missing cut timestamps or beat track",
                "total_transitions_evaluated": 0,
            }

        beats = np.array(beat_timestamps)
        
        # 1. Primary Grid Evaluation
        primary_eval = self._evaluate_single_grid(internal_cuts, beats)

        # 2. Half-Time Grid (every 2nd beat)
        half_time_beats = beats[::2] if len(beats) >= 2 else beats
        half_time_eval = self._evaluate_single_grid(internal_cuts, half_time_beats)

        # 3. Double-Time Grid (interpolate mid-beat points)
        double_time_beats = []
        for i in range(len(beats) - 1):
            double_time_beats.append(beats[i])
            double_time_beats.append((beats[i] + beats[i+1]) / 2.0)
        if len(beats) > 0:
            double_time_beats.append(beats[-1])
        double_eval = self._evaluate_single_grid(internal_cuts, np.array(double_time_beats))

        # 4. 16th-Note Subdivision Grid (4 subdivisions per beat interval)
        sub16_beats = []
        for i in range(len(beats) - 1):
            b0, b1 = beats[i], beats[i+1]
            step = (b1 - b0) / 4.0
            for k in range(4):
                sub16_beats.append(b0 + k * step)
        if len(beats) > 0:
            sub16_beats.append(beats[-1])
        sub16_eval = self._evaluate_single_grid(internal_cuts, np.array(sub16_beats))

        # 5. Acoustic Onset Transient Alignment
        onset_eval = None
        if audio_onsets and len(audio_onsets) > 0:
            onset_eval = self._evaluate_single_grid(internal_cuts, np.array(audio_onsets))

        # 6. Compound Rhythmic Synchronization (cuts landing on beat, subdivision, OR audio onset)
        anchor_candidates = list(sub16_beats)
        if audio_onsets and len(audio_onsets) > 0:
            anchor_candidates.extend(audio_onsets)
        compound_eval = self._evaluate_single_grid(internal_cuts, np.array(sorted(anchor_candidates)))

        # 7. Intra-Shot Flash Synchronization (flashes landing on beats or audio onsets)
        flash_sync_pct = None
        flash_hits_count = 0
        if flash_timestamps and len(flash_timestamps) > 0:
            flash_anchors = np.array(sorted(list(beat_timestamps) + (audio_onsets or [])))
            for ft in flash_timestamps:
                diffs = np.abs(ft - flash_anchors)
                if len(diffs) > 0 and np.min(diffs) <= 0.070:
                    flash_hits_count += 1
            flash_sync_pct = round((flash_hits_count / len(flash_timestamps)) * 100.0, 1)

        return {
            "status": StatusTag.MEASURED_SIGNAL,
            "primary_bpm": round(primary_bpm, 1),
            "half_time_bpm": round(primary_bpm / 2.0, 1),
            "double_time_bpm": round(primary_bpm * 2.0, 1),
            "total_transitions_evaluated": len(internal_cuts),
            "primary_grid": primary_eval,
            "half_time_grid": half_time_eval,
            "double_time_grid": double_eval,
            "subdivision_16th_grid": sub16_eval,
            "onset_alignment": onset_eval,
            "compound_sync": compound_eval,
            "intra_shot_flash_sync_percent": flash_sync_pct,
            "intra_shot_flashes_on_beat_count": flash_hits_count if flash_sync_pct is not None else 0,
            "best_rhythmic_fit": (
                "double_time_syncopated" if double_eval["tight_sync_percent"] > primary_eval["tight_sync_percent"] + 15
                else ("half_time_pulse" if half_time_eval["tight_sync_percent"] > primary_eval["tight_sync_percent"] + 10
                else "primary_beat_grid")
            ),
            "anticipatory_cuts_count": primary_eval["anticipatory_sync_count"],
        }

    def _evaluate_single_grid(
        self,
        cuts: List[float],
        beats: np.ndarray
    ) -> Dict[str, Any]:
        tight_count = 0
        loose_count = 0
        anticipatory_count = 0
        unaligned_count = 0
        deltas = []

        for cut_t in cuts:
            # signed delta: cut_t - beat_t
            signed_diffs = cut_t - beats
            min_idx = np.argmin(np.abs(signed_diffs))
            signed_delta = float(signed_diffs[min_idx])
            abs_delta = abs(signed_delta)
            deltas.append(abs_delta)

            if abs_delta <= 0.070:
                tight_count += 1
            elif -0.120 <= signed_delta <= -0.050:
                # Anticipatory lead-in cut: fires slightly ahead of beat impact
                anticipatory_count += 1
                loose_count += 1
            elif abs_delta <= 0.150:
                loose_count += 1
            else:
                unaligned_count += 1

        total = len(cuts)
        return {
            "total_cuts": total,
            "tight_sync_count": tight_count,
            "loose_sync_count": loose_count,
            "anticipatory_sync_count": anticipatory_count,
            "unaligned_count": unaligned_count,
            "tight_sync_percent": round((tight_count / total) * 100.0, 1) if total else 0.0,
            "loose_sync_percent": round((loose_count / total) * 100.0, 1) if total else 0.0,
            "mean_delta_ms": round(float(np.mean(deltas)) * 1000.0, 1) if deltas else 0.0,
        }

    def evaluate_scorecard(
        self,
        cuts_reconciliation: Dict[str, Any],
        rhythm_evaluation: Dict[str, Any],
        video_signals: Dict[str, Any],
        audio_signals: Dict[str, Any],
        semantic_evaluations: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generates the 6-dimension scorecard with strict distinction between
        measured facts and assessed semantic qualities.

        Dimensions:
          1. Beat Synchronization: MEASURED_SIGNAL (derived from beat delta distribution)
          2. Transitions: MEASURED_SIGNAL + accessibility flags, or EVALUATED_SEMANTIC
          3. Pacing: CPS is MEASURED_SIGNAL. Pacing quality is NOT_YET_ASSESSED unless semantic input exists.
          4. Visual Quality: Resolution/sharpness are MEASURED_SIGNAL. Visual quality is NOT_YET_ASSESSED unless semantic input exists.
          5. Storytelling / Emotion: NOT_YET_ASSESSED (no fake energy proxies).
          6. Originality / Creativity: NOT_YET_ASSESSED (no fake shot-variance proxies).
        """
        semantic_evals = semantic_evaluations or {}

        # 1. Beat Synchronization (0-10) — grounded in measured delta distribution
        primary_tight = rhythm_evaluation.get("primary_grid", {}).get("tight_sync_percent", 0.0)
        primary_loose = rhythm_evaluation.get("primary_grid", {}).get("loose_sync_percent", 0.0)
        rigid_effective = primary_tight + (primary_loose * 0.5)
        rigid_grid_score = round(min(10.0, max(1.0, (rigid_effective / 100.0) * 10.0)), 2)

        compound_eval = rhythm_evaluation.get("compound_sync")
        if compound_eval and compound_eval.get("tight_sync_percent") is not None:
            c_tight = compound_eval.get("tight_sync_percent", primary_tight)
            c_loose = compound_eval.get("loose_sync_percent", primary_loose)
            c_effective = c_tight + (c_loose * 0.5)
            compound_score = round(min(10.0, max(1.0, (c_effective / 100.0) * 10.0)), 2)
        else:
            c_tight = primary_tight
            c_loose = primary_loose
            compound_score = rigid_grid_score

        # Selected score reports compound technical alignment when multi-anchor evidence exists
        selected_beat_score = compound_score

        beat_sync_card = {
            "status": StatusTag.MEASURED_SIGNAL,
            "score": selected_beat_score,
            "provenance": "measured_beat_and_transient_deltas",
            "artistic_quality": StatusTag.NOT_YET_ASSESSED,
            "metric_details": {
                "rigid_grid_score": rigid_grid_score,
                "compound_alignment_score": compound_score,
                "primary_grid_tight_percent": primary_tight,
                "primary_grid_loose_percent": primary_loose,
                "double_time_tight_percent": rhythm_evaluation.get("double_time_grid", {}).get("tight_sync_percent"),
                "subdivision_16th_tight_percent": rhythm_evaluation.get("subdivision_16th_grid", {}).get("tight_sync_percent"),
                "onset_transient_tight_percent": rhythm_evaluation.get("onset_alignment", {}).get("tight_sync_percent") if rhythm_evaluation.get("onset_alignment") else None,
                "compound_tight_sync_percent": c_tight,
                "flash_onset_sync_percent": rhythm_evaluation.get("intra_shot_flash_sync_percent"),
                "anticipatory_cuts": rhythm_evaluation.get("anticipatory_cuts_count", 0),
                "best_rhythmic_fit": rhythm_evaluation.get("best_rhythmic_fit", "unknown")
            },
            "limitations": [
                "Derived strictly from measured temporal proximity of cut timestamps to detected audio transients. "
                "This is an objective timing alignment measurement, NOT a validated overall artistic judgment of musicality, groove, or emotional sync."
            ],
            "notes": "Measures physical timing alignment to beats, subdivisions, and transient hits. Does NOT validate artistic groove, emotional timing, or musical phrasing without verified human critique."
        }

        # 2. Transitions (0-10)
        # If semantic assessment provided, use it; otherwise report physical continuity & flash risk
        if "transitions" in semantic_evals:
            transitions_card = {
                "status": StatusTag.EVALUATED_SEMANTIC,
                "score": round(float(semantic_evals["transitions"]["score"]), 2),
                "provenance": semantic_evals["transitions"].get("evaluator", "human_expert"),
                "notes": semantic_evals["transitions"].get("notes", "")
            }
        else:
            flash_rate = cuts_reconciliation.get("flash_rate_per_second", 0.0)
            transitions_card = {
                "status": StatusTag.NOT_YET_ASSESSED,
                "score": None,
                "provenance": "requires_semantic_evaluation",
                "physical_signals": {
                    "intra_shot_flashes": cuts_reconciliation.get("intra_shot_flashes_count", 0),
                    "flash_rate_per_second": flash_rate,
                    "accessibility_strobe_alert": flash_rate > 1.0
                },
                "explanation": "Subjective transition flow and seam invisibility cannot be measured from frame differencing alone."
            }

        # 3. Pacing (0-10)
        # CPS and duration variance are facts; pacing quality requires semantic evaluation
        if "pacing" in semantic_evals:
            pacing_card = {
                "status": StatusTag.EVALUATED_SEMANTIC,
                "score": round(float(semantic_evals["pacing"]["score"]), 2),
                "provenance": semantic_evals["pacing"].get("evaluator", "human_expert"),
                "notes": semantic_evals["pacing"].get("notes", "")
            }
        else:
            pacing_card = {
                "status": StatusTag.NOT_YET_ASSESSED,
                "score": None,
                "provenance": "requires_semantic_evaluation",
                "physical_signals": {
                    "cuts_per_second": cuts_reconciliation.get("cuts_per_second", 0.0),
                    "shot_duration_mean": cuts_reconciliation.get("shot_duration_mean", 0.0),
                    "shot_duration_std_dev": cuts_reconciliation.get("shot_duration_std_dev", 0.0),
                },
                "explanation": "Pacing depends on narrative breathing room and emotional beats, not raw cuts-per-second thresholds."
            }

        # 4. Visual Quality (0-10)
        if "visual_quality" in semantic_evals:
            visual_quality_card = {
                "status": StatusTag.EVALUATED_SEMANTIC,
                "score": round(float(semantic_evals["visual_quality"]["score"]), 2),
                "provenance": semantic_evals["visual_quality"].get("evaluator", "human_expert"),
                "notes": semantic_evals["visual_quality"].get("notes", "")
            }
        else:
            visual_quality_card = {
                "status": StatusTag.NOT_YET_ASSESSED,
                "score": None,
                "provenance": "requires_semantic_evaluation",
                "physical_signals": {
                    "width": video_signals.get("width"),
                    "height": video_signals.get("height"),
                    "fps": video_signals.get("fps"),
                    "mean_sharpness_laplacian": video_signals.get("mean_sharpness_laplacian"),
                    "mean_contrast": video_signals.get("mean_contrast"),
                },
                "explanation": "High resolution does not ensure color harmony, grading quality, or absence of compression artifacts."
            }

        # 5. Storytelling & Emotional Impact (0-10)
        if "storytelling_emotion" in semantic_evals:
            storytelling_card = {
                "status": StatusTag.EVALUATED_SEMANTIC,
                "score": round(float(semantic_evals["storytelling_emotion"]["score"]), 2),
                "provenance": semantic_evals["storytelling_emotion"].get("evaluator", "human_expert"),
                "notes": semantic_evals["storytelling_emotion"].get("notes", "")
            }
        else:
            storytelling_card = {
                "status": StatusTag.NOT_YET_ASSESSED,
                "score": None,
                "provenance": "requires_semantic_evaluation",
                "physical_signals": {
                    "audio_dynamic_range_rms": audio_signals.get("rms_db"),
                    "audio_clipping_detected": audio_signals.get("clipping_detected", False),
                },
                "explanation": "Narrative structure and emotional resonance require understanding character arcs and dramatic context, which cannot be derived from audio energy."
            }

        # 6. Originality & Creative Execution (0-10)
        if "originality_creativity" in semantic_evals:
            originality_card = {
                "status": StatusTag.EVALUATED_SEMANTIC,
                "score": round(float(semantic_evals["originality_creativity"]["score"]), 2),
                "provenance": semantic_evals["originality_creativity"].get("evaluator", "human_expert"),
                "notes": semantic_evals["originality_creativity"].get("notes", "")
            }
        else:
            originality_card = {
                "status": StatusTag.NOT_YET_ASSESSED,
                "score": None,
                "provenance": "requires_semantic_evaluation",
                "physical_signals": {
                    "shot_duration_variance": cuts_reconciliation.get("shot_duration_std_dev", 0.0),
                },
                "explanation": "Shot-length variance is not a valid proxy for creative originality or unique stylistic voice."
            }

        # Overall Personalized Estimate:
        # If all 6 criteria are assessed, compute weighted score.
        # If only beat sync is measured and others are unassessed, report partial estimate
        # with an explicit disclaimer, OR withhold overall grade.
        all_scored = all(
            c["score"] is not None for c in [
                beat_sync_card, transitions_card, pacing_card,
                visual_quality_card, storytelling_card, originality_card
            ]
        )

        if all_scored:
            weighted_score = (
                beat_sync_card["score"] * self.owner_weights["beat_synchronization"]
                + transitions_card["score"] * self.owner_weights["transitions"]
                + pacing_card["score"] * self.owner_weights["pacing"]
                + storytelling_card["score"] * self.owner_weights["storytelling_emotion"]
                + originality_card["score"] * self.owner_weights["originality_creativity"]
                + visual_quality_card["score"] * self.owner_weights["visual_quality"]
            )
            overall_prediction = {
                "status": StatusTag.PERSONALIZED_ESTIMATE,
                "predicted_score": round(weighted_score, 2),
                "calculation_basis": "full_rubric_evaluated",
                "owner_weights": self.owner_weights,
            }
        else:
            # Honest declaration: Overall score cannot be reliably computed without semantic evaluation
            overall_prediction = {
                "status": StatusTag.NOT_YET_ASSESSED,
                "predicted_score": None,
                "calculation_basis": "unassessed_semantic_dimensions",
                "assessed_dimensions": ["beat_synchronization"],
                "unassessed_dimensions": [
                    k for k, v in [
                        ("transitions", transitions_card),
                        ("pacing", pacing_card),
                        ("visual_quality", visual_quality_card),
                        ("storytelling_emotion", storytelling_card),
                        ("originality_creativity", originality_card)
                    ] if v["score"] is None
                ],
                "explanation": (
                    "Subjective overall quality cannot be responsibly scored while 5 of 6 "
                    "dimensions remain unassessed. Discarded Phase 5 heuristic proxy score of 6.07."
                )
            }

        return {
            "scorecard": {
                "beat_synchronization": beat_sync_card,
                "transitions": transitions_card,
                "pacing": pacing_card,
                "visual_quality": visual_quality_card,
                "storytelling_emotion": storytelling_card,
                "originality_creativity": originality_card,
            },
            "overall_prediction": overall_prediction,
        }
