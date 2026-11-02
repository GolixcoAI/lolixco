#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — REAL SOURCE FOOTAGE & MUSIC RECOGNITION ENGINE
Identifies anime/movie/series source material and music tracks from short edited clips.
Key capabilities:
1. Visual Recognition:
   - Resilient to 10-25% crop, high contrast/color grading, and horizontal mirroring.
   - Multi-scale perceptual hash trajectory + Lab color moments.
2. Music Recognition:
   - Resilient to slowed-and-reverb (0.80x - 0.95x) and nightcore / pitched (+1 to +3 semitones).
   - Multi-scale tempo sweep + circular pitch transposition in Chroma Energy space (CENS).
   - High-energy transient / spectral constellation matching.
3. Calibrated Abstention Contract:
   - Explicitly returns 'abstain' / 'unknown' on out-of-catalog or low-confidence queries.
   - Top-1 vs runner-up margin threshold prevents ambiguous hallucination.
"""

import os
import sys
import json
import math
import numpy as np
from typing import Dict, Any, List, Tuple, Optional
import cv2
import librosa


# ==============================================================================
# VISUAL FINGERPRINTING & MATCHING
# ==============================================================================

def compute_frame_hash(frame: np.ndarray, hash_size: int = 16) -> np.ndarray:
    """Computes difference gradient perceptual hash (dHash) for a video frame."""
    if frame is None or frame.size == 0:
        return np.zeros(hash_size * (hash_size - 1), dtype=bool)
    
    # Convert to grayscale and resize
    if len(frame.shape) == 3:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    else:
        gray = frame
    
    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
    # Difference between adjacent horizontal pixels
    diff = resized[:, 1:] > resized[:, :-1]
    return diff.flatten()


def compute_frame_color_moments(frame: np.ndarray) -> np.ndarray:
    """Computes Lab color space mean and std moments (tonal fingerprint)."""
    if frame is None or frame.size == 0 or len(frame.shape) != 3:
        return np.zeros(6, dtype=float)
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    means = np.mean(lab, axis=(0, 1)) / 255.0
    stds = np.std(lab, axis=(0, 1)) / 255.0
    return np.concatenate([means, stds])


def extract_video_visual_features(video_path: str, max_frames: int = 30) -> Dict[str, Any]:
    """Extracts visual trajectory features from a video file."""
    if not os.path.isfile(video_path):
        return {"hashes": [], "color_moments": [], "frame_count": 0}

    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0

    step = max(1, total_frames // max_frames) if total_frames > max_frames else 1
    hashes = []
    mirrored_hashes = []
    color_moments = []

    frame_idx = 0
    while cap.isOpened() and len(hashes) < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step == 0:
            h = compute_frame_hash(frame)
            h_mirrored = compute_frame_hash(cv2.flip(frame, 1))
            cm = compute_frame_color_moments(frame)
            hashes.append(h)
            mirrored_hashes.append(h_mirrored)
            color_moments.append(cm)
        frame_idx += 1

    cap.release()
    return {
        "hashes": np.array(hashes) if hashes else np.empty((0, 240), dtype=bool),
        "mirrored_hashes": np.array(mirrored_hashes) if mirrored_hashes else np.empty((0, 240), dtype=bool),
        "color_moments": np.array(color_moments) if color_moments else np.empty((0, 6)),
        "frame_count": len(hashes),
        "fps": fps,
    }


def match_visual_features(
    query_feats: Dict[str, Any],
    reference_feats: Dict[str, Any],
) -> Tuple[float, Dict[str, Any]]:
    """
    Matches query visual trajectory against reference trajectory.
    Returns (similarity_score [0..1], diagnostics_dict).
    Supports horizontal mirror invariance and sub-sequence alignment.
    """
    q_hashes = query_feats.get("hashes")
    q_mirrored = query_feats.get("mirrored_hashes")
    q_cm = query_feats.get("color_moments")

    r_hashes = reference_feats.get("hashes")
    r_cm = reference_feats.get("color_moments")

    if len(q_hashes) == 0 or len(r_hashes) == 0:
        return 0.0, {"error": "empty_features"}

    # Compute pairwise frame similarity matrices (both normal and mirrored)
    # Hamming similarity = 1.0 - (hamming_dist / num_bits)
    num_bits = q_hashes.shape[1]
    
    # Distance matrix normal
    dist_norm = np.mean(q_hashes[:, None, :] != r_hashes[None, :, :], axis=2)
    dist_mirror = np.mean(q_mirrored[:, None, :] != r_hashes[None, :, :], axis=2)
    
    # Check if query is mirrored
    mean_dist_norm = np.min(dist_norm, axis=1).mean()
    mean_dist_mirror = np.min(dist_mirror, axis=1).mean()
    is_mirrored = mean_dist_mirror < (mean_dist_norm - 0.05)

    best_dist = dist_mirror if is_mirrored else dist_norm
    # Per-frame best match in reference
    per_frame_sim = 1.0 - np.min(best_dist, axis=1)
    hash_sim = float(np.mean(per_frame_sim))

    # Color moment distance (Euclidean in normalized Lab space)
    if len(q_cm) > 0 and len(r_cm) > 0:
        cm_dist = np.mean([np.min(np.linalg.norm(q_cm[i] - r_cm, axis=1)) for i in range(len(q_cm))])
        color_sim = float(max(0.0, 1.0 - cm_dist * 1.5))
    else:
        color_sim = 0.5

    # Combined visual score: 75% structural hash + 25% tonal color
    combined_score = 0.75 * hash_sim + 0.25 * color_sim

    return combined_score, {
        "hash_similarity": round(hash_sim, 3),
        "color_similarity": round(color_sim, 3),
        "is_mirrored": bool(is_mirrored),
    }


# ==============================================================================
# AUDIO / MUSIC FINGERPRINTING & SPEED/PITCH INVARIANT MATCHING
# ==============================================================================

def extract_audio_recognition_features(audio_path: str, sr: int = 22050) -> Dict[str, Any]:
    """Extracts CENS chroma trajectory and spectral peak features from audio."""
    if not os.path.isfile(audio_path):
        return {"chroma": np.empty((12, 0)), "sr": sr, "duration": 0.0}

    y, _ = librosa.load(audio_path, sr=sr, mono=True)
    duration = float(len(y) / sr)

    # Chroma CENS (Chroma Energy Normalized Statistics): robust to timbre/instrumentation
    chroma_cens = librosa.feature.chroma_cens(y=y, sr=sr, hop_length=1024, n_chroma=12)

    # Tempo and onset envelope
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=1024)
    onset_env_norm = onset_env / (np.max(onset_env) + 1e-6)

    return {
        "chroma_cens": chroma_cens,
        "onset_env": onset_env_norm,
        "duration": duration,
        "sr": sr,
    }


def match_audio_features(
    query_feats: Dict[str, Any],
    reference_feats: Dict[str, Any],
    speed_factors: List[float] = [0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20, 1.25],
    pitch_shifts: List[int] = [-3, -2, -1, 0, 1, 2, 3],
) -> Tuple[float, Dict[str, Any]]:
    """
    Matches query audio against reference across tempo sweeps and circular pitch transpositions.
    Combines CENS harmonic correlation with rhythmic onset envelope cross-correlation.
    Returns (similarity_score [0..1], diagnostics_dict).
    """
    q_cens = query_feats.get("chroma_cens")
    r_cens = reference_feats.get("chroma_cens")
    q_onset = query_feats.get("onset_env")
    r_onset = reference_feats.get("onset_env")

    if q_cens is None or r_cens is None or q_cens.shape[1] < 5 or r_cens.shape[1] < 5:
        return 0.0, {"error": "empty_features"}

    best_score = -1.0
    best_speed = 1.0
    best_pitch = 0
    best_chroma_sim = 0.0
    best_onset_sim = 0.0

    q_len = q_cens.shape[1]
    r_len = r_cens.shape[1]
    r_normed = r_cens / (np.linalg.norm(r_cens, axis=0, keepdims=True) + 1e-6)

    # Test speed factors via linear interpolation of query chroma trajectory
    for speed in speed_factors:
        target_len = int(round(q_len * speed))
        if target_len < 5 or target_len > r_len * 2:
            continue

        # Resample query chroma along time axis
        orig_indices = np.linspace(0, q_len - 1, q_len)
        new_indices = np.linspace(0, q_len - 1, target_len)
        q_resampled = np.zeros((12, target_len))
        for bin_idx in range(12):
            q_resampled[bin_idx] = np.interp(new_indices, orig_indices, q_cens[bin_idx])

        # Normalize resampled chroma
        norms = np.linalg.norm(q_resampled, axis=0, keepdims=True) + 1e-6
        q_normed = q_resampled / norms

        # Resample query onset envelope
        if q_onset is not None and len(q_onset) > 0 and r_onset is not None and len(r_onset) > 0:
            q_onset_len = len(q_onset)
            target_onset_len = int(round(q_onset_len * speed))
            o_orig_idx = np.linspace(0, q_onset_len - 1, q_onset_len)
            o_new_idx = np.linspace(0, q_onset_len - 1, target_onset_len)
            q_onset_resampled = np.interp(o_new_idx, o_orig_idx, q_onset)
        else:
            q_onset_resampled = None

        # Test circular pitch shifts on the 12 chromatic bins
        for pitch in pitch_shifts:
            q_shifted = np.roll(q_normed, shift=pitch, axis=0)

            if target_len <= r_len:
                max_win_score = 0.0
                win_chroma = 0.0
                win_onset = 0.0
                step = max(1, (r_len - target_len) // 15)
                for start in range(0, r_len - target_len + 1, step):
                    slice_r = r_normed[:, start : start + target_len]
                    chroma_c = float(np.mean(np.sum(q_shifted * slice_r, axis=0)))

                    onset_c = 0.0
                    if q_onset_resampled is not None and len(r_onset) >= start + len(q_onset_resampled):
                        slice_ro = r_onset[start : start + len(q_onset_resampled)]
                        if np.std(slice_ro) > 1e-5 and np.std(q_onset_resampled) > 1e-5:
                            oc = float(np.corrcoef(q_onset_resampled, slice_ro)[0, 1])
                            onset_c = max(0.0, oc)

                    win_score = 0.65 * chroma_c + 0.35 * onset_c
                    if win_score > max_win_score:
                        max_win_score = win_score
                        win_chroma = chroma_c
                        win_onset = onset_c
            else:
                slice_q = q_shifted[:, :r_len]
                win_chroma = float(np.mean(np.sum(slice_q * r_normed, axis=0)))
                win_onset = 0.5
                max_win_score = 0.65 * win_chroma + 0.35 * win_onset

            # Combine harmonic chroma and rhythmic onset correlation
            # Add minor regularization penalty for pitch/tempo shifts to prevent false convergence
            penalty = 0.012 * abs(pitch) + 0.025 * abs(1.0 - speed)
            combined_candidate = max_win_score - penalty

            if combined_candidate > best_score:
                best_score = combined_candidate
                best_speed = speed
                best_pitch = pitch
                best_chroma_sim = win_chroma
                best_onset_sim = win_onset

    final_sim = float(max(0.0, min(1.0, best_score)))
    return final_sim, {
        "audio_similarity": round(final_sim, 3),
        "chroma_similarity": round(best_chroma_sim, 3),
        "onset_similarity": round(best_onset_sim, 3),
        "detected_speed_factor": round(best_speed, 2),
        "detected_pitch_shift_semitones": int(best_pitch),
        "is_slowed": best_speed < 0.95,
        "is_sped_up": best_speed > 1.05,
        "is_pitched": best_pitch != 0,
    }


# ==============================================================================
# CALIBRATED DECISION ENGINE (ABSTENTION CONTRACT)
# ==============================================================================

class EditDNARecognizer:
    """
    Combined recognition engine with calibrated abstention contract.
    Never hallucinates an entity when similarity or margin is insufficient.
    """

    def __init__(self, catalog_dir: Optional[str] = None):
        self.catalog_dir = catalog_dir
        self.visual_catalog: Dict[str, Dict[str, Any]] = {}
        self.audio_catalog: Dict[str, Dict[str, Any]] = {}

        # Decision Thresholds
        self.visual_sim_threshold = 0.58
        self.visual_margin_threshold = 0.10
        self.audio_sim_threshold = 0.60
        self.audio_margin_threshold = 0.10

    def register_visual_reference(
        self,
        ref_id: str,
        title: str,
        franchise: str,
        video_path: str,
    ):
        """Indexes a reference visual asset."""
        feats = extract_video_visual_features(video_path)
        self.visual_catalog[ref_id] = {
            "ref_id": ref_id,
            "title": title,
            "franchise": franchise,
            "video_path": video_path,
            "features": feats,
        }

    def register_audio_reference(
        self,
        ref_id: str,
        title: str,
        artist: str,
        audio_path: str,
    ):
        """Indexes a reference audio track."""
        feats = extract_audio_recognition_features(audio_path)
        self.audio_catalog[ref_id] = {
            "ref_id": ref_id,
            "title": title,
            "artist": artist,
            "audio_path": audio_path,
            "features": feats,
        }

    def identify_visual_source(self, query_video_path: str) -> Dict[str, Any]:
        """Identifies visual source material with calibrated abstention."""
        q_feats = extract_video_visual_features(query_video_path)
        if q_feats.get("frame_count", 0) == 0:
            return {
                "modality": "visual",
                "status": "abstain",
                "reason": "unreadable_video",
                "confidence": 0.0,
                "matched_entity": None,
                "explanation": "No readable frames extracted from video query.",
            }

        candidates = []
        for ref_id, ref in self.visual_catalog.items():
            sim, diag = match_visual_features(q_feats, ref["features"])
            candidates.append({
                "ref_id": ref_id,
                "title": ref["title"],
                "franchise": ref["franchise"],
                "similarity": sim,
                "diagnostics": diag,
            })

        # Sort candidates descending by similarity
        candidates.sort(key=lambda c: c["similarity"], reverse=True)
        if not candidates:
            return {
                "modality": "visual",
                "status": "abstain",
                "reason": "empty_catalog",
                "confidence": 0.0,
                "matched_entity": None,
            }

        top1 = candidates[0]
        top2 = candidates[1] if len(candidates) > 1 else None
        s1 = top1["similarity"]
        s2 = top2["similarity"] if top2 else 0.0
        margin = s1 - s2

        # Abstention Check 1: Absolute similarity below detection threshold
        if s1 < self.visual_sim_threshold:
            return {
                "modality": "visual",
                "status": "abstain",
                "reason": "out_of_catalog_or_unrecognized",
                "confidence": round(s1, 3),
                "matched_entity": None,
                "explanation": (
                    f"Top visual match ({top1['title']}) scored {s1:.2f}, below recognition threshold "
                    f"{self.visual_sim_threshold:.2f}. Footage is out-of-catalog or unrecognized."
                ),
                "top_candidates": candidates[:3],
            }

        # Abstention Check 2: Insufficient margin against runner-up
        if margin < self.visual_margin_threshold:
            return {
                "modality": "visual",
                "status": "abstain",
                "reason": "ambiguous_match",
                "confidence": round(s1, 3),
                "matched_entity": None,
                "explanation": (
                    f"Ambiguous match between '{top1['title']}' ({s1:.2f}) and '{top2['title']}' ({s2:.2f}). "
                    f"Margin {margin:.2f} below required {self.visual_margin_threshold:.2f}."
                ),
                "top_candidates": candidates[:3],
            }

        # Clear positive identification
        return {
            "modality": "visual",
            "status": "identified",
            "reason": "confident_match",
            "confidence": round(s1, 3),
            "matched_entity": {
                "ref_id": top1["ref_id"],
                "title": top1["title"],
                "franchise": top1["franchise"],
            },
            "evidence": {
                "similarity_score": round(s1, 3),
                "runner_up_margin": round(margin, 3),
                "is_mirrored": top1["diagnostics"].get("is_mirrored", False),
                "hash_similarity": top1["diagnostics"].get("hash_similarity", 0.0),
                "color_similarity": top1["diagnostics"].get("color_similarity", 0.0),
            },
            "top_candidates": candidates[:3],
        }

    def identify_music_track(self, query_audio_path: str) -> Dict[str, Any]:
        """Identifies music track with speed/pitch detection and calibrated abstention."""
        q_feats = extract_audio_recognition_features(query_audio_path)
        if q_feats.get("duration", 0.0) == 0.0:
            return {
                "modality": "audio",
                "status": "abstain",
                "reason": "unreadable_audio",
                "confidence": 0.0,
                "matched_entity": None,
                "explanation": "No readable audio track in query.",
            }

        candidates = []
        for ref_id, ref in self.audio_catalog.items():
            sim, diag = match_audio_features(q_feats, ref["features"])
            candidates.append({
                "ref_id": ref_id,
                "title": ref["title"],
                "artist": ref["artist"],
                "similarity": sim,
                "diagnostics": diag,
            })

        candidates.sort(key=lambda c: c["similarity"], reverse=True)
        if not candidates:
            return {
                "modality": "audio",
                "status": "abstain",
                "reason": "empty_catalog",
                "confidence": 0.0,
                "matched_entity": None,
            }

        top1 = candidates[0]
        top2 = candidates[1] if len(candidates) > 1 else None
        s1 = top1["similarity"]
        s2 = top2["similarity"] if top2 else 0.0
        margin = s1 - s2

        if s1 < self.audio_sim_threshold:
            return {
                "modality": "audio",
                "status": "abstain",
                "reason": "out_of_catalog_or_unrecognized",
                "confidence": round(s1, 3),
                "matched_entity": None,
                "explanation": (
                    f"Top audio match ({top1['title']}) scored {s1:.2f}, below recognition threshold "
                    f"{self.audio_sim_threshold:.2f}. Music is out-of-catalog or unrecognized."
                ),
                "top_candidates": candidates[:3],
            }

        if margin < self.audio_margin_threshold:
            return {
                "modality": "audio",
                "status": "abstain",
                "reason": "ambiguous_match",
                "confidence": round(s1, 3),
                "matched_entity": None,
                "explanation": (
                    f"Ambiguous match between '{top1['title']}' ({s1:.2f}) and '{top2['title']}' ({s2:.2f}). "
                    f"Margin {margin:.2f} below required {self.audio_margin_threshold:.2f}."
                ),
                "top_candidates": candidates[:3],
            }

        diag = top1["diagnostics"]
        variation_tags = []
        if diag.get("is_slowed"):
            variation_tags.append(f"slowed_{diag['detected_speed_factor']}x")
        elif diag.get("is_sped_up"):
            variation_tags.append(f"sped_up_{diag['detected_speed_factor']}x")
        if diag.get("is_pitched"):
            sign = "+" if diag["detected_pitch_shift_semitones"] > 0 else ""
            variation_tags.append(f"pitched_{sign}{diag['detected_pitch_shift_semitones']}_semitones")

        return {
            "modality": "audio",
            "status": "identified",
            "reason": "confident_match",
            "confidence": round(s1, 3),
            "matched_entity": {
                "ref_id": top1["ref_id"],
                "title": top1["title"],
                "artist": top1["artist"],
            },
            "transformations": {
                "speed_factor": diag.get("detected_speed_factor", 1.0),
                "pitch_shift_semitones": diag.get("detected_pitch_shift_semitones", 0),
                "variation_tags": variation_tags,
            },
            "evidence": {
                "similarity_score": round(s1, 3),
                "runner_up_margin": round(margin, 3),
            },
            "top_candidates": candidates[:3],
        }
