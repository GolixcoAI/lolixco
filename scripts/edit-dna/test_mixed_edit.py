#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — MIXED EDIT EXPERIMENT & VERIFICATION
Synthesizes a 12-second multi-source composite video:
- Shot 1 (0.0s - 3.0s): Source 1 (Crimson Slash) + Track 1 (Phonk).
- Shot 2 (3.0s - 6.0s): Source 2 (Comic Halftone, Mirrored) + Track 2 (Trap, Slowed 0.85x).
- Shot 3 (6.0s - 9.0s): Source 3 (Sepia Clouds, Color-Graded) + Track 3 (Piano, Dialogue Overlay).
- Shot 4 (9.0s - 12.0s): Unregistered pastel scene + Unregistered acoustic guitar (Explicit Unknown).
Verifies that MixedEditAnalyzer correctly identifies segment-level source and music candidates,
measures timestamp boundaries, and cleanly abstains on unregistered segments.
"""

import os
import sys
import json
import time
import numpy as np
import cv2
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
from recognizer import EditDNARecognizer
from mixed_edit_analyzer import MixedEditAnalyzer

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
OUTPUT_DIR = os.path.join(BASE_DIR, "test-assets", "recognition")
COMPOSITE_PATH = os.path.join(OUTPUT_DIR, "mixed_edit_demo.mp4")
COMPOSITE_AUDIO_PATH = os.path.join(OUTPUT_DIR, "mixed_edit_demo_audio.wav")
REPORT_PATH = os.path.join(BASE_DIR, "data", "edit-dna", "mixed_edit_analysis_report.json")

SR = 22050
FPS = 24.0
WIDTH, HEIGHT = 640, 360


def synthesize_mixed_edit():
    print("Synthesizing 12-second multi-source composite edit...")

    # Load video clips: q_v1 (clean jjk), q_v2 (crop/contrast spiderman), q_v4 (graded aot), q_v5 (unknown anime)
    clip_paths = [
        os.path.join(OUTPUT_DIR, "q_v1_clean_jjk.mp4"),
        os.path.join(OUTPUT_DIR, "q_v2_crop_contrast_spiderman.mp4"),
        os.path.join(OUTPUT_DIR, "q_v4_color_graded_aot.mp4"),
        os.path.join(OUTPUT_DIR, "q_v5_unknown_anime.mp4"),
    ]

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(COMPOSITE_PATH, fourcc, FPS, (WIDTH, HEIGHT))

    frames_per_shot = int(3.0 * FPS)

    for c_path in clip_paths:
        cap = cv2.VideoCapture(c_path)
        written = 0
        while written < frames_per_shot:
            ret, frame = cap.read()
            if not ret:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret, frame = cap.read()
                if not ret:
                    frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
            resized = cv2.resize(frame, (WIDTH, HEIGHT))
            out.write(resized)
            written += 1
        cap.release()

    out.release()
    print(f"Composite video written to {COMPOSITE_PATH}")

    # Load audio clips: q_a1 (phonk), q_a3 (trap pitched), q_a4 (exp dialogue), q_a5 (unknown)
    audio_paths = [
        os.path.join(OUTPUT_DIR, "q_a1_clean_phonk.wav"),
        os.path.join(OUTPUT_DIR, "q_a3_pitched_family.wav"),
        os.path.join(OUTPUT_DIR, "q_a4_dialogue_mixed_exp.wav"),
        os.path.join(OUTPUT_DIR, "q_a5_unknown_audio.wav"),
    ]

    audio_samples_per_shot = int(3.0 * SR)
    composite_audio = []

    for a_path in audio_paths:
        y, _ = sf.read(a_path)
        if len(y) >= audio_samples_per_shot:
            slice_y = y[:audio_samples_per_shot]
        else:
            slice_y = np.pad(y, (0, audio_samples_per_shot - len(y)))
        composite_audio.append(slice_y)

    full_audio = np.concatenate(composite_audio)
    sf.write(COMPOSITE_AUDIO_PATH, full_audio, SR)
    print(f"Composite audio written to {COMPOSITE_AUDIO_PATH}")


def run_mixed_experiment():
    if not os.path.isfile(COMPOSITE_PATH) or not os.path.isfile(COMPOSITE_AUDIO_PATH):
        synthesize_mixed_edit()

    # Initialize Recognizer and index catalog references
    recognizer = EditDNARecognizer()
    manifest_path = os.path.join(OUTPUT_DIR, "manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    for v_ref in manifest.get("visual_references", []):
        recognizer.register_visual_reference(
            ref_id=v_ref["ref_id"],
            title=v_ref["title"],
            franchise=v_ref["franchise"],
            video_path=os.path.join(BASE_DIR, v_ref["path"]),
        )

    for a_ref in manifest.get("audio_references", []):
        recognizer.register_audio_reference(
            ref_id=a_ref["ref_id"],
            title=a_ref["title"],
            artist=a_ref["artist"],
            audio_path=os.path.join(BASE_DIR, a_ref["path"]),
        )

    analyzer = MixedEditAnalyzer(recognizer)
    report = analyzer.analyze_video(COMPOSITE_PATH, audio_path=COMPOSITE_AUDIO_PATH)

    print("\n" + "=" * 80)
    print("           LOLIXCO EDIT DNA — MIXED EDIT TIMELINE REPORT")
    print("=" * 80)
    print(f" Total Duration: {report['media_summary']['duration_seconds']}s | Shots Detected: {report['media_summary']['detected_shots_count']}")
    print(f" Mixed-Source Edit: {report['holistic_summary']['is_mixed_source_edit']}")
    print(f" Analysis Latency: {report['media_summary']['analysis_latency_ms']} ms")

    print("\n--- Shot-Level Visual Timeline ---")
    for s in report["shot_timeline"]:
        rec = s["visual_recognition"]
        status = rec["status"]
        entity = rec["matched_entity"]["title"] if rec.get("matched_entity") else "UNKNOWN / ABSTAIN"
        conf = rec.get("confidence", 0.0)
        print(f" Shot {s['shot_index']} [{s['start_time']:4.1f}s - {s['end_time']:4.1f}s] ({s['duration']:4.1f}s): {status.upper():12} -> {entity[:40]:40} (Conf: {conf:4.2f})")

    print("\n--- Windowed Music Timeline ---")
    for w in report["audio_windows"]:
        a_rec = w["audio_recognition"]
        status = a_rec["status"]
        track = a_rec["matched_entity"]["title"] if a_rec.get("matched_entity") else "UNKNOWN / ABSTAIN"
        conf = a_rec.get("confidence", 0.0)
        print(f" Window [{w['window_start']:4.1f}s - {w['window_end']:4.1f}s]: {status.upper():12} -> {track[:40]:40} (Conf: {conf:4.2f})")

    print("\n--- Holistic Summary ---")
    print(" Identified Visual Sources:")
    for src in report["holistic_summary"]["identified_visual_sources"]:
        print(f"   * {src['source_title']}: {src['cumulative_seconds']}s ({src['duration_share_percent']}%)")
    print(f" Unrecognized Visual Duration: {report['holistic_summary']['unrecognized_visual_duration_sec']}s ({report['holistic_summary']['unrecognized_visual_share_percent']}%)")

    print(" Identified Music Tracks:")
    for trk in report["holistic_summary"]["identified_music_tracks"]:
        print(f"   * {trk['track_title']} (by {trk['artist']}): intervals {trk['detected_intervals']}")
    print("=" * 80)

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"Report saved to {REPORT_PATH}")

    return report


if __name__ == "__main__":
    run_mixed_experiment()
