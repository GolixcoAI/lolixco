#!/usr/bin/env python3
"""
Lolixco Edit DNA — Hybrid Intelligence Pipeline (System A + System B)
System A (Independent Local Engine):
  - FFmpeg / OpenCV technical signal analysis.
  - Scale/rotation invariant ORB keypoints + semantic visual matcher.
  - Speed/pitch invariant CENS chroma + onset envelope audio identifier.
  - Owner personalized preference model (11 reviews, 4 comparisons).

System B (Google Gemini Video Intelligence):
  - Optional semantic video understanding provider.
  - Public YouTube URL ingestion via Google Interactions API.
  - High-level scene description, character identification, and storytelling analysis.
  - Token tracking, rate limiting, and graceful offline fallback.
"""

import os
import sys
import json
import time
from typing import Dict, Any, Optional

from gemini_provider import GeminiVideoProvider
from semantic_visual_matcher import SemanticVisualMatcher
from recognizer import EditDNARecognizer
from edit_dna_report import EditDNAReportCompiler


class HybridEditAnalyzer:
    """
    Orchestrates the hybrid analysis workflow.
    Ensures System A remains 100% operational offline,
    while System B enriches with semantic understanding when available.
    """

    def __init__(self, mode: str = "hybrid_auto"):
        self.mode = mode
        self.gemini_provider = GeminiVideoProvider(mode=mode)
        self.semantic_matcher = SemanticVisualMatcher(embedding_dim=256)
        self.geometric_recognizer = EditDNARecognizer()
        self.report_compiler = EditDNAReportCompiler()

    def analyze(
        self,
        media_input: str,
        media_type: str = "authorized_video_bytes",
        audio_path: Optional[str] = None,
        manual_score: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Executes analysis across available local and cloud providers.
        """
        start_time = time.time()
        is_youtube = "youtube.com" in media_input or "youtu.be" in media_input or media_type == "public_youtube_url"

        # 1. System B: Query Gemini Video Intelligence (if YouTube URL or enabled)
        gemini_result = None
        if is_youtube and self.mode != "local_only":
            gemini_result = self.gemini_provider.analyze_youtube_video(media_input)

        # 2. System A: Run Local Visual Recognition (if local media exists)
        visual_recognition = {"status": "abstain", "confidence": 0.0, "matched_entity": None}
        if os.path.isfile(media_input):
            # Run semantic matcher
            s_res = self.semantic_matcher.query_video(media_input)
            # Run geometric matcher
            g_res = self.geometric_recognizer.identify_visual_source(media_input)

            if g_res.get("status") == "identified":
                visual_recognition = {
                    "status": "identified",
                    "matched_entity": g_res.get("matched_entity"),
                    "confidence": g_res.get("confidence", 0.0),
                    "is_mirrored": g_res.get("is_mirrored", False),
                    "evidence": g_res.get("evidence", {}),
                    "verification_type": "invariant_orb_keypoint_correspondence",
                }
            elif s_res.get("status") == "identified":
                visual_recognition = {
                    "status": "identified",
                    "matched_entity": s_res.get("matched_ref"),
                    "confidence": s_res.get("confidence", 0.0),
                    "is_mirrored": False,
                    "evidence": {"cosine_similarity": s_res.get("confidence")},
                    "verification_type": "dense_semantic_embedding_cosine",
                }

        # 3. System A: Run Local Music Identification (if audio exists)
        music_recognition = {"status": "abstain", "confidence": 0.0, "matched_entity": None}
        target_audio = audio_path or (media_input if media_input.endswith((".wav", ".mp3", ".ogg")) else None)
        if target_audio and os.path.isfile(target_audio):
            m_res = self.geometric_recognizer.identify_music_track(target_audio)
            music_recognition = {
                "status": m_res.get("status", "abstain"),
                "matched_entity": m_res.get("matched_entity"),
                "confidence": m_res.get("confidence", 0.0),
                "transformations": m_res.get("transformations", {}),
                "evidence": m_res.get("evidence", {}),
            }

        # 4. Compile Unified Report
        report = self.report_compiler.compile_report(
            media_id=os.path.basename(media_input),
            media_type="public_youtube_url" if is_youtube else "authorized_video_bytes",
            visual_recognition=visual_recognition,
            music_recognition=music_recognition,
            technical_measurements=None,  # Or pass technical metrics if byte pipeline ran
            gemini_observations=gemini_result.get("analysis") if gemini_result else None,
            manual_owner_score=manual_score,
        )

        report["pipeline_metadata"] = {
            "execution_mode": self.mode,
            "latency_ms": round((time.time() - start_time) * 1000.0, 1),
            "gemini_provider_status": gemini_result.get("status") if gemini_result else "not_invoked",
        }

        return report
