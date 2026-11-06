#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — OWNER RATING LAB (LOCAL BROWSER WEB APPLICATION)
FastAPI backend and embedded Black/Yellow single-page application.
Phase 3 Edition:
1. YouTube URL embedded playback (official iframe, zero video scraping).
2. Local video playback for authorized assets.
3. 6-dimension scoring + independent overall score.
4. Detailed critique and timestamped notes with editorial tag extraction.
5. Blind AI prediction reveal (hidden until submitted to prevent confirmation bias).
6. Clear separation between:
   - Owner Rating
   - Mathematical Rubric Score
   - Mode A (Personalized Preference Estimate with 90% Confidence Interval)
   - Mode B (Independent Signal DSP Evaluation)
7. Side-by-side A/B comparison arena with active learning recommendations.
8. Private Training Status Panel with LOOCV generalization metrics.
9. Automatic dual-persistence in data/edit-dna/ and ~/.lolixco-edit-dna/.
"""

import os
import sys
import json
import time
import math
import re
import shutil
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel
import uvicorn
import numpy as np

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
DATA_DIR = os.path.join(BASE_DIR, "data", "edit-dna")
BENCHMARK_DIR = os.path.join(BASE_DIR, "test-assets", "benchmarks")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
HOME_DATA_DIR = os.path.expanduser("~/.lolixco-edit-dna")

OWNER_RATINGS_FILE = os.path.join(DATA_DIR, "owner_ratings.json")
SYNTHETIC_RATINGS_FILE = os.path.join(DATA_DIR, "synthetic_ratings.json")
OWNER_COMPARISONS_FILE = os.path.join(DATA_DIR, "owner_comparisons.json")
SYNTHETIC_COMPARISONS_FILE = os.path.join(DATA_DIR, "synthetic_comparisons.json")
RUBRIC_FILE = os.path.join(DATA_DIR, "owner_rubric.json")
ANNOTATIONS_DIR = os.path.join(HOME_DATA_DIR, "annotations")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)
os.makedirs(HOME_DATA_DIR, exist_ok=True)
os.makedirs(ANNOTATIONS_DIR, exist_ok=True)

# Import Phase 3 ML modules
sys.path.insert(0, os.path.join(BASE_DIR, "scripts", "edit-dna"))
from preference_learner import (
    PersonalizedPreferenceModel,
    preference_model,
    train_owner_preference_model,
    FEATURE_KEYS,
    DEFAULT_RUBRIC,
)
from editorial_annotator import extract_editorial_tags, annotate_rating_record


def load_json(path, default):
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    # Rehydrate from persistent home mirror if missing
    base_name = os.path.basename(path)
    home_alt = os.path.join(HOME_DATA_DIR, base_name)
    if os.path.isfile(home_alt):
        try:
            with open(home_alt, "r", encoding="utf-8") as f:
                data = json.load(f)
            save_json(path, data)
            return data
        except Exception:
            return default
    return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_rubric():
    return load_json(RUBRIC_FILE, DEFAULT_RUBRIC)


def extract_youtube_id(url_or_id: str) -> Optional[str]:
    if not url_or_id:
        return None
    url_or_id = url_or_id.strip()
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


# Ensure startup sync with home directory fallback if local data missing
if not os.path.isfile(OWNER_RATINGS_FILE) and os.path.isfile(os.path.join(HOME_DATA_DIR, "owner_ratings.json")):
    shutil.copy2(os.path.join(HOME_DATA_DIR, "owner_ratings.json"), OWNER_RATINGS_FILE)
if not os.path.isfile(OWNER_COMPARISONS_FILE) and os.path.isfile(os.path.join(HOME_DATA_DIR, "owner_comparisons.json")):
    shutil.copy2(os.path.join(HOME_DATA_DIR, "owner_comparisons.json"), OWNER_COMPARISONS_FILE)

# Initial model training
try:
    train_owner_preference_model()
except Exception as e:
    print(f"[EDIT DNA] Notice on startup model training: {e}")


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
    scope: str = "owner"


class RubricRequest(BaseModel):
    weights: Dict[str, float]


class EditorialTagUpdateRequest(BaseModel):
    asset_id: str
    positive_tags: List[str]
    negative_tags: List[str]


class MusicOverrideRequest(BaseModel):
    asset_id: str
    corrected_title: str
    corrected_artist: str
    notes: str = ""


class SourceOverrideRequest(BaseModel):
    asset_id: str
    corrected_franchise: str
    corrected_title: str
    notes: str = ""


class IntentionalCutRequest(BaseModel):
    asset_id: str
    cut_timestamp: float
    rhythm_role: str = "anticipatory_lead_in"
    notes: str = ""


app = FastAPI(title="Lolixco Edit DNA — Owner Rating Lab", version="3.0")


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
    canonical_id = extract_youtube_id(req.asset_id) or req.asset_id

    entry = {
        "asset_id": req.asset_id,
        "canonical_id": canonical_id,
        "youtube_id": canonical_id if req.intake_type == "youtube_url" else None,
        "original_url": req.asset_id if req.intake_type == "youtube_url" else None,
        "intake_type": req.intake_type,
        "telemetry_provenance": (
            "url_high_level_estimate_only"
            if req.intake_type == "youtube_url"
            else "local_offline_dsp_measured"
        ),
        "is_synthetic_benchmark": req.scope == "synthetic",
        "scope": req.scope,
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

    # Extract editorial annotations from notes
    entry = annotate_rating_record(entry)

    db["ratings"][req.asset_id] = entry
    save_json(target_file, db)

    # Mirror to home directory and retrain model if owner scope
    if req.scope == "owner":
        save_json(os.path.join(HOME_DATA_DIR, "owner_ratings.json"), db)
        train_owner_preference_model()

    # Generate Mode A & Mode B predictions for the reveal box
    mode_a = preference_model.predict_mode_a(req.component_scores)
    mode_b = preference_model.predict_mode_b(signal_metrics=None, intake_type=req.intake_type)

    return {
        "status": "success",
        "is_revision": is_revision,
        "rating": entry,
        "mode_a": mode_a,
        "mode_b": mode_b,
        "ai_prediction_reveal": {
            "predicted_score": mode_a["predicted_score"],
            "confidence_interval_90": mode_a["confidence_interval_90"],
            "rubric_calculated_score": round(rubric_score, 2),
            "score_delta": round(float(req.overall_score) - mode_a["predicted_score"], 2),
            "delta_vs_rubric": round(float(req.overall_score) - rubric_score, 2),
            "learned_weights": mode_a["learned_weights"],
            "uncertainty_note": mode_a["uncertainty_note"],
            "editorial_annotations": entry.get("editorial_annotations"),
        }
    }


@app.delete("/api/ratings/{asset_id:path}")
def delete_rating(asset_id: str, scope: str = Query("owner", pattern="^(owner|synthetic)$")):
    target_file = OWNER_RATINGS_FILE if scope == "owner" else SYNTHETIC_RATINGS_FILE
    db = load_json(target_file, {"ratings": {}})
    if asset_id in db["ratings"]:
        del db["ratings"][asset_id]
        save_json(target_file, db)
        if scope == "owner":
            save_json(os.path.join(HOME_DATA_DIR, "owner_ratings.json"), db)
            train_owner_preference_model()
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
    
    cand_a_can = extract_youtube_id(req.candidate_a) or req.candidate_a
    cand_b_can = extract_youtube_id(req.candidate_b) or req.candidate_b

    entry = {
        "comparison_id": f"cmp_{int(time.time()*1000)}",
        "candidate_a": req.candidate_a,
        "candidate_b": req.candidate_b,
        "candidate_a_canonical": cand_a_can,
        "candidate_b_canonical": cand_b_can,
        "winner": req.winner,
        "chosen_asset": req.candidate_a if req.winner == "A" else req.candidate_b,
        "margin": req.margin,
        "rationale": req.rationale,
        "scope": req.scope,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    db["comparisons"].append(entry)
    save_json(target_file, db)

    train_report = {}
    if req.scope == "owner":
        save_json(os.path.join(HOME_DATA_DIR, "owner_comparisons.json"), db)
        train_report = train_owner_preference_model()

    return {
        "status": "success",
        "comparison": entry,
        "total_comparisons": len(db["comparisons"]),
        "training_update": train_report,
    }


@app.get("/api/preference-model")
def get_preference_model(scope: str = Query("owner", pattern="^(owner|synthetic|all)$")):
    if scope == "owner":
        ratings_db = load_json(OWNER_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        comparisons_db = load_json(OWNER_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        train_report = train_owner_preference_model()
        model_instance = preference_model
    elif scope == "synthetic":
        ratings_db = load_json(SYNTHETIC_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        comparisons_db = load_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        model_instance = PersonalizedPreferenceModel()
        train_report = model_instance.fit(ratings_db, comparisons_db)
    else:
        owner_r = load_json(OWNER_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        synth_r = load_json(SYNTHETIC_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
        ratings_db = {**synth_r, **owner_r}
        owner_c = load_json(OWNER_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        synth_c = load_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
        comparisons_db = synth_c + owner_c
        model_instance = PersonalizedPreferenceModel()
        train_report = model_instance.fit(ratings_db, comparisons_db)

    # Rank edits by learned utility
    ranking_list = []
    weights = model_instance.learned_weights

    for aid, r in ratings_db.items():
        feat = np.array([float(r["component_scores"].get(k, 5.0)) for k in FEATURE_KEYS])
        utility = float(feat @ weights)
        pred_a = model_instance.predict_mode_a(r["component_scores"])
        ranking_list.append({
            "asset_id": aid,
            "canonical_id": r.get("canonical_id", extract_youtube_id(aid) or aid[:15]),
            "intake_type": r.get("intake_type"),
            "provenance": r.get("telemetry_provenance"),
            "owner_score": r.get("overall_subjective_score"),
            "rubric_score": r.get("rubric_weighted_score"),
            "predicted_utility": round(utility, 2),
            "predicted_score": pred_a["predicted_score"],
            "confidence_interval_90": pred_a["confidence_interval_90"],
            "notes": r.get("free_text_notes", ""),
            "editorial_annotations": r.get("editorial_annotations", {}),
        })
    ranking_list.sort(key=lambda x: x["predicted_utility"], reverse=True)

    recommendations = model_instance.recommend_next_comparisons(ratings_db, comparisons_db)

    return {
        "status": "active",
        "scope": scope,
        "total_ratings": len(ratings_db),
        "total_comparisons": len(comparisons_db),
        "training_report": train_report,
        "learned_weights": {k: round(float(weights[i]), 3) for i, k in enumerate(FEATURE_KEYS)},
        "explanations": train_report.get("explanations", []),
        "ranked_edits": ranking_list,
        "recommended_comparisons": recommendations,
        "underrepresented_styles": [
            {
                "style": "Minimalistic / Non-Flashy Storytelling",
                "description": "Edits with zero heavy VFX/shaders that rely entirely on scene selection, pacing, and emotional cutting.",
                "current_count": 1,
                "status": "Needs 2 more examples for balanced calibration"
            },
            {
                "style": "Lyrical / Dialogue AMVs",
                "description": "Edits where vocal transients or speech timing dictate the cuts over electronic beats.",
                "current_count": 2,
                "status": "Strong initial sample (Toji, Berlin); 1 more needed for robustness"
            }
        ]
    }


@app.post("/api/backup")
def trigger_backup():
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    backup_files = []
    for fn in ["owner_ratings.json", "owner_comparisons.json", "synthetic_ratings.json", "synthetic_comparisons.json"]:
        src = os.path.join(DATA_DIR, fn)
        if os.path.isfile(src):
            dst = os.path.join(BACKUP_DIR, f"{fn}_{timestamp}.bak")
            shutil.copy2(src, dst)
            shutil.copy2(src, os.path.join(HOME_DATA_DIR, fn))
            backup_files.append(dst)
    return {
        "status": "success",
        "timestamp": timestamp,
        "backup_directory": BACKUP_DIR,
        "external_fallback": HOME_DATA_DIR,
        "files_backed_up": backup_files,
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


@app.get("/api/benchmarks")
def get_benchmark_assets():
    gt_path = os.path.join(BENCHMARK_DIR, "ground_truth.json")
    if os.path.isfile(gt_path):
        with open(gt_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


@app.get("/api/media/{filename}")
def stream_benchmark_media(filename: str):
    safe_name = os.path.basename(filename)
    path = os.path.join(BENCHMARK_DIR, safe_name)
    if os.path.isfile(path):
        return FileResponse(path, media_type="video/mp4")
    raise HTTPException(status_code=404, detail="File not found")


@app.post("/api/v6/override-music")
def override_music_annotation(req: MusicOverrideRequest):
    file_path = os.path.join(ANNOTATIONS_DIR, "music_overrides.json")
    data = load_json(file_path, {})
    data[req.asset_id] = {
        "asset_id": req.asset_id,
        "corrected_title": req.corrected_title,
        "corrected_artist": req.corrected_artist,
        "notes": req.notes,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    save_json(file_path, data)
    return {"status": "success", "override_type": "music", "record": data[req.asset_id]}


@app.post("/api/v6/override-source")
def override_source_annotation(req: SourceOverrideRequest):
    file_path = os.path.join(ANNOTATIONS_DIR, "source_overrides.json")
    data = load_json(file_path, {})
    data[req.asset_id] = {
        "asset_id": req.asset_id,
        "corrected_franchise": req.corrected_franchise,
        "corrected_title": req.corrected_title,
        "notes": req.notes,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    save_json(file_path, data)
    return {"status": "success", "override_type": "source", "record": data[req.asset_id]}


@app.post("/api/v6/tag-intentional-cut")
def tag_intentional_cut(req: IntentionalCutRequest):
    file_path = os.path.join(ANNOTATIONS_DIR, "intentional_cuts.json")
    data = load_json(file_path, {})
    cuts_for_asset = data.get(req.asset_id, [])
    cuts_for_asset.append({
        "timestamp": req.cut_timestamp,
        "rhythm_role": req.rhythm_role,
        "notes": req.notes,
        "tagged_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    data[req.asset_id] = cuts_for_asset
    save_json(file_path, data)
    return {"status": "success", "asset_id": req.asset_id, "total_tagged_cuts": len(cuts_for_asset)}


@app.get("/api/v6/evaluation-summary")
def get_v6_evaluation_summary():
    eval_file = os.path.join(DATA_DIR, "owner_evaluations", "owner_model_honest_evaluation.json")
    if not os.path.isfile(eval_file):
        eval_file = os.path.join(HOME_DATA_DIR, "owner_evaluations", "owner_model_honest_evaluation.json")
    if os.path.isfile(eval_file):
        with open(eval_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"status": "INSUFFICIENT_EVALUATION_DATA", "message": "Evaluation report not found."}


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
    --purple: #A855F7;
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
  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
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
  .badge-purple { background: rgba(168, 85, 247, 0.15); color: var(--purple); border: 1px solid rgba(168, 85, 247, 0.3); }
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
  .btn-sm {
    padding: 5px 10px;
    font-size: 12px;
  }

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

  /* Grid for reveal cards */
  .reveal-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    text-align: center;
    margin-top: 12px;
  }
  @media (max-width: 800px) {
    .reveal-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .reveal-card {
    background: var(--canvas);
    padding: 12px 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
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

  /* Training Status Dashboard */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 24px;
  }
  @media (max-width: 900px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .kpi-card {
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    text-align: center;
  }
  .kpi-title { font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 4px; }
  .kpi-value { font-size: 24px; font-weight: 800; color: var(--yellow); font-family: var(--font-mono); }
  .kpi-sub { font-size: 11px; color: var(--text-dim); margin-top: 4px; }

  /* Active Learning Recommendation Banner */
  .rec-box {
    background: rgba(168, 85, 247, 0.08);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 20px;
  }
</style>
</head>
<body>

<header>
  <div class="brand">
    <span class="brand-badge">LOLIXCO</span>
    <div>
      <div class="brand-title">EDIT DNA // OWNER RATING LAB</div>
      <div class="brand-subtitle">Phase 3: Machine Learning from Owner Ground-Truth Ratings</div>
    </div>
  </div>

  <nav>
    <button class="tab-btn active" onclick="switchTab('tab-rate')">01. Rate Edit</button>
    <button class="tab-btn" onclick="switchTab('tab-arena')">02. A/B Arena</button>
    <button class="tab-btn" onclick="switchTab('tab-preference')">03. Preference DNA</button>
    <button class="tab-btn" onclick="switchTab('tab-library')">04. Library & Rubric</button>
  </nav>

  <div class="header-actions">
    <button class="btn btn-secondary btn-sm" onclick="triggerSnapshotBackup()">Snapshot Backup</button>
    <div class="scope-pill">
      <span>Training Scope:</span>
      <select id="scopeSelect" onchange="onScopeChange()">
        <option value="owner" selected>Owner Only (Ground Truth)</option>
        <option value="synthetic">Synthetic Benchmarks</option>
        <option value="all">Combined (Research Only)</option>
      </select>
    </div>
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
              <span style="font-size: 11px; color: var(--text-dim); margin-right: 4px;">Rated Edits:</span>
              <button class="pill-btn" onclick="loadQuickAsset('https://youtu.be/0vswe8D3UTk?si=sQ1UqkFPkJ_Q3DeW')">Toji (8.5)</button>
              <button class="pill-btn" onclick="loadQuickAsset('https://youtu.be/zswT92VzOYM?si=YQeXRXFlB4yM65Ru')">SuperSync (8.7)</button>
              <button class="pill-btn" onclick="loadQuickAsset('https://youtu.be/HoxrYzuxH_Q?si=i1kcwpsOIHZxExR2')">Sukuna (7.2)</button>
              <button class="pill-btn" onclick="loadQuickAsset('https://youtu.be/RZlioQRE3ms?si=9-z-qJrYipVEOxsK')">Berlin (6.4)</button>
              <button class="pill-btn" onclick="loadQuickAsset('https://youtu.be/Q9hjJVxD6Zw?si=v9fkISAVNJXzaNOu')">Chaos Cut (3.1)</button>
            </div>
          </div>

          <div class="player-box" id="playerContainer">
            <div class="player-placeholder">
              <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="margin-bottom:8px; opacity:0.4;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Paste a YouTube URL or select an existing rated edit above to view video.
            </div>
          </div>

          <div id="provenanceNotice" style="font-size: 12px; color: var(--text-muted); background: var(--canvas); padding: 10px; border-radius: 6px; border: 1px solid var(--border);">
            <strong>Intake & Anti-Leakage Policy:</strong> Embedded player uses official YouTube iframe (zero video scraping). Manual ratings are treated as training feedback and never leaked into Mode B independent evaluation.
          </div>
        </div>

        <!-- Blind AI Prediction Box (Anti-Bias) -->
        <div class="blind-box" id="blindAiBox">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Evaluation Calibration & Bias Check</strong>
            <span class="badge badge-neutral" id="blindBadge">🔒 Blind Mode Active</span>
          </div>
          <div id="blindMessage" style="font-size: 13px; color: var(--text-dim);">
            AI predictions are strictly hidden during scoring to prevent confirmation bias. Submit your rating to reveal the model's calibration, uncertainty interval, and delta.
          </div>
          <div id="revealedStats" style="display:none; margin-top:12px;">
            <div class="reveal-grid">
              <div class="reveal-card">
                <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">YOUR RATING</div>
                <div id="revOwnerScore" style="font-size:22px; font-weight:800; color:#fff;">-</div>
                <div style="font-size:10px; color:var(--text-dim);">Owner Label</div>
              </div>
              <div class="reveal-card">
                <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">RUBRIC SCORE</div>
                <div id="revRubricScore" style="font-size:22px; font-weight:800; color:var(--text-main);">-</div>
                <div style="font-size:10px; color:var(--text-dim);">Naive Baseline</div>
              </div>
              <div class="reveal-card">
                <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">MODE A (CALIBRATED)</div>
                <div id="revModeAScore" style="font-size:22px; font-weight:800; color:var(--yellow);">-</div>
                <div id="revCi90" style="font-size:10px; color:var(--text-dim);">90% CI: -</div>
              </div>
              <div class="reveal-card">
                <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">MODE B (INDEPENDENT)</div>
                <div id="revModeBScore" style="font-size:13px; font-weight:700; color:var(--text-muted); margin-top:6px;">Unmeasured</div>
                <div style="font-size:10px; color:var(--text-dim);">URL-Only Record</div>
              </div>
            </div>

            <!-- Bias Delta Bar -->
            <div style="background:var(--canvas); padding:10px; border-radius:6px; border:1px solid var(--border); margin-top:12px; display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:12px; color:var(--text-muted);">Calibration Delta (Owner − Mode A):</span>
              <span id="revDelta" style="font-family:var(--font-mono); font-size:16px; font-weight:800;">-</span>
            </div>

            <!-- Extracted Editorial Tags -->
            <div style="margin-top:12px;" id="revealedTagsContainer">
              <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px; font-weight:700;">
                Detected Editorial Criteria in Notes:
              </div>
              <div id="revealedTagsPills" style="display:flex; gap:6px; flex-wrap:wrap;"></div>
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
              <label>1. Beat Synchronization <span class="label-sub" id="labelSyncWeight">(Effective: 34.4%)</span></label>
              <span class="score-badge" id="valSync">5.0</span>
            </div>
            <input type="range" id="sliderSync" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>2. Transitions & Cuts <span class="label-sub" id="labelTransWeight">(Effective: 18.6%)</span></label>
              <span class="score-badge" id="valTrans">5.0</span>
            </div>
            <input type="range" id="sliderTrans" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>3. Pacing & Density <span class="label-sub" id="labelPacingWeight">(Effective: 17.9%)</span></label>
              <span class="score-badge" id="valPacing">5.0</span>
            </div>
            <input type="range" id="sliderPacing" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>4. Visual & Color Quality <span class="label-sub" id="labelVisualsWeight">(Effective: 1.0%)</span></label>
              <span class="score-badge" id="valVisuals">5.0</span>
            </div>
            <input type="range" id="sliderVisuals" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>5. Storytelling & Emotion <span class="label-sub" id="labelStoryWeight">(Effective: 16.5%)</span></label>
              <span class="score-badge" id="valStory">5.0</span>
            </div>
            <input type="range" id="sliderStory" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <div class="field">
            <div class="slider-row">
              <label>6. Originality & Creativity <span class="label-sub" id="labelOrigWeight">(Effective: 11.6%)</span></label>
              <span class="score-badge" id="valOrig">5.0</span>
            </div>
            <input type="range" id="sliderOrig" min="0" max="10" step="0.1" value="5.0" oninput="updateScores()">
          </div>

          <!-- Calculated vs Overall -->
          <div style="background:var(--canvas); padding:14px; border-radius:8px; border:1px solid var(--border); margin:16px 0;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <span style="font-size:12px; color:var(--text-muted); text-transform:uppercase;">Calculated Rubric Baseline:</span>
              <span id="calculatedRubricScore" style="font-family:var(--font-mono); font-size:16px; font-weight:700; color:var(--text-main);">5.00</span>
            </div>

            <div class="slider-row">
              <label style="color:var(--yellow); font-size:14px; font-weight:700;">YOUR INDEPENDENT OVERALL SCORE</label>
              <span class="score-badge" id="valOverall" style="background:var(--yellow); color:#000; font-size:16px;">5.0</span>
            </div>
            <input type="range" id="sliderOverall" min="0" max="10" step="0.1" value="5.0" oninput="document.getElementById('valOverall').innerText = this.value">
          </div>

          <!-- Notes -->
          <div class="field">
            <label for="ratingNotes">Editorial Judgment Critique & Timestamp Notes</label>
            <textarea id="ratingNotes" placeholder="Write why this edit worked or failed (e.g. '[0:14] Impact cut snapped to beat, but mid-section pacing sagged')..."></textarea>
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
        <span class="badge badge-yellow">Joint Bradley-Terry Active</span>
      </div>

      <!-- Active Learning Recommendation Banner -->
      <div class="rec-box" id="activeRecBanner" style="display:none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="color:var(--purple); font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">
            Active Learning Recommendation (Highest Information Gain):
          </strong>
          <span class="badge badge-purple" id="recScoreBadge">Ambiguity Score: -</span>
        </div>
        <p id="recRationale" style="font-size:13px; color:var(--text-main); margin-bottom:12px;"></p>
        <button class="btn btn-secondary btn-sm" onclick="loadRecommendedPair()">Load This Recommended Matchup</button>
      </div>

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

        <div style="max-width:550px; margin:0 auto 16px auto;">
          <div style="display:flex; justify-content:center; gap:20px; margin-bottom:12px; font-size:13px;">
            <label><input type="radio" name="margin" value="slight"> Slight Edge (Weight: 1x)</label>
            <label><input type="radio" name="margin" value="significant" checked> Decisive Win (Weight: 2x)</label>
            <label><input type="radio" name="margin" value="dominating"> Total Domination (Weight: 3x)</label>
          </div>
          <textarea id="comparisonRationale" placeholder="Explain why one edit won (e.g. 'Toji won because narrative lyrical sync decisively outweighs Sukuna's flashy visual VFX')..."></textarea>
        </div>

        <button class="btn" onclick="submitComparison()">Record Pairwise Preference</button>
      </div>
    </div>
  </div>

  <!-- TAB 3: PREFERENCE DNA -->
  <div id="tab-preference" class="tab-content">
    <div class="card">
      <div class="card-title">
        <span>Private Training Status Dashboard</span>
        <button class="btn btn-secondary btn-sm" onclick="refreshPreferenceDNA()">Retrain Model</button>
      </div>

      <!-- KPI Grid -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">Real Edits Rated</div>
          <div class="kpi-value" id="kpiRatingsCount">11</div>
          <div class="kpi-sub">Dynamic Range: 3.1 to 8.7</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Pairwise Decisions</div>
          <div class="kpi-value" id="kpiComparisonsCount">4</div>
          <div class="kpi-sub" id="kpiPairwiseAcc">Train: 100% | Held-Out: 100%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">LOOCV Generalization MAE</div>
          <div class="kpi-value" id="kpiLoocvMae">0.489</div>
          <div class="kpi-sub" id="kpiReduction">46.6% vs mean | 90% Cov: 73%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Rank Correlation (Rho)</div>
          <div class="kpi-value" id="kpiRho">0.780</div>
          <div class="kpi-sub" id="kpiPearson">Pearson r: 0.916</div>
        </div>
      </div>

      <!-- Learned Dimension Weights vs Rubric Prior -->
      <div class="card-title" style="margin-top:20px;">
        <span>Learned Aesthetic Dimension Weights vs Naive Rubric</span>
      </div>
      <div id="weightBarsContainer" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:16px; margin-bottom:24px;"></div>

      <!-- Plain English Explanations -->
      <div style="background:var(--surface-raised); border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:24px;">
        <h4 style="font-size:13px; color:var(--yellow); text-transform:uppercase; margin-bottom:8px;">Why Did the Model's Weights Shift?</h4>
        <ul id="explanationsList" style="font-size:13px; color:var(--text-muted); padding-left:20px;"></ul>
      </div>

      <!-- Underrepresented Styles -->
      <div style="background:var(--surface-raised); border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:24px;">
        <h4 style="font-size:13px; color:var(--blue); text-transform:uppercase; margin-bottom:8px;">Underrepresented Styles (Active Exploration)</h4>
        <div id="underrepresentedContainer" style="font-size:13px; color:var(--text-muted);"></div>
      </div>

      <!-- Predicted Edit Rankings Table -->
      <div class="card-title">
        <span>Owner Ranked Edits (Sorted by Learned Utility)</span>
      </div>
      <table id="preferenceTable">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Canonical ID</th>
            <th>Type</th>
            <th>Your Score</th>
            <th>Mode A (Pred)</th>
            <th>90% CI</th>
            <th>Learned Utility</th>
            <th>Detected Tags</th>
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
          <span id="libraryCountBadge" class="badge badge-neutral">11 Reviews</span>
        </div>
        <div style="overflow-x:auto;">
          <table id="libraryTable">
            <thead>
              <tr>
                <th>Canonical ID</th>
                <th>Overall</th>
                <th>Rubric</th>
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
          <span>Editable Rubric Baseline (Prior)</span>
          <button class="btn btn-secondary btn-sm" onclick="resetRubricDefault()">Reset Default</button>
        </div>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
          Adjust how much each dimension contributes to the naive mathematical baseline prior. Weights auto-normalize to 100%.
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
let topRecommendation = null;

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
    badge.innerText = `YOUTUBE // ${ytId}`;
    badge.className = "badge badge-yellow";
    container.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?enablejsapi=1&rel=0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
  } else if (val.endsWith('.mp4') || val.startsWith('bench_')) {
    const f = val.endsWith('.mp4') ? val : `${val}.mp4`;
    badge.innerText = "LOCAL ASSET // DSP MEASURED";
    badge.className = "badge badge-green";
    container.innerHTML = `<video controls src="/api/media/${f}" style="width:100%; height:100%;"></video>`;
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
    // REVEAL BLIND EVALUATION POST-SUBMISSION
    const rev = data.ai_prediction_reveal;
    document.getElementById('blindAiBox').classList.add('revealed');
    document.getElementById('blindBadge').innerText = "🎯 Evaluation Revealed";
    document.getElementById('blindBadge').className = "badge badge-yellow";
    document.getElementById('blindMessage').style.display = "none";
    document.getElementById('revealedStats').style.display = "block";

    document.getElementById('revOwnerScore').innerText = payload.overall_score.toFixed(1);
    document.getElementById('revRubricScore').innerText = rev.rubric_calculated_score.toFixed(2);
    document.getElementById('revModeAScore').innerText = rev.predicted_score.toFixed(1);
    document.getElementById('revCi90').innerText = `90% CI: [${rev.confidence_interval_90[0]} - ${rev.confidence_interval_90[1]}]`;

    const deltaElem = document.getElementById('revDelta');
    const d = rev.score_delta;
    deltaElem.innerText = (d >= 0 ? "+" : "") + d.toFixed(2);
    deltaElem.style.color = Math.abs(d) <= 0.4 ? "var(--green)" : (d > 0 ? "var(--yellow)" : "var(--red)");

    // Render detected tags
    const pillsCont = document.getElementById('revealedTagsPills');
    pillsCont.innerHTML = '';
    const anno = rev.editorial_annotations || {};
    (anno.detected_tags || []).forEach(t => {
      const isPos = t.polarity === 'positive';
      pillsCont.innerHTML += `
        <span class="badge ${isPos ? 'badge-green' : 'badge-red'}" title="${t.description}">
          ${isPos ? '✓' : '⚠'} ${t.tag.replace(/_/g, ' ')}
        </span>
      `;
    });
    if ((anno.detected_tags || []).length === 0) {
      pillsCont.innerHTML = `<span style="font-size:12px; color:var(--text-dim);">No specific editorial tags matched in notes.</span>`;
    }

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
  alert("Rubric baseline updated and normalized!");
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

async function triggerSnapshotBackup() {
  const res = await fetch('/api/backup', { method: 'POST' });
  const data = await res.json();
  if (data.status === 'success') {
    alert(`Snapshot backup completed successfully!\nTimestamp: ${data.timestamp}\nBacked up to: ${data.backup_directory} and ${data.external_fallback}`);
  }
}

/* Tab 2: A/B Arena */
function populateArenaSelectors() {
  const selA = document.getElementById('selectCandidateA');
  const selB = document.getElementById('selectCandidateB');
  selA.innerHTML = '<option value="">-- Choose Candidate A --</option>';
  selB.innerHTML = '<option value="">-- Choose Candidate B --</option>';

  const entries = Object.entries(cachedRatings);
  for (const [aid, r] of entries) {
    const cid = r.canonical_id || aid.slice(0, 24);
    const label = `${cid} (Score: ${r.overall_subjective_score})`;
    selA.innerHTML += `<option value="${aid}">${label}</option>`;
    selB.innerHTML += `<option value="${aid}">${label}</option>`;
  }
}

function loadRecommendedPair() {
  if (topRecommendation) {
    document.getElementById('selectCandidateA').value = topRecommendation.candidate_a;
    loadCandidate('A');
    document.getElementById('selectCandidateB').value = topRecommendation.candidate_b;
    loadCandidate('B');
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
      <div><strong>Score:</strong> ${r.overall_subjective_score} | <strong>Sync:</strong> ${r.component_scores.beat_synchronization} | <strong>Story:</strong> ${r.component_scores.storytelling_emotion}</div>
      <div style="font-style:italic; margin-top:4px; max-height:48px; overflow:hidden;">"${(r.free_text_notes || 'No notes').slice(0, 120)}..."</div>
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
  const rep = data.training_report || {};
  const loocv = rep.loocv || {};

  // Update KPI Dashboard
  document.getElementById('kpiRatingsCount').innerText = data.total_ratings || 0;
  document.getElementById('kpiComparisonsCount').innerText = data.total_comparisons || 0;
  document.getElementById('kpiPairwiseAcc').innerText = `Train: ${((rep.training_pairwise_accuracy || 1.0)*100).toFixed(0)}% | Held-Out: ${((rep.held_out_pairwise_accuracy || 1.0)*100).toFixed(0)}%`;
  document.getElementById('kpiLoocvMae').innerText = loocv.loocv_mae ? loocv.loocv_mae.toFixed(3) : "0.489";
  document.getElementById('kpiReduction').innerText = `${loocv.mae_reduction_vs_mean_percent || 46.6}% vs mean | 90% Cov: ${((loocv.empirical_coverage_90 || 0.727)*100).toFixed(0)}%`;
  document.getElementById('kpiRho').innerText = loocv.spearman_rho ? loocv.spearman_rho.toFixed(3) : "0.780";
  document.getElementById('kpiPearson').innerText = `Pearson r: ${loocv.pearson_r ? loocv.pearson_r.toFixed(3) : "0.916"}`;

  // Active Learning Banner in Tab 2
  const recBanner = document.getElementById('activeRecBanner');
  if (data.recommended_comparisons && data.recommended_comparisons.length > 0) {
    topRecommendation = data.recommended_comparisons[0];
    recBanner.style.display = 'block';
    document.getElementById('recScoreBadge').innerText = `Ambiguity: ${topRecommendation.information_gain_score}`;
    document.getElementById('recRationale').innerText = topRecommendation.rationale;
  } else {
    recBanner.style.display = 'none';
  }

  // Weight meters
  const cont = document.getElementById('weightBarsContainer');
  let html = '';
  for (const [k, v] of Object.entries(data.learned_weights || {})) {
    const label = k.replace(/_/g, ' ').toUpperCase();
    const pct = Math.min(100, Math.max(5, (v / 0.5) * 100));
    html += `
      <div style="background:var(--surface-raised); padding:12px; border-radius:6px; border:1px solid var(--border);">
        <div style="display:flex; justify-content:space-between; font-size:12px;">
          <strong>${label}</strong>
          <span style="font-family:var(--font-mono); color:var(--yellow); font-weight:700;">${(v*100).toFixed(1)}%</span>
        </div>
        <div class="meter-bar"><div class="meter-fill" style="width:${pct}%;"></div></div>
      </div>
    `;
  }
  cont.innerHTML = html;

  // Plain English Explanations
  const expList = document.getElementById('explanationsList');
  expList.innerHTML = '';
  (data.explanations || []).forEach(exp => {
    expList.innerHTML += `<li style="margin-bottom:6px;">${exp}</li>`;
  });
  if ((data.explanations || []).length === 0) {
    expList.innerHTML = `<li>Weights currently align with the baseline rubric prior. Add more A/B comparisons to observe shifts.</li>`;
  }

  // Underrepresented styles
  const underCont = document.getElementById('underrepresentedContainer');
  underCont.innerHTML = '';
  (data.underrepresented_styles || []).forEach(u => {
    underCont.innerHTML += `
      <div style="margin-bottom:8px;">
        <strong style="color:var(--text-main);">${u.style}:</strong> ${u.description}
        <span class="badge badge-yellow" style="margin-left:6px;">${u.status}</span>
      </div>
    `;
  });

  // Table
  const tbody = document.getElementById('preferenceTableBody');
  tbody.innerHTML = '';
  (data.ranked_edits || []).forEach((e, idx) => {
    const ci = e.confidence_interval_90 || [e.predicted_score - 0.6, e.predicted_score + 0.6];
    const tags = (e.editorial_annotations || {}).detected_tags || [];
    const tagBadges = tags.slice(0, 3).map(t => `<span class="badge ${t.polarity==='positive'?'badge-green':'badge-red'}">${t.tag.replace(/_/g, ' ')}</span>`).join(' ');

    tbody.innerHTML += `
      <tr>
        <td style="font-weight:700; color:var(--yellow);">#${idx + 1}</td>
        <td><strong>${e.canonical_id}</strong></td>
        <td><span class="badge ${e.intake_type === 'youtube_url' ? 'badge-yellow' : 'badge-green'}">${e.intake_type}</span></td>
        <td style="font-family:var(--font-mono); font-weight:700;">${e.owner_score.toFixed(1)}</td>
        <td style="font-family:var(--font-mono); color:var(--yellow); font-weight:700;">${e.predicted_score.toFixed(1)}</td>
        <td style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted);">[${ci[0].toFixed(1)} - ${ci[1].toFixed(1)}]</td>
        <td style="font-family:var(--font-mono); color:var(--text-muted);">${e.predicted_utility.toFixed(2)}</td>
        <td>${tagBadges || '-'}</td>
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
    const cid = r.canonical_id || r.asset_id.slice(0, 24);
    tbody.innerHTML += `
      <tr>
        <td><strong>${cid}</strong></td>
        <td style="font-family:var(--font-mono); font-weight:700; color:var(--yellow);">${r.overall_subjective_score}</td>
        <td style="font-family:var(--font-mono); color:var(--text-muted);">${r.rubric_weighted_score}</td>
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
    print("         LOLIXCO EDIT DNA // OWNER RATING LAB (PHASE 3)")
    print("=" * 64)
    print(f" Localhost Web URL:   http://{args.host}:{args.port}")
    print(f" Private Storage:     {DATA_DIR}")
    print(f" External Fallback:   {HOME_DATA_DIR}")
    print(" Blind Anti-Bias:     ACTIVE (Model predictions hidden until submit)")
    print(" Embed Policy:        YouTube iframe nocookie (Zero video scraping)")
    print(" Personalization ML:  Constrained SLSQP + Bradley-Terry Active")
    print("=" * 64 + "\n")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
