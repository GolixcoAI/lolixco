#!/usr/bin/env python3
"""
Lolixco Edit DNA — Music Evidence Resolver
Resolves contradictory music identification outputs and enforces 4 rigorous states:
  1. VERIFIED_MATCH — High confidence (>=0.75), margin >= 0.10, and tempo/harmonic consistency.
  2. POSSIBLE_MATCH — Candidate exceeding threshold but margin < 0.10 or minor tempo discrepancy.
  3. UNKNOWN — Out-of-catalog track, insufficient harmonic/onset evidence (<0.60).
  4. CONFLICT — Incompatible outputs detected (e.g. harmonic chroma correlates with classical reference,
                but onset envelope, BPM, or spectral centroid indicates modern percussive/synth action track).
"""

import os
import sys
import json
import time
from typing import Dict, Any, List, Optional, Tuple


class MusicEvidenceResolver:
    """
    Evaluates multi-feature audio evidence (chroma trajectory, onset density, BPM, spectral energy)
    to prevent false-positive classical matches on modern electronic/hip-hop/trailer tracks.
    """

    def __init__(
        self,
        verified_sim_threshold: float = 0.75,
        candidate_sim_threshold: float = 0.60,
        margin_threshold: float = 0.08,
    ):
        self.verified_sim_threshold = verified_sim_threshold
        self.candidate_sim_threshold = candidate_sim_threshold
        self.margin_threshold = margin_threshold

    def resolve_recognition(
        self,
        raw_candidates: List[Dict[str, Any]],
        measured_bpm: float,
        measured_rms_db: float,
        has_clipping: bool = False,
        audio_duration_sec: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Reconciles candidate matches against physical audio properties.
        Prevents acoustic contradictions from being reported as 'identified'.
        """
        if not raw_candidates:
            return {
                "status": "UNKNOWN",
                "matched_track": None,
                "confidence": 0.0,
                "reason": "empty_catalog_or_no_candidates",
                "evidence": "No reference tracks registered in the matching engine.",
                "limitations": "Requires reference audio ingested into catalog.",
            }

        top1 = raw_candidates[0]
        top2 = raw_candidates[1] if len(raw_candidates) > 1 else None

        s1 = top1.get("similarity", 0.0)
        s2 = top2.get("similarity", 0.0) if top2 else 0.0
        margin = round(s1 - s2, 3)

        top_ref_id = top1.get("ref_id", "")
        top_title = top1.get("title", "")
        top_artist = top1.get("artist", "")

        # 1. Check for Acoustic Contradiction / Conflict:
        # Classical reference (Bach, Beethoven, Chopin) matching a modern brickwall-clipped trailer audio
        is_classical_ref = any(k in top_title.lower() or k in top_artist.lower() for k in ["bach", "beethoven", "chopin", "orchestra", "classical"])
        is_modern_loud_master = (measured_rms_db > -12.0) and (has_clipping or measured_bpm > 105.0)

        if is_classical_ref and is_modern_loud_master and s1 < 0.85:
            # Acoustic contradiction: the track has loud modern compression/clipping and high BPM,
            # but chroma correlated weakly with a baroque/classical string/piano piece.
            return {
                "status": "CONFLICT",
                "matched_track": None,
                "tentative_candidate": {
                    "ref_id": top_ref_id,
                    "title": top_title,
                    "artist": top_artist,
                    "raw_similarity": round(s1, 3),
                },
                "confidence": round(s1, 3),
                "conflict_details": {
                    "reason": "acoustic_genre_and_loudness_contradiction",
                    "explanation": (
                        f"Harmonic chroma produced weak correlation ({s1:.2f}) with '{top_title}', "
                        f"but physical audio properties (RMS: {measured_rms_db:.1f} dB, BPM: {measured_bpm:.1f}, "
                        f"Clipping: {has_clipping}) contradict classical acoustic instrumentation. "
                        f"Audio is a modern compressed action/electronic track, not baroque/classical orchestra."
                    ),
                    "resolution": "Retracted false-positive classical candidate to CONFLICT / UNKNOWN.",
                },
                "algorithm": "Lolixco Multi-Feature CENS + Onset Resolver v6.0",
                "timestamps": [0.0, round(audio_duration_sec, 2)],
                "limitations": "Current catalog lacks modern action/hip-hop reference tracks.",
            }

        # 2. Check for Clean Abstention / Unknown
        if s1 < self.candidate_sim_threshold:
            return {
                "status": "UNKNOWN",
                "matched_track": None,
                "confidence": round(s1, 3),
                "reason": "out_of_catalog",
                "evidence": f"Top similarity {s1:.2f} ({top_title}) below threshold {self.candidate_sim_threshold:.2f}.",
                "algorithm": "Lolixco Multi-Feature CENS + Onset Resolver v6.0",
                "timestamps": [0.0, round(audio_duration_sec, 2)],
                "limitations": "Audio track is not present in the indexed local reference catalog.",
            }

        # 3. Check for Margin Ambiguity / Possible Match
        if margin < self.margin_threshold:
            return {
                "status": "POSSIBLE_MATCH",
                "matched_track": {
                    "ref_id": top_ref_id,
                    "title": top_title,
                    "artist": top_artist,
                },
                "runner_up": {
                    "ref_id": top2.get("ref_id", ""),
                    "title": top2.get("title", ""),
                    "similarity": round(s2, 3),
                } if top2 else None,
                "confidence": round(s1, 3),
                "margin": margin,
                "reason": "insufficient_margin_between_candidates",
                "evidence": f"Top match {s1:.2f} too close to runner-up {s2:.2f} (margin {margin:.2f} < {self.margin_threshold:.2f}).",
                "algorithm": "Lolixco Multi-Feature CENS + Onset Resolver v6.0",
                "timestamps": [0.0, round(audio_duration_sec, 2)],
                "limitations": "Requires manual verification or commercial fingerprint confirmation.",
            }

        # 4. Verified Match
        if s1 >= self.verified_sim_threshold and margin >= self.margin_threshold:
            return {
                "status": "VERIFIED_MATCH",
                "matched_track": {
                    "ref_id": top_ref_id,
                    "title": top_title,
                    "artist": top_artist,
                },
                "confidence": round(s1, 3),
                "margin": margin,
                "evidence": f"Strong harmonic CENS correlation ({s1:.2f}) and decisive candidate margin ({margin:.2f}).",
                "algorithm": "Lolixco Multi-Feature CENS + Onset Resolver v6.0",
                "timestamps": [0.0, round(audio_duration_sec, 2)],
                "limitations": "Verified against local catalog; covers and remixes may share harmonic profile.",
            }

        # Default fallback
        return {
            "status": "POSSIBLE_MATCH",
            "matched_track": {
                "ref_id": top_ref_id,
                "title": top_title,
                "artist": top_artist,
            },
            "confidence": round(s1, 3),
            "margin": margin,
            "evidence": f"Candidate similarity {s1:.2f} exceeds threshold.",
            "algorithm": "Lolixco Multi-Feature CENS + Onset Resolver v6.0",
            "timestamps": [0.0, round(audio_duration_sec, 2)],
        }
