"""Current six-dimension Studio contract, with safe historical report conversion."""
import copy
import math

SCHEMA = "8.0.0-presentation"
SECTION_IDS = (
    "beat_synchronization", "cuts_and_transitions", "pacing", "visual_measurements",
    "storytelling_interpretation", "originality_creativity",
)
LABELS = (
    "Beat Synchronization / Audiovisual Rhythm", "Cuts & Transitions", "Pacing",
    "Visual Craftsmanship", "Storytelling & Coherence", "Creative Execution & Impact",
)


def to_six_report(report, *, aggregate_semantic=False):
    result = copy.deepcopy(report)
    by_id = {section["section_id"]: section for section in result.get("assessment_sections", [])}
    sections = []
    for section_id, label in zip(SECTION_IDS, LABELS, strict=True):
        section = by_id.get(section_id, {
            "section_id": section_id, "score_0_10": None, "evidence_status": "NOT_YET_ASSESSED",
            "creator_explanation": "Additional audiovisual evidence is required.", "evidence_refs": {}, "timestamps": [],
        })
        section.update(section_name=label, display_name=label)
        sections.append(section)
    result.update(schema_version=SCHEMA, assessment_sections=sections, dimension_count=6,
                  overall_score_0_10=None, overall_score_status="NOT_YET_ASSESSED", overall_score_method=None)
    # An old aggregate may have included a retired dimension.
    result.pop("reaction_bubbles", None)
    values = [section.get("score_0_10") for section in sections]
    eligible = all(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 10 for value in values)
    semantic = all(section.get("evidence_status") == "EXPERIMENTAL_SEMANTIC_SCORE" for section in sections)
    if aggregate_semantic and eligible and semantic:
        result.update(overall_score_0_10=round(sum(values) / 6, 2),
                      overall_score_status="CALCULATED_EXPERIMENTAL_SIX",
                      overall_score_method="six_rubric_mean_v1",
                      overall_score_explanation="Mean of six supported experimental rubric assessments. Two decimal places are a display convention, without validated hundredth-point artistic precision.")
    overall = result["overall_score_0_10"]
    result["analysis_status"] = "ASSESSED_EXPERIMENTAL" if overall is not None else "PARTIAL"
    result["gauge_presentation"] = {
        "gauge_state": "scored" if overall is not None else "unassessed_standby",
        "display_value": overall,
        "standby_reason": "An overall summary requires supported assessments in all six dimensions." if overall is None else "",
    }
    return result
