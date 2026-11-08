#!/usr/bin/env python3
"""
Lolixco Edit DNA — Owner Model Honest Evaluation Framework (Phase 6)
Evaluates preference models on the 11 real owner reviews and 4 A/B comparisons.

Protocols:
  1. Strict LOOCV (Leave-One-Out Cross-Validation) on N=11 real ratings.
  2. Benchmarks against:
     - Baseline Mean Predictor (predicts held-out mean ~6.75)
     - Uniform Equal-Weight Rubric (weights = 1/6 for each dimension)
  3. Evaluates A/B pairwise concordance on 4 ground-truth comparisons.
  4. Removes uncalibrated +/-0.85 90% confidence claims; computes honest empirical residual intervals.
  5. Scans inbox for next 5-10 diverse candidate edits to rate.
"""

import os
import sys
import json
import numpy as np
from typing import Dict, Any, List, Tuple


RATINGS_FILE = os.path.expanduser("~/.lolixco-edit-dna/owner_ratings.json")
COMPARISONS_FILE = os.path.expanduser("~/.lolixco-edit-dna/owner_comparisons.json")
INBOX_DIR = "/home/rohan/lolixco-owner-media/inbox"
OUTPUT_REPORT_DIR = "data/edit-dna/owner_evaluations"
os.makedirs(OUTPUT_REPORT_DIR, exist_ok=True)

CATEGORIES = [
    "beat_synchronization",
    "transitions",
    "pacing",
    "storytelling_emotion",
    "originality_creativity",
    "visual_quality",
]


