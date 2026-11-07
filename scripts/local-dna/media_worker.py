"""One private local analysis in a bounded, disposable subprocess."""

import json
import math
import os
import resource
import subprocess
import sys
import time
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from staged_media import FORMATS, MAX_FPS, MAX_SECONDS
from owner_fit import assess_owner_fit, content_hash

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "edit-dna"))
import local_service as research


def json_values(value):
    if isinstance(value, np.generic):
        return json_values(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_values(item) for key, item in value.items() if key not in ("local_storage_path", "media_target")}
    if isinstance(value, list):
        return [json_values(item) for item in value]
    return value


def emit(kind, **data):
    print(json.dumps(json_values({"kind": kind, **data}), allow_nan=False), flush=True)


def decode_samples(path, options, timeout):
    args = ["ffmpeg", "-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe",
            "-format_whitelist", FORMATS, "-nostdin", "-threads", "1", "-filter_threads", "1", "-i", str(path)]
    return subprocess.check_output([*args, *options, "pipe:1"], stderr=subprocess.DEVNULL, timeout=timeout)


def stream_start(stream):
    try:
        start = float(stream["start_time"])
        return start if math.isfinite(start) else None
    except (ValueError, KeyError, TypeError):
        return None


def inspect(path, meta):
    """Classify the bounded upload using whole-clip samples and actual packet timing."""
    facts = {
        "duration_seconds": round(meta["duration"], 3),
        "has_video_stream": bool(meta["video"]),
        "has_audio_stream": bool(meta["audio"]),
    }
    notes = []
    if meta["video"]:
        video = meta["video"]
        facts.update({key: video[key] for key in ("width", "height")})
        facts["video_codec"] = video["codec_name"]
        facts["average_fps"] = round(float(Fraction(video["avg_frame_rate"])), 3)
        data = decode_samples(path, ["-map", "0:V:0", "-an", "-t", str(MAX_SECONDS), "-vf",
                         "fps=2,scale=64:36,format=gray", "-frames:v", "240", "-f", "rawvideo"], 25)
        if not data:
            data = decode_samples(path, ["-map", "0:V:0", "-an", "-vf", "scale=64:36,format=gray",
                             "-frames:v", "1", "-f", "rawvideo"], 10)
        frames = np.frombuffer(data, dtype=np.uint8).reshape(-1, 36, 64).astype(np.int16)
        if not len(frames):
            raise ValueError("No video frames could be decoded.")
        black = np.mean(frames <= 18, axis=(1, 2)) >= .98
        facts["sampled_video_frames"] = len(frames)
        facts["sampled_black_frame_percent"] = round(float(100 * np.mean(black)), 2)
        facts["uniform_black_samples"] = bool(np.all(frames <= 2))
        facts["limited_visual_change"] = bool(len(frames) >= 3 and np.max(np.mean(np.abs(np.diff(frames, axis=0)), axis=(1, 2))) < 1.5)
        packets = subprocess.check_output([
            "ffprobe", "-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe",
            "-format_whitelist", FORMATS, "-select_streams", "V:0", "-read_intervals", f"0%+{MAX_SECONDS}",
            "-show_entries", "packet=pts_time", "-of", "json", str(path),
        ], stderr=subprocess.DEVNULL, timeout=12)
        pts = sorted({float(p["pts_time"]) for p in json.loads(packets).get("packets", []) if "pts_time" in p})
        deltas = np.diff(pts)
        facts["variable_frame_timing"] = bool(len(deltas) >= 3 and np.ptp(deltas) > .004)
        if np.any(black):
            notes.append(f"Near-black frames appeared in {facts['sampled_black_frame_percent']:g}% of video samples.")
        elif facts["limited_visual_change"]:
            notes.append("The twice-per-second samples show limited visual change.")
        if facts["variable_frame_timing"]:
            notes.append("Variable frame timing was detected. Frame-index-based cut timing and rhythm ratings were withheld.")
    else:
        notes.append("No video stream detected.")
    if meta["audio"]:
        emit("stage", stage="Inspecting audio activity", progress=12)
        data = decode_samples(path, ["-map", "0:a:0", "-vn", "-t", str(MAX_SECONDS), "-ar", "11025",
                         "-f", "f32le"], 20)
        audio = np.frombuffer(data, dtype="<f4")
        if not len(audio) or not np.isfinite(audio).all():
            raise ValueError("No usable audio samples could be decoded.")
        peak = float(np.max(np.abs(audio)))
        rms = math.sqrt(float(np.mean(np.square(audio, dtype=np.float64))))
        facts.update(audio_codec=meta["audio"]["codec_name"], audio_peak=round(peak, 6),
                     audio_rms_dbfs=round(20 * math.log10(max(rms, 1e-8)), 2), audio_activity=rms >= .001)
        window_samples = 2756 * meta["audio"]["channels"]
        windows = audio[:len(audio) // window_samples * window_samples].reshape(-1, window_samples)
        if len(windows):
            quiet = np.sqrt(np.mean(np.square(windows, dtype=np.float64), axis=1)) < .001
            facts["quiet_audio_window_percent"] = round(float(100 * np.mean(quiet)), 2)
        if not facts["audio_activity"]:
            notes.append("Audio stream is silent or near-silent (sample RMS below −60 dBFS).")
    else:
        notes.append("No audio stream detected.")
    if meta["video"] and meta["audio"]:
        video_start, audio_start = stream_start(meta["video"]), stream_start(meta["audio"])
        if video_start is not None and audio_start is not None:
            facts["audio_video_start_offset_ms"] = round((audio_start - video_start) * 1000, 1)
            if abs(facts["audio_video_start_offset_ms"]) > 25:
                notes.append("Audio and video stream start timestamps differ. Synchronization rating was withheld.")
        else:
            notes.append("Comparable audio and video start timestamps were unavailable. Synchronization rating was withheld.")
    return facts, notes


def timing_limitation(facts):
    if facts.get("variable_frame_timing"):
        return "Variable frame timing requires a timestamp-aware cut detector."
    if facts["has_audio_stream"] and facts["has_video_stream"]:
        offset = facts.get("audio_video_start_offset_ms")
        if offset is None:
            return "Comparable audio and video stream start timestamps are unavailable."
        if abs(offset) > 25:
            return f"Audio and video stream starts differ by {abs(offset):g} ms. The timing proxy requires aligned timebases."
    return None


def withhold(result, reason):
    return {**result, "score_0_10": None, "evidence_status": "NOT_YET_ASSESSED",
            "reason": reason, "editorial_explanation": reason}


class StreamJob(research.AnalysisJob):
    def update_stage(self, stage, progress):
        super().update_stage(stage, progress)
        emit("stage", stage=stage, progress=progress)

    def add_event(self, event_type, section_id=None, payload=None, duration_ms=0.0):
        if event_type in ("COMPLETE", "FAILED", "CANCELLED"):
            return
        emit("event", event_type=event_type, section_id=section_id, payload=payload or {},
             duration_ms=duration_ms, stage=self.current_stage, progress=self.progress_percent)


class WorkerQualityEngine(research.Phase9QualityEngine):
    facts = {}

    def evaluate_beat_synchronization(self, internal_cuts, audio_y, sr, duration, flash_timestamps=None):
        reason = timing_limitation(self.facts)
        if len(internal_cuts) < 4:
            reason = reason or "Fewer than four eligible cut boundaries were available for a beat comparison."
        if reason:
            return withhold({"metrics": {"cuts_count": len(internal_cuts)}}, reason)
        result = super().evaluate_beat_synchronization(internal_cuts, audio_y, sr, duration, flash_timestamps)
        if result["score_0_10"] is not None and not result.get("bpm"):
            return withhold(result, "Onsets were detected, but no stable tempo estimate was available.")
        return result

    def evaluate_cuts_and_transitions(self, correlations, flashes, cuts, duration, num_cuts):
        if self.facts.get("variable_frame_timing"):
            return withhold({"metrics": {}}, "Variable frame timing requires a timestamp-aware cut detector.")
        if not num_cuts:
            return withhold({"metrics": {"cut_transitions_count": 0}}, "The detector found no eligible hard cuts for comparing shot boundaries.")
        result = super().evaluate_cuts_and_transitions(correlations, flashes, cuts, duration, num_cuts)
        if result["score_0_10"] is not None:
            result["editorial_explanation"] = (
                f"Continuity proxy based on {num_cuts} detected hard cuts and adjacent-frame color histograms. "
                "A deliberate visual contrast may yield a lower proxy value."
            )
        return result

    def evaluate_pacing(self, shot_durations, audio_y, sr, duration):
        reason = timing_limitation(self.facts)
        if self.facts.get("variable_frame_timing"):
            return withhold({"metrics": {}}, reason)
        result = super().evaluate_pacing(shot_durations, audio_y, sr, duration)
        metrics = result["metrics"]
        metrics["cuts_per_second"] = round(max(0, len(shot_durations) - 1) / duration, 2) if duration else None
        correlation = metrics.get("cadence_to_audio_correlation") if len(audio_y) else None
        if reason or len(shot_durations) < 4 or duration < 12 or correlation is None:
            metrics["cadence_to_audio_correlation"] = None
            if not reason and len(audio_y):
                reason = ("A pacing rating needs at least four shots and three four-second audio windows."
                          if len(shot_durations) < 4 or duration < 12
                          else "Cut rate or audio energy did not vary enough to estimate their association.")
            return withhold(result, reason or result["editorial_explanation"])
        result["editorial_explanation"] = (
            f"Cadence proxy uses {metrics['cuts_per_second']:g} detected cuts per second and "
            f"the association between local cut rate and audio energy (r = {correlation:.2f}). "
            "The proxy does not establish whether the pacing serves the story."
        )
        return result

    def evaluate_visual_quality(self, sharpness, contrast, width, height, fps):
        # Apply the same resolution tier to portrait and landscape footage.
        result = super().evaluate_visual_quality(sharpness, contrast, max(width, height), min(width, height), fps)
        result["metrics"]["resolution"] = f"{width}x{height}"
        if self.facts.get("uniform_black_samples") and sharpness and not any(sharpness):
            result["score_0_10"] = 0.0
            result["editorial_explanation"] = "Decoded samples are uniformly black. The visual signal proxy is 0.00."
        elif result["score_0_10"] is not None:
            result["editorial_explanation"] = (
                f"Visual signal proxy from {width}×{height} at {fps:.1f} fps, sampled edge sharpness and contrast. "
                "Intentional softness, grain, or low contrast can affect the proxy."
            )
        return result

    def evaluate_storytelling(self, duration, pacing_metrics, semantic_overrides=None):
        return withhold(
            {"missing_evidence": ["Scene context, dialogue and narrative interpretation"]},
            "A storytelling rating requires scene and dialogue interpretation. Local signal analysis measures timing and frames.",
        )

    def evaluate_originality(self, shot_durations, semantic_overrides=None):
        if len(shot_durations) < 6 or self.facts.get("variable_frame_timing"):
            return withhold(
                {"missing_evidence": ["A comparative reference collection of edits"]},
                "Originality requires comparing creative choices against a reference collection.",
            )
        result = super().evaluate_originality(shot_durations)
        result["metrics"].pop("descriptor", None)
        return result

    def evaluate_personalized_owner_fit(self, dimension_scores, semantic_overrides=None):
        return withhold(
            {"missing_evidence": ["Independent preference model with held-out owner ratings"]},
            "Owner fit requires a preference model validated against independently rated edits.",
        )

    def evaluate_full_edit_quality(self, *args, **kwargs):
        return json_values(super().evaluate_full_edit_quality(*args, **kwargs))


def bounded_engine_command(args, **kwargs):
    if args[0] not in ("ffmpeg", "ffprobe"):
        raise ValueError("Unsupported media worker command.")
    safety = ["-max_alloc", "67108864", "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS]
    if args[0] == "ffmpeg":
        safety += ["-nostdin", "-threads", "1"]
    return subprocess.run([args[0], *safety, *args[1:]], timeout=25, **kwargs)


def main(path, job_id, mode, out):
    resource.setrlimit(resource.RLIMIT_CPU, (85, 90))
    resource.setrlimit(resource.RLIMIT_AS, (4 * 1024**3, 4 * 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024 * 1024, 128 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    manifest = json.loads((path.parent / "manifest.json").read_text())
    emit("stage", stage="Inspecting streams", progress=4)
    facts, notes = inspect(path, manifest)
    research.PRIVATE_JOBS_DIR = str(out)
    WorkerQualityEngine.facts = facts
    research.Phase9QualityEngine = WorkerQualityEngine
    research.cv2.setNumThreads(2)
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "protocol_whitelist;file,pipe|format_whitelist;" + FORMATS
    research.subprocess = SimpleNamespace(run=bounded_engine_command, DEVNULL=subprocess.DEVNULL)

    # Use Phase 10's capability-guided engine with the already validated input and whole-clip sampling.
    capabilities = {
        **facts,
        "duration_sec": manifest["duration"],
        "fps": facts.get("average_fps", 0.0),
        "is_audio_silent": facts["has_audio_stream"] and not facts["audio_activity"],
        "decode_frame_limit": MAX_FPS * MAX_SECONDS,
        "decode_seconds_limit": MAX_SECONDS,
    }
    job = StreamJob(job_id, str(path), quality_mode=mode)
    job.media_filename = manifest["name"]
    research.AnalysisEngine._execute_local_job(job, {"capabilities": capabilities}, time.time())
    v6 = job.v6_report
    signals = v6["section_c_physical_signals"]
    signals.update(duration_seconds=facts["duration_seconds"], media_observations=facts, media_notes=notes)
    if facts["has_video_stream"] and not facts.get("variable_frame_timing"):
        signals["cuts_per_second"] = round(signals["cut_transitions_count"] / manifest["duration"], 2)
    else:
        for key in ("shots_count", "cut_transitions_count", "cuts_per_second", "shot_duration_mean_sec", "shot_duration_std_dev_sec"):
            signals[key] = None
        for key in ("cut_timestamps", "flash_frame_timestamps"):
            signals["video_signals"][key] = []
        signals["accessibility_signals"] = {}
    if not facts["has_audio_stream"] or not facts["audio_activity"] or timing_limitation(facts):
        signals["rhythm_alignment"] = {key: None for key in signals["rhythm_alignment"]}
    v6["section_a_visual_recognition"].update(
        provenance="reference_index_unavailable", confidence=None, evidence={},
        explanation="Local visual source matching requires a verified reference index. No source identification was made.",
    )
    v6["section_b_music_recognition"].update(
        provenance="reference_index_unavailable", confidence=None,
        audit_note="Local track identification requires a registered fingerprint index. Acoustic measurements are available separately.",
    )
    v6["section_d_semantic_evaluation"]["explanation"] = (
        "Local technical proxies describe measured signals. Semantic quality and owner fit require separate evidence."
    )
    v6["section_e_personalized_model"].pop("empirical_evaluation", None)
    v6["section_e_personalized_model"].pop("owner_preference_weights", None)
    v6["section_f_boundaries_and_unknowns"]["unverified_elements"] = [
        "Local source and soundtrack identities are unverified. No reference index was searched.",
        "Storytelling, originality and owner fit require additional independent evidence.",
    ]
    presentation = research.EditDNAPresentationAdapter.from_v6_report(v6)
    presentation["context_evidence"]["media_observations"] = facts
    presentation["context_evidence"]["media_notes"] = notes
    presentation["context_evidence"]["local_input_sha256"] = content_hash(path)
    owner_fit = assess_owner_fit(presentation)
    presentation["assessment_sections"][-1].update(owner_fit)
    v6["section_e_personalized_model"].update(
        provenance=owner_fit["method_version"], status=owner_fit["evidence_status"],
        predicted_score=owner_fit["score_0_10"], explanation=owner_fit["creator_explanation"],
        owner_fit={**owner_fit, "score": owner_fit["score_0_10"], "status": owner_fit["evidence_status"],
                   "provenance": owner_fit["method_version"]},
    )
    job.add_event(
        "SECTION_COMPLETED" if owner_fit["score_0_10"] is not None else "SECTION_UNASSESSED",
        "personalized_owner_fit", owner_fit,
    )
    result = json_values({"v6": v6, "presentation": presentation})
    (out / "result.json").write_text(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    try:
        main(Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4]))
    except (ValueError, subprocess.SubprocessError, OSError, RuntimeError) as error:
        emit("error", message=str(error) if isinstance(error, ValueError) else "The media could not be decoded or analyzed within local limits.")
        sys.exit(1)
