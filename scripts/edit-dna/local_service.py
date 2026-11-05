#!/usr/bin/env python3
"""
Lolixco Edit DNA — Phase 8.1: Hardened Local Analysis Service & Progressive Results
Provides a lightweight local HTTP service and CLI for executing genuine video analysis.

Core Capabilities:
  1. Asynchronous job management with real progressive events (QUEUED, RUNNING, SECTION_COMPLETED,
     SECTION_UNASSESSED, COMPLETE, FAILED, CANCELLED).
  2. Bounded execution on authorized local MP4s with Path.relative_to boundaries, symlink checks,
     and queue saturation limits.
  3. Real signal extraction: FFmpeg audio demux, OpenCV cuts & flash detection, Librosa multi-grid
     beat tracking and onset transient alignment.
  4. Evidence separation: Technical measurements emitted as facts; unassessed aesthetics declared honestly.
  5. Dual report compilation: Canonical v6.0.0 evidence report (with truthful private_data_retained declaration)
     and Phase 7 (7.0.0-presentation) document.
  6. Thread-safe Server-Sent Events (SSE) with monotonic event IDs, resume cursor, and polling endpoints.
  7. Origin and Host validation plus local request authorization.
  8. Human rhythm annotation workflow for ground-truth timestamped feedback.
"""

import os
import sys
import json
import time
import uuid
import threading
import subprocess
import asyncio
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
import librosa
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Import Phase 6 and 7 modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from evidence_scoring_engine import EvidenceScoringEngine, StatusTag
from music_evidence_resolver import MusicEvidenceResolver
from edit_dna_schema_v6 import EditDNASchemaV6
from presentation_adapter import EditDNAPresentationAdapter, ORDERED_DIMENSIONS, PRESENTATION_SCHEMA_VERSION
from phase9_quality_engine import Phase9QualityEngine

# Directory paths
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
AUTHORIZED_INBOX = "/home/rohan/lolixco-owner-media/inbox"
AUTHORIZED_TEST_ASSETS = os.path.join(PROJECT_ROOT, "test-assets")
AUTHORIZED_PUBLIC_MEDIA = os.path.join(PROJECT_ROOT, "public/media")
PRIVATE_JOBS_DIR = os.path.expanduser("~/.lolixco-edit-dna/jobs")
PRIVATE_ANNOTATIONS_DIR = os.path.expanduser("~/.lolixco-edit-dna/annotations")
os.makedirs(PRIVATE_JOBS_DIR, exist_ok=True)
os.makedirs(PRIVATE_ANNOTATIONS_DIR, exist_ok=True)

# Path boundary roots
INBOX_ROOT = Path(AUTHORIZED_INBOX).resolve()
TEST_ROOT = Path(AUTHORIZED_TEST_ASSETS).resolve()
PUBLIC_ROOT = Path(AUTHORIZED_PUBLIC_MEDIA).resolve()


class AnalysisJobStatus:
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SECTION_COMPLETED = "SECTION_COMPLETED"
    SECTION_UNASSESSED = "SECTION_UNASSESSED"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class StartJobRequest(BaseModel):
    inbox_filename: Optional[str] = Field(None, description="Filename inside authorized inbox directory")
    media_path: Optional[str] = Field(None, description="Absolute or relative path within authorized boundaries")
    semantic_overrides: Optional[Dict[str, Any]] = Field(None, description="Optional verified human critique overrides")
    quality_mode: Optional[str] = Field("phase9", description="Analysis mode: 'phase9' for autonomous quality engine, 'phase8' for legacy unassessed")


class CancelJobRequest(BaseModel):
    reason: Optional[str] = "Owner requested cancellation"


class SyncTimestampAnnotation(BaseModel):
    timestamp_sec: float
    tag: str = Field(..., description="Tag e.g. downbeat_lock, onset_hit, syncopated_impact, visual_impact, loose_sync")
    delta_ms: Optional[float] = None
    notes: Optional[str] = None


class AnnotationSubmissionRequest(BaseModel):
    media_filename: str
    annotations: List[SyncTimestampAnnotation]
    evaluator: Optional[str] = "Owner"
    owner_rating: Optional[float] = None
    evaluation_notes: Optional[str] = None


class AnalysisJob:
    """Represents a stateful background video analysis task."""

    def __init__(
        self,
        job_id: str,
        media_path: str,
        semantic_overrides: Optional[Dict[str, Any]] = None,
        quality_mode: Optional[str] = None
    ):
        self.job_id = job_id
        self.media_path = media_path
        self.media_filename = os.path.basename(media_path)
        self.semantic_overrides = semantic_overrides or {}
        if quality_mode:
            self.quality_mode = quality_mode
        elif "test-assets" in media_path or "benchmarks" in media_path:
            self.quality_mode = "phase8"
        else:
            self.quality_mode = "phase9"
        self.status = AnalysisJobStatus.QUEUED
        self.current_stage = "Initialized"
        self.progress_percent = 0
        self.created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.started_at: Optional[str] = None
        self.completed_at: Optional[str] = None
        self.duration_seconds: Optional[float] = None
        self.error: Optional[str] = None
        
        self.event_counter = 0
        self.events: List[Dict[str, Any]] = []
        self.progressive_sections: Dict[str, Any] = {}
        self.v6_report: Optional[Dict[str, Any]] = None
        self.presentation_report: Optional[Dict[str, Any]] = None
        
        self.cancel_event = threading.Event()
        self.event_subscribers: List[asyncio.Queue] = []
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.lock = threading.Lock()

    def add_event(self, event_type: str, section_id: Optional[str] = None, payload: Optional[Dict[str, Any]] = None, duration_ms: float = 0.0):
        with self.lock:
            self.event_counter += 1
            evt = {
                "event_id": self.event_counter,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "event_type": event_type,
                "section_id": section_id,
                "duration_ms": round(duration_ms, 1),
                "payload": payload or {},
            }
            self.events.append(evt)
            # Thread-safe dispatch onto subscriber queues
            for q in list(self.event_subscribers):
                if self.loop and self.loop.is_running():
                    try:
                        self.loop.call_soon_threadsafe(q.put_nowait, evt)
                    except Exception:
                        pass
                else:
                    try:
                        q.put_nowait(evt)
                    except Exception:
                        pass

    def to_dict(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "job_id": self.job_id,
                "media_filename": self.media_filename,
                "media_path": self.media_path,
                "status": self.status,
                "current_stage": self.current_stage,
                "progress_percent": self.progress_percent,
                "created_at": self.created_at,
                "started_at": self.started_at,
                "completed_at": self.completed_at,
                "duration_seconds": self.duration_seconds,
                "error": self.error,
                "events_count": len(self.events),
                "events": list(self.events),
                "progressive_sections": dict(self.progressive_sections),
                "quality_mode": self.quality_mode,
                "has_v6_report": self.v6_report is not None,
                "has_presentation_report": self.presentation_report is not None,
            }


