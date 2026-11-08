#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — MIXED EDIT SEGMENT-LEVEL RECOGNITION ANALYZER
Analyzes complex multi-source edits containing:
- Several visual sources / scenes across different timestamps.
- Multiple music tracks, transitions, slowed/pitched variations.
- Dialogue overlays and background sound.
- Unrecognizable or out-of-catalog intervals explicitly marked unknown.
Provides both shot-level timeline breakdown and holistic video summary.
Zero hard-coded labels: dynamically evaluates against whatever reference catalog is indexed.
"""

import os
import sys
import json
import time
import math
import numpy as np
import cv2
import soundfile as sf
import librosa
from typing import Dict, Any, List, Tuple, Optional

sys.path.insert(0, os.path.dirname(__file__))
from recognizer import (
    EditDNARecognizer,
    compute_frame_hash,
    compute_frame_color_moments,
    match_visual_features,
    extract_audio_recognition_features,
    match_audio_features,
)


def detect_scene_cuts(video_path: str, threshold: float = 27.0) -> List[float]:
    """Detects scene cut timestamps using frame luminance delta."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return [0.0]

    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    cuts = [0.0]

    ret, prev_frame = cap.read()
    if not ret:
        cap.release()
        return [0.0]

    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    frame_idx = 1

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        diff = cv2.absdiff(prev_gray, gray)
        mean_diff = float(np.mean(diff))

        if mean_diff > threshold:
            timestamp = frame_idx / fps
            if timestamp - cuts[-1] >= 0.5:  # Debounce minimum shot length 0.5s
                cuts.append(timestamp)

        prev_gray = gray
        frame_idx += 1

    total_duration = frame_idx / fps
    cap.release()

    if cuts[-1] < total_duration - 0.2:
        cuts.append(total_duration)

    return cuts


