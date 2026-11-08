#!/usr/bin/env python3
"""
Lolixco Edit DNA — Phase 7: Safe Demo Fixture Generator for Codex
Generates and validates all 9 required synthetic demo fixtures for Creator Studio frontend development.

Fixtures generated:
  A:  fixture_a_all_scored_strong.json            (All 7 categories scored, valid overall score 7.86)
  B:  fixture_b_partially_scored_dhurandhar.json   (Some categories scored, some unassessed, overall null)
  C:  fixture_c_all_unassessed.json                (All 7 categories unassessed, overall null)
  D:  fixture_d_no_overall_score.json              (Multiple dimensions scored, but overall eligibility not met)
  E:  fixture_e_music_conflict.json                (Music recognition CONFLICT, acoustic clash)
  F:  fixture_f_unknown_source.json                (Visual source UNKNOWN / out-of-catalog)
  G:  fixture_g_owner_fit_unavailable.json         (Personalized owner fit unassessed)
  H1: fixture_h1_low_scoring_weak.json             (Genuinely low-scoring edit, 3.14/10, red tier)
  H2: fixture_h2_high_scoring_exceptional.json      (Genuinely high-scoring edit, 9.43/10, exceptional glow)

Safety Guarantees:
  - All fixtures explicitly flag: is_synthetic_fixture: true, for_frontend_testing_only: true.
  - Zero private owner critique text or private media paths are included.
  - All fixtures are strictly validated against presentation contract v7.0.0.
"""

import os
import sys
import json
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from presentation_adapter import (
    EditDNAPresentationAdapter,
    PRESENTATION_SCHEMA_VERSION,
    ORDERED_DIMENSIONS,
)

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/edit-dna/fixtures")
os.makedirs(FIXTURES_DIR, exist_ok=True)


def build_base_doc(
    fixture_id: str,
    media_id: str,
    overall_score: Any,
    overall_status: str,
    overall_method: Any,
    sections: List[Dict[str, Any]],
    purpose: str,
    reaction_bubbles: List[Dict[str, str]] = None,
    context_evidence: Dict[str, Any] = None,
) -> Dict[str, Any]:
    """Helper to assemble a validated presentation document."""
    gauge = EditDNAPresentationAdapter.build_gauge_presentation(overall_score, overall_status)
    tier = EditDNAPresentationAdapter.get_score_tier(overall_score)
    bubbles = reaction_bubbles or EditDNAPresentationAdapter.generate_reaction_bubbles(sections, overall_score, context_evidence)

    doc = {
        "schema_version": PRESENTATION_SCHEMA_VERSION,
        "is_synthetic_fixture": True,
        "for_frontend_testing_only": True,
        "do_not_use_for_training": True,
        "fixture_id": fixture_id,
        "fixture_purpose": purpose,
        "media_id": media_id,
        "media_type": "authorized_video_bytes",
        "generated_at": "2026-11-04T00:00:00Z",
        "analysis_status": (
            "COMPLETE" if overall_score is not None
            else ("PARTIAL" if any(s["score_0_10"] is not None for s in sections) else "UNASSESSED")
        ),
        "overall_score_0_10": overall_score,
        "overall_score_status": overall_status,
        "overall_score_method": overall_method,
        "overall_score_tier": tier,
        "gauge_presentation": gauge,
        "reaction_bubbles": bubbles,
        "assessment_sections": sections,
        "context_evidence": context_evidence or {
            "visual_recognition": {"status": "UNKNOWN", "provenance": "synthetic_fixture"},
            "music_recognition": {"status": "UNKNOWN", "provenance": "synthetic_fixture"},
        },
    }

    EditDNAPresentationAdapter.validate_presentation_report(doc)
    return doc


