#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — BENCHMARK EVALUATOR
Part of Phase 2: Real Video Analysis Experiment

Executes the offline analyzer pipeline against all 10 ground-truth benchmark
video assets, computes empirical Precision, Recall, F1, timing errors,
false cuts from flashes, audio error, runtime, and RAM usage.
"""

import os
import sys
import json
import time

from offline_analyzer import analyze_video_pipeline

BENCHMARK_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../test-assets/benchmarks")
)
GT_PATH = os.path.join(BENCHMARK_DIR, "ground_truth.json")


def evaluate_cut_accuracy(detected_cuts, expected_cuts, tolerance_sec=0.100):
    """
    Computes precision, recall, F1 and timing error in ms/frames.
    tolerance_sec = 0.100s (~3 frames at 30fps).
    """
    if not expected_cuts and not detected_cuts:
        return {
            "precision": 1.0,
            "recall": 1.0,
            "f1": 1.0,
            "true_positives": 0,
            "false_positives": 0,
            "false_negatives": 0,
            "mean_error_ms": 0.0,
            "mean_error_frames": 0.0
        }

    if not expected_cuts:
        return {
            "precision": 0.0,
            "recall": 1.0,
            "f1": 0.0,
            "true_positives": 0,
            "false_positives": len(detected_cuts),
            "false_negatives": 0,
            "mean_error_ms": 0.0,
            "mean_error_frames": 0.0
        }

    if not detected_cuts:
        return {
            "precision": 1.0,
            "recall": 0.0,
            "f1": 0.0,
            "true_positives": 0,
            "false_positives": 0,
            "false_negatives": len(expected_cuts),
            "mean_error_ms": 0.0,
            "mean_error_frames": 0.0
        }

    matched_gt = set()
    matched_det = set()
    errors_ms = []

    for d_idx, d_time in enumerate(detected_cuts):
        best_gt_idx = None
        min_err = float("inf")
        for g_idx, g_time in enumerate(expected_cuts):
            err = abs(d_time - g_time)
            if err <= tolerance_sec and err < min_err and g_idx not in matched_gt:
                min_err = err
                best_gt_idx = g_idx

        if best_gt_idx is not None:
            matched_gt.add(best_gt_idx)
            matched_det.add(d_idx)
            errors_ms.append(min_err * 1000.0)

    tp = len(matched_gt)
    fp = len(detected_cuts) - len(matched_det)
    fn = len(expected_cuts) - len(matched_gt)

    precision = round(tp / (tp + fp), 3) if (tp + fp) > 0 else 0.0
    recall = round(tp / (tp + fn), 3) if (tp + fn) > 0 else 0.0
    f1 = round((2 * precision * recall) / (precision + recall), 3) if (precision + recall) > 0 else 0.0

    mean_err_ms = round(sum(errors_ms) / len(errors_ms), 1) if errors_ms else 0.0
    mean_err_frames = round(mean_err_ms / (1000.0 / 30.0), 2)

    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "mean_error_ms": mean_err_ms,
        "mean_error_frames": mean_err_frames
    }


def run_benchmark():
    if not os.path.isfile(GT_PATH):
        raise FileNotFoundError(f"Ground truth file missing: {GT_PATH}")

    with open(GT_PATH, "r", encoding="utf-8") as f:
        ground_truth = json.load(f)

    results = []
    print("\n" + "=" * 80)
    print("      LOLIXCO EDIT DNA — PHASE 2 GROUND-TRUTH BENCHMARK EXECUTION")
    print("=" * 80)

    for bench_key, gt in ground_truth.items():
        vpath = gt["file"]
        print(f"\nEvaluating: {gt['filename']} ({gt['description']})")

        report = analyze_video_pipeline(vpath)

        det_cuts = report["editing_pacing"]["detected_cut_timestamps"]
        exp_cuts = gt.get("expected_cuts", [])

        # Evaluate Cut Detection Accuracy
        cut_metrics = evaluate_cut_accuracy(det_cuts, exp_cuts, tolerance_sec=0.100)

        # Audio accuracy
        exp_bpm = gt.get("expected_bpm")
        det_bpm = report["audio_intelligence"]["estimated_bpm"]
        bpm_err_pct = None
        if exp_bpm and det_bpm:
            bpm_err_pct = round(abs(det_bpm - exp_bpm) / exp_bpm * 100.0, 1)

        # Strobe / False Cut Evaluation
        strobe_warnings = report["visual_characteristics"]["flash_strobe_warnings_count"]
        expected_flashes = gt.get("expected_flashes", [])

        # Audio Clipping Check
        det_clipping = report["audio_intelligence"]["engineering"]["clipping_detected"]
        exp_clipping = gt.get("expected_clipping", False)

        res_item = {
            "benchmark_id": bench_key,
            "filename": gt["filename"],
            "description": gt["description"],
            "expected_cuts_count": len(exp_cuts),
            "detected_cuts_count": len(det_cuts),
            "expected_cuts": exp_cuts,
            "detected_cuts": det_cuts,
            "cut_metrics": cut_metrics,
            "expected_bpm": exp_bpm,
            "detected_bpm": det_bpm,
            "bpm_error_percent": bpm_err_pct,
            "strobe_warnings_count": strobe_warnings,
            "expected_flashes_count": len(expected_flashes),
            "has_audio": report["audio_intelligence"]["has_audio"],
            "clipping_detected": det_clipping,
            "expected_clipping": exp_clipping,
            "beat_sync_index": report["synchronization"]["beat_sync_index"],
            "mean_sync_delta_ms": report["synchronization"]["mean_sync_delta_ms"],
            "runtime_seconds": report["execution_telemetry"]["runtime_seconds"],
            "peak_ram_mb": report["execution_telemetry"]["peak_ram_mb"],
            "notes": gt.get("notes", "")
        }

        results.append(res_item)

        print(f"  -> Cuts: Expected {len(exp_cuts)}, Detected {len(det_cuts)} | F1: {cut_metrics['f1']} (P: {cut_metrics['precision']}, R: {cut_metrics['recall']})")
        print(f"  -> Cut Timing Error: {cut_metrics['mean_error_ms']} ms ({cut_metrics['mean_error_frames']} frames)")
        if exp_bpm:
            print(f"  -> BPM: Expected {exp_bpm}, Detected {det_bpm} (Error: {bpm_err_pct}%)")
        print(f"  -> Strobes/Flashes: Warnings: {strobe_warnings} (Expected flashes: {len(expected_flashes)})")
        print(f"  -> Runtime: {report['execution_telemetry']['runtime_seconds']}s | RAM: {report['execution_telemetry']['peak_ram_mb']} MB")

    # Aggregate Metrics
    total_tp = sum(r["cut_metrics"]["true_positives"] for r in results)
    total_fp = sum(r["cut_metrics"]["false_positives"] for r in results)
    total_fn = sum(r["cut_metrics"]["false_negatives"] for r in results)

    agg_precision = round(total_tp / (total_tp + total_fp), 3) if (total_tp + total_fp) > 0 else 0.0
    agg_recall = round(total_tp / (total_tp + total_fn), 3) if (total_tp + total_fn) > 0 else 0.0
    agg_f1 = round((2 * agg_precision * agg_recall) / (agg_precision + agg_recall), 3) if (agg_precision + agg_recall) > 0 else 0.0

    valid_timing_errors = [r["cut_metrics"]["mean_error_ms"] for r in results if r["cut_metrics"]["true_positives"] > 0]
    agg_timing_err_ms = round(sum(valid_timing_errors) / len(valid_timing_errors), 1) if valid_timing_errors else 0.0

    total_runtime = round(sum(r["runtime_seconds"] for r in results), 2)
    mean_ram = round(sum(r["peak_ram_mb"] for r in results) / len(results), 1)

    summary = {
        "evaluated_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "total_benchmark_videos": len(results),
        "aggregate_cut_detection": {
            "overall_precision": agg_precision,
            "overall_recall": agg_recall,
            "overall_f1": agg_f1,
            "total_true_positives": total_tp,
            "total_false_positives": total_fp,
            "total_false_negatives": total_fn,
            "mean_cut_timing_error_ms": agg_timing_err_ms,
            "mean_cut_timing_error_frames": round(agg_timing_err_ms / (1000.0 / 30.0), 2)
        },
        "performance_profile": {
            "total_runtime_seconds": total_runtime,
            "average_runtime_per_video_seconds": round(total_runtime / len(results), 2),
            "mean_peak_ram_mb": mean_ram
        },
        "per_video_results": results
    }

    out_json = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../docs/research/PHASE2_BENCHMARK_RESULTS.json")
    )
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 80)
    print("                    AGGREGATE BENCHMARK RESULTS")
    print("=" * 80)
    print(f" Total Clips Evaluated:         {len(results)}")
    print(f" Overall Cut Precision:         {agg_precision} ({agg_precision*100:.1f}%)")
    print(f" Overall Cut Recall:            {agg_recall} ({agg_recall*100:.1f}%)")
    print(f" Overall Cut F1-Score:          {agg_f1} ({agg_f1*100:.1f}%)")
    print(f" Mean Timing Error on Cuts:     {agg_timing_err_ms} ms (~{round(agg_timing_err_ms/33.3, 1)} frames)")
    print(f" Total Benchmark Suite Runtime: {total_runtime} s")
    print(f" Mean Peak RAM Consumption:     {mean_ram} MB")
    print(f" Results written to:            {out_json}")
    print("=" * 80 + "\n")

    return summary


if __name__ == "__main__":
    run_benchmark()

