#!/usr/bin/env python3
"""
Lolixco Edit DNA — Anime Scene Resolver
Queries the trace.moe open search API to identify anime series, episode numbers,
and scene timestamps from video frames.

Thresholds:
  - similarity >= 0.87: VERIFIED_MATCH
  - 0.60 <= similarity < 0.87: POSSIBLE_MATCH / CANDIDATE
  - similarity < 0.60: UNKNOWN (unverified / non-anime)
"""

import os
import io
import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional
import cv2
import numpy as np


TRACE_MOE_API_URL = "https://api.trace.moe/search"


class AnimeSceneResolver:
    """
    Connects to the trace.moe visual search engine to resolve anime footage.
    Gracefully handles network drops, non-anime footage, and rate limits.
    """

    @classmethod
    def resolve_from_video(
        cls,
        video_path: str,
        sample_timestamp_sec: Optional[float] = None,
        timeout_seconds: int = 10,
    ) -> Dict[str, Any]:
        """
        Extracts a keyframe from the local video and queries trace.moe.
        """
        if not os.path.exists(video_path):
            return {
                "status": "UNKNOWN",
                "matched_title": None,
                "confidence": 0.0,
                "reason": "video_file_not_found",
            }

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {
                "status": "UNKNOWN",
                "matched_title": None,
                "confidence": 0.0,
                "reason": "failed_to_decode_video_frame",
            }

        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            cap.release()
            return {
                "status": "UNKNOWN",
                "matched_title": None,
                "confidence": 0.0,
                "reason": "empty_video_frames",
            }

        # Select sample frame (e.g. at 50% duration if not specified)
        if sample_timestamp_sec is not None:
            target_frame = int(sample_timestamp_sec * fps)
        else:
            target_frame = total_frames // 2

        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(target_frame, total_frames - 1)))
        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            return {
                "status": "UNKNOWN",
                "matched_title": None,
                "confidence": 0.0,
                "reason": "could_not_read_sample_frame",
            }

        # Quality check: reject dark, low-contrast, or motion-blurred frames
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        lum = float(np.mean(gray))
        contrast = float(np.std(gray))
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if lum < 25.0 or contrast < 20.0 or sharpness < 15.0:
            return {
                "status": "UNKNOWN",
                "matched_title": None,
                "confidence": 0.0,
                "reason": "ambiguous_dark_or_blurry_keyframe",
                "evidence": f"Keyframe at frame {target_frame} has insufficient detail (sharpness {sharpness:.1f}, lum {lum:.1f}) to prevent false-positive visual matches.",
                "provenance": "trace_moe_api"
            }

        # Encode frame as JPEG
        success, jpeg_bytes = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not success:
            return {
                "status": "UNKNOWN",
                "matched_title": None,
                "confidence": 0.0,
                "reason": "jpeg_encoding_failed",
            }

        return cls.resolve_from_image_bytes(jpeg_bytes.tobytes(), timeout_seconds=timeout_seconds)

    @classmethod
    def resolve_from_image_bytes(
        cls,
        image_bytes: bytes,
        timeout_seconds: int = 10,
    ) -> Dict[str, Any]:
        """
        Submits JPEG/PNG bytes to trace.moe API and formats structured result.
        """
        req = urllib.request.Request(
            TRACE_MOE_API_URL,
            data=image_bytes,
            headers={
                "Content-Type": "image/jpeg",
                "User-Agent": "LolixcoEditDNA/2.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                results = data.get("result", [])
                if not results:
                    return {
                        "status": "UNKNOWN",
                        "matched_title": None,
                        "confidence": 0.0,
                        "reason": "no_anime_match_found",
                        "provenance": "trace_moe_api",
                    }

                top = results[0]
                similarity = float(top.get("similarity", 0.0))
                filename = top.get("filename", "")
                anilist_id = top.get("anilist_id")
                episode = top.get("episode")
                from_sec = top.get("from")
                to_sec = top.get("to")

                if similarity >= 0.87:
                    status = "VERIFIED_MATCH"
                elif similarity >= 0.60:
                    status = "POSSIBLE_MATCH"
                else:
                    status = "UNKNOWN"

                return {
                    "status": status,
                    "matched_title": filename if status != "UNKNOWN" else None,
                    "confidence": round(similarity, 3),
                    "anilist_id": anilist_id,
                    "episode": episode,
                    "scene_interval": [from_sec, to_sec] if from_sec is not None else None,
                    "similarity": round(similarity, 3),
                    "provenance": "trace_moe_api",
                }

        except urllib.error.HTTPError as e:
            return {
                "status": "UNKNOWN",
                "matched_title": None,
                "confidence": 0.0,
                "reason": f"trace_moe_http_{e.code}",
                "provenance": "trace_moe_api",
            }
        except Exception as e:
            return {
                "status": "UNKNOWN",
                "matched_title": None,
                "confidence": 0.0,
                "reason": f"network_or_timeout: {str(e)}",
                "provenance": "trace_moe_api",
            }
