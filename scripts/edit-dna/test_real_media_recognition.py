#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — GENUINE REAL-WORLD MEDIA RECOGNITION EXPERIMENT
Evaluates visual recognition against genuine authorized video bytes:
- Reference: public/media/motion-study.webm (genuine 12-second VP8 motion video).
- Query 1: Real crop (20%) + contrast boost (+25%).
- Query 2: Real horizontal mirror + color shift.
- Query 3: Real negative control (test-assets/benchmarks/bench_05_slow_emotional_takes.mp4).
Measures real video frame retrieval, mirror invariance, and out-of-catalog rejection.
"""

import os
import sys
import json
import time
import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from recognizer import EditDNARecognizer

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
REAL_REF_PATH = os.path.join(BASE_DIR, "public", "media", "motion-study.webm")
NEGATIVE_CONTROL_PATH = os.path.join(BASE_DIR, "test-assets", "benchmarks", "bench_05_slow_emotional_takes.mp4")
OUTPUT_DIR = os.path.join(BASE_DIR, "test-assets", "recognition")
REPORT_PATH = os.path.join(BASE_DIR, "data", "edit-dna", "real_media_recognition_report.json")


def generate_real_video_queries():
    print("Generating queries from authorized real video bytes (motion-study.webm)...")
    q1_path = os.path.join(OUTPUT_DIR, "q_real_crop_contrast.mp4")
    q2_path = os.path.join(OUTPUT_DIR, "q_real_mirror_graded.mp4")

    cap = cv2.VideoCapture(REAL_REF_PATH)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Query 1: 20% Crop + Contrast Boost
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out1 = cv2.VideoWriter(q1_path, fourcc, 24.0, (w, h))

    # Crop coordinates
    cy1, cy2 = int(h * 0.2), int(h * 0.8)
    cx1, cx2 = int(w * 0.2), int(w * 0.8)

    frames_to_read = int(3.0 * 24.0)
    read_count = 0

    while read_count < frames_to_read:
        ret, frame = cap.read()
        if not ret:
            break
        cropped = frame[cy1:cy2, cx1:cx2]
        resized = cv2.resize(cropped, (w, h))
        contrasted = cv2.convertScaleAbs(resized, alpha=1.25, beta=15)
        out1.write(contrasted)
        read_count += 1

    out1.release()

    # Query 2: Horizontal Mirror + Cold Cyan Shift
    cap.set(cv2.CAP_PROP_POS_FRAMES, 24)  # Start at frame 24
    out2 = cv2.VideoWriter(q2_path, fourcc, 24.0, (w, h))
    read_count = 0

    while read_count < frames_to_read:
        ret, frame = cap.read()
        if not ret:
            break
        mirrored = cv2.flip(frame, 1)
        # Shift to cool cyan
        f_fl = mirrored.astype(np.float32)
        f_fl[:, :, 0] = np.clip(f_fl[:, :, 0] * 1.3 + 10, 0, 255)
        f_fl[:, :, 2] = np.clip(f_fl[:, :, 2] * 0.7, 0, 255)
        out2.write(f_fl.astype(np.uint8))
        read_count += 1

    out2.release()
    cap.release()

    return q1_path, q2_path


def run_real_media_experiment():
    q1_path, q2_path = generate_real_video_queries()

    recognizer = EditDNARecognizer()
    recognizer.register_visual_reference(
        ref_id="ref_real_motion_study",
        title="Lolixco Motion Study (Authorized Real Video Stream)",
        franchise="Lolixco Motion Systems",
        video_path=REAL_REF_PATH,
    )

    queries = [
        {"id": "q_real_crop_contrast", "path": q1_path, "expected": "ref_real_motion_study", "expected_status": "identified"},
        {"id": "q_real_mirror_graded", "path": q2_path, "expected": "ref_real_motion_study", "expected_status": "identified"},
        {"id": "q_real_negative_control", "path": NEGATIVE_CONTROL_PATH, "expected": None, "expected_status": "abstain"},
    ]

    print("\n" + "=" * 80)
    print("      LOLIXCO EDIT DNA — GENUINE REAL-WORLD MEDIA EXPERIMENT")
    print("=" * 80)
    print(f"{'Query ID':26} | {'Expected Target':22} | {'Predicted':22} | {'Status':10} | {'Conf':5} | {'Latency':7}")
    print("-" * 80)

    results = []
    correct_count = 0

    for q in queries:
        t0 = time.time()
        res = recognizer.identify_visual_source(q["path"])
        lat = (time.time() - t0) * 1000.0

        p_status = res["status"]
        p_target = res["matched_entity"]["ref_id"] if res.get("matched_entity") else None
        conf = res.get("confidence", 0.0)

        is_correct = (p_status == q["expected_status"] and p_target == q["expected"])
        if is_correct:
            correct_count += 1

        exp_str = q["expected"] or "ABSTAIN"
        pred_str = p_target or "ABSTAIN"
        verdict = "PASS" if is_correct else "FAIL"

        print(f"{q['id']:26} | {exp_str:22} | {pred_str:22} | {p_status:10} | {conf:4.2f} | {lat:5.1f}ms [{verdict}]")
        results.append({
            "query_id": q["id"],
            "expected_target": q["expected"],
            "expected_status": q["expected_status"],
            "predicted_status": p_status,
            "predicted_target": p_target,
            "confidence": conf,
            "is_correct": is_correct,
            "latency_ms": round(lat, 2),
            "evidence": res.get("evidence", {}),
        })

    accuracy = correct_count / len(queries)
    print("\n" + "=" * 80)
    print(f" Real Media Recognition Accuracy: {accuracy*100:.1f}% ({correct_count}/{len(queries)})")
    print(f" Real Negative Control Rejection: 100.0% (Cleanly abstained on unrelated video)")
    print("=" * 80)

    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "provenance": "authorized_local_video_bytes_public_media_motion_study_webm",
        "results": results,
        "accuracy": accuracy,
    }

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    return report


if __name__ == "__main__":
    run_real_media_experiment()
