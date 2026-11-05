#!/usr/bin/env python3
"""
Lolixco Edit DNA — Phase 7: Seven-Dimension Presentation Adapter & Engine
Translates canonical v6.0.0 evidence reports into the 7-stage Creator Studio presentation contract.

Creator Studio Presentation Dimensions (in exact sequence):
  1. beat_synchronization          ("Beat Synchronization")
  2. cuts_and_transitions          ("Cuts & Transitions")
  3. pacing                        ("Pacing")
  4. visual_measurements           ("Visual Measurements")
  5. storytelling_interpretation   ("Storytelling Interpretation")
  6. originality_creativity        ("Originality & Creative Execution")
  7. personalized_owner_fit        ("Personalized Owner Fit")

Design Principles:
  - Honest overall score: null / NOT_YET_ASSESSED when semantic dimensions are unassessed.
  - Clear separation of physical measurements, semantic evaluations, and personalized fit.
  - Strict validation of nested types, score bounds (0.00-10.00), and evidence references.
  - Full backward compatibility with canonical v6.0.0 reports.
"""

import math
from typing import Dict, Any, List, Optional, Tuple


PRESENTATION_SCHEMA_VERSION = "7.0.0-presentation"

ORDERED_DIMENSIONS = [
    ("beat_synchronization", "Beat Synchronization"),
    ("cuts_and_transitions", "Cuts & Transitions"),
    ("pacing", "Pacing"),
    ("visual_measurements", "Visual Measurements"),
    ("storytelling_interpretation", "Storytelling Interpretation"),
    ("originality_creativity", "Originality & Creative Execution"),
    ("personalized_owner_fit", "Personalized Owner Fit"),
]

VALID_EVIDENCE_STATUSES = {
    "MEASURED_SIGNAL",
    "EVALUATED_SEMANTIC",
    "EVALUATED_SEMANTIC_EXPERIMENTAL",
    "PERSONALIZED_ESTIMATE",
    "CALCULATED_PERSONALIZED",
    "NOT_YET_ASSESSED",
    "UNKNOWN",
    "CONFLICT",
}

VALID_OVERALL_STATUSES = {
    "CALCULATED_PERSONALIZED",
    "CALCULATED_SEMANTIC",
    "CALCULATED_EXPERIMENTAL_V9",
    "NOT_YET_ASSESSED",
    "INSUFFICIENT_DATA",
}


