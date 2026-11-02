#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — OWNER RATING LAB (LOCAL BROWSER WEB APPLICATION)
FastAPI backend and embedded Black/Yellow single-page application.
Provides:
1. YouTube URL embedded playback (official iframe, no download).
2. Local video playback for authorized assets.
3. 6-dimension scoring + independent overall score.
4. Detailed critique and timestamped notes.
5. Blind AI prediction reveal (hidden until submitted to prevent bias).
6. Side-by-side A/B comparison arena with rationale recording.
7. Bradley-Terry preference intelligence and evolving utility curves.
8. Strict separation of synthetic benchmarks from real owner ratings.
"""

import os
import sys
import json
import time
import math
import re
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel
import uvicorn

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
DATA_DIR = os.path.join(BASE_DIR, "data", "edit-dna")
BENCHMARK_DIR = os.path.join(BASE_DIR, "test-assets", "benchmarks")

OWNER_RATINGS_FILE = os.path.join(DATA_DIR, "owner_ratings.json")
SYNTHETIC_RATINGS_FILE = os.path.join(DATA_DIR, "synthetic_ratings.json")
OWNER_COMPARISONS_FILE = os.path.join(DATA_DIR, "owner_comparisons.json")
SYNTHETIC_COMPARISONS_FILE = os.path.join(DATA_DIR, "synthetic_comparisons.json")
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

FEATURE_KEYS = [
    "beat_synchronization",
    "transitions",
    "pacing",
    "visual_quality",
    "storytelling_emotion",
    "originality_creativity",
]


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


def sigmoid(z):
    if z > 15: return 1.0
    if z < -15: return 0.0
    return 1.0 / (1.0 + math.exp(-z))


def extract_youtube_id(url_or_id: str) -> Optional[str]:
    if not url_or_id:
        return None
    url_or_id = url_or_id.strip()
    # Match standard youtube IDs directly
    if re.match(r"^[a-zA-Z0-9_-]{11}$", url_or_id):
        return url_or_id
    patterns = [
        r"(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})",
        r"^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})",
        r"^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, url_or_id)
        if m:
            return m.group(1)
    return None


def calculate_ai_preference(component_scores: Dict[str, float], scope: str = "owner") -> Dict[str, Any]:
    """Calculates model utility and predicted score based on current preference weights and scope."""
    if scope == "synthetic":
        comparisons_db = load_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": []})
        ratings_db = load_json(SYNTHETIC_RATINGS_FILE, {"ratings": {}})
    elif scope == "all":
        owner_r = load_json(OWNER_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        synth_r = load_json(SYNTHETIC_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        ratings_db = {"ratings": {**synth_r, **owner_r}}
        owner_c = load_json(OWNER_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        synth_c = load_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        comparisons_db = {"comparisons": synth_c + owner_c}
    else:
        comparisons_db = load_json(OWNER_COMPARISONS_FILE, {"comparisons": []})
        ratings_db = load_json(OWNER_RATINGS_FILE, {"ratings": {}})

    ratings = ratings_db.get("ratings", {})
    comparisons = comparisons_db.get("comparisons", [])

    rubric = get_rubric()
    # Initialize weights from rubric so prior reflects rubric expectations:
    weights = [rubric.get(k, 0.1667) * float(len(FEATURE_KEYS)) for k in FEATURE_KEYS]

    # Train on existing comparisons if available
    valid_comparisons = []
    for c in comparisons:
        a_id = c.get("candidate_a")
        b_id = c.get("candidate_b")
        if a_id in ratings and b_id in ratings:
            feat_a = [ratings[a_id]["component_scores"].get(k, 5.0) for k in FEATURE_KEYS]
            feat_b = [ratings[b_id]["component_scores"].get(k, 5.0) for k in FEATURE_KEYS]
            y = 1.0 if c.get("winner") == "A" else 0.0
            valid_comparisons.append((feat_a, feat_b, y))

    if valid_comparisons:
        m = len(valid_comparisons)
        n_feat = len(FEATURE_KEYS)
        for _ in range(80):
            grad = [0.0] * n_feat
            for feat_a, feat_b, y in valid_comparisons:
                delta = [feat_a[j] - feat_b[j] for j in range(n_feat)]
                dot = sum(weights[j] * delta[j] for j in range(n_feat))
                p_a = sigmoid(dot)
                err = y - p_a
                for j in range(n_feat):
                    grad[j] += err * delta[j]
            for j in range(n_feat):
                grad[j] -= 0.02 * weights[j]
                weights[j] += 0.08 * (grad[j] / m)

    feat = [float(component_scores.get(k, 5.0)) for k in FEATURE_KEYS]
    utility = sum(weights[j] * feat[j] for j in range(len(FEATURE_KEYS)))

    rubric_score = sum(rubric.get(k, 0.15) * float(component_scores.get(k, 5.0)) for k in FEATURE_KEYS)

    # Model predicted score incorporates utility shift
    learned_map = {FEATURE_KEYS[j]: round(weights[j], 3) for j in range(len(FEATURE_KEYS))}
    max_utility = sum(weights[j] * 10.0 for j in range(len(FEATURE_KEYS)))
    min_utility = 0.0
    normalized_utility = (utility - min_utility) / (max_utility - min_utility) if max_utility > 0 else 0.5
    predicted_score = round(normalized_utility * 10.0, 1)

    return {
        "utility": round(utility, 2),
        "predicted_score": predicted_score,
        "rubric_calculated_score": round(rubric_score, 2),
        "learned_weights": learned_map,
        "comparisons_count": len(valid_comparisons),
    }


# Models
class RatingRequest(BaseModel):
    asset_id: str
    intake_type: str = "youtube_url"  # 'youtube_url' or 'local_asset'
    scope: str = "owner"  # 'owner' or 'synthetic'
    component_scores: Dict[str, float]
    overall_score: float
    notes: str = ""


class ComparisonRequest(BaseModel):
    candidate_a: str
    candidate_b: str
    winner: str  # 'A' or 'B'
    margin: str = "significant"
    rationale: str = ""
    scope: str = "owner"  # 'owner' or 'synthetic'


class RubricRequest(BaseModel):
    weights: Dict[str, float]


app = FastAPI(title="Lolixco Edit DNA — Owner Rating Lab", version="2.0")


@app.get("/api/ratings")
def list_ratings(scope: str = Query("owner", pattern="^(owner|synthetic|all)$")):
    owner_db = load_json(OWNER_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
    synth_db = load_json(SYNTHETIC_RATINGS_FILE, {"ratings": {}}).get("ratings", {})

    if scope == "owner":
        return {"scope": "owner", "ratings": owner_db}
    elif scope == "synthetic":
        return {"scope": "synthetic", "ratings": synth_db}
    else:
        merged = {**synth_db, **owner_db}
        return {"scope": "all", "ratings": merged}


@app.post("/api/ratings")
def create_or_update_rating(req: RatingRequest):
    target_file = OWNER_RATINGS_FILE if req.scope == "owner" else SYNTHETIC_RATINGS_FILE
    db = load_json(target_file, {"ratings": {}})
    existing = db["ratings"].get(req.asset_id)

    rubric = get_rubric()
    rubric_score = sum(
        rubric.get(k, 0.15) * float(req.component_scores.get(k, 5.0))
        for k in FEATURE_KEYS
    )

    is_revision = existing is not None
    revision_count = (existing.get("revision_count", 0) + 1) if is_revision else 1

    entry = {
        "asset_id": req.asset_id,
        "intake_type": req.intake_type,
        "telemetry_provenance": (
            "url_high_level_estimate_only"
            if req.intake_type == "youtube_url"
            else "local_offline_dsp_measured"
        ),
        "is_synthetic_benchmark": req.scope == "synthetic",
        "component_scores": {
            k: float(req.component_scores.get(k, 5.0)) for k in FEATURE_KEYS
        },
        "overall_subjective_score": float(req.overall_score),
        "rubric_weighted_score": round(rubric_score, 2),
        "free_text_notes": req.notes,
        "revision_count": revision_count,
        "created_at": existing.get("created_at") if existing else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    db["ratings"][req.asset_id] = entry
    save_json(target_file, db)

    # Compute blind AI prediction to reveal POST-submission
    ai_eval = calculate_ai_preference(req.component_scores, scope=req.scope)

    return {
        "status": "success",
        "is_revision": is_revision,
        "rating": entry,
        "ai_prediction_reveal": {
            "predicted_score": ai_eval["predicted_score"],
            "utility": ai_eval["utility"],
            "rubric_calculated_score": round(rubric_score, 2),
            "score_delta": round(float(req.overall_score) - ai_eval["predicted_score"], 2),
            "learned_weights": ai_eval["learned_weights"],
        }
    }


@app.delete("/api/ratings/{asset_id:path}")
def delete_rating(asset_id: str, scope: str = Query("owner")):
    target_file = OWNER_RATINGS_FILE if scope == "owner" else SYNTHETIC_RATINGS_FILE
    db = load_json(target_file, {"ratings": {}})
    if asset_id in db["ratings"]:
        del db["ratings"][asset_id]
        save_json(target_file, db)
        return {"status": "deleted", "asset_id": asset_id}
    raise HTTPException(status_code=404, detail="Rating not found")


@app.get("/api/comparisons")
def list_comparisons(scope: str = Query("owner", pattern="^(owner|synthetic|all)$")):
    if scope == "synthetic":
        return load_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": []})
    elif scope == "all":
        owner_c = load_json(OWNER_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        synth_c = load_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        return {"comparisons": synth_c + owner_c}
    else:
        return load_json(OWNER_COMPARISONS_FILE, {"comparisons": []})


@app.post("/api/comparisons")
def create_comparison(req: ComparisonRequest):
    if req.winner not in ("A", "B"):
        raise HTTPException(status_code=400, detail="Winner must be 'A' or 'B'")

    target_file = SYNTHETIC_COMPARISONS_FILE if req.scope == "synthetic" else OWNER_COMPARISONS_FILE
    db = load_json(target_file, {"comparisons": []})
    entry = {
        "comparison_id": f"cmp_{int(time.time()*1000)}",
        "candidate_a": req.candidate_a,
        "candidate_b": req.candidate_b,
        "winner": req.winner,
        "chosen_asset": req.candidate_a if req.winner == "A" else req.candidate_b,
        "margin": req.margin,
        "rationale": req.rationale,
        "scope": req.scope,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    db["comparisons"].append(entry)
    save_json(target_file, db)

    # Return updated preference model status
    target_rat = SYNTHETIC_RATINGS_FILE if req.scope == "synthetic" else OWNER_RATINGS_FILE
    ratings_db = load_json(target_rat, {"ratings": {}}).get("ratings", {})
    comp_results = []
    for aid, r in ratings_db.items():
        ai = calculate_ai_preference(r["component_scores"], scope=req.scope)
        comp_results.append({
            "asset_id": aid,
            "utility": ai["utility"],
            "owner_score": r["overall_subjective_score"]
        })
    comp_results.sort(key=lambda x: x["utility"], reverse=True)

    return {
        "status": "success",
        "comparison": entry,
        "total_comparisons": len(db["comparisons"]),
        "updated_rankings": comp_results
    }


@app.get("/api/rubric")
def get_rubric_weights():
    return {"rubric": get_rubric()}


@app.post("/api/rubric")
def update_rubric_weights(req: RubricRequest):
    total = sum(max(0.0, float(w)) for w in req.weights.values())
    if total <= 0:
        norm = DEFAULT_RUBRIC
    else:
        norm = {k: round(max(0.0, float(v)) / total, 4) for k, v in req.weights.items()}
    save_json(RUBRIC_FILE, norm)
    return {"status": "success", "rubric": norm}


@app.get("/api/preference-model")
def get_preference_model(scope: str = Query("owner", pattern="^(owner|synthetic|all)$")):
    if scope == "synthetic":
        ratings_db = load_json(SYNTHETIC_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        comparisons_db = load_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
    elif scope == "all":
        owner_r = load_json(OWNER_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        synth_r = load_json(SYNTHETIC_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        ratings_db = {**synth_r, **owner_r}
        owner_c = load_json(OWNER_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        synth_c = load_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        comparisons_db = synth_c + owner_c
    else:
        ratings_db = load_json(OWNER_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        comparisons_db = load_json(OWNER_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])

    rubric = get_rubric()
    weights_summary = {k: round(rubric.get(k, 0.1667) * len(FEATURE_KEYS), 3) for k in FEATURE_KEYS}
    ranking_list = []

    if ratings_db:
        sample_eval = calculate_ai_preference(list(ratings_db.values())[0]["component_scores"], scope=scope)
        weights_summary = sample_eval["learned_weights"]

        for aid, r in ratings_db.items():
            ev = calculate_ai_preference(r["component_scores"], scope=scope)
            ranking_list.append({
                "asset_id": aid,
                "intake_type": r.get("intake_type"),
                "provenance": r.get("telemetry_provenance"),
                "owner_score": r.get("overall_subjective_score"),
                "rubric_score": r.get("rubric_weighted_score"),
                "predicted_utility": ev["utility"],
                "predicted_score": ev["predicted_score"],
                "notes": r.get("free_text_notes", "")
            })
        ranking_list.sort(key=lambda x: x["predicted_utility"], reverse=True)

    return {
        "status": "active",
        "scope": scope,
        "total_ratings": len(ratings_db),
        "total_comparisons": len(comparisons_db),
        "learned_weights": weights_summary,
        "ranked_edits": ranking_list,
        "caveat": "Preferences updated on training set. Real predictive generalization requires held-out validation."
    }


@app.get("/api/benchmarks")
def get_benchmark_assets():
    gt_path = os.path.join(BENCHMARK_DIR, "ground_truth.json")
    if os.path.isfile(gt_path):
        with open(gt_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


@app.get("/api/media/{filename}")
def stream_benchmark_media(filename: str):
    # Sanitize path to prevent traversal
    safe_name = os.path.basename(filename)
    path = os.path.join(BENCHMARK_DIR, safe_name)
    if os.path.isfile(path):
        return FileResponse(path, media_type="video/mp4")
    raise HTTPException(status_code=404, detail="File not found")


@app.get("/", response_class=HTMLResponse)
def render_app():
    return HTML_CONTENT


HTML_CONTENT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lolixco Edit DNA // Owner Rating Lab</title>
<style>
  :root {
    --canvas: #0A0A0A;
    --surface: #141414;
    --surface-raised: #1F1F1F;
    --border: #2C2C2C;
    --border-highlight: #3F3F3F;
    --yellow: #FACC15;
    --yellow-muted: #CA8A04;
    --yellow-glow: rgba(250, 204, 21, 0.2);
    --text-main: #FAFAFA;
    --text-muted: #A3A3A3;
    --text-dim: #737373;
    --red: #EF4444;
    --green: #22C55E;
    --blue: #38BDF8;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background-color: var(--canvas);
    color: var(--text-main);
    font-family: var(--font-sans);
    line-height: 1.5;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand-badge {
    background: var(--yellow);
    color: #000;
    font-weight: 900;
    font-size: 13px;
    padding: 4px 8px;
    border-radius: 4px;
    letter-spacing: 0.5px;
  }
  .brand-title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }
  .brand-subtitle {
    font-size: 13px;
    color: var(--text-muted);
  }
  nav {
    display: flex;
    gap: 8px;
    background: var(--canvas);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--border);
  }
  .tab-btn {
    background: transparent;
    color: var(--text-muted);
    border: none;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tab-btn:hover {
    color: var(--text-main);
    background: var(--surface);
  }
  .tab-btn.active {
    color: #000;
    background: var(--yellow);
  }
  .scope-pill {
    font-size: 12px;
    font-weight: 600;
    padding: 6px 12px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .scope-pill select {
    background: transparent;
    color: var(--yellow);
    border: none;
    font-weight: 700;
    cursor: pointer;
    outline: none;
  }

  main {
    flex: 1;
    max-width: 1400px;
    width: 100%;
    margin: 0 auto;
    padding: 24px;
  }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Grid layout for Tab 1 */
  .grid-2col {
    display: grid;
    grid-template-columns: 1.15fr 0.85fr;
    gap: 24px;
  }
  @media (max-width: 1000px) {
    .grid-2col { grid-template-columns: 1fr; }
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .card-title {
    font-size: 15px;
    font-weight: 700;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--yellow);
  }

  /* Form Elements */
  .field { margin-bottom: 16px; }
  label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--text-main);
  }
  .label-sub {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 400;
    margin-left: 6px;
  }
  input[type="text"], textarea, select {
    width: 100%;
    background: var(--canvas);
    border: 1px solid var(--border);
    color: var(--text-main);
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    outline: none;
  }
  input[type="text"]:focus, textarea:focus {
    border-color: var(--yellow);
    box-shadow: 0 0 0 1px var(--yellow);
  }
  textarea { min-height: 90px; resize: vertical; }

  /* Sliders */
  .slider-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: center;
  }
  input[type="range"] {
    -webkit-appearance: none;
    width: 100%;
    background: var(--surface-raised);
    height: 6px;
    border-radius: 3px;
    outline: none;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    background: var(--yellow);
    border-radius: 50%;
    cursor: pointer;
  }
  .score-badge {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 14px;
    background: var(--surface-raised);
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid var(--border);
    width: 48px;
    text-align: center;
    color: var(--yellow);
  }

  /* Video Player Container */
  .player-box {
    background: #000;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    padding-top: 56.25%; /* 16:9 ratio */
    border: 1px solid var(--border);
    margin-bottom: 16px;
  }
  .player-box iframe, .player-box video {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    border: none;
  }
  .player-placeholder {
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    font-size: 13px;
    text-align: center;
    padding: 20px;
  }

  /* Badges */
  .badge {
    display: inline-block;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 700;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .badge-yellow { background: var(--yellow); color: #000; }
  .badge-blue { background: rgba(56, 189, 248, 0.15); color: var(--blue); border: 1px solid rgba(56, 189, 248, 0.3); }
  .badge-green { background: rgba(34, 197, 94, 0.15); color: var(--green); border: 1px solid rgba(34, 197, 94, 0.3); }
  .badge-red { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }
  .badge-neutral { background: var(--surface-raised); color: var(--text-muted); border: 1px solid var(--border); }

  /* Buttons */
  .btn {
    background: var(--yellow);
    color: #000;
    border: none;
    padding: 10px 18px;
    font-size: 14px;
    font-weight: 700;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .btn:hover { background: #EAB308; }
  .btn-secondary {
    background: var(--surface-raised);
    color: var(--text-main);
    border: 1px solid var(--border);
  }
  .btn-secondary:hover { background: var(--border); }
  .btn-danger {
    background: rgba(239, 68, 68, 0.2);
    color: var(--red);
    border: 1px solid var(--red);
  }
  .btn-danger:hover { background: var(--red); color: #fff; }

  /* Anti-Bias AI Prediction Box */
  .blind-box {
    background: var(--surface-raised);
    border: 1px dashed var(--border-highlight);
    border-radius: 8px;
    padding: 16px;
    margin-top: 16px;
  }
  .blind-box.revealed {
    border: 1px solid var(--yellow);
    background: rgba(250, 204, 21, 0.05);
  }

  /* Table */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th, td {
    padding: 10px 14px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  th {
    color: var(--text-muted);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
  }
  tr:hover td { background: var(--surface-raised); }

  /* Quick Pills */
  .quick-links { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .pill-btn {
    background: var(--surface-raised);
    color: var(--text-muted);
    border: 1px solid var(--border);
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .pill-btn:hover { color: var(--yellow); border-color: var(--yellow); }

  /* Side-by-Side Comparison Arena */
  .arena-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 20px;
  }
  @media (max-width: 900px) {
    .arena-grid { grid-template-columns: 1fr; }
  }
  .candidate-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
  }
  .candidate-card.chosen {
    border-color: var(--yellow);
    box-shadow: 0 0 12px var(--yellow-glow);
  }
  .decision-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    text-align: center;
  }
  .winner-buttons {
    display: flex;
    gap: 16px;
    justify-content: center;
    margin: 20px 0;
  }
  .choice-btn {
    flex: 1;
    max-width: 240px;
    padding: 14px;
    font-size: 15px;
    font-weight: 700;
    background: var(--surface-raised);
    color: var(--text-main);
    border: 2px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
  }
  .choice-btn.selected {
    background: var(--yellow);
    color: #000;
    border-color: var(--yellow);
  }

  /* Metric Meter */
  .meter-bar {
    height: 8px;
    background: var(--surface-raised);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 4px;
  }
  .meter-fill {
    height: 100%;
    background: var(--yellow);
    border-radius: 4px;
  }
</style>
</head>
<body>

<header>
  <div class="brand">
    <span class="brand-badge">LOLIXCO</span>
    <div>
      <div class="brand-title">EDIT DNA // OWNER RATING LAB</div>
      <div class="brand-subtitle">Personalized Video Intelligence & Preference Learning Forge</div>
    </div>
  </div>

  <nav>
    <button class="tab-btn active" onclick="switchTab('tab-rate')">01. Rate Edit</button>
    <button class="tab-btn" onclick="switchTab('tab-arena')">02. A/B Arena</button>
    <button class="tab-btn" onclick="switchTab('tab-preference')">03. Preference DNA</button>
    <button class="tab-btn" onclick="switchTab('tab-library')">04. Library & Rubric</button>
  </nav>

  <div class="scope-pill">
    <span>Data Scope:</span>
    <select id="scopeSelect" onchange="onScopeChange()">
      <option value="owner" selected>Owner Real Ratings</option>
      <option value="synthetic">Synthetic Benchmarks</option>
      <option value="all">All Combined</option>
    </select>
  </div>
</header>

<main>
  <!-- TAB 1: RATE EDIT -->
  <div id="tab-rate" class="tab-content active">
    <div class="grid-2col">
      <!-- Left Column: Video & Telemetry -->
      <div>
        <div class="card">
          <div class="card-title">
            <span>Video Intake Reference</span>
            <span id="intakeProvenanceBadge" class="badge badge-yellow">Awaiting Input</span>
          </div>

          <div class="field">
            <label for="assetInput">YouTube URL or Local Asset ID</label>
            <input type="text" id="assetInput" placeholder="Paste YouTube link (e.g. https://youtu.be/... or Shorts) or benchmark asset" oninput="onAssetInputChanged()">
            
            <div class="quick-links">
              <span style="font-size: 11px; color: var(--text-dim); margin-right: 4px;">Quick Benchmarks:</span>
              <button class="pill-btn" onclick="loadQuickAsset('bench_01_clean_hard_cuts.mp4')">Clean Hard Cuts</button>
              <button class="pill-btn" onclick="loadQuickAsset('bench_02_offset_sync_cuts.mp4')">Offset Sync</button>
              <button class="pill-btn" onclick="loadQuickAsset('bench_04_isolated_flash_frames.mp4')">Strobe Flashes</button>
              <button class="pill-btn" onclick="loadQuickAsset('bench_07_silent_video.mp4')">Silent Video</button>
              <button class="pill-btn" onclick="loadQuickAsset('bench_08_clipping_audio.mp4')">Clipping Audio</button>
            </div>
          </div>

          <div class="player-box" id="playerContainer">
            <div class="player-placeholder">
              <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="margin-bottom:8px; opacity:0.4;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Paste a YouTube URL or select a local benchmark asset above to view video.
            </div>
          </div>

          <div id="provenanceNotice" style="font-size: 12px; color: var(--text-muted); background: var(--canvas); padding: 10px; border-radius: 6px; border: 1px solid var(--border);">
            <strong>Intake Policy:</strong> For YouTube URLs, playback uses the official embedded player without downloading raw content. URL records provide high-level editorial ratings; sub-frame cut DSP requires local authorized media.
          </div>
        </div>

        <!-- Blind AI Prediction Box (Anti-Bias) -->
        <div class="blind-box" id="blindAiBox">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">AI Preference Prediction</strong>
            <span class="badge badge-neutral" id="blindBadge">🔒 Blind Mode Active</span>
          </div>
          <div id="blindMessage" style="font-size: 13px; color: var(--text-dim);">
            AI prediction is hidden during review to prevent confirmation bias. Submit your rating to reveal the model's estimate and delta.
          </div>
          <div id="revealedStats" style="display:none; margin-top:12px;">
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; text-align:center;">
              <div style="background:var(--canvas); padding:10px; border-radius:6px; border:1px solid var(--border);">
                <div style="font-size:11px; color:var(--text-muted);">AI PREDICTED</div>
                <div id="revAiScore" style="font-size:20px; font-weight:800; color:var(--yellow);">-</div>
              </div>
              <div style="background:var(--canvas); padding:10px; border-radius:6px; border:1px solid var(--border);">
                <div style="font-size:11px; color:var(--text-muted);">YOUR RATING</div>
                <div id="revOwnerScore" style="font-size:20px; font-weight:800; color:#fff;">-</div>
              </div>
              <div style="background:var(--canvas); padding:10px; border-radius:6px; border:1px solid var(--border);">
                <div style="font-size:11px; color:var(--text-muted);">DELTA (BIAS CHECK)</div>
                <div id="revDelta" style="font-size:20px; font-weight:800;">-</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Rating Controls -->
      <div>
        <div class="card">
          <div class="card-title">
            <span>Owner Editorial Scoring</span>
            <span id="revisionBadge" class="badge badge-neutral">New Rating</span>
          </div>

          <!-- Component Dimension Sliders -->
          <div class="field">
            <div class="slider-row">
              <label>1. Beat Synchronization <span class="label-sub">(Weight: 25%)</span></label>
              <span class="score-badge" id="valSync">5.0</span>
            </div>
            <input type="range" id="sliderSync" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>2. Transitions & Cuts <span class="label-sub">(Weight: 20%)</span></label>
              <span class="score-badge" id="valTrans">5.0</span>
            </div>
            <input type="range" id="sliderTrans" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>3. Pacing & Density <span class="label-sub">(Weight: 15%)</span></label>
              <span class="score-badge" id="valPacing">5.0</span>
            </div>
            <input type="range" id="sliderPacing" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>4. Visual & Color Quality <span class="label-sub">(Weight: 15%)</span></label>
              <span class="score-badge" id="valVisuals">5.0</span>
            </div>
            <input type="range" id="sliderVisuals" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>5. Storytelling & Emotion <span class="label-sub">(Weight: 15%)</span></label>
              <span class="score-badge" id="valStory">5.0</span>
            </div>
            <input type="range" id="sliderStory" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>6. Originality & Creativity <span class="label-sub">(Weight: 10%)</span></label>
              <span class="score-badge" id="valOrig">5.0</span>
            </div>
            <input type="range" id="sliderOrig" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <!-- Calculated vs Overall -->
          <div style="background:var(--canvas); padding:14px; border-radius:8px; border:1px solid var(--border); margin:16px 0;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <span style="font-size:12px; color:var(--text-muted); text-transform:uppercase;">Calculated Rubric Score:</span>
              <span id="calculatedRubricScore" style="font-family:var(--font-mono); font-size:16px; font-weight:700; color:var(--text-main);">5.00</span>
            </div>

            <div class="slider-row">
              <label style="color:var(--yellow); font-size:14px;">YOUR INDEPENDENT OVERALL SCORE</label>
              <span class="score-badge" id="valOverall" style="background:var(--yellow); color:#000; font-size:16px;">5.0</span>
            </div>
            <input type="range" id="sliderOverall" min="0" max="10" step="0.1" value="5.0" oninput="document.getElementById('valOverall').innerText = this.value">
          </div>

          <!-- Notes -->
          <div class="field">
            <label for="ratingNotes">Editorial Judgment Critique & Timestamp Notes</label>
            <textarea id="ratingNotes" placeholder="Write why this edit worked or failed (e.g. 'Impact cut at 0:14 snapped perfectly to 808 drop, but mid-edit pacing sagged')..."></textarea>
          </div>

          <!-- Submit Buttons -->
          <div style="display:flex; gap:12px;">
            <button class="btn" style="flex:1;" onclick="submitRating()">Save / Submit Rating</button>
            <button class="btn btn-secondary" onclick="resetForm()">Reset</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- TAB 2: A/B ARENA -->
  <div id="tab-arena" class="tab-content">
    <div class="card">
      <div class="card-title">
        <span>Head-to-Head Pairwise Comparison Arena</span>
        <span class="badge badge-yellow">Preference Learner Active</span>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:20px;">
        Comparing two edits side by side teaches the Bradley-Terry preference model your subjective hierarchy (e.g., whether you value tight beat sync over flashy visual shaders).
      </p>

      <div id="arenaEmptyNotice" style="display:none; background:var(--canvas); border:1px solid var(--border); border-radius:6px; padding:12px; margin-bottom:16px; font-size:13px; color:var(--yellow);"></div>

      <div class="arena-grid">
        <!-- Candidate A -->
        <div class="candidate-card" id="cardA">
          <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
            <strong style="color:var(--yellow);">Candidate A</strong>
            <select id="selectCandidateA" onchange="loadCandidate('A')"></select>
          </div>
          <div class="player-box" id="playerA">
            <div class="player-placeholder" id="phA">Select Candidate A</div>
          </div>
          <div id="metaA" style="font-size:12px; color:var(--text-muted); margin-top:8px;"></div>
        </div>

        <!-- Candidate B -->
        <div class="candidate-card" id="cardB">
          <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
            <strong style="color:var(--blue);">Candidate B</strong>
            <select id="selectCandidateB" onchange="loadCandidate('B')"></select>
          </div>
          <div class="player-box" id="playerB">
            <div class="player-placeholder" id="phB">Select Candidate B</div>
          </div>
          <div id="metaB" style="font-size:12px; color:var(--text-muted); margin-top:8px;"></div>
        </div>
      </div>

      <!-- Decision Box -->
      <div class="decision-box">
        <h3 style="font-size:16px; margin-bottom:8px;">Which Edit is Better?</h3>
        <div class="winner-buttons">
          <button class="choice-btn" id="btnWinA" onclick="chooseWinner('A')">Candidate A is Better</button>
          <button class="choice-btn" id="btnWinB" onclick="chooseWinner('B')">Candidate B is Better</button>
        </div>

        <div style="max-width:500px; margin:0 auto 16px auto;">
          <div style="display:flex; justify-content:center; gap:20px; margin-bottom:12px; font-size:13px;">
            <label><input type="radio" name="margin" value="slight" checked> Slight Edge</label>
            <label><input type="radio" name="margin" value="significant"> Decisive Win</label>
            <label><input type="radio" name="margin" value="dominating"> Total Domination</label>
          </div>
          <textarea id="comparisonRationale" placeholder="Explain why one edit won (e.g. 'A has punchy on-beat cuts while B has floaty transition delays')..."></textarea>
        </div>

        <button class="btn" onclick="submitComparison()">Record Pairwise Preference</button>
      </div>
    </div>
  </div>

  <!-- TAB 3: PREFERENCE DNA -->
  <div id="tab-preference" class="tab-content">
    <div class="card">
      <div class="card-title">
        <span>Learned Aesthetic Preference Weights (Bradley-Terry)</span>
        <button class="btn btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="refreshPreferenceDNA()">Retrain Model</button>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:20px;">
        These weights represent what the AI has learned about your subjective taste. Dimensions with higher positive values indicate qualities you prioritize when judging edit quality.
      </p>

      <div id="weightBarsContainer" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:16px; margin-bottom:24px;"></div>

      <div class="card-title" style="margin-top:24px;">
        <span>Predicted Edit Rankings (Sorted by Learned Utility)</span>
      </div>
      <table id="preferenceTable">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Asset</th>
            <th>Type</th>
            <th>Your Score</th>
            <th>AI Utility</th>
            <th>Predicted Score</th>
            <th>Notes Preview</th>
          </tr>
        </thead>
        <tbody id="preferenceTableBody"></tbody>
      </table>
    </div>
  </div>

  <!-- TAB 4: LIBRARY & RUBRIC -->
  <div id="tab-library" class="tab-content">
    <div class="grid-2col">
      <!-- Ratings List -->
      <div class="card">
        <div class="card-title">
          <span>Saved Edit Reviews</span>
          <span id="libraryCountBadge" class="badge badge-neutral">0 Edits</span>
        </div>
        <div style="overflow-x:auto;">
          <table id="libraryTable">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Overall</th>
                <th>Revs</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="libraryTableBody"></tbody>
          </table>
        </div>
      </div>

      <!-- Rubric Customizer -->
      <div class="card">
        <div class="card-title">
          <span>Editable Rubric Baseline</span>
          <button class="btn btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="resetRubricDefault()">Reset Default</button>
        </div>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
          Adjust how much each dimension contributes to the mathematical calculated score. Weights auto-normalize to 100%.
        </p>

        <div id="rubricInputsContainer"></div>

        <button class="btn" style="width:100%; margin-top:16px;" onclick="saveRubricWeights()">Save Rubric Weights</button>
      </div>
    </div>
  </div>
</main>

<script>
let currentAssetId = "";
let currentScope = "owner";
let currentWinner = "";
let cachedRatings = {};
let cachedRubric = {};

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  const idx = ['tab-rate', 'tab-arena', 'tab-preference', 'tab-library'].indexOf(tabId);
  document.querySelectorAll('.tab-btn')[idx].classList.add('active');

  if (tabId === 'tab-arena') populateArenaSelectors();
  if (tabId === 'tab-preference') refreshPreferenceDNA();
  if (tabId === 'tab-library') refreshLibrary();
}

function onScopeChange() {
  currentScope = document.getElementById('scopeSelect').value;
  refreshLibrary();
  refreshPreferenceDNA();
  populateArenaSelectors();
}

function updateScores() {
  const sync = parseFloat(document.getElementById('sliderSync').value);
  const trans = parseFloat(document.getElementById('sliderTrans').value);
  const pacing = parseFloat(document.getElementById('sliderPacing').value);
  const visuals = parseFloat(document.getElementById('sliderVisuals').value);
  const story = parseFloat(document.getElementById('sliderStory').value);
  const orig = parseFloat(document.getElementById('sliderOrig').value);

  document.getElementById('valSync').innerText = sync.toFixed(1);
  document.getElementById('valTrans').innerText = trans.toFixed(1);
  document.getElementById('valPacing').innerText = pacing.toFixed(1);
  document.getElementById('valVisuals').innerText = visuals.toFixed(1);
  document.getElementById('valStory').innerText = story.toFixed(1);
  document.getElementById('valOrig').innerText = orig.toFixed(1);

  const r = cachedRubric;
  const weighted = (
    sync * (r.beat_synchronization || 0.25) +
    trans * (r.transitions || 0.20) +
    pacing * (r.pacing || 0.15) +
    visuals * (r.visual_quality || 0.15) +
    story * (r.storytelling_emotion || 0.15) +
    orig * (r.originality_creativity || 0.10)
  );
  document.getElementById('calculatedRubricScore').innerText = weighted.toFixed(2);
}

function parseYouTubeId(input) {
  if (!input) return null;
  input = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const m = input.match(/(?:v=|\\/v\\/|youtu\\.be\\/|\\/embed\\/|\\/shorts\\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function onAssetInputChanged() {
  const val = document.getElementById('assetInput').value.trim();
  currentAssetId = val;
  const ytId = parseYouTubeId(val);
  const container = document.getElementById('playerContainer');
  const badge = document.getElementById('intakeProvenanceBadge');

  // Reset blind box on new input
  document.getElementById('blindAiBox').classList.remove('revealed');
  document.getElementById('blindBadge').innerText = "🔒 Blind Mode Active";
  document.getElementById('blindBadge').className = "badge badge-neutral";
  document.getElementById('blindMessage').style.display = "block";
  document.getElementById('revealedStats').style.display = "none";

  if (ytId) {
    badge.innerText = "YOUTUBE URL // NO LOCAL BYTES";
    badge.className = "badge badge-yellow";
    container.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?enablejsapi=1&rel=0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
  } else if (val.endsWith('.mp4')) {
    badge.innerText = "LOCAL ASSET // DSP AVAILABLE";
    badge.className = "badge badge-green";
    container.innerHTML = `<video controls src="/api/media/${val}" style="width:100%; height:100%;"></video>`;
  } else if (val.startsWith('bench_')) {
    badge.innerText = "LOCAL ASSET // DSP AVAILABLE";
    badge.className = "badge badge-green";
    container.innerHTML = `<video controls src="/api/media/${val}.mp4" style="width:100%; height:100%;"></video>`;
  } else {
    badge.innerText = "UNKNOWN INTAKE";
    badge.className = "badge badge-neutral";
  }

  // Check if existing rating exists
  if (cachedRatings[val]) {
    loadExistingRating(cachedRatings[val]);
  } else {
    document.getElementById('revisionBadge').innerText = "New Rating";
    document.getElementById('revisionBadge').className = "badge badge-neutral";
  }
}

function loadQuickAsset(filename) {
  document.getElementById('assetInput').value = filename;
  onAssetInputChanged();
}

function loadExistingRating(r) {
  document.getElementById('sliderSync').value = r.component_scores.beat_synchronization;
  document.getElementById('sliderTrans').value = r.component_scores.transitions;
  document.getElementById('sliderPacing').value = r.component_scores.pacing;
  document.getElementById('sliderVisuals').value = r.component_scores.visual_quality;
  document.getElementById('sliderStory').value = r.component_scores.storytelling_emotion;
  document.getElementById('sliderOrig').value = r.component_scores.originality_creativity;
  document.getElementById('sliderOverall').value = r.overall_subjective_score;
  document.getElementById('valOverall').innerText = r.overall_subjective_score.toFixed(1);
  document.getElementById('ratingNotes').value = r.free_text_notes || "";
  document.getElementById('revisionBadge').innerText = `Revision #${r.revision_count || 1}`;
  document.getElementById('revisionBadge').className = "badge badge-blue";
  updateScores();
}

async function submitRating() {
  if (!currentAssetId) {
    alert("Please enter a YouTube URL or asset name first.");
    return;
  }
  const ytId = parseYouTubeId(currentAssetId);
  const intakeType = ytId ? "youtube_url" : "local_asset";

  const payload = {
    asset_id: currentAssetId,
    intake_type: intakeType,
    scope: currentScope,
    component_scores: {
      beat_synchronization: parseFloat(document.getElementById('sliderSync').value),
      transitions: parseFloat(document.getElementById('sliderTrans').value),
      pacing: parseFloat(document.getElementById('sliderPacing').value),
      visual_quality: parseFloat(document.getElementById('sliderVisuals').value),
      storytelling_emotion: parseFloat(document.getElementById('sliderStory').value),
      originality_creativity: parseFloat(document.getElementById('sliderOrig').value),
    },
    overall_score: parseFloat(document.getElementById('sliderOverall').value),
    notes: document.getElementById('ratingNotes').value
  };

  const res = await fetch('/api/ratings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();

  if (data.status === 'success') {
    // REVEAL BLIND AI EVALUATION POST-SUBMISSION
    const rev = data.ai_prediction_reveal;
    document.getElementById('blindAiBox').classList.add('revealed');
    document.getElementById('blindBadge').innerText = "🎯 Prediction Revealed";
    document.getElementById('blindBadge').className = "badge badge-yellow";
    document.getElementById('blindMessage').style.display = "none";
    document.getElementById('revealedStats').style.display = "block";

    document.getElementById('revAiScore').innerText = rev.predicted_score.toFixed(1);
    document.getElementById('revOwnerScore').innerText = payload.overall_score.toFixed(1);

    const deltaElem = document.getElementById('revDelta');
    const d = rev.score_delta;
    deltaElem.innerText = (d >= 0 ? "+" : "") + d.toFixed(1);
    deltaElem.style.color = Math.abs(d) <= 0.5 ? "var(--green)" : (d > 0 ? "var(--yellow)" : "var(--red)");

    document.getElementById('revisionBadge').innerText = `Revision #${data.rating.revision_count}`;
    document.getElementById('revisionBadge').className = "badge badge-blue";

    fetchRatings();
  }
}

function resetForm() {
  document.getElementById('assetInput').value = "";
  currentAssetId = "";
  document.getElementById('sliderSync').value = 5.0;
  document.getElementById('sliderTrans').value = 5.0;
  document.getElementById('sliderPacing').value = 5.0;
  document.getElementById('sliderVisuals').value = 5.0;
  document.getElementById('sliderStory').value = 5.0;
  document.getElementById('sliderOrig').value = 5.0;
  document.getElementById('sliderOverall').value = 5.0;
  document.getElementById('valOverall').innerText = "5.0";
  document.getElementById('ratingNotes').value = "";
  updateScores();
  onAssetInputChanged();
}

async function fetchRatings() {
  const res = await fetch(`/api/ratings?scope=${currentScope}`);
  const data = await res.json();
  cachedRatings = data.ratings || {};
}

async function fetchRubric() {
  const res = await fetch('/api/rubric');
  const data = await res.json();
  cachedRubric = data.rubric || DEFAULT_RUBRIC;
  renderRubricInputs();
  updateScores();
}

function renderRubricInputs() {
  const cont = document.getElementById('rubricInputsContainer');
  let html = '';
  for (const [k, v] of Object.entries(cachedRubric)) {
    const label = k.replace(/_/g, ' ').toUpperCase();
    html += `
      <div class="field">
        <div class="slider-row">
          <label style="font-size:12px;">${label}</label>
          <span class="score-badge" id="rubric_val_${k}">${(v*100).toFixed(0)}%</span>
        </div>
        <input type="range" id="rubric_slider_${k}" min="0" max="60" step="1" value="${(v*100).toFixed(0)}" oninput="document.getElementById('rubric_val_${k}').innerText = this.value + '%'">
      </div>
    `;
  }
  cont.innerHTML = html;
}

async function saveRubricWeights() {
  const weights = {};
  for (const k of Object.keys(cachedRubric)) {
    weights[k] = parseFloat(document.getElementById(`rubric_slider_${k}`).value);
  }
  const res = await fetch('/api/rubric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights })
  });
  const data = await res.json();
  cachedRubric = data.rubric;
  renderRubricInputs();
  updateScores();
  alert("Rubric weights updated and normalized!");
}

async function resetRubricDefault() {
  const res = await fetch('/api/rubric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights: DEFAULT_RUBRIC })
  });
  const data = await res.json();
  cachedRubric = data.rubric;
  renderRubricInputs();
  updateScores();
}

/* Tab 2: A/B Arena */
function populateArenaSelectors() {
  const selA = document.getElementById('selectCandidateA');
  const selB = document.getElementById('selectCandidateB');
  selA.innerHTML = '<option value="">-- Choose Candidate A --</option>';
  selB.innerHTML = '<option value="">-- Choose Candidate B --</option>';

  const entries = Object.entries(cachedRatings);
  for (const [aid, r] of entries) {
    const label = `${aid.slice(0, 32)} (Score: ${r.overall_subjective_score})`;
    selA.innerHTML += `<option value="${aid}">${label}</option>`;
    selB.innerHTML += `<option value="${aid}">${label}</option>`;
  }

  const notice = document.getElementById('arenaEmptyNotice');
  if (notice) {
    if (entries.length < 2) {
      notice.style.display = 'block';
      notice.innerHTML = currentScope === 'owner'
        ? "<strong>Head-to-Head Setup:</strong> Rate at least two edits in <em>01. Rate Edit</em> to unlock pairwise comparisons. (Or switch <em>Data Scope</em> in the top header to <em>Synthetic Benchmarks</em> to test immediately)."
        : "<strong>Notice:</strong> Fewer than 2 rated assets found in this scope.";
    } else {
      notice.style.display = 'none';
    }
  }
}

function loadCandidate(side) {
  const aid = document.getElementById(`selectCandidate${side}`).value;
  const pBox = document.getElementById(`player${side}`);
  const mBox = document.getElementById(`meta${side}`);

  if (!aid) {
    pBox.innerHTML = `<div class="player-placeholder">Select Candidate ${side}</div>`;
    mBox.innerHTML = "";
    return;
  }

  const ytId = parseYouTubeId(aid);
  if (ytId) {
    pBox.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?enablejsapi=1" allowfullscreen></iframe>`;
  } else {
    const f = aid.endsWith('.mp4') ? aid : `${aid}.mp4`;
    pBox.innerHTML = `<video controls src="/api/media/${f}" style="width:100%; height:100%;"></video>`;
  }

  const r = cachedRatings[aid];
  if (r) {
    mBox.innerHTML = `
      <div><strong>Score:</strong> ${r.overall_subjective_score} | <strong>Sync:</strong> ${r.component_scores.beat_synchronization} | <strong>Pacing:</strong> ${r.component_scores.pacing}</div>
      <div style="font-style:italic; margin-top:4px;">"${r.free_text_notes || 'No critique notes'}"</div>
    `;
  }
}

function chooseWinner(choice) {
  currentWinner = choice;
  document.getElementById('btnWinA').classList.toggle('selected', choice === 'A');
  document.getElementById('btnWinB').classList.toggle('selected', choice === 'B');
  document.getElementById('cardA').classList.toggle('chosen', choice === 'A');
  document.getElementById('cardB').classList.toggle('chosen', choice === 'B');
}

async function submitComparison() {
  const candA = document.getElementById('selectCandidateA').value;
  const candB = document.getElementById('selectCandidateB').value;
  if (!candA || !candB) {
    alert("Please select both Candidate A and Candidate B.");
    return;
  }
  if (candA === candB) {
    alert("Please select two distinct edits to compare.");
    return;
  }
  if (!currentWinner) {
    alert("Please choose a winner (Candidate A or B).");
    return;
  }

  const margin = document.querySelector('input[name="margin"]:checked').value;
  const rationale = document.getElementById('comparisonRationale').value;

  const res = await fetch('/api/comparisons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidate_a: candA,
      candidate_b: candB,
      winner: currentWinner,
      margin,
      rationale,
      scope: currentScope
    })
  });
  const data = await res.json();
  if (data.status === 'success') {
    alert(`Preference recorded! The preference model updated on ${data.total_comparisons} comparisons.`);
    document.getElementById('comparisonRationale').value = "";
    chooseWinner("");
    refreshPreferenceDNA();
  }
}

/* Tab 3: Preference DNA */
async function refreshPreferenceDNA() {
  const res = await fetch(`/api/preference-model?scope=${currentScope}`);
  const data = await res.json();

  const cont = document.getElementById('weightBarsContainer');
  let html = '';
  for (const [k, v] of Object.entries(data.learned_weights || {})) {
    const label = k.replace(/_/g, ' ').toUpperCase();
    const pct = Math.min(100, Math.max(5, (v / 2.0) * 100));
    html += `
      <div style="background:var(--surface-raised); padding:12px; border-radius:6px; border:1px solid var(--border);">
        <div style="display:flex; justify-content:space-between; font-size:12px;">
          <strong>${label}</strong>
          <span style="font-family:var(--font-mono); color:var(--yellow);">${v > 0 ? "+" : ""}${v.toFixed(3)}</span>
        </div>
        <div class="meter-bar"><div class="meter-fill" style="width:${pct}%;"></div></div>
      </div>
    `;
  }
  cont.innerHTML = html;

  const tbody = document.getElementById('preferenceTableBody');
  tbody.innerHTML = '';
  (data.ranked_edits || []).forEach((e, idx) => {
    tbody.innerHTML += `
      <tr>
        <td style="font-weight:700; color:var(--yellow);">#${idx + 1}</td>
        <td><strong>${e.asset_id.slice(0, 36)}</strong></td>
        <td><span class="badge ${e.intake_type === 'youtube_url' ? 'badge-yellow' : 'badge-green'}">${e.intake_type}</span></td>
        <td style="font-family:var(--font-mono); font-weight:700;">${e.owner_score.toFixed(1)}</td>
        <td style="font-family:var(--font-mono); color:var(--yellow);">${e.predicted_utility > 0 ? "+" : ""}${e.predicted_utility.toFixed(2)}</td>
        <td style="font-family:var(--font-mono); font-weight:700;">${e.predicted_score.toFixed(1)}</td>
        <td style="color:var(--text-muted); font-size:12px; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${e.notes || "-"}</td>
      </tr>
    `;
  });
}

/* Tab 4: Library */
async function refreshLibrary() {
  await fetchRatings();
  const tbody = document.getElementById('libraryTableBody');
  tbody.innerHTML = '';
  const entries = Object.values(cachedRatings);
  document.getElementById('libraryCountBadge').innerText = `${entries.length} Reviews`;

  entries.forEach(r => {
    tbody.innerHTML += `
      <tr>
        <td><strong>${r.asset_id.slice(0, 32)}</strong></td>
        <td><span class="badge ${r.intake_type === 'youtube_url' ? 'badge-yellow' : 'badge-green'}">${r.intake_type}</span></td>
        <td style="font-family:var(--font-mono); font-weight:700; color:var(--yellow);">${r.overall_subjective_score}</td>
        <td>#${r.revision_count || 1}</td>
        <td>
          <button class="pill-btn" onclick="editReview('${r.asset_id}')">Edit</button>
          <button class="pill-btn" style="color:var(--red);" onclick="deleteReview('${r.asset_id}')">Del</button>
        </td>
      </tr>
    `;
  });
}

function editReview(aid) {
  document.getElementById('assetInput').value = aid;
  onAssetInputChanged();
  switchTab('tab-rate');
}

async function deleteReview(aid) {
  if (!confirm(`Delete rating for ${aid}?`)) return;
  await fetch(`/api/ratings/${encodeURIComponent(aid)}?scope=${currentScope}`, { method: 'DELETE' });
  refreshLibrary();
}

window.addEventListener('DOMContentLoaded', () => {
  fetchRubric();
  fetchRatings();
});
</script>

</body>
</html>
"""


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Lolixco Edit DNA — Owner Rating Lab Web App")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind")
    parser.add_argument("--port", type=int, default=5050, help="Port to listen on (default: 5050)")
    args = parser.parse_args()

    print("\n" + "=" * 64)
    print("         LOLIXCO EDIT DNA // OWNER RATING LAB")
    print("=" * 64)
    print(f" Localhost Web URL:   http://{args.host}:{args.port}")
    print(f" Private Storage:     {DATA_DIR}")
    print(" Blind Anti-Bias:     ACTIVE (Model predictions hidden until submit)")
    print(" Embed Policy:        YouTube iframe nocookie (Zero video scraping)")
    print("=" * 64 + "\n")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
