"""Evidence sufficiency checks and transparent experimental editorial rubrics.

Criteria are an engineering rubric informed by editor evaluation research. Their
scores have not been calibrated against a representative human-judged edit set.
"""
import math
import re


SCORED_STATUS = "EXPERIMENTAL_SEMANTIC_SCORE"
OBSERVED_STATUS = "EVALUATED_SEMANTIC_EXPERIMENTAL"
MAX_REVIEW_SECONDS = 120
STYLES = ("narrative", "hype_montage", "music_montage", "character_study", "abstract", "single_shot", "unknown")
RUBRICS = {
    "beat_synchronization": {
        "method": "gemini_audiovisual_rhythm_rubric_v1", "field": "rhythm_rubric",
        "scope": "Perceived audiovisual rhythm in the sampled interval",
        "criteria": {
            "audible_visual_accents": "Concrete audible accents and their perceived relationship to visible changes",
            "phrase_relationship": "Visual sequence development in relation to audible phrasing or silence",
            "intentional_contrast": "Purposeful syncopation, held shots, anticipations or counterpoint",
            "rhythmic_consistency": "Whether repeated audiovisual relationships support the artistic direction",
        },
    },
    "transitions": {
        "method": "gemini_transition_rubric_v1", "field": "transitions_rubric",
        "scope": "Perceived shot connection and transition execution in the sampled interval",
        "criteria": {
            "spatial_graphic_relationship": "Readable spatial, graphic or conceptual relationships across scenes",
            "transition_purpose": "Purpose of transitions or deliberate use of a held single shot",
            "execution_control": "Observable control of blending, continuity, masking or intentional contrast",
            "viewer_orientation": "How scene changes help or deliberately challenge viewer orientation",
        },
    },
    "pacing": {
        "method": "gemini_pacing_rubric_v1", "field": "pacing_rubric",
        "scope": "Perceived pacing appropriate to the reviewed edit style",
        "criteria": {
            "information_readability": "Time given to understand the intended subject, text or action",
            "energy_shape": "Purposeful changes or consistency in energy across the interval",
            "holds_and_release": "Use of sustained moments, tension, repetition or release",
            "style_appropriate_rhythm": "Whether the sequence timing serves the apparent genre and direction",
        },
    },
    "visual_quality": {
        "method": "gemini_visual_craft_rubric_v1", "field": "visual_craft_rubric",
        "scope": "Visible visual craftsmanship in the sampled interval",
        "criteria": {
            "subject_readability": "Visibility and framing of the intended subject or graphic emphasis",
            "visual_consistency": "Purposeful color, exposure, composition or graphic relationships",
            "effects_integration": "Integration of visible effects, text, compositing or deliberate restraint",
            "artifact_control": "Whether observable artifacts interfere with the intended expression",
        },
    },
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

RUBRIC_FIELDS = {
    "edit_style": {"type": "string", "enum": STYLES},
    "artistic_direction": {"type": "string"},
    "reviewed_duration_sec": {"type": "number", "minimum": 0, "maximum": MAX_REVIEW_SECONDS},
    "review_scope": {"type": "string", "enum": ["complete_edit", "excerpt_or_unknown"]},
    "audio_reviewable": {"type": "boolean"}, "visual_content_present": {"type": "boolean"},
    "criterion_evidence": {
        "type": "array", "minItems": 24, "maxItems": 24,
        "items": {
            "type": "object",
            "properties": {
                "dimension_index": {"type": "integer", "minimum": 0, "maximum": 5},
                "criterion_index": {"type": "integer", "minimum": 0, "maximum": 3},
                "supported": {"type": "boolean"}, "level": {"type": "integer", "minimum": 0, "maximum": 4},
                "approximate_timecode": {"type": "string"},
                "observed_cue": {"type": "string"}, "editorial_effect": {"type": "string"},
            }, "required": ["dimension_index", "criterion_index", "supported", "level", "approximate_timecode", "observed_cue", "editorial_effect"],
        },
    },
    "dimension_notes": {
        "type": "array", "items": {
            "type": "object", "properties": {
                "dimension_index": {"type": "integer", "minimum": 0, "maximum": 5},
                "strengths": {"type": "string"}, "weaknesses": {"type": "string"},
                "suggestion": {"type": "string"},
            }, "required": ["dimension_index", "strengths", "weaknesses", "suggestion"],
        },
    },
}


def normalize_rubric_observations(observation):
    """Turn the compact provider response into named rubric evidence for validation."""
    if isinstance(observation.get("criterion_evidence"), list):
        result = dict(observation)
        dimensions = list(RUBRICS)
        values = {key: {} for key in dimensions}
        seen = set()
        for entry in observation["criterion_evidence"]:
            if not isinstance(entry, dict):
                continue
            dimension, criterion = entry.get("dimension_index"), entry.get("criterion_index")
            if type(dimension) is not int or not 0 <= dimension < 6 or type(criterion) is not int or not 0 <= criterion < 4:
                continue
            identity = (dimension, criterion)
            if identity in seen:
                raise ValueError("Duplicate semantic criterion")
            seen.add(identity)
            if entry.get("supported") is True:
                key = dimensions[dimension]
                evidence = dict(entry)
                timecode = entry.get("approximate_timecode")
                match = re.fullmatch(r"(\d{2}):([0-5]\d)(?:\.(\d{1,3}))?", timecode) if isinstance(timecode, str) else None
                evidence["approximate_timestamp_sec"] = (
                    int(match[1]) * 60 + int(match[2]) + float("0." + (match[3] or "0")) if match else None
                )
                values[key][list(RUBRICS[key]["criteria"])[criterion]] = evidence
        seen_notes = set()
        for entry in observation.get("dimension_notes", []):
            if not isinstance(entry, dict):
                continue
            dimension = entry.get("dimension_index")
            if type(dimension) is not int or not 0 <= dimension < 6:
                continue
            if dimension in seen_notes:
                raise ValueError("Duplicate semantic dimension notes")
            seen_notes.add(dimension)
            for field in ("strengths", "weaknesses"):
                values[dimensions[dimension]][field] = [entry.get(field, "")]
            values[dimensions[dimension]]["suggestion"] = entry.get("suggestion", "")
        for key, value in values.items():
            result[RUBRICS[key]["field"]] = value
        return result
    if not isinstance(observation.get("assessments"), list):
        return observation
    result = dict(observation)
    seen = set()
    for entry in observation["assessments"]:
        if not isinstance(entry, dict) or entry.get("dimension") not in RUBRICS:
            continue
        key = entry["dimension"]
        if key in seen:
            raise ValueError("Duplicate semantic rubric dimension")
        seen.add(key)
        values = {field: entry.get(field) for field in ("strengths", "weaknesses", "suggestion")}
        for criterion in entry.get("criteria", []):
            if not isinstance(criterion, dict) or criterion.get("supported") is not True:
                continue
            name = criterion.get("criterion")
            index = criterion.get("criterion_index")
            if type(index) is int and 0 <= index < 4:
                name = list(RUBRICS[key]["criteria"])[index]
            if name in RUBRICS[key]["criteria"]:
                if name in values:
                    raise ValueError("Duplicate semantic criterion")
                values[name] = criterion
        result[RUBRICS[key]["field"]] = values
    return result


RUBRIC_PROMPT_TEMPLATE = (
    "Also assess the {dimension_count} supplied editorial rubrics from the sampled audiovisual evidence. "
    "Choose edit_style from narrative, hype_montage, music_montage, character_study, abstract, single_shot, unknown. "
    "Choose review_scope complete_edit or excerpt_or_unknown. Identify a plausible artistic_direction. Narrative means character/action progression; "
    "hype or music montage may build energy, a motif or an emotional contrast without a three-act plot. "
    "A single-shot, restrained or repetitive edit can be effective. Do not reward effect quantity or penalize simplicity. "
    "Report the duration actually reviewed and choose excerpt_or_unknown unless the whole edit's beginning and ending "
    "were available. Never assume a two-minute excerpt is the full video. "
    "Return exactly {criterion_count} criterion_evidence entries for dimension_index {dimension_indices}, each with criterion_index 0,1,2,3. "
    "Use the explicit canonical indices listed below. Return {dimension_count} dimension_notes entries "
    "with a concrete strength, weakness (empty if none observed) and actionable suggestion for each dimension. "
    "For a normal audiovisual edit, seriously evaluate all four criteria in every dimension. "
    "When required evidence is absent set supported=false, level=0 and empty cue/effect for that criterion. It will be excluded from scoring. "
    "Use criterion_index to refer to each listed criterion. "
    "For each supported criterion give approximate_timecode strictly as MM:SS (for example 01:05 means 65 seconds), "
    "a concrete visible/audible cue and "
    "its editorial effect (each within 10 words). Set supported=false for unsupported criteria instead of guessing. "
    "Ground each assessable dimension in at least two separated observed moments within the reviewed interval. "
    "Do not reuse 00:00 as a placeholder for sequence-wide observations; unsupported timing evidence must be empty. "
    "Use only these anchored levels: 0 = observed choices consistently obstruct the intended expression; "
    "1 = major observed weaknesses; 2 = mixed or inconsistently effective; 3 = mostly effective with concrete support; "
    "4 = consistently effective with concrete support across the reviewed interval. "
    "Do not assign an aggregate score or confidence. A missing weakness may be an empty array, never invent one. "
    "Keep strengths, weaknesses and suggestion tied to specific observed choices. "
    "Creative execution concerns expressive choices and integration. Comparative originality is unassessed because "
    "no authorized comparison collection is attached. Never claim novelty, copying or owner taste. "
    "An entirely black, undecodable or audio-only input has no assessable visual craft or visual story. "
    "Set visual_content_present accurately. Do not invent scenes. Silence can be intentional, but no audible "
    "evidence cannot support an audiovisual rhythm rating. Never estimate frame-accurate beat alignment, "
    "millisecond errors or exact transition counts from the sampled stream. "
    "{rubrics}"
)


def rubric_prompt(dimensions=None):
    selected = list(RUBRICS) if dimensions is None else list(dimensions)
    indices = {key: index for index, key in enumerate(RUBRICS)}
    return RUBRIC_PROMPT_TEMPLATE.format(
        dimension_count=len(selected), criterion_count=len(selected) * 4,
        dimension_indices=", ".join(str(indices[key]) for key in selected),
        rubrics=" ".join(f"dimension_index {indices[key]} ({key}): " + ". ".join(
            f"criterion_index {index} ({criterion}) = {meaning}"
            for index, (criterion, meaning) in enumerate(RUBRICS[key]["criteria"].items())
        ) for key in selected),
    )


RUBRIC_PROMPT = rubric_prompt()


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
        "evidence_sampling": "Model-reported observations from sampled frames and audio. Precise timing requires local measurements.",
    }
    if key == "beat_synchronization":
        evidence["audio_observation"] = clean_text(observation.get("audio_observation"))
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
    if observation.get("visual_content_present", observation.get("stream_reviewable")) is not True:
        reason = "No meaningful visual content was available for this editing rubric."
    elif key == "beat_synchronization" and observation.get("audio_reviewable") is not True:
        reason = "Audiovisual rhythm requires an audible track and visible editorial evidence."
    elif not coverage:
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