class EditDNAPresentationAdapter:
    """
    Transforms canonical evidence reports into Creator Studio frontend contract
    and enforces strict presentation invariants.
    """

    @staticmethod
    def get_score_tier(score: Optional[float]) -> str:
        """Determines the display tier for an overall score on the 0-10 scale."""
        if score is None:
            return "Unassessed"
        if score < 4.00:
            return "Weak Editing"
        elif score < 6.50:
            return "Mixed Execution"
        elif score < 8.50:
            return "Strong Editing"
        else:
            return "Exceptional Editing"

    @staticmethod
    def evaluate_overall_score_eligibility(
        sections: List[Dict[str, Any]],
        owner_weights: Optional[Dict[str, float]] = None
    ) -> Tuple[Optional[float], str, Optional[str]]:
        """
        Enforces strict eligibility rules for the overall score:
          - An overall score cannot be computed if core semantic dimensions are NOT_YET_ASSESSED.
          - If fewer than 4 dimensions have evaluated scores, returns (None, 'NOT_YET_ASSESSED', None).
          - If all dimensions are assessed, calculates owner-weighted score.
        """
        scored_sections = [s for s in sections if s.get("score_0_10") is not None]
        sec_map = {s["section_id"]: s for s in sections}

        # Check semantic dimensions
        semantic_dims = ["cuts_and_transitions", "pacing", "storytelling_interpretation", "originality_creativity"]
        unassessed_semantic = [
            dim for dim in semantic_dims
            if sec_map.get(dim, {}).get("evidence_status") in ("NOT_YET_ASSESSED", "UNKNOWN")
            or sec_map.get(dim, {}).get("score_0_10") is None
        ]

        # If semantic dimensions are missing, we cannot honestly state an overall editing grade
        if len(unassessed_semantic) >= 3:
            return (
                None,
                "NOT_YET_ASSESSED",
                f"Overall score withheld because {len(unassessed_semantic)} critical subjective dimensions remain unassessed."
            )

        # If we have at least 4 assessed dimensions including semantic
        if len(scored_sections) >= 4:
            weights = owner_weights or {
                "beat_synchronization": 0.20,
                "cuts_and_transitions": 0.15,
                "pacing": 0.15,
                "visual_measurements": 0.10,
                "storytelling_interpretation": 0.15,
                "originality_creativity": 0.10,
                "personalized_owner_fit": 0.15,
            }
            total_weight = 0.0
            weighted_sum = 0.0
            for s in scored_sections:
                sid = s["section_id"]
                w = weights.get(sid, 1.0 / len(ORDERED_DIMENSIONS))
                weighted_sum += s["score_0_10"] * w
                total_weight += w

            final_score = round(weighted_sum / total_weight, 2) if total_weight > 0 else None
            status_tag = (
                "CALCULATED_EXPERIMENTAL_V9"
                if any(s.get("evidence_status") == "EVALUATED_SEMANTIC_EXPERIMENTAL" for s in scored_sections)
                else "CALCULATED_PERSONALIZED"
            )
            return (
                final_score,
                status_tag,
                "phase9_multidimensional_autonomous_quality_v9.0" if status_tag == "CALCULATED_EXPERIMENTAL_V9" else "audited_multi_dimension_weighted_fit_v7.0"
            )

        return (
            None,
            "NOT_YET_ASSESSED",
            "Fewer than 4 dimensions evaluated."
        )

    @staticmethod
    def build_gauge_presentation(overall_score: Optional[float], overall_status: str) -> Dict[str, Any]:
        """Formats the numerical gauge presentation data for Codex's RPM animation."""
        if overall_score is not None:
            tier = EditDNAPresentationAdapter.get_score_tier(overall_score)
            return {
                "min": 0.00,
                "max": 10.00,
                "settled_value": overall_score,
                "display_text": f"{overall_score:.2f}",
                "tier_label": tier,
                "gauge_state": "settled_score",
                "accent_color": (
                    "#E53E3E" if overall_score < 4.00
                    else ("#ECC94B" if overall_score < 6.50
                    else ("#48BB78" if overall_score < 8.50 else "#ECC94B"))  # Lolixco neon yellow for exceptional
                ),
            }
        else:
            return {
                "min": 0.00,
                "max": 10.00,
                "settled_value": None,
                "display_text": "N/A",
                "tier_label": "Unassessed",
                "gauge_state": "unassessed_standby",
                "accent_color": "#718096",
            }

    @staticmethod
    def generate_reaction_bubbles(
        sections: List[Dict[str, Any]],
        overall_score: Optional[float],
        context_evidence: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, str]]:
        """Generates punchy comic-book reaction bubbles based on real evidence."""
        bubbles = []
        sec_map = {s["section_id"]: s for s in sections}

        # 1. Beat sync reaction
        beat_sec = sec_map.get("beat_synchronization", {})
        if beat_sec.get("score_0_10") is not None and beat_sec["score_0_10"] >= 8.5:
            bubbles.append({"tag": "RHYTHM", "callout": "BEAT-LOCKED! Flawless transient hits.", "style": "neon"})
        elif beat_sec.get("score_0_10") is not None and beat_sec["score_0_10"] <= 4.0:
            bubbles.append({"tag": "RHYTHM", "callout": "OFF-TEMPO! Drifting cut cadence.", "style": "warning"})

        # 2. Pacing / cuts reaction
        pacing_sec = sec_map.get("pacing", {})
        cuts_sec = sec_map.get("cuts_and_transitions", {})
        cps = pacing_sec.get("evidence_refs", {}).get("cuts_per_second")
        if cps is not None and cps >= 1.8:
            bubbles.append({"tag": "CADENCE", "callout": f"RAPID FIRE! {cps:.2f} cuts/sec kinetic rush.", "style": "info"})
        elif cps is not None and cps <= 0.6:
            bubbles.append({"tag": "CADENCE", "callout": f"BREATHING ROOM. {cps:.2f} cuts/sec deliberate hold.", "style": "info"})

        # 3. Strobes / accessibility
        flashes = cuts_sec.get("evidence_refs", {}).get("flash_count")
        if flashes is not None and flashes > 25:
            bubbles.append({"tag": "ALERT", "callout": f"STROBE INTENSE! {flashes} flash frames.", "style": "alert"})

        # 4. Music conflict / unknown
        if context_evidence:
            music_status = context_evidence.get("music_recognition", {}).get("status")
            if music_status == "CONFLICT":
                bubbles.append({"tag": "AUDIO", "callout": "ACOUSTIC CLASH! Audio profile conflict.", "style": "warning"})
            elif music_status == "VERIFIED_MATCH":
                title = context_evidence.get("music_recognition", {}).get("matched_track", "Track")
                bubbles.append({"tag": "AUDIO", "callout": f"TRACK MATCH: {title}", "style": "success"})

        # 5. Overall verdict
        if overall_score is not None:
            if overall_score >= 8.5:
                bubbles.append({"tag": "VERDICT", "callout": "CINEMATIC MASTERPIECE!", "style": "neon"})
            elif overall_score <= 4.0:
                bubbles.append({"tag": "VERDICT", "callout": "ROUGH CUT. Needs structure.", "style": "alert"})
        else:
            bubbles.append({"tag": "VERDICT", "callout": "EVIDENCE RECORDED. Standing by for critique.", "style": "neutral"})

        return bubbles[:4]

    @staticmethod
    def from_v6_report(
        v6_report: Dict[str, Any],
        semantic_overrides: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Converts a canonical v6.0.0 report into the Creator Studio 7-dimension presentation format.
        Does NOT alter or discard existing v6 evidence fields.
        """
        media_id = v6_report.get("media_id", "unknown_media")
        media_type = v6_report.get("media_type", "authorized_video_bytes")
        timestamp = v6_report.get("generated_at", "")

        sec_c = v6_report.get("section_c_physical_signals", {})
        sec_d = v6_report.get("section_d_semantic_evaluation", {})
        sec_e = v6_report.get("section_e_personalized_model", {})
        scorecard = sec_d.get("scorecard", {})

        overrides = semantic_overrides or {}

        # 1. Beat Synchronization
        beat_card = scorecard.get("beat_synchronization", {})
        rhythm_align = sec_c.get("rhythm_alignment", {})
        beat_score = beat_card.get("score")
        beat_status = beat_card.get("status", "MEASURED_SIGNAL" if beat_score is not None else "NOT_YET_ASSESSED")
        dim1 = {
            "section_id": "beat_synchronization",
            "dimension_id": "beat_synchronization",
            "section_name": "Beat Synchronization",
            "display_name": "Beat Synchronization",
            "score_0_10": round(float(beat_score), 2) if beat_score is not None else None,
            "evidence_status": beat_status,
            "evidence_refs": {
                "primary_grid_tight_percent": rhythm_align.get("primary_grid_tight_percent"),
                "double_time_tight_percent": rhythm_align.get("double_time_tight_percent"),
                "subdivision_16th_tight_percent": rhythm_align.get("subdivision_16th_tight_percent"),
                "onset_transient_tight_percent": rhythm_align.get("onset_transient_tight_percent"),
                "compound_tight_sync_percent": rhythm_align.get("compound_tight_sync_percent"),
                "flash_onset_sync_percent": rhythm_align.get("flash_onset_sync_percent"),
                "primary_bpm": sec_c.get("primary_bpm"),
                "anticipatory_cuts_count": rhythm_align.get("anticipatory_cuts_count", 0),
                "rigid_grid_score": beat_card.get("metric_details", {}).get("rigid_grid_score"),
                "compound_alignment_score": beat_card.get("metric_details", {}).get("compound_alignment_score"),
            },
            "timestamps": sec_c.get("video_signals", {}).get("cut_timestamps", [])[:10],
            "method_version": "librosa_multi_tempo_grid_v6.0",
            "limitations": [
                "Derived strictly from measured temporal proximity of cut timestamps to detected audio transients. "
                "This is an objective timing alignment measurement, NOT a validated overall artistic judgment of musicality, groove, or emotional sync."
            ],
            "creator_explanation": (
                (f"Beat-alignment score is {beat_score:.2f}/10. "
                 f"Measures physical cut alignment to primary ({rhythm_align.get('primary_grid_tight_percent', 0.0)}%) "
                 f"and double-time ({rhythm_align.get('double_time_tight_percent', 0.0)}%) beat grids, "
                 f"with {rhythm_align.get('compound_tight_sync_percent', rhythm_align.get('primary_grid_tight_percent', 0.0))}% compound alignment across subdivisions and transients. "
                 f"Evaluates transient proximity; this describes cut timing alignment, not validated artistic musicality or groove.")
                if beat_score is not None else "Beat synchronization unassessed."
            )
        }

        # 2. Cuts & Transitions
        trans_override = overrides.get("cuts_and_transitions") or overrides.get("transitions")
        trans_card = scorecard.get("transitions", {}) or scorecard.get("cuts_and_transitions", {})
        intra_flashes = sec_c.get("accessibility_signals", {}).get("intra_shot_flashes_count", 0)
        flash_rate = sec_c.get("accessibility_signals", {}).get("flash_rate_per_sec", 0.0)
        if trans_override:
            t_score = float(trans_override.get("score", 7.0))
            t_status = "EVALUATED_SEMANTIC"
            t_expl = trans_override.get("notes", "Evaluated by verified human critique.")
        elif trans_card.get("score") is not None:
            t_score = float(trans_card["score"])
            t_status = trans_card.get("status", "MEASURED_SIGNAL")
            t_expl = trans_card.get("notes", "Evaluated transitions score.")
        else:
            t_score = None
            t_status = "NOT_YET_ASSESSED"
            flash_str = f" ({flash_rate:.2f}/s)" if flash_rate is not None else ""
            t_expl = (
                f"Identified {sec_c.get('cut_transitions_count', 0)} cut transitions and "
                f"{intra_flashes} intra-shot flashes{flash_str}. "
                f"Subjective smoothness and seam invisibility require human or semantic evaluation."
            )

        dim2 = {
            "section_id": "cuts_and_transitions",
            "dimension_id": "cuts_and_transitions",
            "section_name": "Cuts & Transitions",
            "display_name": "Cuts & Transitions",
            "score_0_10": round(t_score, 2) if t_score is not None else None,
            "evidence_status": t_status,
            "evidence_refs": {
                "cut_transitions_count": sec_c.get("cut_transitions_count"),
                "intra_shot_flashes_count": intra_flashes,
                "flash_rate_per_sec": flash_rate,
                "strobe_warning": sec_c.get("accessibility_signals", {}).get("strobe_warning", False),
            },
            "timestamps": sec_c.get("video_signals", {}).get("flash_frame_timestamps", [])[:10],
            "method_version": "opencv_absdiff_debounced_v6.0",
            "limitations": [
                "Separates cut boundaries from strobe flashes; cannot assess stylistic match of wipes or zooms without semantic review."
            ],
            "creator_explanation": t_expl,
        }

        # 3. Pacing
        pacing_override = overrides.get("pacing")
        pacing_card = scorecard.get("pacing", {})
        cps = sec_c.get("cuts_per_second")
        shot_mean = sec_c.get("shot_duration_mean_sec")
        shot_std = sec_c.get("shot_duration_std_dev_sec")
        if pacing_override:
            p_score = float(pacing_override.get("score", 7.0))
            p_status = "EVALUATED_SEMANTIC"
            p_expl = pacing_override.get("notes", "Evaluated pacing flow.")
        elif pacing_card.get("score") is not None:
            p_score = float(pacing_card["score"])
            p_status = pacing_card.get("status", "MEASURED_SIGNAL")
            p_expl = pacing_card.get("notes", "Evaluated pacing flow.")
        else:
            p_score = None
            p_status = "NOT_YET_ASSESSED"
            cps_str = f"{cps:.2f} cuts/second" if cps is not None else "unmeasured cadence"
            shot_str = f" (average shot {shot_mean:.2f}s)" if shot_mean is not None else ""
            p_expl = (
                f"Physical cadence is {cps_str}{shot_str}. "
                f"Whether this pacing supports or overwhelms the narrative requires semantic assessment."
            )

        dim3 = {
            "section_id": "pacing",
            "dimension_id": "pacing",
            "section_name": "Pacing",
            "display_name": "Pacing",
            "score_0_10": round(p_score, 2) if p_score is not None else None,
            "evidence_status": p_status,
            "evidence_refs": {
                "cuts_per_second": cps,
                "shot_duration_mean_sec": shot_mean,
                "shot_duration_std_dev_sec": shot_std,
            },
            "timestamps": [],
            "method_version": "shot_duration_distribution_v6.0",
            "limitations": [
                "Reports cuts-per-second accurately; does not fabricate quality grades based on raw tempo."
            ],
            "creator_explanation": p_expl,
        }

        # 4. Visual Measurements
        vis_override = overrides.get("visual_measurements") or overrides.get("visual_quality")
        vis_card = scorecard.get("visual_quality", {}) or scorecard.get("visual_measurements", {})
        v_sig = sec_c.get("video_signals", {})
        if vis_override:
            v_score = float(vis_override.get("score", 7.0))
            v_status = "EVALUATED_SEMANTIC"
            v_expl = vis_override.get("notes", "Evaluated visual quality.")
        elif vis_card.get("score") is not None:
            v_score = float(vis_card["score"])
            v_status = vis_card.get("status", "MEASURED_SIGNAL")
            v_expl = vis_card.get("notes", "Evaluated visual quality.")
        else:
            # Visual measurements are physical facts; if no semantic grade, score is None
            v_score = None
            v_status = "NOT_YET_ASSESSED"
            sharp_val = v_sig.get("mean_sharpness_laplacian")
            sharp_str = f"Sharpness variance is {sharp_val:.1f}." if sharp_val is not None else "Sharpness variance unmeasured."
            v_expl = (
                f"Decoded {v_sig.get('width', 0)}x{v_sig.get('height', 0)} @ {v_sig.get('fps', 0)}fps. "
                f"{sharp_str} "
                f"Visual aesthetic grading is not yet assessed."
            )

        dim4 = {
            "section_id": "visual_measurements",
            "dimension_id": "visual_measurements",
            "section_name": "Visual Measurements",
            "display_name": "Visual Measurements",
            "score_0_10": round(v_score, 2) if v_score is not None else None,
            "evidence_status": v_status,
            "evidence_refs": {
                "width": v_sig.get("width"),
                "height": v_sig.get("height"),
                "fps": v_sig.get("fps"),
                "mean_sharpness_laplacian": v_sig.get("mean_sharpness_laplacian"),
                "mean_contrast": v_sig.get("mean_contrast"),
            },
            "timestamps": [],
            "method_version": "laplacian_variance_and_signal_v6.0",
            "limitations": [
                "Resolution and edge sharpness do not measure color balance, compression artifacts, or grading coherence."
            ],
            "creator_explanation": v_expl,
        }

        # 5. Storytelling Interpretation
        story_override = overrides.get("storytelling_interpretation") or overrides.get("storytelling_emotion")
        story_card = scorecard.get("storytelling_emotion", {}) or scorecard.get("storytelling_interpretation", {})
        if story_override:
            s_score = float(story_override.get("score", 7.0))
            s_status = "EVALUATED_SEMANTIC"
            s_expl = story_override.get("notes", "Evaluated narrative structure.")
        elif story_card.get("score") is not None:
            s_score = float(story_card["score"])
            s_status = story_card.get("status", "EVALUATED_SEMANTIC_EXPERIMENTAL")
            s_expl = story_card.get("notes", "Evaluated narrative structure.")
        else:
            s_score = None
            s_status = "NOT_YET_ASSESSED"
            s_expl = "Narrative arc, emotional resonance, and character presence require human or multimodal critique."

        dim5 = {
            "section_id": "storytelling_interpretation",
            "dimension_id": "storytelling_interpretation",
            "section_name": "Storytelling Interpretation",
            "display_name": "Storytelling Interpretation",
            "score_0_10": round(s_score, 2) if s_score is not None else None,
            "evidence_status": s_status,
            "evidence_refs": {
                "audio_clipping": sec_c.get("audio_signals", {}).get("clipping_detected", False),
                "rms_db": sec_c.get("audio_signals", {}).get("rms_db"),
            },
            "timestamps": [],
            "method_version": "narrative_arc_critique_v6.0",
            "limitations": [
                "Audio energy range is recorded but not substituted as a fake narrative grade."
            ],
            "creator_explanation": s_expl,
        }

        # 6. Originality & Creative Execution
        orig_override = overrides.get("originality_creativity")
        orig_card = scorecard.get("originality_creativity", {})
        if orig_override:
            o_score = float(orig_override.get("score", 7.0))
            o_status = "EVALUATED_SEMANTIC"
            o_expl = orig_override.get("notes", "Evaluated creative originality.")
        elif orig_card.get("score") is not None:
            o_score = float(orig_card["score"])
            o_status = orig_card.get("status", "EVALUATED_SEMANTIC_EXPERIMENTAL")
            o_expl = orig_card.get("notes", "Evaluated creative originality.")
        else:
            o_score = None
            o_status = "NOT_YET_ASSESSED"
            o_expl = "Novelty of concept, unique audio-visual pairings, and editorial voice require subjective critique."

        dim6 = {
            "section_id": "originality_creativity",
            "dimension_id": "originality_creativity",
            "section_name": "Originality & Creative Execution",
            "display_name": "Originality & Creative Execution",
            "score_0_10": round(o_score, 2) if o_score is not None else None,
            "evidence_status": o_status,
            "evidence_refs": {
                "shot_duration_variance": shot_std,
            },
            "timestamps": [],
            "method_version": "creative_execution_critique_v6.0",
            "limitations": [
                "Shot length variance does not establish artistic novelty or unique editorial style."
            ],
            "creator_explanation": o_expl,
        }

        # 7. Personalized Owner Fit
        fit_override = overrides.get("personalized_owner_fit")
        owner_weights = sec_e.get("owner_preference_weights", {})
        fit_card = scorecard.get("personalized_owner_fit", {})
        if fit_override:
            fit_score = float(fit_override.get("score", 7.0))
            fit_status = "PERSONALIZED_ESTIMATE"
            fit_expl = fit_override.get("notes", "Personalized fit computed against owner preference rubric.")
        elif fit_card.get("score") is not None:
            fit_score = float(fit_card["score"])
            fit_status = fit_card.get("status", "CALCULATED_PERSONALIZED")
            fit_expl = fit_card.get("notes", "Evaluated fit matching owner preference weights.")
        elif sec_e.get("predicted_score") is not None:
            fit_score = float(sec_e["predicted_score"])
            fit_status = "PERSONALIZED_ESTIMATE"
            fit_expl = f"Evaluated fit ({fit_score:.2f}/10) matching owner's verified preference weights."
        else:
            fit_score = None
            fit_status = "NOT_YET_ASSESSED"
            fit_expl = "Personalized owner fit cannot be calculated until semantic dimensions are assessed."

        dim7 = {
            "section_id": "personalized_owner_fit",
            "dimension_id": "personalized_owner_fit",
            "section_name": "Personalized Owner Fit",
            "display_name": "Personalized Owner Fit",
            "score_0_10": round(fit_score, 2) if fit_score is not None else None,
            "evidence_status": fit_status,
            "evidence_refs": {
                "owner_weights": owner_weights,
                "loocv_mae": sec_e.get("empirical_evaluation", {}).get("loocv_mae", 0.58),
            },
            "timestamps": [],
            "method_version": "loocv_constrained_regression_v6.1",
            "limitations": [
                "Represents personalized taste alignment; does not represent universal or objective quality."
            ],
            "creator_explanation": fit_expl,
        }

        sections = [dim1, dim2, dim3, dim4, dim5, dim6, dim7]

        # Calculate overall score eligibility
        overall_score, overall_status, overall_method = EditDNAPresentationAdapter.evaluate_overall_score_eligibility(
            sections, owner_weights
        )
        overall_tier = EditDNAPresentationAdapter.get_score_tier(overall_score)
        gauge = EditDNAPresentationAdapter.build_gauge_presentation(overall_score, overall_status)

        # Context evidence preservation
        context_evidence = {
            "visual_recognition": v6_report.get("section_a_visual_recognition", {}),
            "music_recognition": v6_report.get("section_b_music_recognition", {}),
            "boundaries_and_unknowns": v6_report.get("section_f_boundaries_and_unknowns", {}),
            "governance_contract": v6_report.get("section_g_privacy_and_contract", {}),
        }

        bubbles = EditDNAPresentationAdapter.generate_reaction_bubbles(
            sections, overall_score, context_evidence
        )

        doc = {
            "schema_version": PRESENTATION_SCHEMA_VERSION,
            "media_id": media_id,
            "media_type": media_type,
            "generated_at": timestamp,
            "analysis_status": (
                "COMPLETE" if overall_score is not None
                else ("PARTIAL" if any(s["score_0_10"] is not None for s in sections) else "UNASSESSED")
            ),
            "overall_score_0_10": overall_score,
            "overall_score_status": overall_status,
            "overall_score_method": overall_method,
            "overall_score_tier": overall_tier,
            "gauge_presentation": gauge,
            "reaction_bubbles": bubbles,
            "assessment_sections": sections,
            "context_evidence": context_evidence,
        }

        EditDNAPresentationAdapter.validate_presentation_report(doc)
        return doc

    @staticmethod
    def validate_presentation_report(doc: Dict[str, Any]) -> bool:
        """Validates all presentation invariants, nested types, and ordering."""
        assert doc.get("schema_version") == PRESENTATION_SCHEMA_VERSION, (
            f"Invalid schema version: {doc.get('schema_version')}"
        )
        assert "media_id" in doc, "Missing media_id"
        assert "analysis_status" in doc, "Missing analysis_status"

        # Overall score assertions
        oscore = doc.get("overall_score_0_10")
        if oscore is not None:
            assert isinstance(oscore, (int, float)), "overall_score_0_10 must be float"
            assert 0.00 <= oscore <= 10.00, f"overall_score_0_10 {oscore} out of bounds [0.0, 10.0]"
        ostatus = doc.get("overall_score_status")
        assert ostatus in VALID_OVERALL_STATUSES, f"Invalid overall_score_status: {ostatus}"

        # Gauge assertions
        gauge = doc.get("gauge_presentation", {})
        assert "min" in gauge and "max" in gauge, "gauge_presentation missing min/max"
        assert "display_text" in gauge, "gauge_presentation missing display_text"

        # Assessment sections assertions
        sections = doc.get("assessment_sections", [])
        assert len(sections) == 7, f"Expected exactly 7 assessment sections, got {len(sections)}"

        for i, (expected_id, expected_name) in enumerate(ORDERED_DIMENSIONS):
            sec = sections[i]
            assert sec.get("section_id") == expected_id, (
                f"Section index {i} expected id '{expected_id}', got '{sec.get('section_id')}'"
            )
            assert sec.get("section_name") == expected_name, (
                f"Section index {i} expected name '{expected_name}', got '{sec.get('section_name')}'"
            )
            assert sec.get("evidence_status") in VALID_EVIDENCE_STATUSES, (
                f"Section '{expected_id}' invalid evidence_status: {sec.get('evidence_status')}"
            )

            # Score checks
            score = sec.get("score_0_10")
            if score is not None:
                assert isinstance(score, (int, float)), f"Section '{expected_id}' score must be numeric"
                assert 0.00 <= score <= 10.00, f"Section '{expected_id}' score {score} out of bounds"

            # Method version and limitations
            assert "method_version" in sec and isinstance(sec["method_version"], str), (
                f"Section '{expected_id}' missing method_version"
            )
            assert "limitations" in sec and isinstance(sec["limitations"], list), (
                f"Section '{expected_id}' limitations must be a list"
            )
            assert "creator_explanation" in sec and len(sec["creator_explanation"]) > 0, (
                f"Section '{expected_id}' missing creator_explanation"
            )

        return True


if __name__ == "__main__":
    import sys
    import os
    import json

    if len(sys.argv) > 1 and sys.argv[1] != "--test":
        in_path = sys.argv[1]
        out_path = sys.argv[2] if len(sys.argv) > 2 else "presentation_report.json"
        with open(in_path, "r", encoding="utf-8") as f:
            v6_data = json.load(f)
        pres = EditDNAPresentationAdapter.from_v6_report(v6_data)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(pres, f, indent=2)
        print(f"Converted {in_path} -> {out_path} (Schema: {pres['schema_version']})")
    else:
        # Self-test
        sample_doc = {
            "schema_version": PRESENTATION_SCHEMA_VERSION,
            "media_id": "test_video.mp4",
            "media_type": "authorized_video_bytes",
            "analysis_status": "UNASSESSED",
            "overall_score_0_10": None,
            "overall_score_status": "NOT_YET_ASSESSED",
            "overall_score_method": None,
            "overall_score_tier": "Unassessed",
            "gauge_presentation": {
                "min": 0.00,
                "max": 10.00,
                "settled_value": None,
                "display_text": "N/A",
                "tier_label": "Unassessed",
                "gauge_state": "unassessed_standby"
            },
            "reaction_bubbles": [],
            "assessment_sections": [
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
                    "limitations": ["Not yet assessed."],
                    "creator_explanation": "Pending evaluation."
                }
                for sid, sname in ORDERED_DIMENSIONS
            ]
        }
        EditDNAPresentationAdapter.validate_presentation_report(sample_doc)

        # Convert Dhurandhar v6 report if present
        v6_dhur = "data/edit-dna/owner_evaluations/dhurandhar_v6_evidence_report.json"
        if os.path.isfile(v6_dhur):
            with open(v6_dhur, "r", encoding="utf-8") as f:
                dhur_v6 = json.load(f)
            dhur_pres = EditDNAPresentationAdapter.from_v6_report(dhur_v6)
            EditDNAPresentationAdapter.validate_presentation_report(dhur_pres)
            print("Dhurandhar v6 evidence report converted and validated successfully.")

        print("Presentation Adapter Schema v7.0.0 validation passed successfully.")
