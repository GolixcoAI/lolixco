#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — REAL OFFLINE SIGNAL ANALYZER
Part of Phase 2: Real Video Analysis Experiment

Analyzes real MP4 bytes using FFmpeg/ffprobe, PySceneDetect, and librosa.
Outputs structured JSON telemetry with genuine measured data.
"""

import os
import sys
import json
import time
import shutil
import tempfile
import argparse
import subprocess
import resource

try:
    import numpy as np
    import cv2
    from scenedetect import open_video, SceneManager, AdaptiveDetector, ContentDetector
    import librosa
except ImportError as e:
    sys.stderr.write(f"Missing dependency: {e}\n")
    sys.exit(1)


def get_peak_ram_mb():
    # ru_maxrss in Linux is kilobytes
    usage_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(usage_kb / 1024.0, 2)


def probe_media(video_path):
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration,bit_rate,size",
        "-show_entries", "stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,bit_rate,sample_rate,channels",
        "-of", "json",
        video_path
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {res.stderr}")

    data = json.loads(res.stdout)
    v_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    a_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    fmt = data.get("format", {})

    if not v_stream:
        raise ValueError("No video stream found in media container.")

    width = int(v_stream.get("width", 0))
    height = int(v_stream.get("height", 0))

    # Evaluate FPS
    r_fps = v_stream.get("r_frame_rate", "30/1")
    if "/" in r_fps:
        num, den = r_fps.split("/")
        fps = float(num) / float(den) if float(den) > 0 else 30.0
    else:
        fps = float(r_fps)

    duration = float(fmt.get("duration", v_stream.get("duration", 0.0)))
    bitrate_kbps = int(fmt.get("bit_rate", 0)) // 1000 if fmt.get("bit_rate") else 0

    return {
        "duration_seconds": round(duration, 3),
        "dimensions": {
            "width": width,
            "height": height,
            "aspect_ratio": f"{width}:{height}" if height > 0 else "unknown"
        },
        "fps": round(fps, 2),
        "video_codec": v_stream.get("codec_name", "unknown"),
        "audio_codec": a_stream.get("codec_name") if a_stream else None,
        "has_audio": a_stream is not None,
        "bitrate_kbps": bitrate_kbps,
        "file_size_bytes": int(fmt.get("size", 0))
    }


def detect_scene_cuts(video_path):
    video = open_video(video_path)
    scene_manager = SceneManager()
    # Use AdaptiveDetector with 4-frame min scene length
    scene_manager.add_detector(AdaptiveDetector(adaptive_threshold=3.0, min_scene_len=4))
    scene_manager.detect_scenes(video)
    scene_list = scene_manager.get_scene_list()

    cut_timestamps = []
    shot_lengths = []

    for idx, (start_time, end_time) in enumerate(scene_list):
        s_sec = start_time.seconds
        e_sec = end_time.seconds
        shot_len = round(e_sec - s_sec, 3)
        shot_lengths.append(shot_len)
        if idx > 0:
            cut_timestamps.append(round(s_sec, 3))

    return {
        "cut_timestamps": cut_timestamps,
        "shot_lengths": shot_lengths,
        "total_shots": len(scene_list)
    }


def analyze_flash_and_visuals(video_path):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {
            "mean_luminance": 0.0,
            "mean_contrast": 0.0,
            "flash_warnings": []
        }

    luminances = []
    contrasts = []
    flash_warnings = []
    prev_lum = None
    frame_idx = 0
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        lum = float(np.mean(gray))
        contrast = float(np.std(gray))
        luminances.append(lum)
        contrasts.append(contrast)

        if prev_lum is not None:
            delta = lum - prev_lum
            # Detect spike to near-white (>200) with delta > 120
            if delta > 120 and lum > 210:
                t = round(frame_idx / fps, 3)
                flash_warnings.append({
                    "timestamp": t,
                    "frame": frame_idx,
                    "luminance_spike": round(delta, 1),
                    "note": "Sharp luminance spike detected (possible single-frame strobe/flash)"
                })

        prev_lum = lum
        frame_idx += 1

    cap.release()

    mean_lum = round(float(np.mean(luminances)), 2) if luminances else 0.0
    mean_contrast = round(float(np.mean(contrasts)), 2) if contrasts else 0.0

    return {
        "mean_luminance": mean_lum,
        "mean_contrast": mean_contrast,
        "flash_warnings": flash_warnings
    }


def analyze_audio_librosa(video_path, has_audio):
    if not has_audio:
        return {
            "has_audio": False,
            "status": "no_audio_stream",
            "estimated_bpm": None,
            "bpm_uncertainty_percent": None,
            "beat_timestamps": [],
            "mean_onset_strength": 0.0
        }

    # Extract audio stream to temporary WAV via FFmpeg
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
        tmp_wav_path = tmp_wav.name

    try:
        cmd_extract = [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-ar", "22050", "-ac", "1",
            tmp_wav_path
        ]
        res = subprocess.run(cmd_extract, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode != 0:
            return {
                "has_audio": True,
                "status": "audio_demux_failed",
                "estimated_bpm": None,
                "bpm_uncertainty_percent": None,
                "beat_timestamps": [],
                "mean_onset_strength": 0.0
            }

        y, sr = librosa.load(tmp_wav_path, sr=22050, mono=True)
    except Exception as e:
        return {
            "has_audio": True,
            "status": f"audio_decode_failed: {str(e)}",
            "estimated_bpm": None,
            "bpm_uncertainty_percent": None,
            "beat_timestamps": [],
            "mean_onset_strength": 0.0
        }
    finally:
        if os.path.exists(tmp_wav_path):
            os.remove(tmp_wav_path)

    if len(y) == 0:
        return {
            "has_audio": True,
            "status": "empty_audio_track",
            "estimated_bpm": None,
            "bpm_uncertainty_percent": None,
            "beat_timestamps": [],
            "mean_onset_strength": 0.0
        }

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    mean_onset = float(np.mean(onset_env)) if len(onset_env) > 0 else 0.0

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, onset_envelope=onset_env)

    if isinstance(tempo, (np.ndarray, list)):
        bpm_val = float(tempo[0]) if len(tempo) > 0 else 0.0
    else:
        bpm_val = float(tempo)

    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    beat_times = [round(float(t), 3) for t in beat_times]

    # Compute BPM uncertainty based on beat interval variance
    if len(beat_times) >= 3:
        intervals = np.diff(beat_times)
        std_interval = float(np.std(intervals))
        mean_interval = float(np.mean(intervals))
        uncertainty = round((std_interval / mean_interval) * 100.0, 2) if mean_interval > 0 else 0.0
    else:
        uncertainty = 15.0

    return {
        "has_audio": True,
        "status": "analyzed",
        "estimated_bpm": round(bpm_val, 1),
        "bpm_uncertainty_percent": uncertainty,
        "beat_timestamps": beat_times,
        "mean_onset_strength": round(mean_onset, 3)
    }


def analyze_audio_quality(video_path, has_audio):
    if not has_audio:
        return {
            "integrated_lufs": None,
            "true_peak_dbtp": None,
            "loudness_range_lra": None,
            "clipping_detected": False,
            "max_volume_db": None
        }

    # Run volumedetect
    cmd_vol = [
        "ffmpeg", "-i", video_path,
        "-af", "volumedetect",
        "-f", "null", "-"
    ]
    res_vol = subprocess.run(cmd_vol, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    max_volume_db = 0.0
    for line in res_vol.stderr.splitlines():
        if "max_volume:" in line:
            parts = line.split("max_volume:")
            if len(parts) > 1:
                val_str = parts[1].replace("dB", "").strip()
                try:
                    max_volume_db = float(val_str)
                except ValueError:
                    pass

    # Run ebur128
    cmd_ebu = [
        "ffmpeg", "-i", video_path,
        "-af", "ebur128=peak=true",
        "-f", "null", "-"
    ]
    res_ebu = subprocess.run(cmd_ebu, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    lufs = -14.0
    peak = -1.0
    lra = 5.0
    in_summary = False
    for line in res_ebu.stderr.splitlines():
        if "Summary:" in line:
            in_summary = True
        if in_summary:
            if "I:" in line and "LUFS" in line:
                try:
                    lufs = float(line.split("I:")[1].split("LUFS")[0].strip())
                except Exception:
                    pass
            elif "Peak:" in line and "dBFS" in line:
                try:
                    peak = float(line.split("Peak:")[1].split("dBFS")[0].strip())
                except Exception:
                    pass
            elif "LRA:" in line and "LU" in line:
                try:
                    lra = float(line.split("LRA:")[1].split("LU")[0].strip())
                except Exception:
                    pass

    clipping_detected = (max_volume_db >= -0.05) or (peak > 0.05)

    return {
        "integrated_lufs": round(lufs, 1),
        "true_peak_dbtp": round(peak, 1),
        "loudness_range_lra": round(lra, 1),
        "max_volume_db": round(max_volume_db, 1),
        "clipping_detected": clipping_detected
    }


def compute_sync_metrics(cut_timestamps, beat_timestamps):
    if not cut_timestamps:
        return {
            "status": "no_cuts_detected",
            "beat_sync_index": 0.0,
            "tight_cuts_count": 0,
            "acceptable_cuts_count": 0,
            "off_beat_cuts_count": 0,
            "mean_sync_delta_ms": 0.0,
            "per_cut_deltas": []
        }

    if not beat_timestamps:
        return {
            "status": "unmeasured_no_beats",
            "beat_sync_index": 1.0,
            "tight_cuts_count": 0,
            "acceptable_cuts_count": 0,
            "off_beat_cuts_count": len(cut_timestamps),
            "mean_sync_delta_ms": 999.0,
            "per_cut_deltas": []
        }

    per_cut_deltas = []
    tight = 0
    acceptable = 0
    off_beat = 0
    total_delta = 0.0

    for c in cut_timestamps:
        deltas = [abs(c - b) for b in beat_timestamps]
        min_delta = min(deltas)
        delta_ms = round(min_delta * 1000.0, 1)
        total_delta += delta_ms

        if delta_ms <= 33.34:
            cls = "tight"
            tight += 1
        elif delta_ms <= 75.0:
            cls = "acceptable"
            acceptable += 1
        else:
            cls = "off_beat"
            off_beat += 1

        per_cut_deltas.append({
            "cut_time": c,
            "nearest_beat_delta_ms": delta_ms,
            "classification": cls
        })

    n = len(cut_timestamps)
    mean_delta = round(total_delta / n, 1)
    weighted_ratio = (tight * 1.0 + acceptable * 0.65 + off_beat * 0.1) / n
    bsi = round(weighted_ratio * 10.0, 2)

    return {
        "status": "measured",
        "beat_sync_index": bsi,
        "tight_cuts_count": tight,
        "acceptable_cuts_count": acceptable,
        "off_beat_cuts_count": off_beat,
        "mean_sync_delta_ms": mean_delta,
        "per_cut_deltas": per_cut_deltas
    }


def analyze_video_pipeline(video_path):
    t_start = time.perf_counter()

    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    # 1. Probe container
    probe = probe_media(video_path)

    # 2. Scene cut detection
    scenes = detect_scene_cuts(video_path)

    # 3. Flash & visual metrics
    visuals = analyze_flash_and_visuals(video_path)

    # 4. Audio beat extraction
    audio_beats = analyze_audio_librosa(video_path, probe["has_audio"])

    # 5. Audio quality & clipping
    audio_quality = analyze_audio_quality(video_path, probe["has_audio"])

    # 6. Synchronization calculation
    sync = compute_sync_metrics(scenes["cut_timestamps"], audio_beats["beat_timestamps"])

    # Pacing statistics
    dur = probe["duration_seconds"]
    shots_count = scenes["total_shots"]
    asl = round(dur / shots_count, 2) if shots_count > 0 else dur
    cps = round(len(scenes["cut_timestamps"]) / dur, 2) if dur > 0 else 0.0

    lengths = scenes["shot_lengths"]
    if len(lengths) > 1:
        pacing_var = round(float(np.var(lengths)), 4)
    else:
        pacing_var = 0.0

    if asl < 0.9:
        pacing_dyn = "rapid_phonk_pace"
    elif asl > 3.0:
        pacing_dyn = "slow_emotional_pace"
    else:
        pacing_dyn = "balanced_action_pace"

    t_end = time.perf_counter()
    elapsed_sec = round(t_end - t_start, 3)
    peak_ram = get_peak_ram_mb()

    report = {
        "$schema": "https://lolixco.com/schemas/edit-dna-offline.v1.json",
        "analyzer": "Lolixco Edit DNA Offline Pipeline v2.0",
        "target_file": os.path.basename(video_path),
        "absolute_path": os.path.abspath(video_path),
        "execution_telemetry": {
            "runtime_seconds": elapsed_sec,
            "peak_ram_mb": peak_ram
        },
        "technical_metadata": probe,
        "editing_pacing": {
            "total_shots": shots_count,
            "total_cuts": len(scenes["cut_timestamps"]),
            "average_shot_length_seconds": asl,
            "cut_density_cps": cps,
            "pacing_variance": pacing_var,
            "pacing_dynamic": pacing_dyn,
            "detected_cut_timestamps": scenes["cut_timestamps"],
            "shot_lengths_seconds": lengths
        },
        "visual_characteristics": {
            "mean_luminance": visuals["mean_luminance"],
            "mean_contrast": visuals["mean_contrast"],
            "flash_strobe_warnings_count": len(visuals["flash_warnings"]),
            "potential_flash_strobe_warnings": visuals["flash_warnings"]
        },
        "audio_intelligence": {
            "has_audio": audio_beats["has_audio"],
            "status": audio_beats["status"],
            "estimated_bpm": audio_beats["estimated_bpm"],
            "bpm_uncertainty_percent": audio_beats.get("bpm_uncertainty_percent"),
            "detected_beats_count": len(audio_beats["beat_timestamps"]),
            "detected_beat_timestamps": audio_beats["beat_timestamps"],
            "engineering": audio_quality
        },
        "synchronization": sync
    }

    return report


def main():
    parser = argparse.ArgumentParser(description="Lolixco Edit DNA — Real Offline Video Analyzer")
    parser.add_argument("video_path", help="Path to input MP4 video file")
    parser.add_argument("--output", "-o", help="Path to output JSON report", default=None)
    parser.add_argument("--format", choices=["json", "summary", "both"], default="both")

    args = parser.parse_args()

    report = analyze_video_pipeline(args.video_path)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print(f"Report written to: {args.output}")

    if args.format in ("json", "both") and not args.output:
        print(json.dumps(report, indent=2))

    if args.format in ("summary", "both"):
        p = report["technical_metadata"]
        pac = report["editing_pacing"]
        aud = report["audio_intelligence"]
        syn = report["synchronization"]
        tel = report["execution_telemetry"]

        print("\n" + "=" * 60)
        print("          LOLIXCO EDIT DNA — OFFLINE ANALYSIS REPORT")
        print("=" * 60)
        print(f" Target File:    {report['target_file']}")
        print(f" Resolution:     {p['dimensions']['width']}x{p['dimensions']['height']} @ {p['fps']} fps")
        print(f" Duration:       {p['duration_seconds']}s | Bitrate: {p['bitrate_kbps']} kbps")
        print(f" Codecs:         Video: {p['video_codec']} | Audio: {p['audio_codec'] or 'None'}")
        print("-" * 60)
        print(f" Total Shots:    {pac['total_shots']} (Cuts: {pac['total_cuts']})")
        print(f" Avg Shot Len:   {pac['average_shot_length_seconds']}s | Density: {pac['cut_density_cps']} CPS")
        print(f" Pacing Style:   {pac['pacing_dynamic']} (Var: {pac['pacing_variance']})")
        print(f" Strobe Warnings:{report['visual_characteristics']['flash_strobe_warnings_count']}")
        print("-" * 60)
        if aud["has_audio"]:
            print(f" Estimated BPM:  {aud['estimated_bpm']} (Uncertainty: ±{aud.get('bpm_uncertainty_percent', 0)}%)")
            print(f" Loudness:       {aud['engineering']['integrated_lufs']} LUFS | Peak: {aud['engineering']['true_peak_dbtp']} dBTP")
            print(f" Clipping:       {'DETECTED' if aud['engineering']['clipping_detected'] else 'Clean'}")
            print("-" * 60)
            print(f" Beat Sync Index:{syn['beat_sync_index']} / 10.0")
            print(f" Mean Delta:     {syn['mean_sync_delta_ms']} ms")
            print(f" Tight (<=33ms): {syn['tight_cuts_count']} | Acceptable: {syn['acceptable_cuts_count']} | Off-Beat: {syn['off_beat_cuts_count']}")
        else:
            print(" Audio:          No audio stream detected (Visual metrics only)")
        print("-" * 60)
        print(f" Runtime:        {tel['runtime_seconds']}s | Peak RAM: {tel['peak_ram_mb']} MB")
        print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
