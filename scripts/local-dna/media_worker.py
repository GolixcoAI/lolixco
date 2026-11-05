"""One staged analysis in a bounded, disposable subprocess."""
import json
import math
import os
import resource
import subprocess
import sys
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from staged_media import FORMATS, MAX_SECONDS

sys.dont_write_bytecode = True
sys.path.insert(0, "/home/rohan/Lolixco/scripts/edit-dna")
import local_service as research


def emit(kind, **data):
    print(json.dumps({"kind": kind, **data}, allow_nan=False), flush=True)


def decode_samples(path, options, timeout):
    args = ["ffmpeg", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS,
            "-nostdin", "-threads", "1", "-filter_threads", "1", "-i", str(path)]
    return subprocess.check_output([*args, *options, "pipe:1"], stderr=subprocess.DEVNULL, timeout=timeout)


def observe(path, meta):
    facts = {"duration_seconds": round(meta["duration"], 3),
             "has_video_stream": bool(meta["video"]), "has_audio_stream": bool(meta["audio"])}
    notes = []
    if meta["video"]:
        facts.update({key: meta["video"][key] for key in ("width", "height")})
        facts["video_codec"] = meta["video"]["codec_name"]
        facts["average_fps"] = round(float(Fraction(meta["video"]["avg_frame_rate"])), 3)
        data = decode_samples(path, ["-map", "0:V:0", "-an", "-t", str(MAX_SECONDS), "-vf",
                         "fps=2,scale=64:36,format=gray", "-frames:v", "240", "-f", "rawvideo"], 25)
        if not data:
            # fps=2 can drop valid sub-half-second media. Read one decoded frame directly.
            data = decode_samples(path, ["-map", "0:V:0", "-an", "-vf", "scale=64:36,format=gray",
                             "-frames:v", "1", "-f", "rawvideo"], 10)
        frames = np.frombuffer(data, dtype=np.uint8).reshape(-1, 36, 64).astype(np.int16)
        if not len(frames):
            raise ValueError("No video frames could be decoded.")
        black = np.mean(frames <= 18, axis=(1, 2)) >= .98
        facts["sampled_video_frames"] = len(frames)
        facts["sampled_black_frame_percent"] = round(float(100 * np.mean(black)), 2)
        predominantly_black = bool(np.mean(black) >= .95)
        limited_change = bool(len(frames) >= 3 and np.max(np.mean(np.abs(np.diff(frames, axis=0)), axis=(1, 2))) < 1.5)
        packets = subprocess.check_output([
            "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS,
            "-select_streams", "V:0", "-read_intervals", f"0%+{MAX_SECONDS}", "-show_entries", "packet=pts_time",
            "-of", "json", str(path),
        ], stderr=subprocess.DEVNULL, timeout=12)
        pts = sorted({float(p["pts_time"]) for p in json.loads(packets).get("packets", []) if "pts_time" in p})
        deltas = np.diff(pts)
        vfr = bool(len(deltas) >= 3 and np.ptp(deltas) > .004)
        facts.update(predominantly_black=predominantly_black, limited_visual_change=limited_change, variable_frame_timing=vfr)
        if predominantly_black:
            notes.append("Video frames appear predominantly black in the sampled frames.")
        elif np.any(black):
            notes.append(f"Black frames were observed in {facts['sampled_black_frame_percent']:g}% of video samples.")
        elif limited_change:
            notes.append("Video shows limited visual change in the sampled frames.")
        if vfr:
            notes.append("Variable frame timing detected. Cut timing and beat alignment were withheld.")
    else:
        notes.append("No video stream detected.")
    if meta["audio"]:
        data = decode_samples(path, ["-map", "0:a:0", "-vn", "-t", str(MAX_SECONDS), "-ar", "11025",
                         "-f", "f32le"], 20)
        audio = np.frombuffer(data, dtype="<f4")
        if not len(audio) or not np.isfinite(audio).all():
            raise ValueError("No usable audio samples could be decoded.")
        peak = float(np.max(np.abs(audio)))
        rms = math.sqrt(float(np.mean(np.square(audio, dtype=np.float64))))
        facts.update(audio_codec=meta["audio"]["codec_name"], audio_peak=round(peak, 6),
                     audio_rms_dbfs=round(20 * math.log10(max(rms, 1e-8)), 2), audio_activity=peak >= 1e-4)
        window_samples = 2756 * meta["audio"]["channels"]
        windows = audio[:len(audio) // window_samples * window_samples].reshape(-1, window_samples)
        if len(windows):
            quiet = np.sqrt(np.mean(np.square(windows, dtype=np.float64), axis=1)) < 1e-4
            facts["quiet_audio_window_percent"] = round(float(100 * np.mean(quiet)), 2)
            if facts["audio_activity"] and np.any(quiet):
                notes.append(f"Low audio activity in {facts['quiet_audio_window_percent']:g}% of quarter-second windows.")
        if not facts["audio_activity"]:
            notes.append("Audio stream detected with no meaningful audio activity.")
    else:
        notes.append("No audio stream detected.")
    return facts, notes


def evidence_report(media_id, mode, facts, notes):
    a = {"status": "UNKNOWN", "provenance": "local_stream_observation"}
    b = {"status": "UNKNOWN", "provenance": "local_stream_observation"}
    cards = {
        "beat_synchronization": {"score": None, "status": "NOT_YET_ASSESSED",
                                 "notes": "No eligible video-cut and rhythmic evidence was assessed."},
        "visual_quality": {"score": None, "status": "NOT_YET_ASSESSED",
                           "notes": "Insufficient visual evidence for a quality rating."},
    }
    doc = research.EditDNASchemaV6.create_report(
        media_id, "authorized_video_bytes", a, b,
        {"provenance": "measured_signal", "media_observations": facts},
        {"status": "NOT_YET_ASSESSED", "provenance": "local_stream_observation", "scorecard": cards},
        {"status": "NOT_YET_ASSESSED", "provenance": "unassessed_dimensions"},
        {"unverified_elements": notes},
    )
    doc["quality_mode"] = mode
    return doc


class StreamJob(research.AnalysisJob):
    def add_event(self, event_type, section_id=None, payload=None, duration_ms=0.0):
        if event_type in ("COMPLETE", "FAILED", "CANCELLED"):
            return
        # The parent owns job status and persistence.
        emit("event", event_type=event_type, section_id=section_id, payload=payload or {},
             duration_ms=duration_ms, stage=self.current_stage, progress=self.progress_percent)


class WorkerQualityEngine(research.Phase9QualityEngine):
    def evaluate_beat_synchronization(self, internal_cuts, audio_y, sr, duration, flash_timestamps=None):
        result = super().evaluate_beat_synchronization(internal_cuts, audio_y, sr, duration, flash_timestamps)
        if result["score_0_10"] is not None and (len(internal_cuts) < 4 or not result.get("bpm")):
            reason = "Too few detected cuts or no tempo estimate for the timing proxy."
            result.update(score_0_10=None, evidence_status="NOT_YET_ASSESSED",
                          reason=reason, editorial_explanation=reason)
            result["metrics"]["assessment_reason"] = reason
        return result

    def evaluate_pacing(self, shot_durations, audio_y, sr, duration):
        if len(audio_y) and np.max(np.abs(audio_y)) < 1e-4:
            audio_y = np.array([])
        return super().evaluate_pacing(shot_durations, audio_y, sr, duration)


def bounded_engine_command(args, **kwargs):
    if args[0] not in ("ffmpeg", "ffprobe"):
        raise ValueError("Unsupported media worker command.")
    safety = ["-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS]
    if args[0] == "ffmpeg":
        safety += ["-nostdin", "-threads", "1"]
    return subprocess.run([args[0], *safety, *args[1:]], timeout=25, **kwargs)


def main(path, job_id, mode, out):
    resource.setrlimit(resource.RLIMIT_CPU, (85, 90))
    resource.setrlimit(resource.RLIMIT_AS, (4 * 1024**3, 4 * 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024 * 1024, 128 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    manifest = json.loads((path.parent / "manifest.json").read_text())
    emit("stage", stage="Inspecting video and audio streams", progress=4)
    facts, notes = observe(path, manifest)
    research.PRIVATE_JOBS_DIR = str(out)
    research.Phase9QualityEngine = WorkerQualityEngine
    research.cv2.setNumThreads(2)
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "protocol_whitelist;file,pipe|format_whitelist;" + FORMATS
    research.subprocess = SimpleNamespace(run=bounded_engine_command, DEVNULL=subprocess.DEVNULL)

    technical_only = facts["duration_seconds"] <= 1 or not facts["has_video_stream"] or any(facts.get(key) for key in (
        "predominantly_black", "limited_visual_change", "variable_frame_timing"
    ))
    if facts["duration_seconds"] <= 1:
        notes.append("Clip is too short for reliable editing scores.")
    if not technical_only:
        emit("stage", stage="Measuring cuts, frames and audio", progress=15)
        job = StreamJob(job_id, str(path), quality_mode=mode)
        job.media_filename = manifest["name"]
        research.AnalysisEngine.execute_job(job)
        if job.status != "COMPLETE":
            raise RuntimeError("The local evidence engine could not analyze the decoded streams.")
        v6 = job.v6_report
    else:
        emit("stage", stage="Assembling available stream measurements", progress=70)
        v6 = evidence_report(manifest["name"], mode, facts, notes)

    v6["media_id"] = manifest["name"]
    v6["section_c_physical_signals"].update(media_observations=facts, media_notes=notes)
    presentation = research.EditDNAPresentationAdapter.from_v6_report(v6)
    if technical_only:
        for section in presentation["assessment_sections"]:
            # Legacy presentation defaults do not establish measurements for absent streams.
            section["evidence_refs"] = {}
            section["timestamps"] = []
            emit("event", event_type="SECTION_UNASSESSED", section_id=section["section_id"],
                 payload=section, duration_ms=0, stage="Assembling available stream measurements", progress=85)
    presentation["context_evidence"]["media_observations"] = facts
    presentation["context_evidence"]["media_notes"] = notes
    result = {"v6": v6, "presentation": presentation}
    (out / "result.json").write_text(json.dumps(result, allow_nan=False))
    emit("result")


if __name__ == "__main__":
    try:
        main(Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4]))
    except (ValueError, subprocess.SubprocessError, OSError, RuntimeError) as error:
        emit("error", message=str(error) if isinstance(error, ValueError) else "The media could not be decoded or analyzed within local limits.")
        sys.exit(1)
