"""Evidence sufficiency checks and transparent experimental editorial rubrics.

Criteria are an engineering rubric informed by editor evaluation research. Their
scores have not been calibrated against a representative human-judged edit set.
"""
import math


SCORED_STATUS = "EXPERIMENTAL_SEMANTIC_SCORE"
OBSERVED_STATUS = "EVALUATED_SEMANTIC_EXPERIMENTAL"
MAX_REVIEW_SECONDS = 120
STYLES = ("narrative", "hype_montage", "music_montage", "character_study", "abstract", "single_shot", "unknown")
RUBRICS = {
    "storytelling_emotion": {
        "method": "gemini_storytelling_rubric_v1",
        "field": "storytelling_rubric",
        "scope": "Storytelling interpretation of the reviewed interval",
        "criteria": {
            "direction_clarity": "Clarity of subject, theme or intended feeling",
            "sequence_coherence": "Relationships between shots or developments within a held shot",
            "progression": "Purposeful development, contrast, repetition or payoff appropriate to the style",
            "audiovisual_support": "How audible music, dialogue or silence supports the visible direction",
        },
    },
    "originality_creativity": {
        "method": "gemini_creative_execution_rubric_v1",
        "field": "creative_execution_rubric",
        "scope": "Creative execution of the reviewed interval; comparative originality is unassessed",
        "criteria": {
            "purposeful_choices": "How identifiable editorial choices serve the artistic direction",
            "technique_integration": "How transitions, compositing, framing or deliberate restraint support the sequence",
            "meaningful_variation": "Purposeful variation or expressive repetition without an effect-count preference",
            "expressive_identity": "Consistency of image, color, motion or sound choices with the intended expression",
        },
    },
}

TEXT_OR_NULL = {"type": ["string", "null"]}
CRITERION_SCHEMA = {
    "type": "object",
    "properties": {
        "level": {"type": ["integer", "null"], "minimum": 0, "maximum": 4},
        "approximate_timestamp_sec": {"type": ["number", "null"], "minimum": 0, "maximum": MAX_REVIEW_SECONDS},
        "observed_cue": TEXT_OR_NULL,
        "editorial_effect": TEXT_OR_NULL,
    },
    "required": ["level", "approximate_timestamp_sec", "observed_cue", "editorial_effect"],
}


def rubric_schema(criteria):
    properties = {
        **{criterion: CRITERION_SCHEMA for criterion in criteria},
        "strengths": {"type": "array", "maxItems": 2, "items": {"type": "string"}},
        "weaknesses": {"type": "array", "maxItems": 2, "items": {"type": "string"}},
        "suggestion": TEXT_OR_NULL,
    }
    return {"type": "object", "properties": properties, "required": list(properties)}


RUBRIC_FIELDS = {
    "edit_style": {"type": "string", "enum": STYLES},
    "artistic_direction": TEXT_OR_NULL,
    "reviewed_duration_sec": {"type": ["number", "null"], "minimum": 0, "maximum": MAX_REVIEW_SECONDS},
    "review_scope": {"type": "string", "enum": ["complete_edit", "excerpt_or_unknown"]},
    "audio_reviewable": {"type": "boolean"},
    **{rubric["field"]: rubric_schema(rubric["criteria"]) for rubric in RUBRICS.values()},
}

RUBRIC_PROMPT = (
    "Also assess the two supplied editorial rubrics from the sampled audiovisual evidence. "
    "Identify edit_style and a plausible artistic_direction. Narrative means character/action progression; "
    "hype or music montage may build energy, a motif or an emotional contrast without a three-act plot. "
    "A single-shot, restrained or repetitive edit can be effective. Do not reward effect quantity or penalize simplicity. "
    "Report the duration actually reviewed and choose excerpt_or_unknown unless the whole edit's beginning and ending "
    "were available. Never assume a two-minute excerpt is the full video. "
    "For each supported criterion give one approximate timestamp in seconds, a concrete visible/audible cue and "
    "its editorial effect (each within 18 words). Use null level and cue when evidence is missing. "
    "Use only these anchored levels: 0 = observed choices consistently obstruct the intended expression; "
    "1 = major observed weaknesses; 2 = mixed or inconsistently effective; 3 = mostly effective with concrete support; "
    "4 = consistently effective with concrete support across the reviewed interval. "
    "Do not assign an aggregate score or confidence. A missing weakness may be an empty array, never invent one. "
    "Keep strengths, weaknesses and suggestion tied to specific observed choices. "
    "Creative execution concerns expressive choices and integration. Comparative originality is unassessed because "
    "no authorized comparison collection is attached. Never claim novelty, copying or owner taste. "
    "Story criteria: "
    + "; ".join(f"{key}: {meaning}" for key, meaning in RUBRICS["storytelling_emotion"]["criteria"].items())
    + ". Creative criteria: "
    + "; ".join(f"{key}: {meaning}" for key, meaning in RUBRICS["originality_creativity"]["criteria"].items())
    + "."
)


