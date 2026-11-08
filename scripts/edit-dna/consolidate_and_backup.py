#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — DATA CONSOLIDATION, CANONICALIZATION & BACKUP
Preserves 100% of owner ratings, notes, category scores, and comparisons.
Canonicalizes YouTube IDs without discarding original URLs.
Maintains isolated backups in data/edit-dna/backups/ and ~/.lolixco-edit-dna/.
"""

import os
import sys
import json
import time
import re
import shutil

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
DATA_DIR = os.path.join(BASE_DIR, "data", "edit-dna")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
HOME_BACKUP_DIR = os.path.expanduser("~/.lolixco-edit-dna")

OWNER_RATINGS_FILE = os.path.join(DATA_DIR, "owner_ratings.json")
SYNTHETIC_RATINGS_FILE = os.path.join(DATA_DIR, "synthetic_ratings.json")
OWNER_COMPARISONS_FILE = os.path.join(DATA_DIR, "owner_comparisons.json")
SYNTHETIC_COMPARISONS_FILE = os.path.join(DATA_DIR, "synthetic_comparisons.json")


def extract_youtube_id(url_or_id: str) -> str:
    if not url_or_id:
        return ""
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
    return url_or_id


def load_json(path, default):
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load {path}: {e}")
            return default
    return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def main():
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    os.makedirs(BACKUP_DIR, exist_ok=True)
    os.makedirs(HOME_BACKUP_DIR, exist_ok=True)
    os.makedirs(os.path.join(HOME_BACKUP_DIR, "backups"), exist_ok=True)

    # 1. Create immediate snapshot of raw files
    for fname in ["owner_ratings.json", "owner_comparisons.json", "synthetic_ratings.json", "synthetic_comparisons.json"]:
        src = os.path.join(DATA_DIR, fname)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(BACKUP_DIR, f"{fname}_{timestamp}.bak"))
            shutil.copy2(src, os.path.join(HOME_BACKUP_DIR, "backups", f"{fname}_{timestamp}.bak"))

    # 2. Load all databases
    raw_owner_ratings = load_json(OWNER_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
    raw_synthetic_ratings = load_json(SYNTHETIC_RATINGS_FILE, {"ratings": {}}).get("ratings", {})
    raw_owner_comparisons = load_json(OWNER_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])
    raw_synthetic_comparisons = load_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": []}).get("comparisons", [])

    # 3. Consolidate 11 owner reviews
    consolidated_owner_ratings = {}
    cleaned_synthetic_ratings = {}

    for k, v in {**raw_synthetic_ratings, **raw_owner_ratings}.items():
        if k.startswith("http") or "youtu" in k:
            yt_id = extract_youtube_id(k)
            # Ensure full data structure with canonicalization
            v["canonical_id"] = yt_id
            v["youtube_id"] = yt_id
            v["original_url"] = k
            v["is_synthetic_benchmark"] = False
            v["scope"] = "owner"
            consolidated_owner_ratings[k] = v
        else:
            # Genuine synthetic benchmark
            v["is_synthetic_benchmark"] = True
            v["scope"] = "synthetic"
            cleaned_synthetic_ratings[k] = v

    # 4. Consolidate comparisons
    consolidated_owner_comparisons = []
    cleaned_synthetic_comparisons = []

    for c in raw_owner_comparisons + raw_synthetic_comparisons:
        cand_a = c.get("candidate_a", "")
        cand_b = c.get("candidate_b", "")
        is_synthetic = cand_a.startswith("bench_") or cand_b.startswith("bench_")
        
        c["candidate_a_canonical"] = extract_youtube_id(cand_a)
        c["candidate_b_canonical"] = extract_youtube_id(cand_b)

        if is_synthetic:
            c["scope"] = "synthetic"
            cleaned_synthetic_comparisons.append(c)
        else:
            c["scope"] = "owner"
            # Deduplicate by comparison_id
            if not any(x.get("comparison_id") == c.get("comparison_id") for x in consolidated_owner_comparisons):
                consolidated_owner_comparisons.append(c)

    # 5. Save consolidated files
    save_json(OWNER_RATINGS_FILE, {"ratings": consolidated_owner_ratings})
    save_json(OWNER_COMPARISONS_FILE, {"comparisons": consolidated_owner_comparisons})
    save_json(SYNTHETIC_RATINGS_FILE, {"ratings": cleaned_synthetic_ratings})
    save_json(SYNTHETIC_COMPARISONS_FILE, {"comparisons": cleaned_synthetic_comparisons})

    # 6. Mirror to user home directory for external permanent persistence across branches
    save_json(os.path.join(HOME_BACKUP_DIR, "owner_ratings.json"), {"ratings": consolidated_owner_ratings})
    save_json(os.path.join(HOME_BACKUP_DIR, "owner_comparisons.json"), {"comparisons": consolidated_owner_comparisons})

    print("=" * 64)
    print("      LOLIXCO EDIT DNA — DATA CONSOLIDATION COMPLETE")
    print("=" * 64)
    print(f" Owner Ratings Preserved:      {len(consolidated_owner_ratings)} real edits")
    print(f" Owner Comparisons Preserved:  {len(consolidated_owner_comparisons)} pairwise comparisons")
    print(f" Synthetic Ratings Isolated:   {len(cleaned_synthetic_ratings)} benchmark assets")
    print(f" Synthetic Comparisons:        {len(cleaned_synthetic_comparisons)} comparisons")
    print(f" Primary Data Path:            {DATA_DIR}")
    print(f" Local Backup Snapshot:        {BACKUP_DIR}")
    print(f" External Fallback Path:       {HOME_BACKUP_DIR}")
    print("=" * 64)


if __name__ == "__main__":
    main()

