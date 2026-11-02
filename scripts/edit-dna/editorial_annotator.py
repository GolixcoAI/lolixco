#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — EDITORIAL CRITICISM ANNOTATION LAYER
Extracts structured editorial tags, timestamp intervals, and qualitative feedback
from the owner's written critiques without modifying original text.
Enables the preference engine to understand *why* an edit succeeded or failed.
"""

import re
from typing import Dict, Any, List, Optional

TAG_DEFINITIONS = {
    # Positive Editorial Qualities
    "lyrical_mapping": {
        "polarity": "positive",
        "description": "Kinetic action or cuts mapped to vocal lyrics / dialogue meanings",
        "keywords": [
            r"lyric(?:al)?\s+(?:mapping|alignment|cue|timing|cut)",
            r"vocal\s+(?:intro|cue|mapping|phrase|line)",
            r"dialogue\s+(?:pacing|resonance|alignment|cue)",
            r"spoken\s+word\s+(?:hit|sync)",
            r"thematic\s+and\s+lyrical",
        ],
    },
    "kinetic_transient_sync": {
        "polarity": "positive",
        "description": "Flawless sub-frame alignment to percussion / audio transients",
        "keywords": [
            r"(?:high-impact|flawless|godly|super|exceptional)\s+(?:beat\s+)?sync",
            r"perfect(?:ly)?\s+locking",
            r"mapped\s+to\s+(?:the\s+)?(?:rapid\s+)?percussive",
            r"audio-visual\s+alignment",
            r"primary\s+(?:synth\s+)?transients?",
            r"perfectly\s+mapping\s+(?:the\s+)?primary\s+audio\s+transient",
            r"transient\s+sync",
            r"on-beat\s+(?:snap|hit)",
        ],
    },
    "atmospheric_tension_pacing": {
        "polarity": "positive",
        "description": "Deliberate slow pacing / silence / absence of beats building tension",
        "keywords": [
            r"atmospheric\s+slow\s+pacing",
            r"absence\s+of\s+heavy\s+beats",
            r"environmental\s+pacing",
            r"build(?:s|ing)\s+(?:narrative|atmospheric)\s+tension",
            r"deliberate\s+slow\s+pacing",
            r"strategic\s+structural\s+reset"
        ],
    },
    "purposeful_transitions": {
        "polarity": "positive",
        "description": "Technically pristine, deliberate transitions serving visual flow",
        "keywords": [
            r"purposeful,\s*varied\s+transitions",
            r"cuts\s+are\s+clean",
            r"solid\s+technical\s+fundamentals",
            r"technically\s+pristine",
            r"flawless\s+technical\s+execution",
            r"high-impact\s+resolution"
        ],
    },
    "narrative_cohesion": {
        "polarity": "positive",
        "description": "Clear story arc, character depth, and thematic emotional resonance",
        "keywords": [
            r"high\s+narrative\s+cohesion",
            r"strong\s+narrative\s+cohesion",
            r"masterful\s+thematic",
            r"outstanding\s+thematic\s+execution",
            r"narrative\s+alignment",
            r"complete\s+narrative\s+arc",
            r"highly\s+effective\s+narrative\s+arc"
        ],
    },
    "custom_visual_graphics": {
        "polarity": "positive",
        "description": "Creative custom assets (motion tracking, accent lines, animation)",
        "keywords": [
            r"custom\s+graphics",
            r"animated\s+red\s+accent",
            r"glowing\s+eye\s+tracking",
            r"custom\s+animation",
            r"inventive\s+and\s+visually\s+impressive"
        ],
    },

    # Negative / Penalty Editorial Qualities
    "audio_visual_disconnect": {
        "polarity": "negative",
        "description": "Cuts and visual changes operate independently of the audio track",
        "keywords": [
            r"audio-visual\s+disconnect",
            r"operate\s+(?:completely\s+)?independently\s+of\s+the\s+(?:music|audio)",
            r"failing\s+entirely\s+to\s+map",
            r"minimal\s+to\s+zero\s+audio-visual\s+mapping",
            r"severe\s+lack\s+of\s+audio-visual\s+mapping"
        ],
    },
    "repetitive_template_transitions": {
        "polarity": "negative",
        "description": "Overreliance on repetitive zoom-in/out effects like an automated template",
        "keywords": [
            r"repetitive\s+zoom",
            r"automated\s+template",
            r"generic\s+transition\s+exercise"
        ],
    },
    "excessive_visual_clutter": {
        "polarity": "negative",
        "description": "Over-edited with continuous overlays, shaders, or text clutter",
        "keywords": [
            r"excessive\s+visual\s+clutter",
            r"over-edit",
            r"text\s+overlay",
            r"on-screen\s+clutter",
            r"heavy\s+reliance\s+on\s+continuous\s+filters"
        ],
    },
    "low_visual_fidelity": {
        "polarity": "negative",
        "description": "Noticeably degraded raw footage resolution, encoding, or color fidelity",
        "keywords": [
            r"low\s+visual\s+fidelity",
            r"poor\s+visual\s+fidelity",
            r"footage\s+(?:quality\s+or\s+rendering\s+is\s+)?noticeably\s+degraded",
            r"degradation\s+in\s+resolution",
            r"degraded\s+visual\s+quality"
        ],
    },
    "chaotic_cut_incoherence": {
        "polarity": "negative",
        "description": "Chaotic cut frequency with zero structure, making action incomprehensible",
        "keywords": [
            r"total\s+visual\s+incoherence",
            r"chaotic\s+and\s+lack\s+purposeful",
            r"impossible\s+to\s+comprehend",
            r"complete\s+lack\s+of\s+narrative\s+cohesion",
            r"zero\s+emotional\s+resonance"
        ],
    },
    "style_over_substance": {
        "polarity": "negative",
        "description": "Visually polished or hyperactive but devoid of emotional resonance",
        "keywords": [
            r"style\s+over\s+substance",
            r"infusing\s+more\s+emotional\s+resonance",
            r"diminishes\s+overall\s+visual\s+appeal"
        ],
    },
}


def parse_timestamp_intervals(text: str) -> List[Dict[str, Any]]:
    """Extracts explicit timestamp markers like [0:00 - 0:23] or [1:15 - 1:37]."""
    intervals = []
    # Match patterns like [0:00 - 0:23] or [Start & Ending] or [Intro]
    pattern = r"\[(\d+:\d+|\w+)(?:\s*-\s*(\d+:\d+|\w+))?\]"
    for m in re.finditer(pattern, text):
        raw = m.group(0)
        start_str = m.group(1)
        end_str = m.group(2) if m.group(2) else ""
        intervals.append({
            "raw_marker": raw,
            "start": start_str,
            "end": end_str,
        })
    return intervals


def extract_editorial_tags(text: str) -> Dict[str, Any]:
    """Analyzes critique text and identifies detected editorial criteria."""
    if not text:
        return {
            "detected_tags": [],
            "positive_tags": [],
            "negative_tags": [],
            "intervals": [],
            "summary": "No written critique notes provided."
        }

    detected_tags = []
    positive_tags = []
    negative_tags = []

    text_lower = text.lower()

    for tag_name, defn in TAG_DEFINITIONS.items():
        matched_keywords = []
        for kw in defn["keywords"]:
            if re.search(kw, text_lower):
                matched_keywords.append(kw)
        
        if matched_keywords:
            tag_info = {
                "tag": tag_name,
                "polarity": defn["polarity"],
                "description": defn["description"],
                "matched_evidence": matched_keywords[:3],
            }
            detected_tags.append(tag_info)
            if defn["polarity"] == "positive":
                positive_tags.append(tag_name)
            else:
                negative_tags.append(tag_name)

    intervals = parse_timestamp_intervals(text)

    return {
        "detected_tags": detected_tags,
        "positive_tags": positive_tags,
        "negative_tags": negative_tags,
        "intervals": intervals,
        "positive_count": len(positive_tags),
        "negative_count": len(negative_tags),
        "editorial_sentiment": (
            "strongly_favorable" if len(positive_tags) >= 3 and len(negative_tags) == 0
            else "favorable_with_constructive_critique" if len(positive_tags) > len(negative_tags)
            else "balanced_mixed" if len(positive_tags) == len(negative_tags) and len(positive_tags) > 0
            else "severe_criticism" if len(negative_tags) >= 2
            else "neutral"
        )
    }


def annotate_rating_record(rating_entry: Dict[str, Any]) -> Dict[str, Any]:
    """Enriches a rating record with structured editorial annotations while keeping notes intact."""
    notes = rating_entry.get("free_text_notes", "")
    annotations = extract_editorial_tags(notes)
    
    # Store without mutating original notes
    rating_entry["editorial_annotations"] = annotations
    return rating_entry


if __name__ == "__main__":
    sample_text = (
        "[0:00 - 0:15] Synthesized sample testing block: Pacing features atmospheric tension. "
        "At [0:10], video locks with audio-visual alignment to the primary synth transient. "
        "Transitions rely heavily on repetitive zoom effects and automated templates."
    )
    result = extract_editorial_tags(sample_text)
    import json
    print(json.dumps(result, indent=2))