def clean_text(value, limit=350):
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def evaluate_rubric(key, observation, provider_model):
    """Derive a rating from supported anchored levels, or return an explicit abstention.

    Text/timestamp validation checks the shape of the model's evidence. It does
    not independently establish that its semantic observations are accurate.
    """
    rubric = RUBRICS[key]
    raw = observation.get(rubric["field"])
    raw = raw if isinstance(raw, dict) else {}
    duration = observation.get("reviewed_duration_sec")
    direction = clean_text(observation.get("artistic_direction"))
    style = observation.get("edit_style")
    scope = observation.get("review_scope")
    coverage = finite_number(duration) and 2 <= duration <= MAX_REVIEW_SECONDS
    evidence = {
        "assessment_scope": rubric["scope"],
        "provider_model": provider_model,
        "rubric_scale": "Mean supported criterion level (0–4), multiplied by 2.5; equal criterion weights",
        "edit_style": style if style in STYLES else "unknown",
        "artistic_direction": direction,
        "comparative_originality": "unassessed; no reference collection supplied",
    }
    limitations = [
        "Experimental model judgment. Criterion anchors and evidence gates await calibration against independent human critiques.",
        "Approximate timestamps and observations are model-reported and may miss rapid edits or details between sampled frames.",
        "Artistic direction is a model interpretation; the creator did not supply an intended brief.",
    ]
    if coverage:
        evidence["reviewed_interval_sec"] = f"0–{duration:g}"
        evidence["review_scope"] = scope if scope in ("complete_edit", "excerpt_or_unknown") else "excerpt_or_unknown"
        limitations.append(f"This rating applies only to the reviewed 0–{duration:g}s interval. Full-video coverage has not been independently verified.")
    if key == "originality_creativity":
        limitations.append("The number evaluates creative execution. Comparative originality requires an authorized reference collection.")

    supported = {}
    for criterion in rubric["criteria"]:
        value = raw.get(criterion)
        if not isinstance(value, dict):
            continue
        level, timestamp = value.get("level"), value.get("approximate_timestamp_sec")
        cue, effect = clean_text(value.get("observed_cue")), clean_text(value.get("editorial_effect"))
        if (type(level) is not int or not 0 <= level <= 4 or not coverage
                or not finite_number(timestamp) or not 0 <= timestamp <= duration
                or len(cue) < 12 or len(effect) < 12
                or criterion == "audiovisual_support" and observation.get("audio_reviewable") is not True):
            continue
        supported[criterion] = {
            "level": level, "approximate_timestamp_sec": round(timestamp, 2),
            "observed_cue": cue, "editorial_effect": effect,
        }
    evidence.update(supported)
    evidence["supported_criteria"] = len(supported)
    for field in ("strengths", "weaknesses"):
        entries = raw.get(field)
        if isinstance(entries, list):
            evidence[field] = " ".join(clean_text(value) for value in entries[:2] if clean_text(value))
    evidence["suggestion"] = clean_text(raw.get("suggestion"))
    times = sorted({item["approximate_timestamp_sec"] for item in supported.values()})
    spread = bool(coverage and len(times) >= 2 and times[-1] - times[0] >= min(2.0, duration * .2))
    reason = ""
    if not coverage:
        reason = "The provider did not establish a usable reviewed interval of at least two seconds."
    elif style not in STYLES or style == "unknown" or not direction:
        reason = "The edit style and artistic direction need clearer semantic evidence before rubric scoring."
    elif len(supported) < 3 or not spread:
        reason = "A rating needs at least three supported rubric criteria and concrete observations at separated timestamps."
    score = None if reason else round(sum(item["level"] for item in supported.values()) * 2.5 / len(supported), 2)
    evidence["assessment_reason"] = reason or "Supported criteria met the experimental evidence sufficiency checks."
    return {
        "score": score,
        "status": SCORED_STATUS if score is not None else OBSERVED_STATUS if supported else "NOT_YET_ASSESSED",
        "notes": reason or f"{rubric['scope']}. The supported rubric criteria average {score:.2f}/10 for the stated artistic direction.",
        "method_version": rubric["method"],
        "metric_details": evidence,
        "timestamps": times,
        "limitations": limitations,
    }