def generate_all_fixtures() -> Dict[str, str]:
    created_paths = {}

    # -------------------------------------------------------------
    # Fixture A: All seven categories scored, valid overall score (7.86)
    # -------------------------------------------------------------
    sec_a = [
        {
            "section_id": "beat_synchronization",
            "dimension_id": "beat_synchronization",
            "section_name": "Beat Synchronization",
            "display_name": "Beat Synchronization",
            "score_0_10": 8.70,
            "evidence_status": "MEASURED_SIGNAL",
            "evidence_refs": {"tight_sync_percent": 84.5, "loose_sync_percent": 12.0, "primary_bpm": 128.0},
            "timestamps": [1.25, 2.50, 3.75, 5.00, 6.25],
            "method_version": "librosa_multi_tempo_grid_v6.0",
            "limitations": ["Evaluates transient impact; lyric emotional alignment unmeasured."],
            "creator_explanation": "Flawless sync lock with 84.5% of cuts hitting heavy drum transients."
        },
        {
            "section_id": "cuts_and_transitions",
            "dimension_id": "cuts_and_transitions",
            "section_name": "Cuts & Transitions",
            "display_name": "Cuts & Transitions",
            "score_0_10": 7.80,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"cut_transitions_count": 32, "intra_shot_flashes_count": 4, "flash_rate_per_sec": 0.18},
            "timestamps": [2.45, 4.88, 8.12],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Evaluated by human editorial critique."],
            "creator_explanation": "Clean match cuts and directional whip-pans maintain continuous screen energy."
        },
        {
            "section_id": "pacing",
            "dimension_id": "pacing",
            "section_name": "Pacing",
            "display_name": "Pacing",
            "score_0_10": 8.20,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"cuts_per_second": 1.45, "shot_duration_mean_sec": 0.69, "shot_duration_std_dev_sec": 0.35},
            "timestamps": [],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Pacing flow judged in context of song progression."],
            "creator_explanation": "Great dynamic build; slow opening that accelerates into the drop."
        },
        {
            "section_id": "visual_measurements",
            "dimension_id": "visual_measurements",
            "section_name": "Visual Measurements",
            "display_name": "Visual Measurements",
            "score_0_10": 7.50,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"width": 1920, "height": 1080, "fps": 60.0, "mean_sharpness_laplacian": 412.0},
            "timestamps": [],
            "method_version": "laplacian_variance_and_signal_v6.0",
            "limitations": ["High bit rate confirmed; subtle grading compression noted."],
            "creator_explanation": "Crisp 1080p60 master with balanced contrast and vibrant highlights."
        },
        {
            "section_id": "storytelling_interpretation",
            "dimension_id": "storytelling_interpretation",
            "section_name": "Storytelling Interpretation",
            "display_name": "Storytelling Interpretation",
            "score_0_10": 7.60,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"narrative_arc": "hero_fall_and_redemption"},
            "timestamps": [0.0, 10.5, 22.0],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Assessed from character reaction coherence."],
            "creator_explanation": "Clear emotional narrative arc tracking the protagonist's duel."
        },
        {
            "section_id": "originality_creativity",
            "dimension_id": "originality_creativity",
            "section_name": "Originality & Creative Execution",
            "display_name": "Originality & Creative Execution",
            "score_0_10": 7.40,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"vfx_originality": "custom_kinetic_typography"},
            "timestamps": [14.2, 18.0],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Subjective novelty rating."],
            "creator_explanation": "Custom geometric text hits and kinetic color grading avoid generic template looks."
        },
        {
            "section_id": "personalized_owner_fit",
            "dimension_id": "personalized_owner_fit",
            "section_name": "Personalized Owner Fit",
            "display_name": "Personalized Owner Fit",
            "score_0_10": 7.90,
            "evidence_status": "PERSONALIZED_ESTIMATE",
            "evidence_refs": {"model": "loocv_constrained_regression_v6.1", "top_weight": "beat_synchronization (0.34)"},
            "timestamps": [],
            "method_version": "loocv_constrained_regression_v6.1",
            "limitations": ["Calibrated on owner's 11 real reviews."],
            "creator_explanation": "Strongly aligns with owner's preference for rhythmic sync and narrative clarity."
        },
    ]
    doc_a = build_base_doc(
        fixture_id="fixture_a_all_scored_strong",
        media_id="synthetic_demo_master_edit.mp4",
        overall_score=7.86,
        overall_status="CALCULATED_PERSONALIZED",
        overall_method="audited_multi_dimension_weighted_fit_v7.0",
        sections=sec_a,
        purpose="Verify full 7-stage animation with all bars filled, high yellow RPM gauge deflection, and celebratory badges.",
    )
    p_a = os.path.join(FIXTURES_DIR, "fixture_a_all_scored_strong.json")
    with open(p_a, "w") as f: json.dump(doc_a, f, indent=2)
    created_paths["A"] = p_a

    # -------------------------------------------------------------
    # Fixture B: Partially scored (Dhurandhar real-world case, overall null)
    # -------------------------------------------------------------
    sec_b = [
        {
            "section_id": "beat_synchronization",
            "dimension_id": "beat_synchronization",
            "section_name": "Beat Synchronization",
            "display_name": "Beat Synchronization",
            "score_0_10": 4.93,
            "evidence_status": "MEASURED_SIGNAL",
            "evidence_refs": {"primary_grid_tight_percent": 34.8, "double_time_tight_percent": 68.1, "primary_bpm": 112.3},
            "timestamps": [0.52, 1.04, 1.56, 2.08],
            "method_version": "librosa_multi_tempo_grid_v6.0",
            "limitations": ["Evaluates transient timing."],
            "creator_explanation": "Moderate primary sync (34.8%), but strong 16th-note double-time alignment (68.1%)."
        },
        {
            "section_id": "cuts_and_transitions",
            "dimension_id": "cuts_and_transitions",
            "section_name": "Cuts & Transitions",
            "display_name": "Cuts & Transitions",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {"cut_transitions_count": 69, "intra_shot_flashes_count": 14, "flash_rate_per_sec": 0.38},
            "timestamps": [3.12, 5.84, 12.40],
            "method_version": "opencv_absdiff_debounced_v6.0",
            "limitations": ["Physical cut counts recorded; subjective flow unassessed."],
            "creator_explanation": "Detected 69 cuts and 14 intra-shot flashes. Visual transition smoothness requires semantic evaluation."
        },
        {
            "section_id": "pacing",
            "dimension_id": "pacing",
            "section_name": "Pacing",
            "display_name": "Pacing",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {"cuts_per_second": 1.92, "shot_duration_mean_sec": 0.52, "shot_duration_std_dev_sec": 0.42},
            "timestamps": [],
            "method_version": "shot_duration_distribution_v6.0",
            "limitations": ["Cadence measured; narrative pacing unassessed."],
            "creator_explanation": "Rapid kinetic cadence at 1.92 cuts/sec. Pacing quality requires editorial review."
        },
        {
            "section_id": "visual_measurements",
            "dimension_id": "visual_measurements",
            "section_name": "Visual Measurements",
            "display_name": "Visual Measurements",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {"width": 1280, "height": 720, "fps": 30.0, "mean_sharpness_laplacian": 387.2},
            "timestamps": [],
            "method_version": "laplacian_variance_and_signal_v6.0",
            "limitations": ["Resolution confirmed; color grading unassessed."],
            "creator_explanation": "720p30 master with sharpness Laplacian 387.2. Aesthetic visual quality is unassessed."
        },
        {
            "section_id": "storytelling_interpretation",
            "dimension_id": "storytelling_interpretation",
            "section_name": "Storytelling Interpretation",
            "display_name": "Storytelling Interpretation",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {"audio_clipping": True, "rms_db": -9.0},
            "timestamps": [],
            "method_version": "narrative_arc_critique_v6.0",
            "limitations": ["Audio dynamics recorded; dramatic narrative arc requires human review."],
            "creator_explanation": "Storytelling arc and emotional impact are not yet assessed."
        },
        {
            "section_id": "originality_creativity",
            "dimension_id": "originality_creativity",
            "section_name": "Originality & Creative Execution",
            "display_name": "Originality & Creative Execution",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {"shot_duration_variance": 0.42},
            "timestamps": [],
            "method_version": "creative_execution_critique_v6.0",
            "limitations": ["Originality cannot be derived from shot variance."],
            "creator_explanation": "Creative execution and unique stylistic voice are not yet assessed."
        },
        {
            "section_id": "personalized_owner_fit",
            "dimension_id": "personalized_owner_fit",
            "section_name": "Personalized Owner Fit",
            "display_name": "Personalized Owner Fit",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {"status": "withheld_pending_semantic_evaluation"},
            "timestamps": [],
            "method_version": "loocv_constrained_regression_v6.1",
            "limitations": ["Owner fit requires full rubric evaluation."],
            "creator_explanation": "Personalized fit is withheld until semantic dimensions are assessed."
        },
    ]
    doc_b = build_base_doc(
        fixture_id="fixture_b_partially_scored_dhurandhar",
        media_id="Best Dhurandhar edit.mp4",
        overall_score=None,
        overall_status="NOT_YET_ASSESSED",
        overall_method=None,
        sections=sec_b,
        purpose="Verify Dhurandhar real-world case: beat sync bar fills (4.93), other bars show honest unassessed state, overall gauge settles into standby (N/A).",
        context_evidence={
            "visual_recognition": {"status": "UNKNOWN", "explanation": "Out-of-catalog Bollywood footage."},
            "music_recognition": {"status": "CONFLICT", "explanation": "Acoustic genre clash with classical reference."},
        }
    )
    p_b = os.path.join(FIXTURES_DIR, "fixture_b_partially_scored_dhurandhar.json")
    with open(p_b, "w") as f: json.dump(doc_b, f, indent=2)
    created_paths["B"] = p_b

    # -------------------------------------------------------------
    # Fixture C: All seven categories unassessed (overall null)
    # -------------------------------------------------------------
    sec_c = [
        {
            "section_id": sid,
            "dimension_id": sid,
            "section_name": sname,
            "display_name": sname,
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {},
            "timestamps": [],
            "method_version": "v7.0",
            "limitations": ["Analysis not yet run or media bytes unavailable."],
            "creator_explanation": f"{sname} is currently unassessed. Awaiting analysis."
        }
        for sid, sname in ORDERED_DIMENSIONS
    ]
    doc_c = build_base_doc(
        fixture_id="fixture_c_all_unassessed",
        media_id="unprocessed_upload.mp4",
        overall_score=None,
        overall_status="NOT_YET_ASSESSED",
        overall_method=None,
        sections=sec_c,
        purpose="Verify initial upload / unanalyzed state: all 7 bars in dimmed standby, gauge shows N/A, zero false scores.",
    )
    p_c = os.path.join(FIXTURES_DIR, "fixture_c_all_unassessed.json")
    with open(p_c, "w") as f: json.dump(doc_c, f, indent=2)
    created_paths["C"] = p_c

    # -------------------------------------------------------------
    # Fixture D: Multiple dimensions scored, but overall eligibility not met
    # -------------------------------------------------------------
    sec_d = [
        {
            "section_id": "beat_synchronization",
            "dimension_id": "beat_synchronization",
            "section_name": "Beat Synchronization",
            "display_name": "Beat Synchronization",
            "score_0_10": 8.40,
            "evidence_status": "MEASURED_SIGNAL",
            "evidence_refs": {"tight_sync_percent": 81.0, "primary_bpm": 120.0},
            "timestamps": [1.0, 2.0, 3.0],
            "method_version": "librosa_multi_tempo_grid_v6.0",
            "limitations": [],
            "creator_explanation": "Tight beat synchronization measured."
        },
        {
            "section_id": "cuts_and_transitions",
            "dimension_id": "cuts_and_transitions",
            "section_name": "Cuts & Transitions",
            "display_name": "Cuts & Transitions",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {},
            "timestamps": [],
            "method_version": "v7.0",
            "limitations": [],
            "creator_explanation": "Transitions unassessed."
        },
        {
            "section_id": "pacing",
            "dimension_id": "pacing",
            "section_name": "Pacing",
            "display_name": "Pacing",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {},
            "timestamps": [],
            "method_version": "v7.0",
            "limitations": [],
            "creator_explanation": "Pacing unassessed."
        },
        {
            "section_id": "visual_measurements",
            "dimension_id": "visual_measurements",
            "section_name": "Visual Measurements",
            "display_name": "Visual Measurements",
            "score_0_10": 7.00,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"width": 1920, "height": 1080},
            "timestamps": [],
            "method_version": "laplacian_variance_and_signal_v6.0",
            "limitations": [],
            "creator_explanation": "Clean 1080p source."
        },
        {
            "section_id": "storytelling_interpretation",
            "dimension_id": "storytelling_interpretation",
            "section_name": "Storytelling Interpretation",
            "display_name": "Storytelling Interpretation",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {},
            "timestamps": [],
            "method_version": "v7.0",
            "limitations": [],
            "creator_explanation": "Storytelling unassessed."
        },
        {
            "section_id": "originality_creativity",
            "dimension_id": "originality_creativity",
            "section_name": "Originality & Creative Execution",
            "display_name": "Originality & Creative Execution",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {},
            "timestamps": [],
            "method_version": "v7.0",
            "limitations": [],
            "creator_explanation": "Originality unassessed."
        },
        {
            "section_id": "personalized_owner_fit",
            "dimension_id": "personalized_owner_fit",
            "section_name": "Personalized Owner Fit",
            "display_name": "Personalized Owner Fit",
            "score_0_10": None,
            "evidence_status": "NOT_YET_ASSESSED",
            "evidence_refs": {},
            "timestamps": [],
            "method_version": "v7.0",
            "limitations": [],
            "creator_explanation": "Owner fit unassessed."
        },
    ]
    doc_d = build_base_doc(
        fixture_id="fixture_d_no_overall_score",
        media_id="partial_signals_edit.mp4",
        overall_score=None,
        overall_status="NOT_YET_ASSESSED",
        overall_method=None,
        sections=sec_d,
        purpose="Verify eligibility gate: dimensions 1 and 4 animate with scores, but overall score remains null (N/A) because critical narrative dimensions are missing.",
    )
    p_d = os.path.join(FIXTURES_DIR, "fixture_d_no_overall_score.json")
    with open(p_d, "w") as f: json.dump(doc_d, f, indent=2)
    created_paths["D"] = p_d

    # -------------------------------------------------------------
    # Fixture E: Conflicting music recognition (Acoustic clash)
    # -------------------------------------------------------------
    doc_e = build_base_doc(
        fixture_id="fixture_e_music_conflict",
        media_id="conflict_soundtrack_edit.mp4",
        overall_score=5.17,
        overall_status="CALCULATED_SEMANTIC",
        overall_method="audited_multi_dimension_weighted_fit_v7.0",
        sections=sec_a,  # Use scored sections with adjusted scores
        purpose="Verify comic bubble for acoustic conflict without breaking quality scoring.",
        reaction_bubbles=[
            {"tag": "AUDIO", "callout": "ACOUSTIC CLASH! Modern trap beat matched against classical piece.", "style": "warning"},
            {"tag": "RHYTHM", "callout": "BEAT-LOCKED! High transient precision.", "style": "neon"},
            {"tag": "VERDICT", "callout": "MIXED EXECUTION. 5.17/10 overall.", "style": "info"},
        ],
        context_evidence={
            "visual_recognition": {"status": "UNKNOWN", "explanation": "Out-of-catalog footage."},
            "music_recognition": {
                "status": "CONFLICT",
                "matched_track": None,
                "tentative_candidate": {"title": "Brandenburg Concerto No. 3", "artist": "J.S. Bach", "similarity": 0.72},
                "conflict_details": {"reason": "acoustic_genre_and_loudness_contradiction"}
            }
        }
    )
    p_e = os.path.join(FIXTURES_DIR, "fixture_e_music_conflict.json")
    with open(p_e, "w") as f: json.dump(doc_e, f, indent=2)
    created_paths["E"] = p_e

    # -------------------------------------------------------------
    # Fixture F: Unknown movie / anime source
    # -------------------------------------------------------------
    doc_f = build_base_doc(
        fixture_id="fixture_f_unknown_source",
        media_id="indie_unknown_short.mp4",
        overall_score=7.10,
        overall_status="CALCULATED_SEMANTIC",
        overall_method="audited_multi_dimension_weighted_fit_v7.0",
        sections=sec_a,
        purpose="Verify Creator Studio source chip displays 'Unrecognized / Indie Source' cleanly.",
        context_evidence={
            "visual_recognition": {
                "status": "UNKNOWN",
                "matched_entity": None,
                "confidence": 0.0,
                "explanation": "Out-of-catalog visual source footage. Independent animation not indexed in catalog."
            },
            "music_recognition": {"status": "UNKNOWN", "matched_track": None}
        }
    )
    p_f = os.path.join(FIXTURES_DIR, "fixture_f_unknown_source.json")
    with open(p_f, "w") as f: json.dump(doc_f, f, indent=2)
    created_paths["F"] = p_f

    # -------------------------------------------------------------
    # Fixture G: Personalized owner fit unavailable
    # -------------------------------------------------------------
    sec_g = [dict(s) for s in sec_a]
    sec_g[6] = {
        "section_id": "personalized_owner_fit",
        "dimension_id": "personalized_owner_fit",
        "section_name": "Personalized Owner Fit",
        "display_name": "Personalized Owner Fit",
        "score_0_10": None,
        "evidence_status": "NOT_YET_ASSESSED",
        "evidence_refs": {"reason": "anonymous_user_profile"},
        "timestamps": [],
        "method_version": "v7.0",
        "limitations": ["Personalized owner weights require trained editor profile."],
        "creator_explanation": "No personalized profile linked for this account. Showing objective rubric only."
    }
    doc_g = build_base_doc(
        fixture_id="fixture_g_owner_fit_unavailable",
        media_id="standard_guest_upload.mp4",
        overall_score=7.80,
        overall_status="CALCULATED_SEMANTIC",
        overall_method="uniform_rubric_v6.0",
        sections=sec_g,
        purpose="Verify presentation when user has not trained an owner preference model: 6 bars scored, bar 7 in standby, overall score computed from objective rubric.",
    )
    p_g = os.path.join(FIXTURES_DIR, "fixture_g_owner_fit_unavailable.json")
    with open(p_g, "w") as f: json.dump(doc_g, f, indent=2)
    created_paths["G"] = p_g

    # -------------------------------------------------------------
    # Fixture H1: Low-scoring edit (3.14/10, Red tier)
    # -------------------------------------------------------------
    sec_h1 = [
        {
            "section_id": "beat_synchronization",
            "dimension_id": "beat_synchronization",
            "section_name": "Beat Synchronization",
            "display_name": "Beat Synchronization",
            "score_0_10": 2.80,
            "evidence_status": "MEASURED_SIGNAL",
            "evidence_refs": {"tight_sync_percent": 18.0, "loose_sync_percent": 20.0, "primary_bpm": 140.0},
            "timestamps": [1.4, 2.9, 4.2],
            "method_version": "librosa_multi_tempo_grid_v6.0",
            "limitations": ["Severe drift."],
            "creator_explanation": "Persistent offbeat cutting with 62% of cuts missing any musical beat."
        },
        {
            "section_id": "cuts_and_transitions",
            "dimension_id": "cuts_and_transitions",
            "section_name": "Cuts & Transitions",
            "display_name": "Cuts & Transitions",
            "score_0_10": 3.20,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"cut_transitions_count": 48, "intra_shot_flashes_count": 35, "flash_rate_per_sec": 1.45},
            "timestamps": [0.8, 1.2, 1.6, 2.0],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Severe strobe warning triggered."],
            "creator_explanation": "Excessive strobe flashing (1.45 flashes/s) and disorienting jump cuts."
        },
        {
            "section_id": "pacing",
            "dimension_id": "pacing",
            "section_name": "Pacing",
            "display_name": "Pacing",
            "score_0_10": 3.50,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"cuts_per_second": 2.8, "shot_duration_mean_sec": 0.35},
            "timestamps": [],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Exhaustive pacing."],
            "creator_explanation": "Frantic pacing without pauses or emotional contrast causes viewer fatigue."
        },
        {
            "section_id": "visual_measurements",
            "dimension_id": "visual_measurements",
            "section_name": "Visual Measurements",
            "display_name": "Visual Measurements",
            "score_0_10": 3.00,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"width": 640, "height": 360, "fps": 24.0, "mean_sharpness_laplacian": 84.0},
            "timestamps": [],
            "method_version": "laplacian_variance_and_signal_v6.0",
            "limitations": ["Heavy compression."],
            "creator_explanation": "Low resolution (360p) with severe compression macroblocking."
        },
        {
            "section_id": "storytelling_interpretation",
            "dimension_id": "storytelling_interpretation",
            "section_name": "Storytelling Interpretation",
            "display_name": "Storytelling Interpretation",
            "score_0_10": 2.90,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"coherence": "disjointed"},
            "timestamps": [],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["No recognizable arc."],
            "creator_explanation": "Disjointed clips spliced together without narrative context or dramatic purpose."
        },
        {
            "section_id": "originality_creativity",
            "dimension_id": "originality_creativity",
            "section_name": "Originality & Creative Execution",
            "display_name": "Originality & Creative Execution",
            "score_0_10": 3.10,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"style": "generic_preset_filter"},
            "timestamps": [],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Overused presets."],
            "creator_explanation": "Relying heavily on automated shake presets and stock strobe overlays."
        },
        {
            "section_id": "personalized_owner_fit",
            "dimension_id": "personalized_owner_fit",
            "section_name": "Personalized Owner Fit",
            "display_name": "Personalized Owner Fit",
            "score_0_10": 3.40,
            "evidence_status": "PERSONALIZED_ESTIMATE",
            "evidence_refs": {"alignment": "low"},
            "timestamps": [],
            "method_version": "loocv_constrained_regression_v6.1",
            "limitations": ["Fails owner criteria."],
            "creator_explanation": "Significantly penalizes lack of beat alignment and sensory strobe overload."
        },
    ]
    doc_h1 = build_base_doc(
        fixture_id="fixture_h1_low_scoring_weak",
        media_id="poorly_synchronized_strobe_edit.mp4",
        overall_score=3.14,
        overall_status="CALCULATED_SEMANTIC",
        overall_method="audited_multi_dimension_weighted_fit_v7.0",
        sections=sec_h1,
        purpose="Verify low-scoring red tier UI: 3.14 on RPM gauge, red warning callouts, short bars, alert animations.",
        reaction_bubbles=[
            {"tag": "RHYTHM", "callout": "OFF-TEMPO! Severe drift.", "style": "alert"},
            {"tag": "ALERT", "callout": "STROBE INTENSE! 35 flashes.", "style": "alert"},
            {"tag": "VERDICT", "callout": "ROUGH CUT. 3.14/10 Weak Editing.", "style": "alert"},
        ]
    )
    p_h1 = os.path.join(FIXTURES_DIR, "fixture_h1_low_scoring_weak.json")
    with open(p_h1, "w") as f: json.dump(doc_h1, f, indent=2)
    created_paths["H1"] = p_h1

    # -------------------------------------------------------------
    # Fixture H2: High-scoring edit (9.43/10, Exceptional neon glow)
    # -------------------------------------------------------------
    sec_h2 = [
        {
            "section_id": "beat_synchronization",
            "dimension_id": "beat_synchronization",
            "section_name": "Beat Synchronization",
            "display_name": "Beat Synchronization",
            "score_0_10": 9.80,
            "evidence_status": "MEASURED_SIGNAL",
            "evidence_refs": {"tight_sync_percent": 96.2, "primary_bpm": 132.0},
            "timestamps": [1.14, 2.27, 3.41, 4.54, 5.68],
            "method_version": "librosa_multi_tempo_grid_v6.0",
            "limitations": ["Exceptional transient lock."],
            "creator_explanation": "Near-perfect frame-accurate transient synchronization (96.2% tight lock)."
        },
        {
            "section_id": "cuts_and_transitions",
            "dimension_id": "cuts_and_transitions",
            "section_name": "Cuts & Transitions",
            "display_name": "Cuts & Transitions",
            "score_0_10": 9.40,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"cut_transitions_count": 42, "intra_shot_flashes_count": 2, "flash_rate_per_sec": 0.05},
            "timestamps": [2.27, 4.54, 8.00],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Seamless velocity matching."],
            "creator_explanation": "Godly match cuts; seamless rotational momentum transfer between shots."
        },
        {
            "section_id": "pacing",
            "dimension_id": "pacing",
            "section_name": "Pacing",
            "display_name": "Pacing",
            "score_0_10": 9.50,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"cuts_per_second": 1.65, "shot_duration_mean_sec": 0.61},
            "timestamps": [],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["World-class tension modulation."],
            "creator_explanation": "Masterful dynamic tension buildup with breathtaking rhythmic releases."
        },
        {
            "section_id": "visual_measurements",
            "dimension_id": "visual_measurements",
            "section_name": "Visual Measurements",
            "display_name": "Visual Measurements",
            "score_0_10": 9.20,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"width": 3840, "height": 2160, "fps": 60.0, "mean_sharpness_laplacian": 620.0},
            "timestamps": [],
            "method_version": "laplacian_variance_and_signal_v6.0",
            "limitations": ["Flawless 4K color grading."],
            "creator_explanation": "Pristine 4K60 master with Hollywood-grade ACES color science."
        },
        {
            "section_id": "storytelling_interpretation",
            "dimension_id": "storytelling_interpretation",
            "section_name": "Storytelling Interpretation",
            "display_name": "Storytelling Interpretation",
            "score_0_10": 9.60,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"thematic_resonance": "exceptional"},
            "timestamps": [],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Profound emotional impact."],
            "creator_explanation": "Profound narrative resonance mapping lyrics directly to character decisions."
        },
        {
            "section_id": "originality_creativity",
            "dimension_id": "originality_creativity",
            "section_name": "Originality & Creative Execution",
            "display_name": "Originality & Creative Execution",
            "score_0_10": 9.10,
            "evidence_status": "EVALUATED_SEMANTIC",
            "evidence_refs": {"innovation": "bespoke_vfx_and_framing"},
            "timestamps": [],
            "method_version": "manual_editorial_critique_v1",
            "limitations": ["Unique artistic signature."],
            "creator_explanation": "Unmatched creative voice blending anime action with cinematic live-action framing."
        },
        {
            "section_id": "personalized_owner_fit",
            "dimension_id": "personalized_owner_fit",
            "section_name": "Personalized Owner Fit",
            "display_name": "Personalized Owner Fit",
            "score_0_10": 9.50,
            "evidence_status": "PERSONALIZED_ESTIMATE",
            "evidence_refs": {"alignment": "pinnacle"},
            "timestamps": [],
            "method_version": "loocv_constrained_regression_v6.1",
            "limitations": ["Pinnacle match for owner taste."],
            "creator_explanation": "Exemplifies every quality prioritized by the owner: musical sync, storytelling, and pacing."
        },
    ]
    doc_h2 = build_base_doc(
        fixture_id="fixture_h2_high_scoring_exceptional",
        media_id="toji_vs_gojo_pinnacle_edit.mp4",
        overall_score=9.43,
        overall_status="CALCULATED_PERSONALIZED",
        overall_method="audited_multi_dimension_weighted_fit_v7.0",
        sections=sec_h2,
        purpose="Verify top-tier neon glow UI: 9.43 on RPM gauge, neon-yellow bar illumination, celebratory comic bubbles.",
        reaction_bubbles=[
            {"tag": "RHYTHM", "callout": "BEAT-LOCKED! 96.2% tight lock.", "style": "neon"},
            {"tag": "STORY", "callout": "LYRICAL RESONANCE! Masterful narrative.", "style": "neon"},
            {"tag": "VERDICT", "callout": "CINEMATIC MASTERPIECE! 9.43/10 Exceptional.", "style": "neon"},
        ]
    )
    p_h2 = os.path.join(FIXTURES_DIR, "fixture_h2_high_scoring_exceptional.json")
    with open(p_h2, "w") as f: json.dump(doc_h2, f, indent=2)
    created_paths["H2"] = p_h2

    return created_paths


if __name__ == "__main__":
    paths = generate_all_fixtures()
    print("=" * 64)
    print("LOLIXCO EDIT DNA — PHASE 7 DEMO FIXTURES GENERATED")
    print("=" * 64)
    for fid, p in paths.items():
        print(f" Fixture {fid:3s} -> {os.path.basename(p)}")
    print(f"\nAll {len(paths)} fixtures validated against Presentation Contract v7.0.0.")
    print("=" * 64)
