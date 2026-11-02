#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — OWNER RATING LAB
Part of Phase 2: Real Video Analysis Experiment

A local-only interactive laboratory allowing the owner to:
1. Rate individual edits (YouTube URL or local asset ID) across 6 dimensions.
2. Record pairwise A/B preference comparisons with written rationales.
3. Dynamically adjust category rubric weights.
4. Save and revise ratings as private structured JSON.
5. Train preference learning models and observe how predictions adapt.
"""

import os
import sys
import json
import time
import argparse
from typing import Dict, Any, List

DATA_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../data/edit-dna")
)
RATINGS_FILE = os.path.join(DATA_DIR, "owner_ratings.json")
COMPARISONS_FILE = os.path.join(DATA_DIR, "owner_comparisons.json")
RUBRIC_FILE = os.path.join(DATA_DIR, "owner_rubric.json")

os.makedirs(DATA_DIR, exist_ok=True)

DEFAULT_RUBRIC = {
    "beat_synchronization": 0.25,
    "transitions": 0.20,
    "pacing": 0.15,
    "visual_quality": 0.15,
    "storytelling_emotion": 0.15,
    "originality_creativity": 0.10,
}


def load_json(path, default):
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_rubric():
    return load_json(RUBRIC_FILE, DEFAULT_RUBRIC)


def set_rubric_weights(weights: Dict[str, float]):
    total = sum(max(0.0, float(w)) for w in weights.values())
    if total <= 0:
        norm = DEFAULT_RUBRIC
    else:
        norm = {k: round(max(0.0, float(v)) / total, 4) for k, v in weights.items()}
    save_json(RUBRIC_FILE, norm)
    return norm


def record_rating(
    asset_id: str,
    intake_type: str,
    component_scores: Dict[str, float],
    overall_score: float,
    notes: str = ""
):
    ratings_db = load_json(RATINGS_FILE, {"ratings": {}})
    existing = ratings_db["ratings"].get(asset_id)

    rubric = get_rubric()
    # Calculate rubric weighted score
    weighted_calc = sum(
        rubric.get(k, 0.15) * component_scores.get(k, 5.0)
        for k in rubric.keys()
    )

    is_revision = existing is not None
    revision_count = (existing.get("revision_count", 0) + 1) if is_revision else 1

    entry = {
        "asset_id": asset_id,
        "intake_type": intake_type,  # 'youtube_url' or 'local_asset'
        "telemetry_provenance": (
            "url_high_level_estimate_only"
            if intake_type == "youtube_url"
            else "local_offline_dsp_measured"
        ),
        "component_scores": {
            "beat_synchronization": float(component_scores.get("beat_synchronization", 5.0)),
            "transitions": float(component_scores.get("transitions", 5.0)),
            "pacing": float(component_scores.get("pacing", 5.0)),
            "visual_quality": float(component_scores.get("visual_quality", 5.0)),
            "storytelling_emotion": float(component_scores.get("storytelling_emotion", 5.0)),
            "originality_creativity": float(component_scores.get("originality_creativity", 5.0)),
        },
        "overall_subjective_score": float(overall_score),
        "rubric_weighted_score": round(weighted_calc, 2),
        "free_text_notes": notes,
        "revision_count": revision_count,
        "created_at": existing.get("created_at") if existing else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    ratings_db["ratings"][asset_id] = entry
    save_json(RATINGS_FILE, ratings_db)
    return entry


def record_comparison(
    candidate_a: str,
    candidate_b: str,
    winner: str,  # 'A' or 'B'
    margin: str = "significant",
    rationale: str = ""
):
    if winner not in ("A", "B"):
        raise ValueError("Winner must be 'A' or 'B'")

    comparisons_db = load_json(COMPARISONS_FILE, {"comparisons": []})

    entry = {
        "comparison_id": f"cmp_{int(time.time()*1000)}",
        "candidate_a": candidate_a,
        "candidate_b": candidate_b,
        "winner": winner,
        "chosen_asset": candidate_a if winner == "A" else candidate_b,
        "margin": margin,
        "rationale": rationale,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    comparisons_db["comparisons"].append(entry)
    save_json(COMPARISONS_FILE, comparisons_db)
    return entry


def sigmoid(z):
    if z > 15: return 1.0
    if z < -15: return 0.0
    import math
    return 1.0 / (1.0 + math.exp(-z))


def train_preference_model(learning_rate=0.08, iterations=100, l2_reg=0.02):
    """
    Trains Bradley-Terry preference weights theta based on stored A/B comparisons.
    Uses component scores as feature vectors.
    """
    ratings_db = load_json(RATINGS_FILE, {"ratings": {}})
    comparisons_db = load_json(COMPARISONS_FILE, {"comparisons": []})

    ratings = ratings_db.get("ratings", {})
    comparisons = comparisons_db.get("comparisons", [])

    feature_keys = [
        "beat_synchronization",
        "transitions",
        "pacing",
        "visual_quality",
        "storytelling_emotion",
        "originality_creativity",
    ]

    # Initialize weights to 1.0
    weights = [1.0 for _ in feature_keys]

    if not comparisons:
        return {
            "status": "insufficient_data",
            "message": "No pairwise comparisons recorded yet. Add comparisons using --compare.",
            "weights": {k: 1.0 for k in feature_keys}
        }

    valid_comparisons = []
    for c in comparisons:
        a_id = c["candidate_a"]
        b_id = c["candidate_b"]
        if a_id in ratings and b_id in ratings:
            feat_a = [ratings[a_id]["component_scores"][k] for k in feature_keys]
            feat_b = [ratings[b_id]["component_scores"][k] for k in feature_keys]
            y = 1.0 if c["winner"] == "A" else 0.0
            valid_comparisons.append((feat_a, feat_b, y, a_id, b_id))

    if not valid_comparisons:
        return {
            "status": "unlinked_comparisons",
            "message": "Comparisons exist, but referenced assets lack individual component ratings. Rate assets first.",
            "weights": {k: 1.0 for k in feature_keys}
        }

    # Gradient descent on logistic log-likelihood
    m = len(valid_comparisons)
    n_feat = len(feature_keys)

    for _ in range(iterations):
        grad = [0.0] * n_feat
        for feat_a, feat_b, y, _, _ in valid_comparisons:
            delta = [feat_a[j] - feat_b[j] for j in range(n_feat)]
            dot = sum(weights[j] * delta[j] for j in range(n_feat))
            p_a = sigmoid(dot)
            err = y - p_a
            for j in range(n_feat):
                grad[j] += err * delta[j]

        for j in range(n_feat):
            grad[j] -= l2_reg * weights[j]
            weights[j] += learning_rate * (grad[j] / m)

    learned_weights = {feature_keys[j]: round(weights[j], 4) for j in range(n_feat)}

    # Compute predicted utility for all rated assets
    predictions = {}
    for aid, r in ratings.items():
        feat = [r["component_scores"][k] for k in feature_keys]
        utility = round(sum(weights[j] * feat[j] for j in range(n_feat)), 3)
        predictions[aid] = {
            "utility_score": utility,
            "overall_owner_score": r["overall_subjective_score"]
        }

    return {
        "status": "trained",
        "comparisons_used": len(valid_comparisons),
        "learned_weights": learned_weights,
        "asset_predictions": predictions,
        "caveat": "Preferences updated on training set. Real predictive accuracy requires held-out validation."
    }


def main():
    parser = argparse.ArgumentParser(description="Lolixco Edit DNA — Owner Rating Lab")
    subparsers = parser.add_subparsers(dest="action")

    # Rate command
    rate_p = subparsers.add_parser("rate", help="Record or revise an edit rating")
    rate_p.add_argument("asset_id", help="Asset ID or YouTube URL")
    rate_p.add_argument("--type", choices=["local_asset", "youtube_url"], default="local_asset")
    rate_p.add_argument("--sync", type=float, default=5.0, help="Beat synchronization (1-10)")
    rate_p.add_argument("--trans", type=float, default=5.0, help="Transitions rating (1-10)")
    rate_p.add_argument("--pacing", type=float, default=5.0, help="Pacing rating (1-10)")
    rate_p.add_argument("--visuals", type=float, default=5.0, help="Visual quality (1-10)")
    rate_p.add_argument("--story", type=float, default=5.0, help="Storytelling/emotion (1-10)")
    rate_p.add_argument("--orig", type=float, default=5.0, help="Originality (1-10)")
    rate_p.add_argument("--overall", type=float, required=True, help="Overall subjective score (1-10)")
    rate_p.add_argument("--notes", default="", help="Free text critique / rationale")

    # Compare command
    cmp_p = subparsers.add_parser("compare", help="Record pairwise comparison between two edits")
    cmp_p.add_argument("candidate_a", help="Asset ID for Edit A")
    cmp_p.add_argument("candidate_b", help="Asset ID for Edit B")
    cmp_p.add_argument("--winner", choices=["A", "B"], required=True, help="Winner: A or B")
    cmp_p.add_argument("--margin", choices=["slight", "significant"], default="significant")
    cmp_p.add_argument("--notes", default="", help="Why this edit won")

    # Set weights command
    w_p = subparsers.add_parser("set-rubric", help="Adjust rubric category weights")
    w_p.add_argument("--sync", type=float, default=0.25)
    w_p.add_argument("--trans", type=float, default=0.20)
    w_p.add_argument("--pacing", type=float, default=0.15)
    w_p.add_argument("--visuals", type=float, default=0.15)
    w_p.add_argument("--story", type=float, default=0.15)
    w_p.add_argument("--orig", type=float, default=0.10)

    # Train command
    subparsers.add_parser("train", help="Train preference model and display utility predictions")

    # List command
    subparsers.add_parser("list", help="List all recorded ratings and comparisons")

    args = parser.parse_args()

    if args.action == "rate":
        scores = {
            "beat_synchronization": args.sync,
            "transitions": args.trans,
            "pacing": args.pacing,
            "visual_quality": args.visuals,
            "storytelling_emotion": args.story,
            "originality_creativity": args.orig,
        }
        res = record_rating(args.asset_id, args.type, scores, args.overall, args.notes)
        print(f"\n[OWNER RATING LAB] Recorded rating for: {args.asset_id}")
        print(f"  Provenance: {res['telemetry_provenance']}")
        print(f"  Overall Score: {res['overall_subjective_score']} | Rubric Weighted: {res['rubric_weighted_score']}")
        print(f"  Revision Count: {res['revision_count']}")
        if res['free_text_notes']:
            print(f"  Notes: {res['free_text_notes']}")

    elif args.action == "compare":
        res = record_comparison(args.candidate_a, args.candidate_b, args.winner, args.margin, args.notes)
        print(f"\n[OWNER RATING LAB] Recorded comparison: {res['candidate_a']} vs {res['candidate_b']}")
        print(f"  Winner: Edit {res['winner']} ({res['chosen_asset']}) [{res['margin']} margin]")
        if res['rationale']:
            print(f"  Rationale: {res['rationale']}")

    elif args.action == "set-rubric":
        w = {
            "beat_synchronization": args.sync,
            "transitions": args.trans,
            "pacing": args.pacing,
            "visual_quality": args.visuals,
            "storytelling_emotion": args.story,
            "originality_creativity": args.orig,
        }
        norm = set_rubric_weights(w)
        print("\n[OWNER RATING LAB] Rubric weights updated and normalized:")
        for k, v in norm.items():
            print(f"  {k:25}: {v*100:.1f}%")

    elif args.action == "train":
        res = train_preference_model()
        print("\n" + "=" * 60)
        print("         OWNER PREFERENCE LEARNING RESULTS")
        print("=" * 60)
        print(f" Status:           {res['status']}")
        if res['status'] == 'trained':
            print(f" Comparisons Used: {res['comparisons_used']}")
            print("\n Learned Dimension Weights (theta):")
            for dim, weight in res['learned_weights'].items():
                print(f"   {dim:25}: {weight:+0.4f}")
            print("\n Predicted Utilities for Rated Edits:")
            for aid, pred in res['asset_predictions'].items():
                print(f"   {aid:25}: Utility: {pred['utility_score']:+0.2f} (Owner Score: {pred['overall_owner_score']})")
            print(f"\n Notice: {res['caveat']}")
        else:
            print(f" Message: {res.get('message')}")
        print("=" * 60 + "\n")

    elif args.action == "list":
        ratings_db = load_json(RATINGS_FILE, {"ratings": {}})
        cmps_db = load_json(COMPARISONS_FILE, {"comparisons": []})
        rubric = get_rubric()

        print("\n" + "=" * 70)
        print("                  LOLIXCO OWNER RATING LAB DATABASE")
        print("=" * 70)
        print(" CURRENT RUBRIC WEIGHTS:")
        for k, v in rubric.items():
            print(f"   {k:25}: {v*100:.1f}%")

        print("\n RECORDED EDIT RATINGS:")
        if not ratings_db.get("ratings"):
            print("   (No ratings recorded yet)")
        for aid, r in ratings_db.get("ratings", {}).items():
            print(f"   * {aid} [{r['intake_type']}]")
            print(f"     Overall: {r['overall_subjective_score']} | Weighted: {r['rubric_weighted_score']} | Rev: {r['revision_count']}")
            print(f"     Provenance: {r['telemetry_provenance']}")
            if r.get("free_text_notes"):
                print(f"     Critique: \"{r['free_text_notes']}\"")

        print("\n RECORDED PAIRWISE COMPARISONS:")
        if not cmps_db.get("comparisons"):
            print("   (No comparisons recorded yet)")
        for c in cmps_db.get("comparisons", []):
            print(f"   * {c['candidate_a']} vs {c['candidate_b']} -> Winner: Edit {c['winner']} ({c['margin']})")
            if c.get("rationale"):
                print(f"     Why: \"{c['rationale']}\"")
        print("=" * 70 + "\n")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
