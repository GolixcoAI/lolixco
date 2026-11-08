"""Create one private, bounded analysis rendition while preserving the input timeline."""

import json
import math
import subprocess
from fractions import Fraction
from pathlib import Path

from staged_media import FORMATS, MAX_SECONDS, MediaValidationError

ANALYSIS_LONG_EDGE = 640
ANALYSIS_FPS_LIMIT = 60
PREPARATION_SECONDS = 90


def number(value, default=None):
    try:
        parsed = float(Fraction(value))
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError, ZeroDivisionError):
        return default


def packet_timing(path):
    try:
        raw = subprocess.check_output([
            "ffprobe", "-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe",
            "-format_whitelist", FORMATS, "-select_streams", "V:0", "-read_intervals", f"0%+{MAX_SECONDS}",
            "-show_entries", "packet=pts_time", "-of", "json", str(path),
        ], stderr=subprocess.DEVNULL, timeout=15)
        timestamps = sorted({float(packet["pts_time"]) for packet in json.loads(raw).get("packets", [])
                             if "pts_time" in packet and number(packet["pts_time"]) is not None})
    except (ValueError, subprocess.SubprocessError, OSError):
        return {"variable_frame_timing": None, "source_timestamp_count": 0}
    intervals = [right - left for left, right in zip(timestamps, timestamps[1:])]
    variable = len(intervals) >= 3 and max(intervals) - min(intervals) > .004
    return {"variable_frame_timing": variable, "source_timestamp_count": len(timestamps)}


def prepare_analysis(path, workspace, metadata):
    """Use a common timestamp shift and a bounded sample grid, never per-stream resets."""
    path, workspace = Path(path), Path(workspace)
    video, audio = metadata["video"], metadata["audio"]
    timing = packet_timing(path) if video else {"variable_frame_timing": False, "source_timestamp_count": 0}
    reported_fps = max(0, number(video.get("avg_frame_rate"), 0)) if video else 0
    nominal_fps = max(0, number(video.get("r_frame_rate"), 0)) if video else 0
    sample_fps = min(ANALYSIS_FPS_LIMIT, reported_fps or nominal_fps or 30)
    if timing["variable_frame_timing"] or timing["source_timestamp_count"] == 0:
        sample_fps = ANALYSIS_FPS_LIMIT if video else 0
    origin = metadata.get("start_time", 0)
    output = workspace / "analysis.mkv"
    arguments = [
        "ffmpeg", "-v", "error", "-nostdin", "-y", "-max_alloc", "67108864", "-threads", "2",
        "-filter_threads", "1", "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS,
        "-copyts", "-i", str(path), "-map", "0:V:0?", "-map", "0:a:0?", "-sn", "-dn", "-t", str(metadata["duration"]),
    ]
    if video:
        # fps uses the original PTS after one common origin shift, preserving VFR wall-clock timing.
        filters = (
            f"setpts=PTS-({origin:.9f})/TB,"
            f"fps=fps={sample_fps:.9f}:start_time=0:round=near,"
            f"scale=w='min({ANALYSIS_LONG_EDGE},iw)':h='min({ANALYSIS_LONG_EDGE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,"
            "setsar=1,format=yuv420p"
        )
        arguments += ["-vf", filters, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-maxrate", "4M", "-bufsize", "8M", "-threads", "2", "-bf", "0"]
    if audio:
        arguments += ["-af", f"asetpts=PTS-({origin:.9f})/TB,aresample=22050:async=1:first_pts=0",
                      "-c:a", "pcm_s16le", "-ar", "22050", "-ac", "1"]
    arguments += ["-map_metadata", "-1", "-avoid_negative_ts", "disabled", "-f", "matroska", str(output)]
    try:
        subprocess.run(arguments, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=True, timeout=PREPARATION_SECONDS)
    except subprocess.TimeoutExpired:
        raise MediaValidationError("analysis_preparation_timeout", "Decoding this media exceeded the preparation time limit. Try a shorter export.") from None
    except (subprocess.CalledProcessError, OSError):
        raise MediaValidationError("media_decode_failed", "FFmpeg could not decode the selected video or audio stream. Try exporting it again.") from None
    if not output.is_file() or output.stat().st_size == 0:
        raise MediaValidationError("media_decode_failed", "The selected file produced no decodable analysis samples.")
    return output, {
        **timing,
        "timestamp_normalized": True,
        "source_timeline_origin_seconds": round(origin, 6),
        "analysis_video_fps": round(sample_fps, 6) if video else 0,
        "analysis_long_edge_limit": ANALYSIS_LONG_EDGE,
        "analysis_audio_sample_rate": 22050 if audio else 0,
        "analysis_timing_resolution_ms": round(1000 / sample_fps, 3) if video and sample_fps else None,
        "analysis_preparation": "Common source timestamp origin, scaled video and uniform temporal sampling; original bytes retained",
    }
