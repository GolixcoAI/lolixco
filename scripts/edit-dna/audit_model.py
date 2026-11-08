#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — HONEST MODEL VALIDATION & UNCERTAINTY AUDIT
1. Weight stability & sensitivity analysis across LOOCV folds.
2. Sensitivity to prior regularization parameter (lambda).
3. Distinguishes training pairwise agreement from held-out (leave-one-pair-out) accuracy.
4. Evaluates empirical coverage of nominal 90% prediction intervals.
"""

import os
import sys
import json
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from preference_learner import (
    PersonalizedPreferenceModel,
    FEATURE_KEYS,
    DEFAULT_RUBRIC,
    load_json,
    OWNER_RATINGS_FILE,
    OWNER_COMPARISONS_FILE,
)


def run_honest_audit():
    ratings = load_json(OWNER_RATINGS_FILE, {}).get("ratings", {})
    comparisons = load_json(OWNER_COMPARISONS_FILE, {}).get("comparisons", [])

    edits = [v for v in ratings.values() if "component_scores" in v and "overall_subjective_score" in v]
    N = len(edits)

    print("\n" + "=" * 68)
    print("      LOLIXCO EDIT DNA — HONEST MODEL VALIDATION & AUDIT")
    print("=" * 68)
    print(f" Sample Count: {N} reviews | Pairwise Comparisons: {len(comparisons)} pairs")

    # 1. LOOCV Weight Stability Across 11 Folds
    fold_weights = []
    interval_hits = 0
    loocv_errors = []
    fold_details = []

    for i in range(N):
        train_edits = {f"e_{idx}": e for idx, e in enumerate(edits) if idx != i}
        held_out = edits[i]

        m = PersonalizedPreferenceModel()
        m.fit(train_edits, comparisons)
        fold_weights.append([float(m.learned_weights[k_idx]) for k_idx in range(len(FEATURE_KEYS))])

        pred = m.predict_mode_a(held_out["component_scores"])
        actual = held_out["overall_subjective_score"]
        err = abs(actual - pred["predicted_score"])
        loocv_errors.append(err)

        lower, upper = pred["confidence_interval_90"]
        hit = (lower <= actual <= upper)
        if hit:
            interval_hits += 1

        fold_details.append({
            "asset": held_out.get("canonical_id") or held_out.get("asset_id"),
            "actual": actual,
            "pred": pred["predicted_score"],
            "lower": lower,
            "upper": upper,
            "hit": hit,
            "err": err,
        })

    fold_weights = np.array(fold_weights)
    print("\n1. LEAVE-ONE-OUT WEIGHT STABILITY (11 FOLDS):")
    print(f"   {'Dimension':25} | {'Mean':6} | {'Std':5} | {'Min':5} | {'Max':5} | {'Rubric':6}")
    print("   " + "-" * 62)
    for k_idx, k in enumerate(FEATURE_KEYS):
        vals = fold_weights[:, k_idx]
        rubric_val = DEFAULT_RUBRIC[k] * 100
        print(f"   {k:25} | {np.mean(vals)*100:5.1f}% | {np.std(vals)*100:4.1f}% | {np.min(vals)*100:4.1f}% | {np.max(vals)*100:4.1f}% | {rubric_val:5.1f}%")

    # 2. Empirical Coverage of 90% Prediction Intervals
    empirical_coverage = interval_hits / N * 100
    print("\n2. EMPIRICAL COVERAGE OF NOMINAL 90% PREDICTION INTERVALS:")
    print(f"   Empirical Coverage: {interval_hits}/{N} ({empirical_coverage:.1f}%)")
    print(f"   LOOCV MAE:          {np.mean(loocv_errors):.3f} points")
    print("   Interval Coverage Breakdown:")
    for fd in fold_details:
        status_sym = "[OK]" if fd["hit"] else "[OUTLIER MISS]"
        print(f"     {status_sym:15} {fd['asset']:15} Actual: {fd['actual']:3.1f} | Pred: {fd['pred']:4.2f} [{fd['lower']:4.2f} .. {fd['upper']:4.2f}] Err: {fd['err']:4.2f}")

    # 3. Sensitivity to Regularization (Lambda)
    print("\n3. SENSITIVITY TO PRIOR REGULARIZATION (LAMBDA):")
    print(f"   {'Lambda':6} | {'Visual':6} | {'Beat':6} | {'Trans':6} | {'Pacing':6} | {'Story':6} | {'Orig':6}")
    print("   " + "-" * 56)
    for lam in [0.1, 0.5, 1.0, 2.0, 5.0, 10.0]:
        m = PersonalizedPreferenceModel()
        m.fit(ratings, comparisons, reg_lambda=lam)
        w = {k: float(m.learned_weights[i]) for i, k in enumerate(FEATURE_KEYS)}
        print(f"   {lam:6.1f} | {w['visual_quality']*100:5.1f}% | {w['beat_synchronization']*100:5.1f}% | {w['transitions']*100:5.1f}% | {w['pacing']*100:5.1f}% | {w['storytelling_emotion']*100:5.1f}% | {w['originality_creativity']*100:5.1f}%")

    # 4. Training vs. Held-Out Pairwise Accuracy
    print("\n4. TRAINING VS. HELD-OUT PAIRWISE RANKING PERFORMANCE:")
    # Training performance (all 4 comparisons in fit)
    m_full = PersonalizedPreferenceModel()
    m_full.fit(ratings, comparisons)
    train_correct = 0
    for c in comparisons:
        a_id = c.get("candidate_a_canonical") or c.get("candidate_a")
        b_id = c.get("candidate_b_canonical") or c.get("candidate_b")
        rec_a = next((r for r in edits if (r.get("canonical_id") == a_id or r.get("asset_id") == a_id)), None)
        rec_b = next((r for r in edits if (r.get("canonical_id") == b_id or r.get("asset_id") == b_id)), None)
        if rec_a and rec_b:
            s_a = m_full.predict_mode_a(rec_a["component_scores"])["predicted_score"]
            s_b = m_full.predict_mode_a(rec_b["component_scores"])["predicted_score"]
            pred_w = "A" if s_a >= s_b else "B"
            if pred_w == c["winner"]:
                train_correct += 1

    # Leave-One-Pair-Out Cross-Validation
    held_out_pair_correct = 0
    for p_idx in range(len(comparisons)):
        train_comp = [c for idx, c in enumerate(comparisons) if idx != p_idx]
        test_c = comparisons[p_idx]

        m_loo = PersonalizedPreferenceModel()
        m_loo.fit(ratings, train_comp)

        a_id = test_c.get("candidate_a_canonical") or test_c.get("candidate_a")
        b_id = test_c.get("candidate_b_canonical") or test_c.get("candidate_b")
        rec_a = next((r for r in edits if (r.get("canonical_id") == a_id or r.get("asset_id") == a_id)), None)
        rec_b = next((r for r in edits if (r.get("canonical_id") == b_id or r.get("asset_id") == b_id)), None)

        if rec_a and rec_b:
            s_a = m_loo.predict_mode_a(rec_a["component_scores"])["predicted_score"]
            s_b = m_loo.predict_mode_a(rec_b["component_scores"])["predicted_score"]
            pred_w = "A" if s_a >= s_b else "B"
            is_correct = (pred_w == test_c["winner"])
            if is_correct:
                held_out_pair_correct += 1
            print(f"   Pair {p_idx+1} ({a_id} vs {b_id}): Pred={pred_w} ({s_a:.2f} vs {s_b:.2f}) | Actual={test_c['winner']} | Correct={is_correct}")

    print(f"\n   Training Pairwise Agreement:         {train_correct}/{len(comparisons)} ({train_correct/len(comparisons)*100:.1f}%)")
    print(f"   Held-Out (Leave-One-Pair-Out) Acc:   {held_out_pair_correct}/{len(comparisons)} ({held_out_pair_correct/len(comparisons)*100:.1f}%)")
    print("=" * 68)

    return {
        "loocv_mae": float(np.mean(loocv_errors)),
        "empirical_coverage": float(empirical_coverage),
        "held_out_pairwise_accuracy": float(held_out_pair_correct / len(comparisons)),
        "training_pairwise_accuracy": float(train_correct / len(comparisons)),
    }


if __name__ == "__main__":
    run_honest_audit()