def load_owner_data() -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    """Loads 11 ratings and 4 comparisons safely."""
    if not os.path.isfile(RATINGS_FILE):
        raise FileNotFoundError(f"Ratings file missing: {RATINGS_FILE}")
    
    with open(RATINGS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    ratings_dict = data.get("ratings", {}) if "ratings" in data else data
    ratings_list = list(ratings_dict.values())

    # Create canonical map
    ratings_by_id = {}
    for r in ratings_list:
        cid = r.get("canonical_id") or r.get("youtube_id") or r.get("asset_id")
        if cid:
            ratings_by_id[cid] = r
        if "original_url" in r:
            ratings_by_id[r["original_url"]] = r
        if "asset_id" in r:
            ratings_by_id[r["asset_id"]] = r

    comparisons_list = []
    if os.path.isfile(COMPARISONS_FILE):
        with open(COMPARISONS_FILE, "r", encoding="utf-8") as f:
            c_data = json.load(f)
            comparisons_list = c_data.get("comparisons", []) if isinstance(c_data, dict) else c_data

    return ratings_list, ratings_by_id, comparisons_list


def fit_constrained_linear_weights(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    """
    Fits non-negative normalized linear weights using Projected Gradient Descent or NNLS.
    Solves min ||X w - y||^2 subject to w_i >= 0 and sum(w) = 1.
    """
    # Simple, stable projected gradient descent
    n_features = X.shape[1]
    w = np.ones(n_features) / n_features
    lr = 0.005
    for _ in range(2000):
        pred = X @ w
        grad = 2 * X.T @ (pred - y)
        w = w - lr * grad
        w = np.maximum(w, 0.001)
        w = w / np.sum(w)
    return w


def run_loocv_evaluation(ratings: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Runs Leave-One-Out Cross-Validation on all ratings.
    Evaluates:
      1. Preference Learner (Constrained regression)
      2. Mean Predictor Baseline
      3. Uniform Rubric (Equal 1/6 weights)
    """
    N = len(ratings)
    if N < 3:
        return {"error": "INSUFFICIENT_EVALUATION_DATA", "n_samples": N}

    def get_comp_scores(r):
        return r.get("component_scores") or r.get("scores") or {}

    def get_overall(r):
        return float(r.get("overall_subjective_score") or r.get("overall_score") or 5.0)

    X = np.array([[float(get_comp_scores(r).get(cat, 5.0)) for cat in CATEGORIES] for r in ratings])
    y = np.array([get_overall(r) for r in ratings])

    errors_model = []
    errors_mean = []
    errors_uniform = []

    preds_model = []
    preds_mean = []
    preds_uniform = []

    weights_distribution = []

    for i in range(N):
        # Hold out sample i
        X_train = np.delete(X, i, axis=0)
        y_train = np.delete(y, i)
        x_test = X[i]
        y_test = y[i]

        # Model 1: Preference Learner fitted on N-1
        w_fitted = fit_constrained_linear_weights(X_train, y_train)
        weights_distribution.append(w_fitted)
        pred_m = float(np.dot(x_test, w_fitted))
        preds_model.append(pred_m)
        errors_model.append(y_test - pred_m)

        # Model 2: Mean Predictor Baseline (predicts mean of y_train)
        pred_base = float(np.mean(y_train))
        preds_mean.append(pred_base)
        errors_mean.append(y_test - pred_base)

        # Model 3: Uniform Rubric
        w_uni = np.ones(len(CATEGORIES)) / len(CATEGORIES)
        pred_uni = float(np.dot(x_test, w_uni))
        preds_uniform.append(pred_uni)
        errors_uniform.append(y_test - pred_uni)

    errors_m = np.array(errors_model)
    errors_b = np.array(errors_mean)
    errors_u = np.array(errors_uniform)

    mae_m = float(np.mean(np.abs(errors_m)))
    rmse_m = float(np.sqrt(np.mean(errors_m ** 2)))

    mae_b = float(np.mean(np.abs(errors_b)))
    rmse_b = float(np.sqrt(np.mean(errors_b ** 2)))

    mae_u = float(np.mean(np.abs(errors_u)))
    rmse_u = float(np.sqrt(np.mean(errors_u ** 2)))

    mean_weights = np.mean(weights_distribution, axis=0)
    std_weights = np.std(weights_distribution, axis=0)

    # Full fit on all 11 samples for reference
    w_full = fit_constrained_linear_weights(X, y)
    full_weights_dict = {CATEGORIES[k]: round(float(w_full[k]), 3) for k in range(len(CATEGORIES))}

    # Empirical residual standard error for uncertainty estimation
    empirical_residual_std = float(np.std(errors_m))

    return {
        "n_samples": N,
        "loocv_metrics": {
            "preference_model": {
                "mae": round(mae_m, 3),
                "rmse": round(rmse_m, 3),
                "residuals": [round(float(e), 3) for e in errors_m],
            },
            "mean_predictor_baseline": {
                "mae": round(mae_b, 3),
                "rmse": round(rmse_b, 3),
                "baseline_mean": round(float(np.mean(y)), 2),
            },
            "uniform_rubric_baseline": {
                "mae": round(mae_u, 3),
                "rmse": round(rmse_u, 3),
            },
        },
        "full_fitted_weights": full_weights_dict,
        "weight_stability": {
            CATEGORIES[k]: {
                "mean": round(float(mean_weights[k]), 3),
                "std": round(float(std_weights[k]), 3),
            }
            for k in range(len(CATEGORIES))
        },
        "empirical_uncertainty": {
            "empirical_mae": round(mae_m, 2),
            "empirical_residual_std": round(empirical_residual_std, 2),
            "honest_claim": (
                f"With N=11 reviews, standard 90% confidence claims are UNCALIBRATED. "
                f"The empirical cross-validated MAE is {mae_m:.2f} points (RMSE {rmse_m:.2f})."
            )
        }
    }


def evaluate_ab_comparisons(
    comparisons: List[Dict[str, Any]],
    ratings_by_id: Dict[str, Dict[str, Any]],
    weights: Dict[str, float]
) -> Dict[str, Any]:
    """Evaluates pairwise ranking accuracy on the owner's 4 comparisons."""
    if not comparisons:
        return {"n_comparisons": 0, "accuracy": None}

    concordant = 0
    total = len(comparisons)
    details = []

    for comp in comparisons:
        winner = comp.get("winner")  # "A" or "B"
        cand_a = comp.get("candidate_a_canonical") or comp.get("candidate_a")
        cand_b = comp.get("candidate_b_canonical") or comp.get("candidate_b")

        rating_a = ratings_by_id.get(cand_a) or ratings_by_id.get(comp.get("candidate_a"))
        rating_b = ratings_by_id.get(cand_b) or ratings_by_id.get(comp.get("candidate_b"))

        s_a = (rating_a.get("component_scores") if rating_a else None) or comp.get("scores_a", {})
        s_b = (rating_b.get("component_scores") if rating_b else None) or comp.get("scores_b", {})

        score_a = sum(float(s_a.get(cat, 5.0)) * weights.get(cat, 1/6) for cat in CATEGORIES)
        score_b = sum(float(s_b.get(cat, 5.0)) * weights.get(cat, 1/6) for cat in CATEGORIES)

        pred_winner = "A" if score_a > score_b else ("B" if score_b > score_a else "TIE")
        is_match = (pred_winner == winner)
        if is_match:
            concordant += 1

        details.append({
            "comparison_id": comp.get("comparison_id", "unknown"),
            "owner_choice": winner,
            "predicted_choice": pred_winner,
            "score_a": round(score_a, 2),
            "score_b": round(score_b, 2),
            "concordant": is_match,
        })

    accuracy = round((concordant / total) * 100.0, 1) if total else 0.0
    return {
        "n_comparisons": total,
        "concordant_pairs": concordant,
        "accuracy_percent": accuracy,
        "details": details,
    }


def scan_inbox_for_diverse_edits() -> List[Dict[str, Any]]:
    """Scans owner inbox directory and recommends next 5-10 diverse edits to rate."""
    if not os.path.isdir(INBOX_DIR):
        return []

    files = [f for f in os.listdir(INBOX_DIR) if f.lower().endswith((".mp4", ".mov", ".mkv", ".webm"))]
    
    # Classify file types by filename cues to suggest a balanced, diverse slate
    recommendations = []
    for f in sorted(files):
        path = os.path.join(INBOX_DIR, f)
        size_mb = round(os.path.getsize(path) / (1024 * 1024), 2)
        f_lower = f.lower()

        # Genre / style heuristic for diversity recommendation
        if "dhurandhar" in f_lower:
            style_tag = "bollywood_action_strobe"
        elif "spider" in f_lower:
            style_tag = "hollywood_superhero_vfx"
        elif "dune" in f_lower:
            style_tag = "cinematic_atmospheric_scifi"
        elif "stranger" in f_lower:
            style_tag = "series_mystery_synthwave"
        elif "jon snow" in f_lower or "got" in f_lower:
            style_tag = "dark_fantasy_narrative"
        elif "goggins" in f_lower or "hard" in f_lower:
            style_tag = "motivational_speech_montage"
        elif "bullet" in f_lower:
            style_tag = "stylized_kinetic_action"
        else:
            style_tag = "general_creative_edit"

        recommendations.append({
            "filename": f,
            "size_mb": size_mb,
            "style_tag": style_tag,
            "recommended_priority": "High" if "dhurandhar" not in f_lower else "Already Analyzed",
        })

    return recommendations


def run_full_evaluation_report() -> Dict[str, Any]:
    """Generates the comprehensive evaluation report."""
    ratings, ratings_by_id, comparisons = load_owner_data()
    loocv_results = run_loocv_evaluation(ratings)
    ab_results = evaluate_ab_comparisons(comparisons, ratings_by_id, loocv_results.get("full_fitted_weights", {}))
    inbox_recommendations = scan_inbox_for_diverse_edits()

    report = {
        "evaluation_title": "Lolixco Edit DNA — Owner Model Honest Evaluation (Phase 6)",
        "timestamp": os.path.expanduser("~"),
        "sample_count_ratings": len(ratings),
        "sample_count_comparisons": len(comparisons),
        "loocv_evaluation": loocv_results,
        "ab_concordance": ab_results,
        "next_recommended_edits_to_rate": [
            r for r in inbox_recommendations if r["recommended_priority"] == "High"
        ][:8],
    }

    out_file = os.path.join(OUTPUT_REPORT_DIR, "owner_model_honest_evaluation.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    private_out_dir = os.path.expanduser("~/.lolixco-edit-dna/owner_evaluations")
    os.makedirs(private_out_dir, exist_ok=True)
    private_out_file = os.path.join(private_out_dir, "owner_model_honest_evaluation.json")
    with open(private_out_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    return report


if __name__ == "__main__":
    report = run_full_evaluation_report()
    print("=== OWNER MODEL HONEST EVALUATION REPORT ===")
    print(f"Total Owner Reviews: {report['sample_count_ratings']}")
    print(f"Total A/B Comparisons: {report['sample_count_comparisons']}")
    loocv = report["loocv_evaluation"]["loocv_metrics"]
    print("\nLOOCV Prediction Errors:")
    print(f"  Preference Model:    MAE={loocv['preference_model']['mae']:.3f}, RMSE={loocv['preference_model']['rmse']:.3f}")
    print(f"  Mean Predictor Base: MAE={loocv['mean_predictor_baseline']['mae']:.3f}, RMSE={loocv['mean_predictor_baseline']['rmse']:.3f} (mean={loocv['mean_predictor_baseline']['baseline_mean']})")
    print(f"  Uniform Rubric Base: MAE={loocv['uniform_rubric_baseline']['mae']:.3f}, RMSE={loocv['uniform_rubric_baseline']['rmse']:.3f}")
    print("\nFitted Owner Weights (on all 11 reviews):")
    for k, v in report["loocv_evaluation"]["full_fitted_weights"].items():
        print(f"  {k:25s}: {v:.3f}")
    print(f"\nA/B Ranking Accuracy: {report['ab_concordance']['accuracy_percent']}% ({report['ab_concordance']['concordant_pairs']}/{report['ab_concordance']['n_comparisons']})")
    print("\nRecommended Next Edits to Rate:")
    for r in report["next_recommended_edits_to_rate"]:
        print(f"  - {r['filename']} ({r['style_tag']}, {r['size_mb']} MB)")