class MixedEditAnalyzer:
    """
    Evaluates mixed multi-source edits at both segment and video level.
    Distinguishes identified entities with evidence from unverified guesses and unknown segments.
    """

    def __init__(self, recognizer: EditDNARecognizer):
        self.recognizer = recognizer

    def analyze_video(
        self,
        video_path: str,
        audio_path: Optional[str] = None,
        audio_window_sec: float = 4.0,
        audio_hop_sec: float = 2.0,
    ) -> Dict[str, Any]:
        """
        Runs comprehensive multi-source segmentation and timeline recognition.
        """
        if not os.path.isfile(video_path):
            return {"status": "error", "message": f"File not found: {video_path}"}

        start_time = time.time()
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()

        # 1. Detect Visual Cuts
        cut_timestamps = detect_scene_cuts(video_path)
        if len(cut_timestamps) < 2:
            cut_timestamps = [0.0, duration]

        # 2. Analyze Visual Shots
        visual_segments = []
        for i in range(len(cut_timestamps) - 1):
            t_start = cut_timestamps[i]
            t_end = cut_timestamps[i + 1]
            seg_duration = t_end - t_start

            # Extract keyframes and invariant local descriptors for this segment
            cap = cv2.VideoCapture(video_path)
            cap.set(cv2.CAP_PROP_POS_MSEC, t_start * 1000.0)
            seg_hashes = []
            seg_mirrored = []
            seg_cm = []
            seg_des = []
            seg_mdes = []
            orb = cv2.ORB_create(nfeatures=250)

            f_count = int(seg_duration * fps)
            sample_step = max(1, f_count // 15)

            for f_i in range(f_count):
                ret, frame = cap.read()
                if not ret:
                    break
                if f_i % sample_step == 0:
                    h = compute_frame_hash(frame)
                    h_m = compute_frame_hash(cv2.flip(frame, 1))
                    cm = compute_frame_color_moments(frame)
                    seg_hashes.append(h)
                    seg_mirrored.append(h_m)
                    seg_cm.append(cm)

                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    kp, des = orb.detectAndCompute(gray, None)
                    if des is not None:
                        seg_des.append(des)
                    gray_m = cv2.flip(gray, 1)
                    kp_m, des_m = orb.detectAndCompute(gray_m, None)
                    if des_m is not None:
                        seg_mdes.append(des_m)

            cap.release()

            seg_feats = {
                "hashes": np.array(seg_hashes) if seg_hashes else np.empty((0, 240), dtype=bool),
                "mirrored_hashes": np.array(seg_mirrored) if seg_mirrored else np.empty((0, 240), dtype=bool),
                "color_moments": np.array(seg_cm) if seg_cm else np.empty((0, 6)),
                "keypoint_descriptors": seg_des,
                "mirrored_descriptors": seg_mdes,
            }

            # Match against visual catalog
            best_candidate = None
            runner_up = None
            max_sim = 0.0
            runner_up_sim = 0.0

            candidates = []
            for ref_id, ref in self.recognizer.visual_catalog.items():
                sim, diag = match_visual_features(seg_feats, ref["features"])
                candidates.append({
                    "ref_id": ref_id,
                    "title": ref["title"],
                    "franchise": ref["franchise"],
                    "similarity": sim,
                    "diagnostics": diag,
                })

            candidates.sort(key=lambda c: c["similarity"], reverse=True)
            top1 = candidates[0] if candidates else None
            top2 = candidates[1] if len(candidates) > 1 else None

            # Calibrated evaluation
            if top1 and top1["similarity"] >= self.recognizer.visual_sim_threshold and (
                not top2 or (top1["similarity"] - top2["similarity"]) >= self.recognizer.visual_margin_threshold
            ):
                diag = top1["diagnostics"]
                visual_result = {
                    "status": "identified",
                    "matched_entity": {
                        "ref_id": top1["ref_id"],
                        "title": top1["title"],
                        "franchise": top1["franchise"],
                    },
                    "confidence": round(top1["similarity"], 3),
                    "margin": round(top1["similarity"] - (top2["similarity"] if top2 else 0.0), 3),
                    "is_mirrored": diag.get("is_mirrored", False),
                    "evidence": f"Keyframe hash match {diag.get('hash_similarity', 0.0):.2f}, tonal match {diag.get('color_similarity', 0.0):.2f}",
                }
            else:
                top_name = top1["title"] if top1 else "None"
                top_score = top1["similarity"] if top1 else 0.0
                visual_result = {
                    "status": "abstain",
                    "reason": "unregistered_source_or_insufficient_confidence",
                    "confidence": round(top_score, 3),
                    "matched_entity": None,
                    "evidence": f"Top similarity {top_score:.2f} ({top_name}) below threshold or ambiguous.",
                }

            visual_segments.append({
                "shot_index": i + 1,
                "start_time": round(t_start, 2),
                "end_time": round(t_end, 2),
                "duration": round(seg_duration, 2),
                "visual_recognition": visual_result,
            })

        # 3. Analyze Audio Windows (if audio available)
        audio_segments = []
        target_audio = audio_path or video_path
        try:
            y, sr = librosa.load(target_audio, sr=22050, mono=True)
            has_audio = len(y) > 0
        except Exception:
            has_audio = False
            y, sr = np.array([]), 22050

        if has_audio:
            total_audio_sec = len(y) / sr
            hop_samples = int(audio_hop_sec * sr)
            win_samples = int(audio_window_sec * sr)

            for w_start_sample in range(0, len(y), hop_samples):
                w_end_sample = min(len(y), w_start_sample + win_samples)
                if (w_end_sample - w_start_sample) < int(1.5 * sr):
                    continue

                w_t_start = w_start_sample / sr
                w_t_end = w_end_sample / sr
                slice_y = y[w_start_sample:w_end_sample]

                # Extract audio features for window
                chroma = librosa.feature.chroma_cens(y=slice_y, sr=sr, hop_length=1024, n_chroma=12)
                onset = librosa.onset.onset_strength(y=slice_y, sr=sr, hop_length=1024)
                onset_norm = onset / (np.max(onset) + 1e-6)

                w_feats = {
                    "chroma_cens": chroma,
                    "onset_env": onset_norm,
                    "duration": float(len(slice_y) / sr),
                }

                # Match against audio catalog
                candidates = []
                for ref_id, ref in self.recognizer.audio_catalog.items():
                    sim, diag = match_audio_features(w_feats, ref["features"])
                    candidates.append({
                        "ref_id": ref_id,
                        "title": ref["title"],
                        "artist": ref["artist"],
                        "similarity": sim,
                        "diagnostics": diag,
                    })

                candidates.sort(key=lambda c: c["similarity"], reverse=True)
                top1 = candidates[0] if candidates else None
                top2 = candidates[1] if len(candidates) > 1 else None

                if top1 and top1["similarity"] >= self.recognizer.audio_sim_threshold and (
                    not top2 or (top1["similarity"] - top2["similarity"]) >= self.recognizer.audio_margin_threshold
                ):
                    diag = top1["diagnostics"]
                    audio_result = {
                        "status": "identified",
                        "matched_entity": {
                            "ref_id": top1["ref_id"],
                            "title": top1["title"],
                            "artist": top1["artist"],
                        },
                        "confidence": round(top1["similarity"], 3),
                        "transformations": {
                            "speed_factor": diag.get("detected_speed_factor", 1.0),
                            "pitch_shift_semitones": diag.get("detected_pitch_shift_semitones", 0),
                        },
                        "evidence": f"Chroma correlation {diag.get('chroma_similarity', 0.0):.2f}, onset correlation {diag.get('onset_similarity', 0.0):.2f}",
                    }
                else:
                    top_name = top1["title"] if top1 else "None"
                    top_score = top1["similarity"] if top1 else 0.0
                    audio_result = {
                        "status": "abstain",
                        "reason": "unregistered_music_or_insufficient_confidence",
                        "confidence": round(top_score, 3),
                        "matched_entity": None,
                        "evidence": f"Top similarity {top_score:.2f} ({top_name}) below threshold or ambiguous.",
                    }

                audio_segments.append({
                    "window_start": round(w_t_start, 2),
                    "window_end": round(w_t_end, 2),
                    "audio_recognition": audio_result,
                })

        # 4. Synthesize Holistic Timeline Summary
        identified_sources = {}
        unrecognized_visual_sec = 0.0
        for vs in visual_segments:
            dur = vs["duration"]
            rec = vs["visual_recognition"]
            if rec["status"] == "identified":
                title = rec["matched_entity"]["title"]
                identified_sources[title] = identified_sources.get(title, 0.0) + dur
            else:
                unrecognized_visual_sec += dur

        source_shares = [
            {
                "source_title": title,
                "cumulative_seconds": round(sec, 2),
                "duration_share_percent": round((sec / duration) * 100, 1),
            }
            for title, sec in identified_sources.items()
        ]

        identified_music_tracks = {}
        for a_seg in audio_segments:
            a_rec = a_seg["audio_recognition"]
            if a_rec["status"] == "identified":
                m_title = a_rec["matched_entity"]["title"]
                if m_title not in identified_music_tracks:
                    identified_music_tracks[m_title] = {
                        "track_title": m_title,
                        "artist": a_rec["matched_entity"]["artist"],
                        "detected_intervals": [],
                        "transformations": a_rec.get("transformations", {}),
                    }
                identified_music_tracks[m_title]["detected_intervals"].append(
                    f"[{a_seg['window_start']:.1f}s - {a_seg['window_end']:.1f}s]"
                )

        latency = round((time.time() - start_time) * 1000.0, 1)

        return {
            "media_summary": {
                "filename": os.path.basename(video_path),
                "duration_seconds": round(duration, 2),
                "resolution": f"{width}x{height}",
                "fps": round(fps, 1),
                "detected_shots_count": len(visual_segments),
                "analysis_latency_ms": latency,
            },
            "holistic_summary": {
                "identified_visual_sources": source_shares,
                "unrecognized_visual_duration_sec": round(unrecognized_visual_sec, 2),
                "unrecognized_visual_share_percent": round((unrecognized_visual_sec / duration) * 100, 1) if duration > 0 else 0.0,
                "identified_music_tracks": list(identified_music_tracks.values()),
                "is_mixed_source_edit": (len(source_shares) > 1) or (len(identified_music_tracks) > 1),
            },
            "shot_timeline": visual_segments,
            "audio_windows": audio_segments,
        }