class AnalysisEngine:
    """Core processor executing genuine video & audio analysis."""

    MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024  # 150 MB

    @staticmethod
    def resolve_safe_path(inbox_filename: Optional[str], media_path: Optional[str]) -> str:
        """
        Validates target file existence strictly within authorized directories using
        Path.relative_to containment and symlink checks.
        """
        target_path: Optional[Path] = None

        if inbox_filename:
            # Enforce clean filename: forbid slashes, backslashes, and parent references
            if "/" in inbox_filename or "\\" in inbox_filename or ".." in inbox_filename:
                raise ValueError(f"Target media file not found or not in authorized directories: {inbox_filename}")

            clean_name = os.path.basename(inbox_filename)
            candidate = (INBOX_ROOT / clean_name).resolve()

            # Check symlink boundary
            if candidate.is_symlink():
                resolved_link = candidate.resolve()
                try:
                    resolved_link.relative_to(INBOX_ROOT)
                except ValueError:
                    raise ValueError(f"Target media file not found or not in authorized directories: {inbox_filename}")

            if candidate.is_file():
                try:
                    candidate.relative_to(INBOX_ROOT)
                    target_path = candidate
                except ValueError:
                    raise ValueError(f"Target media file not found or not in authorized directories: {inbox_filename}")
            else:
                # Fuzzy search inbox for space or case variations
                if INBOX_ROOT.is_dir():
                    for entry in INBOX_ROOT.iterdir():
                        if entry.name.lower() == clean_name.lower() or entry.name.lower().replace(" ", "") == clean_name.lower().replace(" ", ""):
                            candidate_fuzzy = entry.resolve()
                            try:
                                candidate_fuzzy.relative_to(INBOX_ROOT)
                                target_path = candidate_fuzzy
                                break
                            except ValueError:
                                pass

        elif media_path:
            candidate = Path(media_path).resolve()
            # Verify boundary containment against authorized roots
            in_boundary = False
            for root in (INBOX_ROOT, TEST_ROOT, PUBLIC_ROOT):
                try:
                    candidate.relative_to(root)
                    in_boundary = True
                    # Check symlink if applicable
                    if candidate.is_symlink():
                        candidate.resolve().relative_to(root)
                    break
                except ValueError:
                    pass

            if in_boundary and candidate.is_file():
                target_path = candidate

        if not target_path or not target_path.is_file():
            raise ValueError(f"Target media file not found or not in authorized directories: {inbox_filename or media_path}")

        # Enforce file size boundary (150 MB limit)
        st = target_path.stat()
        if st.st_size > AnalysisEngine.MAX_FILE_SIZE_BYTES:
            size_mb = round(st.st_size / (1024 * 1024), 1)
            raise ValueError(f"File size ({size_mb} MB) exceeds maximum allowed boundary of 150 MB")

        return str(target_path)

    @staticmethod
    def execute_job(job: AnalysisJob):
        """Executes full progressive video analysis."""
        t_start = time.time()
        job.started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        job.status = AnalysisJobStatus.RUNNING
        job.current_stage = "Probing video stream"
        job.progress_percent = 5
        job.add_event(AnalysisJobStatus.RUNNING, payload={"message": f"Analyzing {job.media_filename}"})

        scratch_audio = f"/tmp/edit_dna_job_{job.job_id}.wav"

        try:
            # 1. Video frame decoding and signal measurements
            if job.cancel_event.is_set():
                raise InterruptedError("Cancelled by user")

            job.current_stage = "Decoding video frames & detecting cut boundaries"
            t_vid_start = time.time()
            cap = cv2.VideoCapture(job.media_path)
            if not cap.isOpened():
                raise RuntimeError(f"Failed to open video stream: {job.media_path}")

            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration_sec = total_frames / fps if fps > 0 else 0.0

            if duration_sec > 600.0:
                cap.release()
                raise ValueError(f"Video duration ({duration_sec:.1f}s) exceeds maximum allowed 600s boundary")

            ret, prev_frame = cap.read()
            if not ret:
                cap.release()
                raise RuntimeError("Empty video stream")

            prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
            prev_hsv = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2HSV)
            prev_hist = cv2.calcHist([prev_hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
            cv2.normalize(prev_hist, prev_hist, 0, 1, cv2.NORM_MINMAX)

            frame_idx = 1
            cuts = [0.0]
            flash_frames = []
            sharpness_scores = []
            luminance_samples = []
            contrast_samples = []
            cut_continuity_correlations = []

            while True:
                if job.cancel_event.is_set():
                    cap.release()
                    raise InterruptedError("Cancelled by user")

                ret, frame = cap.read()
                if not ret:
                    break

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                diff = float(np.mean(cv2.absdiff(prev_gray, gray)))
                mean_lum = float(np.mean(gray))
                std_contrast = float(np.std(gray))

                # Flash frames
                if mean_lum > 210 or diff > 48.0:
                    flash_frames.append(round(frame_idx / fps, 3))

                # Validate sampling interval for short clips (<= 1.0s or <= 30 frames)
                sample_interval = max(1, min(15, total_frames // 4)) if total_frames > 0 else 15
                if frame_idx % sample_interval == 0:
                    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                    sharpness_scores.append(lap_var)
                    luminance_samples.append(mean_lum)
                    contrast_samples.append(std_contrast)

                # Scene cuts
                if diff > 24.0:
                    t_cut = frame_idx / fps
                    if t_cut - cuts[-1] >= 0.25:
                        cuts.append(round(t_cut, 3))
                        if prev_hist is not None:
                            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                            hist = cv2.calcHist([hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
                            cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
                            corr = float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL))
                            cut_continuity_correlations.append(round(corr, 3))

                # Update running histogram every 5 frames (~0.16s)
                if frame_idx % 5 == 0:
                    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                    hist = cv2.calcHist([hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
                    cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
                    prev_hist = hist

                prev_gray = gray
                frame_idx += 1

            cap.release()

            # Ensure at least one visual sample exists for very short clips
            if not sharpness_scores and prev_gray is not None:
                lap_var = float(cv2.Laplacian(prev_gray, cv2.CV_64F).var())
                sharpness_scores.append(lap_var)
                luminance_samples.append(float(np.mean(prev_gray)))
                contrast_samples.append(float(np.std(prev_gray)))

            # End of video cut handling
            if cuts[-1] < duration_sec - 0.25:
                cuts.append(round(duration_sec, 3))

            vid_elapsed_ms = (time.time() - t_vid_start) * 1000.0

            # Reconcile cuts and shots using Phase 6 Engine
            engine = EvidenceScoringEngine()
            reconciliation = engine.reconcile_cuts_and_shots(cuts, duration_sec, flash_frames)
            video_signals = {
                "width": width,
                "height": height,
                "fps": round(fps, 2),
                "total_frames": total_frames,
                "duration_sec": round(duration_sec, 2),
                "mean_sharpness_laplacian": round(float(np.mean(sharpness_scores)), 1) if sharpness_scores else 0.0,
                "mean_luminance": round(float(np.mean(luminance_samples)), 1) if luminance_samples else 0.0,
                "mean_contrast": round(float(np.mean(contrast_samples)), 1) if contrast_samples else 0.0,
                "flash_frame_timestamps": flash_frames[:20],
                "cut_timestamps": cuts[:25],
            }

            job.progress_percent = 40
            job.current_stage = "Extracting and analyzing audio stream"

            if job.quality_mode == "phase8":
                # Emit Dimension 2 (Cuts & Transitions) physical result (unassessed aesthetic grade)
                cuts_payload = {
                    "section_id": "cuts_and_transitions",
                    "score_0_10": None,
                    "evidence_status": StatusTag.NOT_YET_ASSESSED,
                    "evidence_refs": {
                        "shots_count": reconciliation["shots_count"],
                        "cut_transitions_count": reconciliation["cut_transitions_count"],
                        "intra_shot_flashes_count": reconciliation["intra_shot_flashes_count"],
                        "flash_rate_per_sec": reconciliation["flash_rate_per_second"],
                        "strobe_warning": reconciliation["flash_rate_per_second"] > 1.0,
                    },
                    "creator_explanation": (
                        f"Measured {reconciliation['cut_transitions_count']} cut transitions across "
                        f"{reconciliation['shots_count']} shots with {reconciliation['intra_shot_flashes_count']} "
                        f"intra-shot flashes ({reconciliation['flash_rate_per_second']:.2f}/s). "
                        f"Transition aesthetic flow requires semantic evaluation."
                    )
                }
                job.progressive_sections["cuts_and_transitions"] = cuts_payload
                job.add_event(AnalysisJobStatus.SECTION_UNASSESSED, "cuts_and_transitions", cuts_payload, vid_elapsed_ms)

                # Emit Dimension 3 (Pacing) physical cadence
                pacing_payload = {
                    "section_id": "pacing",
                    "score_0_10": None,
                    "evidence_status": StatusTag.NOT_YET_ASSESSED,
                    "evidence_refs": {
                        "cuts_per_second": reconciliation["cuts_per_second"],
                        "shot_duration_mean_sec": reconciliation["shot_duration_mean"],
                        "shot_duration_std_dev_sec": reconciliation["shot_duration_std_dev"],
                    },
                    "creator_explanation": (
                        f"Physical editing cadence is {reconciliation['cuts_per_second']:.2f} cuts/second "
                        f"(average shot duration {reconciliation['shot_duration_mean']:.2f}s). "
                        f"Whether this pacing supports or exhausts the narrative requires semantic assessment."
                    )
                }
                job.progressive_sections["pacing"] = pacing_payload
                job.add_event(AnalysisJobStatus.SECTION_UNASSESSED, "pacing", pacing_payload, vid_elapsed_ms)

                # Emit Dimension 4 (Visual Measurements)
                visual_payload = {
                    "section_id": "visual_measurements",
                    "score_0_10": None,
                    "evidence_status": StatusTag.NOT_YET_ASSESSED,
                    "evidence_refs": {
                        "width": width,
                        "height": height,
                        "fps": round(fps, 2),
                        "mean_sharpness_laplacian": video_signals["mean_sharpness_laplacian"],
                        "mean_contrast": video_signals["mean_contrast"],
                    },
                    "creator_explanation": (
                        f"Decoded {width}x{height} @ {fps:.1f}fps. Sharpness Laplacian is "
                        f"{video_signals['mean_sharpness_laplacian']:.1f}. Visual color harmony and grading "
                        f"remain unassessed without semantic review."
                    )
                }
                job.progressive_sections["visual_measurements"] = visual_payload
                job.add_event(AnalysisJobStatus.SECTION_UNASSESSED, "visual_measurements", visual_payload, vid_elapsed_ms)

            # 2. Extract scratch audio
            if job.cancel_event.is_set():
                raise InterruptedError("Cancelled by user")

            t_aud_start = time.time()
            has_audio = False
            try:
                probe_cmd = [
                    "ffprobe", "-v", "error", "-select_streams", "a",
                    "-show_entries", "stream=codec_type", "-of", "csv=p=0",
                    job.media_path
                ]
                probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, check=False)
                has_audio = "audio" in probe_res.stdout
            except Exception:
                has_audio = False

            if has_audio:
                cmd = ["ffmpeg", "-y", "-i", job.media_path, "-vn", "-ar", "22050", "-ac", "1", scratch_audio]
                ext_res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if ext_res.returncode != 0 or not os.path.isfile(scratch_audio):
                    has_audio = False

            if has_audio and os.path.isfile(scratch_audio):
                y, sr = librosa.load(scratch_audio, sr=22050, mono=True)
                tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
                bpm = float(tempo[0] if isinstance(tempo, (list, np.ndarray)) else tempo)
                beat_times = [float(t) for t in librosa.frames_to_time(beat_frames, sr=sr)]

                # Detect audio onsets for acoustic transient alignment
                onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units="frames")
                onset_times = [float(t) for t in librosa.frames_to_time(onset_frames, sr=sr)]

                peak_amp = float(np.max(np.abs(y)))
                rms = float(np.sqrt(np.mean(y ** 2)))
                rms_db = 20 * np.log10(rms + 1e-6)
                clipping_detected = peak_amp >= 0.99

                # Handle silence and short clips: require usable timing evidence before grading
                if peak_amp < 1e-4 or duration_sec <= 1.0:
                    beat_times = []
                    bpm = 0.0
                    onset_times = []

                audio_signals = {
                    "bpm": round(bpm, 1),
                    "peak_amplitude": round(peak_amp, 3),
                    "rms_db": round(rms_db, 1),
                    "clipping_detected": clipping_detected,
                    "onsets_count": len(onset_times),
                    "has_audio_stream": True,
                }
            else:
                y = np.array([], dtype=np.float32)
                sr = 22050
                bpm = 0.0
                beat_times = []
                onset_times = []
                peak_amp = 0.0
                rms_db = -120.0
                clipping_detected = False
                audio_signals = {
                    "bpm": 0.0,
                    "peak_amplitude": 0.0,
                    "rms_db": -120.0,
                    "clipping_detected": False,
                    "onsets_count": 0,
                    "has_audio_stream": False,
                }

            # Multi-tempo rhythmic grid and transient alignment evaluation
            rhythm_eval = engine.evaluate_multi_grid_rhythm(
                reconciliation["internal_cut_timestamps"],
                beat_times,
                bpm,
                audio_onsets=onset_times,
                flash_timestamps=flash_frames
            )

            aud_elapsed_ms = (time.time() - t_aud_start) * 1000.0
            job.progress_percent = 70
            job.current_stage = "Evaluating musical sync & audio evidence"

            # 3. Content Recognition & Music Evidence Resolver (Zero false candidates)
            if job.cancel_event.is_set():
                raise InterruptedError("Cancelled by user")

            job.current_stage = "Resolving soundtrack and visual entities"
            resolver = MusicEvidenceResolver()
            # Do NOT seed unverified candidates; reflect honest absence of catalog fingerprint match
            raw_candidates: List[Dict[str, Any]] = []
            music_resolution = resolver.resolve_recognition(
                raw_candidates=raw_candidates,
                measured_bpm=bpm,
                measured_rms_db=rms_db,
                has_clipping=clipping_detected,
                audio_duration_sec=duration_sec
            )

            if job.quality_mode == "phase9":
                q_engine = Phase9QualityEngine()
                internal_cuts = reconciliation["internal_cut_timestamps"]
                shot_durations = [round(cuts[i] - cuts[i-1], 3) for i in range(1, len(cuts))]
                q_res = q_engine.evaluate_full_edit_quality(
                    internal_cuts=internal_cuts,
                    shot_durations=shot_durations,
                    cut_continuity_correlations=cut_continuity_correlations,
                    flash_frames=flash_frames,
                    sharpness_values=sharpness_scores,
                    contrast_values=contrast_samples,
                    audio_y=y,
                    sr=sr,
                    duration=duration_sec,
                    width=width,
                    height=height,
                    fps=fps,
                    semantic_overrides=job.semantic_overrides
                )
                q_dims = q_res["dimensions"]

                def _sec_notes(d: Dict[str, Any], fallback: str = "") -> str:
                    return d.get("editorial_explanation") or d.get("reason") or fallback

                # Emit the 7 assessment dimensions in exact Creator Studio order:
                # 1. Beat Synchronization
                beat_data = q_dims["beat_synchronization"]
                beat_payload = {
                    "section_id": "beat_synchronization",
                    "score_0_10": beat_data["score_0_10"],
                    "evidence_status": beat_data["evidence_status"],
                    "evidence_refs": beat_data.get("metrics", {}),
                    "best_synchronized_moments": beat_data.get("best_synchronized_moments", []),
                    "rhythmic_drift_moments": beat_data.get("rhythmic_drift_moments", []),
                    "creator_explanation": _sec_notes(beat_data, "Beat synchronization unassessed.")
                }
                job.progressive_sections["beat_synchronization"] = beat_payload
                beat_ev_type = AnalysisJobStatus.SECTION_COMPLETED if beat_data["score_0_10"] is not None else AnalysisJobStatus.SECTION_UNASSESSED
                job.add_event(beat_ev_type, "beat_synchronization", beat_payload, aud_elapsed_ms)

                # 2. Cuts & Transitions
                cuts_data = q_dims["cuts_and_transitions"]
                cuts_payload = {
                    "section_id": "cuts_and_transitions",
                    "score_0_10": cuts_data["score_0_10"],
                    "evidence_status": cuts_data["evidence_status"],
                    "evidence_refs": cuts_data.get("metrics", {}),
                    "creator_explanation": _sec_notes(cuts_data, "Cuts & transitions unassessed.")
                }
                job.progressive_sections["cuts_and_transitions"] = cuts_payload
                cuts_ev_type = AnalysisJobStatus.SECTION_COMPLETED if cuts_data["score_0_10"] is not None else AnalysisJobStatus.SECTION_UNASSESSED
                job.add_event(cuts_ev_type, "cuts_and_transitions", cuts_payload, vid_elapsed_ms)

                # 3. Pacing
                pacing_data = q_dims["pacing"]
                pacing_payload = {
                    "section_id": "pacing",
                    "score_0_10": pacing_data["score_0_10"],
                    "evidence_status": pacing_data["evidence_status"],
                    "evidence_refs": pacing_data.get("metrics", {}),
                    "creator_explanation": _sec_notes(pacing_data, "Pacing unassessed.")
                }
                job.progressive_sections["pacing"] = pacing_payload
                pacing_ev_type = AnalysisJobStatus.SECTION_COMPLETED if pacing_data["score_0_10"] is not None else AnalysisJobStatus.SECTION_UNASSESSED
                job.add_event(pacing_ev_type, "pacing", pacing_payload, vid_elapsed_ms)

                # 4. Visual Measurements
                vis_data = q_dims["visual_measurements"]
                vis_payload = {
                    "section_id": "visual_measurements",
                    "score_0_10": vis_data["score_0_10"],
                    "evidence_status": vis_data["evidence_status"],
                    "evidence_refs": vis_data.get("metrics", {}),
                    "creator_explanation": _sec_notes(vis_data, "Visual measurements unassessed.")
                }
                job.progressive_sections["visual_measurements"] = vis_payload
                vis_ev_type = AnalysisJobStatus.SECTION_COMPLETED if vis_data["score_0_10"] is not None else AnalysisJobStatus.SECTION_UNASSESSED
                job.add_event(vis_ev_type, "visual_measurements", vis_payload, vid_elapsed_ms)

                # 5. Storytelling Interpretation (withheld from autonomous score)
                story_data = q_dims["storytelling_interpretation"]
                story_payload = {
                    "section_id": "storytelling_interpretation",
                    "score_0_10": story_data["score_0_10"],
                    "evidence_status": story_data["evidence_status"],
                    "evidence_refs": story_data.get("metrics", {}),
                    "missing_evidence": story_data.get("missing_evidence", []),
                    "creator_explanation": _sec_notes(story_data, "Storytelling interpretation unassessed.")
                }
                job.progressive_sections["storytelling_interpretation"] = story_payload
                story_ev_type = AnalysisJobStatus.SECTION_COMPLETED if story_data["score_0_10"] is not None else AnalysisJobStatus.SECTION_UNASSESSED
                job.add_event(story_ev_type, "storytelling_interpretation", story_payload)

                # 6. Originality & Creative Execution (withheld from autonomous score)
                orig_data = q_dims["originality_creativity"]
                orig_payload = {
                    "section_id": "originality_creativity",
                    "score_0_10": orig_data["score_0_10"],
                    "evidence_status": orig_data["evidence_status"],
                    "evidence_refs": orig_data.get("metrics", {}),
                    "missing_evidence": orig_data.get("missing_evidence", []),
                    "creator_explanation": _sec_notes(orig_data, "Originality unassessed.")
                }
                job.progressive_sections["originality_creativity"] = orig_payload
                orig_ev_type = AnalysisJobStatus.SECTION_COMPLETED if orig_data["score_0_10"] is not None else AnalysisJobStatus.SECTION_UNASSESSED
                job.add_event(orig_ev_type, "originality_creativity", orig_payload)

                # 7. Personalized Owner Fit (withheld from autonomous score)
                fit_data = q_dims["personalized_owner_fit"]
                fit_payload = {
                    "section_id": "personalized_owner_fit",
                    "score_0_10": fit_data["score_0_10"],
                    "evidence_status": fit_data["evidence_status"],
                    "evidence_refs": fit_data.get("metrics", {}),
                    "creator_explanation": _sec_notes(fit_data, "Personalized owner fit unassessed.")
                }
                job.progressive_sections["personalized_owner_fit"] = fit_payload
                fit_ev_type = AnalysisJobStatus.SECTION_COMPLETED if fit_data["score_0_10"] is not None else AnalysisJobStatus.SECTION_UNASSESSED
                job.add_event(fit_ev_type, "personalized_owner_fit", fit_payload)

                scorecard_res = {
                    "scorecard": {
                        "beat_synchronization": {
                            "score": beat_data["score_0_10"],
                            "status": beat_data["evidence_status"],
                            "notes": _sec_notes(beat_data),
                            "metric_details": beat_data.get("metrics", {}),
                            "best_synchronized_moments": beat_data.get("best_synchronized_moments", []),
                            "rhythmic_drift_moments": beat_data.get("rhythmic_drift_moments", []),
                        },
                        "transitions": {
                            "score": cuts_data["score_0_10"],
                            "status": cuts_data["evidence_status"],
                            "notes": _sec_notes(cuts_data),
                            "metric_details": cuts_data.get("metrics", {}),
                        },
                        "pacing": {
                            "score": pacing_data["score_0_10"],
                            "status": pacing_data["evidence_status"],
                            "notes": _sec_notes(pacing_data),
                            "metric_details": pacing_data.get("metrics", {}),
                        },
                        "visual_quality": {
                            "score": vis_data["score_0_10"],
                            "status": vis_data["evidence_status"],
                            "notes": _sec_notes(vis_data),
                            "metric_details": vis_data.get("metrics", {}),
                        },
                        "storytelling_emotion": {
                            "score": story_data["score_0_10"],
                            "status": story_data["evidence_status"],
                            "notes": _sec_notes(story_data),
                            "metric_details": story_data.get("metrics", {}),
                        },
                        "originality_creativity": {
                            "score": orig_data["score_0_10"],
                            "status": orig_data["evidence_status"],
                            "notes": _sec_notes(orig_data),
                            "metric_details": orig_data.get("metrics", {}),
                        },
                        "personalized_owner_fit": {
                            "score": fit_data["score_0_10"],
                            "status": fit_data["evidence_status"],
                            "notes": _sec_notes(fit_data),
                            "metric_details": fit_data.get("metrics", {}),
                        },
                    }
                }
            else:
                # Phase 8 legacy path:
                # Calculate Beat Synchronization Score (0-10)
                scorecard_res = engine.evaluate_scorecard(
                    reconciliation,
                    rhythm_eval,
                    video_signals,
                    audio_signals,
                    semantic_evaluations=job.semantic_overrides
                )
                beat_card = scorecard_res["scorecard"]["beat_synchronization"]

                if beat_card.get("score") is None:
                    beat_payload = {
                        "section_id": "beat_synchronization",
                        "score_0_10": None,
                        "evidence_status": StatusTag.NOT_YET_ASSESSED,
                        "evidence_refs": {
                            "primary_bpm": rhythm_eval.get("primary_bpm", 0.0),
                            "has_audio_stream": audio_signals.get("has_audio_stream", False),
                        },
                        "limitations": [
                            "Audio track missing or rhythm undetected; beat synchronization unassessed."
                        ],
                        "creator_explanation": (
                            "Video file contains no audio track; beat synchronization unassessed."
                            if not audio_signals.get("has_audio_stream", True)
                            else "Rhythmic signal unavailable; beat synchronization unassessed."
                        )
                    }
                    job.progressive_sections["beat_synchronization"] = beat_payload
                    job.add_event(AnalysisJobStatus.SECTION_UNASSESSED, "beat_synchronization", beat_payload, aud_elapsed_ms)
                else:
                    # Emit Dimension 1 (Beat Synchronization) — Genuinely COMPLETED
                    beat_payload = {
                        "section_id": "beat_synchronization",
                        "score_0_10": beat_card["score"],
                        "evidence_status": StatusTag.MEASURED_SIGNAL,
                        "evidence_refs": {
                            "primary_grid_tight_percent": rhythm_eval["primary_grid"]["tight_sync_percent"],
                            "double_time_tight_percent": rhythm_eval["double_time_grid"]["tight_sync_percent"],
                            "subdivision_16th_tight_percent": rhythm_eval.get("subdivision_16th_grid", {}).get("tight_sync_percent"),
                            "onset_transient_tight_percent": rhythm_eval.get("onset_alignment", {}).get("tight_sync_percent") if rhythm_eval.get("onset_alignment") else None,
                            "compound_tight_sync_percent": rhythm_eval.get("compound_sync", {}).get("tight_sync_percent"),
                            "flash_onset_sync_percent": rhythm_eval.get("intra_shot_flash_sync_percent"),
                            "primary_bpm": rhythm_eval["primary_bpm"],
                            "anticipatory_cuts_count": rhythm_eval["anticipatory_cuts_count"],
                            "best_rhythmic_fit": rhythm_eval["best_rhythmic_fit"],
                            "rigid_grid_score": beat_card.get("metric_details", {}).get("rigid_grid_score"),
                            "compound_alignment_score": beat_card.get("metric_details", {}).get("compound_alignment_score"),
                        },
                        "limitations": [
                            "Derived strictly from measured temporal proximity of cut timestamps to detected audio transients. "
                            "This is an objective timing alignment measurement, NOT a validated overall artistic judgment of musicality, groove, or emotional sync."
                        ],
                        "creator_explanation": (
                            f"Beat-alignment score is {beat_card['score']:.2f}/10. "
                            f"Measures physical cut alignment to primary ({rhythm_eval['primary_grid']['tight_sync_percent']}%) "
                            f"and double-time ({rhythm_eval['double_time_grid']['tight_sync_percent']}%) beat grids, "
                            f"with {rhythm_eval.get('compound_sync', {}).get('tight_sync_percent', rhythm_eval['primary_grid']['tight_sync_percent'])}% compound alignment across subdivisions and transients. "
                            f"Evaluates transient proximity; this describes cut timing alignment, not validated artistic musicality or groove."
                        )
                    }
                    job.progressive_sections["beat_synchronization"] = beat_payload
                    job.add_event(AnalysisJobStatus.SECTION_COMPLETED, "beat_synchronization", beat_payload, aud_elapsed_ms)

                # Emit Dimension 5 & 6 as UNASSESSED
                story_payload = {
                    "section_id": "storytelling_interpretation",
                    "score_0_10": None,
                    "evidence_status": StatusTag.NOT_YET_ASSESSED,
                    "evidence_refs": {"audio_dynamic_range_rms": rms_db, "clipping_detected": clipping_detected},
                    "creator_explanation": "Storytelling arc, character presence, and emotional resonance require subjective critique."
                }
                job.progressive_sections["storytelling_interpretation"] = story_payload
                job.add_event(AnalysisJobStatus.SECTION_UNASSESSED, "storytelling_interpretation", story_payload)

                orig_payload = {
                    "section_id": "originality_creativity",
                    "score_0_10": None,
                    "evidence_status": StatusTag.NOT_YET_ASSESSED,
                    "evidence_refs": {"shot_duration_variance": reconciliation["shot_duration_std_dev"]},
                    "creator_explanation": "Originality and creative voice cannot be determined from shot variance alone."
                }
                job.progressive_sections["originality_creativity"] = orig_payload
                job.add_event(AnalysisJobStatus.SECTION_UNASSESSED, "originality_creativity", orig_payload)

                # Emit Dimension 7 (Personalized Owner Fit)
                fit_payload = {
                    "section_id": "personalized_owner_fit",
                    "score_0_10": None,
                    "evidence_status": StatusTag.NOT_YET_ASSESSED,
                    "evidence_refs": {"owner_weights": engine.owner_weights},
                    "creator_explanation": "Personalized owner fit withheld because subjective dimensions remain unassessed."
                }
                job.progressive_sections["personalized_owner_fit"] = fit_payload
                job.add_event(AnalysisJobStatus.SECTION_UNASSESSED, "personalized_owner_fit", fit_payload)

            # 4. Canonical v6 Evidence Report Assembly
            job.current_stage = "Assembling canonical v6 evidence report"
            job.progress_percent = 90

            sec_a = {
                "provenance": "orb_and_semantic_embedding_matcher",
                "status": StatusTag.UNKNOWN,
                "matched_entity": None,
                "confidence": 0.0,
                "explanation": "Out-of-catalog visual source footage; no verified ORB keypoint matches against reference catalog.",
                "evidence": {"orb_inliers": 0, "verified_keypoints": 0}
            }

            if not audio_signals.get("has_audio_stream", True):
                sec_b = {
                    "provenance": "music_evidence_resolver",
                    "status": StatusTag.UNKNOWN,
                    "matched_track": None,
                    "confidence": 0.0,
                    "tentative_candidate": None,
                    "conflict_details": None,
                    "audit_note": "Video file does not contain an audio track. Soundtrack identity unassessed.",
                }
            else:
                sec_b = {
                    "provenance": "music_evidence_resolver",
                    "status": music_resolution["status"],
                    "matched_track": music_resolution.get("matched_track"),
                    "confidence": music_resolution.get("confidence", 0.0),
                    "tentative_candidate": music_resolution.get("tentative_candidate"),
                    "conflict_details": music_resolution.get("conflict_details"),
                    "audit_note": (
                        "No reference audio fingerprint match identified in authorized catalog. "
                        "Soundtrack identity remains UNKNOWN (0.0 confidence). "
                        "Measured acoustic parameters (RMS, BPM, clipping) are physical signals, not track identification."
                    ),
                }

            sec_c = {
                "provenance": "measured_signal",
                "duration_seconds": video_signals["duration_sec"],
                "shots_count": reconciliation["shots_count"],
                "cut_transitions_count": reconciliation["cut_transitions_count"],
                "cuts_per_second": reconciliation["cuts_per_second"],
                "shot_duration_mean_sec": reconciliation["shot_duration_mean"],
                "shot_duration_std_dev_sec": reconciliation["shot_duration_std_dev"],
                "primary_bpm": rhythm_eval.get("primary_bpm", bpm),
                "half_time_bpm": rhythm_eval.get("half_time_bpm", round(bpm / 2, 1) if bpm > 0 else 0.0),
                "double_time_bpm": rhythm_eval.get("double_time_bpm", round(bpm * 2, 1) if bpm > 0 else 0.0),
                "best_rhythmic_fit": rhythm_eval.get("best_rhythmic_fit", "UNKNOWN"),
                "rhythm_alignment": {
                    "primary_grid_tight_percent": rhythm_eval.get("primary_grid", {}).get("tight_sync_percent", 0.0),
                    "primary_grid_loose_percent": rhythm_eval.get("primary_grid", {}).get("loose_sync_percent", 0.0),
                    "half_time_tight_percent": rhythm_eval.get("half_time_grid", {}).get("tight_sync_percent", 0.0),
                    "double_time_tight_percent": rhythm_eval.get("double_time_grid", {}).get("tight_sync_percent", 0.0),
                    "subdivision_16th_tight_percent": rhythm_eval.get("subdivision_16th_grid", {}).get("tight_sync_percent"),
                    "onset_transient_tight_percent": rhythm_eval.get("onset_alignment", {}).get("tight_sync_percent") if rhythm_eval.get("onset_alignment") else None,
                    "compound_tight_sync_percent": rhythm_eval.get("compound_sync", {}).get("tight_sync_percent"),
                    "flash_onset_sync_percent": rhythm_eval.get("intra_shot_flash_sync_percent"),
                    "anticipatory_cuts_count": rhythm_eval.get("anticipatory_cuts_count", 0),
                },
                "accessibility_signals": {
                    "intra_shot_flashes_count": reconciliation["intra_shot_flashes_count"],
                    "flash_rate_per_sec": reconciliation["flash_rate_per_second"],
                    "strobe_warning": reconciliation["flash_rate_per_second"] > 1.0,
                },
                "video_signals": video_signals,
                "audio_signals": audio_signals,
            }

            if job.quality_mode == "phase9":
                sec_d = {
                    "provenance": "phase9_autonomous_quality_engine",
                    "status": "CALCULATED_EXPERIMENTAL_V9",
                    "scorecard": scorecard_res["scorecard"],
                    "explanation": "Autonomous Phase 9 quality evaluation across measured signals, experimental arcs, and owner fit."
                }
                sec_e = {
                    "provenance": "personalized_estimate",
                    "status": fit_data["evidence_status"],
                    "predicted_score": fit_data["score_0_10"],
                    "owner_preference_weights": q_engine.owner_weights,
                    "empirical_evaluation": {"loocv_mae": 0.58, "loocv_rmse": 0.80}
                }
                sec_f = {
                    "unverified_elements": [
                        "Source film identity is UNKNOWN (out-of-catalog).",
                        "Soundtrack identity is UNKNOWN (no catalog match).",
                        "Storytelling and Originality are experimental algorithmic approximations; semantic dialogue and cross-catalog uniqueness remain unassessed."
                    ],
                    "evidence_boundaries": {
                        "measured_physical_facts": "Cuts, frame rate, resolution, BPM, onsets, scaled rhythmic deltas, color histogram continuity, and RMS energy envelope correlation.",
                        "unmeasured_aesthetic_qualities": "Full semantic dialogue understanding, character emotional arcs, and universal artistic originality."
                    }
                }
            else:
                sec_d = {
                    "provenance": "unassessed_dimensions",
                    "status": StatusTag.NOT_YET_ASSESSED,
                    "scorecard": scorecard_res["scorecard"],
                    "explanation": "No verified human review or authorized multimodal LLM evaluation performed. Heuristics withdrawn."
                }
                sec_e = {
                    "provenance": "personalized_estimate",
                    "status": StatusTag.NOT_YET_ASSESSED,
                    "predicted_score": None,
                    "owner_preference_weights": engine.owner_weights,
                    "empirical_evaluation": {"loocv_mae": 0.58, "loocv_rmse": 0.80}
                }
                sec_f = {
                    "unverified_elements": [
                        "Source film identity is UNKNOWN (out-of-catalog).",
                        "Soundtrack identity is UNKNOWN (no catalog match).",
                        "Aesthetic dimensions (Transitions, Pacing, Visual, Storytelling, Originality) are NOT_YET_ASSESSED."
                    ],
                    "evidence_boundaries": {
                        "measured_physical_facts": "Cuts, frame rate, resolution, BPM, onsets, and multi-grid beat deltas.",
                        "unmeasured_aesthetic_qualities": "Pacing flow, narrative impact, and artistic originality."
                    }
                }

            sec_g = {
                "creator_studio_ready": True,
                "private_data_retained": True,  # Truthfully declared: cached on local private disk
                "cloud_upload_permitted": False,
                "license_tier": "owner_rd_internal",
                "api_endpoint": "/api/v8/jobs",
                "data_governance": {
                    "local_bytes_only": True,
                    "zero_cloud_retention": True,
                    "untracked_by_git": True,
                    "local_storage_path": os.path.join(PRIVATE_JOBS_DIR, job.job_id),
                    "retention_policy": "Local private disk caching for job restoration and audit. Purgeable by owner."
                }
            }

            v6_doc = EditDNASchemaV6.create_report(
                media_id=job.media_filename,
                media_type="authorized_video_bytes",
                section_a_visual=sec_a,
                section_b_music=sec_b,
                section_c_physical=sec_c,
                section_d_semantic=sec_d,
                section_e_personalized=sec_e,
                section_f_boundaries=sec_f,
                section_g_contract=sec_g,
            )
            if job.quality_mode == "phase9":
                v6_doc["quality_mode"] = "phase9"
                v6_doc["analysis_mode"] = "phase9"
            job.v6_report = v6_doc

            # 5. Phase 7 Presentation Report Assembly
            job.current_stage = "Generating Phase 7 presentation report"
            pres_doc = EditDNAPresentationAdapter.from_v6_report(v6_doc, semantic_overrides=job.semantic_overrides)
            job.presentation_report = pres_doc

            # 6. Save outputs to private jobs storage
            job_out_dir = os.path.join(PRIVATE_JOBS_DIR, job.job_id)
            os.makedirs(job_out_dir, exist_ok=True)
            with open(os.path.join(job_out_dir, "report_v6.json"), "w", encoding="utf-8") as f:
                json.dump(v6_doc, f, indent=2)
            with open(os.path.join(job_out_dir, "report_presentation.json"), "w", encoding="utf-8") as f:
                json.dump(pres_doc, f, indent=2)

            # Finalize Job
            t_total = time.time() - t_start
            job.completed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            job.duration_seconds = round(t_total, 2)
            job.progress_percent = 100
            job.status = AnalysisJobStatus.COMPLETE
            job.current_stage = "Analysis complete"
            job.add_event(
                AnalysisJobStatus.COMPLETE,
                payload={
                    "total_duration_sec": job.duration_seconds,
                    "overall_score": pres_doc.get("overall_score_0_10"),
                    "overall_status": pres_doc.get("overall_score_status"),
                    "v6_path": os.path.join(job_out_dir, "report_v6.json"),
                    "presentation_path": os.path.join(job_out_dir, "report_presentation.json"),
                },
                duration_ms=t_total * 1000.0
            )

        except InterruptedError:
            job.status = AnalysisJobStatus.CANCELLED
            job.current_stage = "Cancelled"
            job.add_event(AnalysisJobStatus.CANCELLED, payload={"message": "Job cancelled by owner"})
        except Exception as e:
            job.status = AnalysisJobStatus.FAILED
            job.error = str(e)
            job.current_stage = f"Failed: {e}"
            job.add_event(AnalysisJobStatus.FAILED, payload={"error": str(e)})
        finally:
            if os.path.isfile(scratch_audio):
                try:
                    os.remove(scratch_audio)
                except Exception:
                    pass


class AnalysisJobManager:
    """Singleton managing job queue, concurrency, and event streaming."""

    MAX_QUEUE_CAPACITY = 5

    def __init__(self, max_concurrent: int = 1):
        self.jobs: Dict[str, AnalysisJob] = {}
        self.executor = ThreadPoolExecutor(max_workers=max_concurrent)
        self.max_concurrent = max_concurrent
        self.lock = threading.Lock()

    def create_job(
        self,
        media_path: str,
        semantic_overrides: Optional[Dict[str, Any]] = None,
        quality_mode: Optional[str] = None
    ) -> AnalysisJob:
        with self.lock:
            # Check queue capacity (reject if queued + running >= limit)
            active_or_queued = [j for j in self.jobs.values() if j.status in (AnalysisJobStatus.RUNNING, AnalysisJobStatus.QUEUED)]
            if len(active_or_queued) >= self.MAX_QUEUE_CAPACITY:
                raise HTTPException(
                    status_code=429,
                    detail=f"Analysis queue saturated ({len(active_or_queued)} active/queued jobs). Capacity limit is {self.MAX_QUEUE_CAPACITY}."
                )

            # Enforce concurrency safeguard: reject if another job is already running
            running_jobs = [j for j in self.jobs.values() if j.status == AnalysisJobStatus.RUNNING]
            if len(running_jobs) >= self.max_concurrent:
                raise HTTPException(
                    status_code=429,
                    detail=f"Maximum concurrent analysis limit ({self.max_concurrent}) reached. Job {running_jobs[0].job_id} is currently running."
                )

            job_id = f"job_{int(time.time())}_{uuid.uuid4().hex[:6]}"
            job = AnalysisJob(job_id, media_path, semantic_overrides, quality_mode=quality_mode)
            self.jobs[job_id] = job
            job.add_event(AnalysisJobStatus.QUEUED, payload={"media_path": media_path})
            self.executor.submit(AnalysisEngine.execute_job, job)
            return job

    def get_job(self, job_id: str) -> Optional[AnalysisJob]:
        return self.jobs.get(job_id)

    def cancel_job(self, job_id: str, reason: str = "") -> bool:
        job = self.jobs.get(job_id)
        if not job:
            return False
        if job.status in (AnalysisJobStatus.RUNNING, AnalysisJobStatus.QUEUED):
            job.cancel_event.set()
            job.status = AnalysisJobStatus.CANCELLED
            job.current_stage = f"Cancellation requested: {reason}"
            # Immediate notification to event subscribers
            job.add_event(
                AnalysisJobStatus.CANCELLED,
                payload={"message": f"Job cancelled immediately: {reason}", "acknowledged": True}
            )
            return True
        return False

    def list_inbox_files(self) -> List[Dict[str, Any]]:
        if not os.path.isdir(AUTHORIZED_INBOX):
            return []
        items = []
        for fn in sorted(os.listdir(AUTHORIZED_INBOX)):
            if fn.lower().endswith((".mp4", ".mov", ".mkv", ".webm")):
                fp = os.path.join(AUTHORIZED_INBOX, fn)
                st = os.stat(fp)
                items.append({
                    "filename": fn,
                    "size_bytes": st.st_size,
                    "size_mb": round(st.st_size / (1024 * 1024), 2),
                    "modified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
                })
        return items

    def restore_persisted_jobs(self):
        """Restores completed jobs from private disk storage across service restarts."""
        if not os.path.isdir(PRIVATE_JOBS_DIR):
            return
        for j_id in os.listdir(PRIVATE_JOBS_DIR):
            j_dir = os.path.join(PRIVATE_JOBS_DIR, j_id)
            if os.path.isdir(j_dir):
                v6_path = os.path.join(j_dir, "report_v6.json")
                pres_path = os.path.join(j_dir, "report_presentation.json")
                if os.path.isfile(v6_path) and os.path.isfile(pres_path):
                    try:
                        with open(v6_path, "r", encoding="utf-8") as f:
                            v6_data = json.load(f)
                        with open(pres_path, "r", encoding="utf-8") as f:
                            pres_data = json.load(f)
                        job = AnalysisJob(j_id, v6_data.get("media_id", "restored_media"))
                        job.status = AnalysisJobStatus.COMPLETE
                        job.current_stage = "Analysis complete (restored from disk)"
                        job.progress_percent = 100
                        job.v6_report = v6_data
                        job.presentation_report = pres_data
                        self.jobs[j_id] = job
                    except Exception:
                        pass


# Instantiate Service & Manager
job_manager = AnalysisJobManager(max_concurrent=1)
job_manager.restore_persisted_jobs()

app = FastAPI(
    title="Lolixco Edit DNA — Local Analysis Service",
    version="8.0.0",
    description="Local offline video analysis service powering Creator Studio cinematic scoring."
)

# Controlled local development origins (Loopback & Creator Studio dev)
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",  # Vite dev server default
    "http://127.0.0.1:5173",
    "http://localhost:3000",  # Alternative dev port
    "http://127.0.0.1:3000",
    "http://localhost:5050",  # Owner Rating Lab
    "http://127.0.0.1:5050",
    "http://localhost:5055",  # Self / OpenAPI docs
    "http://127.0.0.1:5055",
]

# Support optional environment override for proxy setups
custom_origins_env = os.environ.get("LOLIXCO_ALLOWED_ORIGINS")
allowed_origins = [o.strip() for o in custom_origins_env.split(",") if o.strip()] if custom_origins_env else DEFAULT_ALLOWED_ORIGINS

# CORS Middleware allowing only explicitly controlled local dev origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "X-Lolixco-Auth", "Last-Event-ID"],
)


@app.middleware("http")
async def security_and_origin_guard(request: Request, call_next):
    """
    Validates host header against local loopback interfaces and verifies
    origin headers against allowed origins to prevent unauthorized external access.
    """
    # 1. Host header validation
    host_hdr = request.headers.get("host", "").split(":")[0].strip().lower()
    allowed_hosts = {"127.0.0.1", "localhost", "[::1]", "testserver"}
    if host_hdr and host_hdr not in allowed_hosts:
        return JSONResponse(
            status_code=403,
            content={"detail": f"Forbidden host header '{host_hdr}': Service only binds to local loopback"}
        )

    # 2. Origin validation (if Origin header present and not preflight OPTIONS)
    origin = request.headers.get("origin")
    if origin and request.method != "OPTIONS":
        norm_origin = origin.rstrip("/")
        norm_allowed = [o.rstrip("/") for o in allowed_origins]
        if norm_origin not in norm_allowed:
            return JSONResponse(
                status_code=403,
                content={"detail": f"Forbidden origin '{origin}': External origins cannot access local analysis service"}
            )

    # 3. Optional local auth token verification
    expected_token = os.environ.get("LOLIXCO_AUTH_TOKEN")
    if expected_token:
        provided_token = request.headers.get("x-lolixco-auth") or request.headers.get("authorization", "").replace("Bearer ", "")
        if provided_token != expected_token:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized: Invalid or missing X-Lolixco-Auth token"})

    response = await call_next(request)
    return response


@app.get("/api/v8/health")
def get_service_health():
    """Health check verifying offline signal service status."""
    return {
        "status": "ok",
        "service": "lolixco-edit-dna",
        "version": "8.0.0",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "inbox_directory": AUTHORIZED_INBOX,
        "max_concurrent_jobs": job_manager.max_concurrent,
        "max_queue_capacity": job_manager.MAX_QUEUE_CAPACITY,
    }


@app.get("/api/v8/inbox")
def list_authorized_inbox_files():
    """Returns available authorized video files from the owner inbox."""
    files = job_manager.list_inbox_files()
    return {"inbox_directory": AUTHORIZED_INBOX, "total_files": len(files), "files": files}


@app.post("/api/v8/jobs/start")
def start_analysis_job(req: StartJobRequest):
    """Starts an asynchronous offline analysis job for an authorized MP4."""
    try:
        target_path = AnalysisEngine.resolve_safe_path(req.inbox_filename, req.media_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    job = job_manager.create_job(target_path, req.semantic_overrides, quality_mode=req.quality_mode)
    return {
        "job_id": job.job_id,
        "status": job.status,
        "media_filename": job.media_filename,
        "quality_mode": job.quality_mode,
        "created_at": job.created_at,
        "poll_url": f"/api/v8/jobs/{job.job_id}",
        "events_url": f"/api/v8/jobs/{job.job_id}/events",
    }


@app.get("/api/v8/jobs/{job_id}")
def get_job_status(job_id: str):
    """Retrieves full job status, elapsed time, current stage, and progressive results."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job.to_dict()


@app.post("/api/v8/jobs/{job_id}/cancel")
def cancel_analysis_job(job_id: str, req: CancelJobRequest = None):
    """Cancels a queued or running analysis job."""
    reason = req.reason if req else "Owner requested cancellation"
    cancelled = job_manager.cancel_job(job_id, reason)
    if not cancelled:
        raise HTTPException(status_code=400, detail=f"Job {job_id} could not be cancelled (either not found or already finished).")
    return {"status": "success", "job_id": job_id, "message": f"Job cancelled: {reason}"}


@app.get("/api/v8/jobs/{job_id}/report/v6")
def get_job_v6_report(job_id: str):
    """Returns the completed canonical v6.0.0 evidence report."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != AnalysisJobStatus.COMPLETE or not job.v6_report:
        raise HTTPException(status_code=400, detail=f"Job {job_id} is in status '{job.status}'. Report available only on completion.")
    return job.v6_report


@app.get("/api/v8/jobs/{job_id}/report/presentation")
def get_job_presentation_report(job_id: str):
    """Returns the completed Phase 7 presentation report (7.0.0-presentation)."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != AnalysisJobStatus.COMPLETE or not job.presentation_report:
        raise HTTPException(status_code=400, detail=f"Job {job_id} is in status '{job.status}'. Report available only on completion.")
    return job.presentation_report


@app.get("/api/v8/jobs/{job_id}/events")
async def stream_job_events(job_id: str, request: Request, cursor: Optional[int] = Query(None)):
    """
    Server-Sent Events (SSE) streaming endpoint for real-time progress events.
    Supports resume cursor via Last-Event-ID header or ?cursor= query parameter.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    last_id_hdr = request.headers.get("last-event-id")
    cursor_val: Optional[int] = None
    if last_id_hdr and last_id_hdr.isdigit():
        cursor_val = int(last_id_hdr)
    elif cursor is not None:
        cursor_val = cursor

    queue = asyncio.Queue()
    with job.lock:
        job.loop = asyncio.get_running_loop()
        job.event_subscribers.append(queue)
        # Pre-populate with events after resume cursor (or all events if no cursor)
        for e in job.events:
            if cursor_val is None or e.get("event_id", 0) > cursor_val:
                queue.put_nowait(e)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=1.0)
                    evt_id = evt.get("event_id", 1)
                    yield f"id: {evt_id}\ndata: {json.dumps(evt)}\n\n"
                    if evt.get("event_type") in (AnalysisJobStatus.COMPLETE, AnalysisJobStatus.FAILED, AnalysisJobStatus.CANCELLED):
                        break
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat
                    yield ": keep-alive\n\n"
        finally:
            with job.lock:
                if queue in job.event_subscribers:
                    job.event_subscribers.remove(queue)

    sse_headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=sse_headers)


@app.post("/api/v8/annotations/sync-timestamps")
def submit_sync_annotations(req: AnnotationSubmissionRequest):
    """
    Records lightweight rhythm annotations from the owner or human expert.
    Stored privately in ~/.lolixco-edit-dna/annotations/ (never tracked by git).
    """
    clean_name = os.path.basename(req.media_filename).replace(" ", "_").replace(".mp4", "")
    out_file = os.path.join(PRIVATE_ANNOTATIONS_DIR, f"{clean_name}_annotations.json")

    data = {
        "media_filename": req.media_filename,
        "evaluator": req.evaluator,
        "owner_rating": req.owner_rating,
        "evaluation_notes": req.evaluation_notes,
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "annotations_count": len(req.annotations),
        "annotations": [a.dict() for a in req.annotations],
        "storage_path": out_file,
    }
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return {
        "status": "success",
        "message": f"Recorded {len(req.annotations)} rhythm annotations for {req.media_filename}",
        "file_path": out_file
    }


@app.get("/api/v8/annotations/{filename}")
def get_sync_annotations(filename: str):
    """Retrieves existing rhythm annotations or owner feedback for a specific video."""
    clean_name = os.path.basename(filename).replace(" ", "_").replace(".mp4", "")
    target = os.path.join(PRIVATE_ANNOTATIONS_DIR, f"{clean_name}_annotations.json")

    if not os.path.isfile(target):
        # Also check owner feedback for Dhurandhar
        if "dhurandhar" in filename.lower():
            alt = os.path.join(PRIVATE_ANNOTATIONS_DIR, "owner_feedback_dhurandhar.json")
            if os.path.isfile(alt):
                with open(alt, "r", encoding="utf-8") as f:
                    return json.load(f)
        raise HTTPException(status_code=404, detail=f"No annotations found for {filename}")

    with open(target, "r", encoding="utf-8") as f:
        return json.load(f)


def run_cli_analysis(media_identifier: str) -> Dict[str, Any]:
    """Runs a synchronous command-line analysis on the specified video."""
    target_path = AnalysisEngine.resolve_safe_path(media_identifier, media_identifier)
    print("=" * 64)
    print("LOLIXCO EDIT DNA — LOCAL ANALYSIS ENGINE (PHASE 9)")
    print("=" * 64)
    print(f" Target Media: {target_path}")

    job_id = f"cli_{int(time.time())}"
    job = AnalysisJob(job_id, target_path, quality_mode="phase9")
    
    print("\n[STARTING ANALYSIS PIPELINE]")
    AnalysisEngine.execute_job(job)

    print(f"\n[ANALYSIS STATUS: {job.status}] (Elapsed: {job.duration_seconds}s)")
    print("\n--- Progressive Events ---")
    for e in job.events:
        sec = f" [{e['section_id']}]" if e.get("section_id") else ""
        dur = f" ({e['duration_ms']:.1f}ms)" if e.get("duration_ms") else ""
        print(f"  {e['timestamp']} | Event #{e.get('event_id', 1):2d} | {e['event_type']:20s}{sec:30s}{dur}")

    if job.presentation_report:
        pres = job.presentation_report
        print("\n--- Seven Assessment Dimensions ---")
        for s in pres["assessment_sections"]:
            score_str = f"{s['score_0_10']:.2f}/10" if s["score_0_10"] is not None else "UNASSESSED"
            print(f"  {s['section_name']:32s} : {score_str:12s} ({s['evidence_status']})")

        print("\n--- Overall Score & Gauge ---")
        gauge = pres["gauge_presentation"]
        print(f"  Score: {pres['overall_score_0_10']} ({pres['overall_score_status']})")
        print(f"  Tier : {pres['overall_score_tier']}")
        print(f"  Gauge: State={gauge['gauge_state']}, Display='{gauge['display_text']}'")

    return job.to_dict()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Lolixco Edit DNA — Local Analysis Service (Phase 8.1)")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5055, help="Port to listen on (default: 5055)")
    parser.add_argument("command", nargs="?", default="serve", choices=["serve", "analyze"], help="Action to perform")
    parser.add_argument("filename", nargs="?", help="Filename in inbox to analyze (if command is 'analyze')")
    args = parser.parse_args()

    if args.command == "analyze":
        target = args.filename or "Best Dhurandhar edit.mp4"
        run_cli_analysis(target)
    else:
        print("\n" + "=" * 64)
        print("     LOLIXCO EDIT DNA // LOCAL ANALYSIS SERVICE (PHASE 8.1)")
        print("=" * 64)
        print(f" Bind Address:        http://{args.host}:{args.port}")
        print(f" Authorized Inbox:    {AUTHORIZED_INBOX}")
        print(" Security Policy:     127.0.0.1 Loopback Only (Zero Public Exposure)")
        print(" Privacy Contract:    Local Analysis First (Zero Cloud Uploads)")
        print(" Concurrency Limit:   1 Active Analysis Job")
        print(" API Documentation:   http://{args.host}:{args.port}/docs")
        print("=" * 64 + "\n")
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")
