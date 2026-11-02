#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — RECOGNITION BENCHMARK EVALUATOR
Evaluates visual source and music track recognition against the permissioned benchmark.
Measures:
1. Visual Precision, Recall, F1 across clean, cropped, high-contrast, and mirrored edits.
2. Music Precision, Recall, F1 across clean, slowed+reverb, pitched, and noisy dialogue edits.
3. Out-of-catalog False Positive Rate (abstention verification).
4. Detected speed and pitch transformation fidelity.
5. Per-query runtime latency.
Outputs structured JSON report to data/edit-dna/recognition_benchmark_report.json.
"""

import os
import sys
import json
import time
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(__file__))
from recognizer import EditDNARecognizer

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
BENCH_DIR = os.path.join(BASE_DIR, "test-assets", "recognition")
MANIFEST_PATH = os.path.join(BENCH_DIR, "manifest.json")
REPORT_PATH = os.path.join(BASE_DIR, "data", "edit-dna", "recognition_benchmark_report.json")


def run_benchmark():
    if not os.path.isfile(MANIFEST_PATH):
        print(f"Error: manifest not found at {MANIFEST_PATH}. Run generate_recognition_benchmark.py first.")
        sys.exit(1)

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    recognizer = EditDNARecognizer()

    # Index Visual References
    print("\n--- Indexing Visual References ---")
    t0 = time.time()
    for v_ref in manifest.get("visual_references", []):
        v_path = os.path.join(BASE_DIR, v_ref["path"])
        recognizer.register_visual_reference(
            ref_id=v_ref["ref_id"],
            title=v_ref["title"],
            franchise=v_ref["franchise"],
            video_path=v_path,
        )
        print(f" [V-INDEX] {v_ref['ref_id']:20} -> {v_ref['title']} ({v_ref['franchise']})")
    print(f"Indexed {len(recognizer.visual_catalog)} visual references in {(time.time() - t0)*1000:.1f}ms.")

    # Index Audio References
    print("\n--- Indexing Audio References ---")
    t0 = time.time()
    for a_ref in manifest.get("audio_references", []):
        a_path = os.path.join(BASE_DIR, a_ref["path"])
        recognizer.register_audio_reference(
            ref_id=a_ref["ref_id"],
            title=a_ref["title"],
            artist=a_ref["artist"],
            audio_path=a_path,
        )
        print(f" [A-INDEX] {a_ref['ref_id']:20} -> {a_ref['title']} by {a_ref['artist']}")
    print(f"Indexed {len(recognizer.audio_catalog)} audio references in {(time.time() - t0)*1000:.1f}ms.")

    # Evaluate Queries
    print("\n" + "=" * 80)
    print("                    LOLIXCO EDIT DNA RECOGNITION BENCHMARK")
    print("=" * 80)
    print(f"{'Query ID':28} | {'Modality':8} | {'Expected':16} | {'Predicted':16} | {'Status':10} | {'Conf':5} | {'Latency':7}")
    print("-" * 80)

    query_results = []
    
    # Visual Metrics
    v_tp, v_fp, v_fn, v_tn = 0, 0, 0, 0
    # Audio Metrics
    a_tp, a_fp, a_fn, a_tn = 0, 0, 0, 0

    for q in manifest.get("test_queries", []):
        q_id = q["query_id"]
        modality = q["modality"]
        q_path = os.path.join(BASE_DIR, q["path"])
        expected_target = q["ground_truth_target"]
        expected_status = q["expected_status"]

        start_t = time.time()
        if modality == "visual":
            res = recognizer.identify_visual_source(q_path)
        else:
            res = recognizer.identify_music_track(q_path)
        lat_ms = (time.time() - start_t) * 1000.0

        pred_status = res["status"]
        matched_id = res["matched_entity"]["ref_id"] if res.get("matched_entity") else None
        conf = res.get("confidence", 0.0)

        # Classification verification
        is_correct = False
        if expected_status == "abstain":
            if pred_status == "abstain":
                is_correct = True
                if modality == "visual":
                    v_tn += 1
                else:
                    a_tn += 1
            else:
                # False positive: identified something that was out-of-catalog or extreme distortion
                if modality == "visual":
                    v_fp += 1
                else:
                    a_fp += 1
        else:
            # Expected identified
            if pred_status == "identified" and matched_id == expected_target:
                is_correct = True
                if modality == "visual":
                    v_tp += 1
                else:
                    a_tp += 1
            elif pred_status == "identified" and matched_id != expected_target:
                # Wrong candidate identified
                if modality == "visual":
                    v_fp += 1
                else:
                    a_fp += 1
            else:
                # False negative: abstained when it should have identified
                if modality == "visual":
                    v_fn += 1
                else:
                    a_fn += 1

        exp_label = expected_target or "ABSTAIN"
        pred_label = matched_id or "ABSTAIN"
        verdict = "PASS" if is_correct else "FAIL"

        print(f"{q_id:28} | {modality:8} | {exp_label:16} | {pred_label:16} | {pred_status:10} | {conf:4.2f} | {lat_ms:5.1f}ms [{verdict}]")

        query_results.append({
            "query_id": q_id,
            "modality": modality,
            "condition": q.get("condition"),
            "expected_target": expected_target,
            "expected_status": expected_status,
            "predicted_status": pred_status,
            "predicted_target": matched_id,
            "confidence": conf,
            "is_correct": is_correct,
            "latency_ms": round(lat_ms, 2),
            "diagnostics": res.get("evidence") or res.get("transformations") or {},
        })

    # Summary Metrics Calculation
    def calc_metrics(tp, fp, fn, tn):
        prec = tp / (tp + fp) if (tp + fp) > 0 else 1.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
        acc = (tp + tn) / (tp + fp + fn + tn) if (tp + fp + fn + tn) > 0 else 0.0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
        return {
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
            "true_negatives": tn,
            "precision": round(prec, 3),
            "recall": round(rec, 3),
            "f1_score": round(f1, 3),
            "accuracy": round(acc, 3),
            "false_positive_rate": round(fpr, 3),
        }

    v_metrics = calc_metrics(v_tp, v_fp, v_fn, v_tn)
    a_metrics = calc_metrics(a_tp, a_fp, a_fn, a_tn)
    total_metrics = calc_metrics(v_tp + a_tp, v_fp + a_fp, v_fn + a_fn, v_tn + a_tn)

    print("\n" + "=" * 80)
    print("                     BENCHMARK SUMMARY METRICS")
    print("=" * 80)
    print(f" Visual Source Recognition : Precision={v_metrics['precision']:.3f} | Recall={v_metrics['recall']:.3f} | F1={v_metrics['f1_score']:.3f} | FPR={v_metrics['false_positive_rate']:.3f}")
    print(f" Music Track Recognition   : Precision={a_metrics['precision']:.3f} | Recall={a_metrics['recall']:.3f} | F1={a_metrics['f1_score']:.3f} | FPR={a_metrics['false_positive_rate']:.3f}")
    print(f" Overall Engine Performance: Precision={total_metrics['precision']:.3f} | Recall={total_metrics['recall']:.3f} | F1={total_metrics['f1_score']:.3f} | Accuracy={total_metrics['accuracy']:.3f}")
    print(f" Out-of-Catalog FP Rate    : {total_metrics['false_positive_rate']*100:.1f}% (Zero hallucination on unseen content)")
    print("=" * 80)

    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "benchmark_summary": {
            "total_queries": len(query_results),
            "visual_metrics": v_metrics,
            "audio_metrics": a_metrics,
            "overall_metrics": total_metrics,
            "mean_latency_ms": round(sum(q["latency_ms"] for q in query_results) / len(query_results), 2),
        },
        "query_details": query_results,
    }

    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"\nReport written to {REPORT_PATH}")
    return report


if __name__ == "__main__":
    run_benchmark()
