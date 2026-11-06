#!/usr/bin/env python3
"""
Lolixco Edit DNA — Real Music Identification Benchmark
Evaluates genuine master recordings from Wikimedia Commons:
  - Ludwig van Beethoven: Symphony No. 5 (Orchestral)
  - Frédéric Chopin: Nocturne Op. 9 No. 2 (Piano Solo)
  - Johann Sebastian Bach: Brandenburg Concerto No. 3 (Strings)

Tests invariance under:
  1. Clean excerpt
  2. Slowed tempo (0.85x)
  3. Pitch shift (+2 semitones)
  4. Dialogue overlay (speech over music)
  5. Out-of-catalog unknown track (abstention)
"""

import os
import sys
import json
import time
from typing import Dict, Any, List

from recognizer import EditDNARecognizer

BENCHMARK_DIR = "test-assets/real_music_benchmark"
REPORT_PATH = "data/edit-dna/real_music_benchmark_report.json"
os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)


def run_real_music_benchmark():
    print("=" * 80)
    print("   LOLIXCO EDIT DNA — REAL MUSIC IDENTIFICATION EXPERIMENT")
    print("=" * 80)

    # 1. Initialize Recognizer
    recognizer = EditDNARecognizer()
    recognizer.audio_sim_threshold = 0.60
    recognizer.audio_margin_threshold = 0.06

    # 2. Register Authorized Real Master Recordings
    references = [
        {
            "ref_id": "ref_real_beethoven_sym5",
            "title": "Symphony No. 5 in C minor, Op. 67 (1. Allegro con brio)",
            "artist": "Ludwig van Beethoven (European Philharmonic)",
            "path": os.path.join(BENCHMARK_DIR, "ref_real_beethoven_sym5.wav"),
        },
        {
            "ref_id": "ref_real_chopin_nocturne",
            "title": "Nocturne in E-flat major, Op. 9, No. 2",
            "artist": "Frédéric Chopin (Piano Solo)",
            "path": os.path.join(BENCHMARK_DIR, "ref_real_chopin_nocturne.wav"),
        },
        {
            "ref_id": "ref_real_bach_brandenburg3",
            "title": "Brandenburg Concerto No. 3 in G major, BWV 1048 (1. Allegro)",
            "artist": "Johann Sebastian Bach (Strings)",
            "path": os.path.join(BENCHMARK_DIR, "ref_real_bach_brandenburg3.wav"),
        },
    ]

    for ref in references:
        recognizer.register_audio_reference(
            ref_id=ref["ref_id"],
            title=ref["title"],
            artist=ref["artist"],
            audio_path=ref["path"],
        )
        print(f" Registered: {ref['title']} ({ref['artist']})")

    print("-" * 80)

    # 3. Test Queries
    queries = [
        {
            "id": "q_m1_clean_beethoven",
            "condition": "clean_excerpt",
            "path": os.path.join(BENCHMARK_DIR, "q_m1_clean_beethoven.wav"),
            "target": "ref_real_beethoven_sym5",
        },
        {
            "id": "q_m2_slowed_chopin",
            "condition": "slowed_0_85x",
            "path": os.path.join(BENCHMARK_DIR, "q_m2_slowed_chopin.wav"),
            "target": "ref_real_chopin_nocturne",
        },
        {
            "id": "q_m3_pitched_bach",
            "condition": "pitched_plus2_semitones",
            "path": os.path.join(BENCHMARK_DIR, "q_m3_pitched_bach.wav"),
            "target": "ref_real_bach_brandenburg3",
        },
        {
            "id": "q_m4_dialogue_beethoven",
            "condition": "dialogue_overlay",
            "path": os.path.join(BENCHMARK_DIR, "q_m4_dialogue_beethoven.wav"),
            "target": "ref_real_beethoven_sym5",
        },
        {
            "id": "q_m5_unknown_acoustic",
            "condition": "out_of_catalog_unknown",
            "path": os.path.join(BENCHMARK_DIR, "q_m5_unknown_acoustic.wav"),
            "target": None,
        },
    ]

    print(f"\n{'Query ID':<26} | {'Condition':<24} | {'Expected Target':<28} | {'Recognized Match':<28} | {'Conf':<6} | {'Status'}")
    print("-" * 125)

    results = []
    correct_count = 0

    for q in queries:
        target = q["target"]
        fpath = q["path"]

        t0 = time.time()
        res = recognizer.identify_music_track(fpath)
        latency_ms = round((time.time() - t0) * 1000.0, 1)

        status = res.get("status")
        matched_entity = res.get("matched_entity")
        matched_id = matched_entity["ref_id"] if matched_entity else None
        matched_title = matched_entity["title"] if matched_entity else "UNKNOWN / ABSTAIN"
        conf = res.get("confidence", 0.0)

        is_pass = (matched_id == target) if target else (status == "abstain")
        if is_pass:
            correct_count += 1

        status_flag = "PASS" if is_pass else "FAIL"
        print(f"{q['id']:<26} | {q['condition']:<24} | {str(target or 'None (Abstain)'):<28} | {matched_title[:26]:<28} | {conf:<6.2f} | {status_flag}")
        if not is_pass:
            print(f"   [DIAGNOSTIC] {res.get('reason')}: {res.get('explanation')}")

        results.append({
            "query_id": q["id"],
            "condition": q["condition"],
            "expected_target": target,
            "matched_id": matched_id,
            "matched_title": matched_title,
            "status": status,
            "confidence": conf,
            "latency_ms": latency_ms,
            "diagnostics": res.get("diagnostics", {}),
            "correct": is_pass,
        })

    accuracy = round((correct_count / len(queries)) * 100.0, 1)
    print("-" * 125)
    print(f" Real Music Identification Accuracy: {correct_count}/{len(queries)} ({accuracy}%)")

    # Commercial Identification Services Assessment
    commercial_proposal = {
        "acoustid_status": "Non-commercial only. AcoustID cannot be used in a commercial product without a commercial license agreement, and Chromaprint is algorithmically fragile to pitch and speed shifts.",
        "commercial_options": [
            {
                "provider": "AudD Music Recognition API",
                "features": "Direct music recognition with massive catalog, official Apple Music / Spotify links, supports humming and partial clips.",
                "pricing": "$5.00 / 1,000 requests (or $20/month base subscription).",
                "integration_path": "REST API with audio slice upload (10-15s WAV).",
                "speed_pitch_invariance": "Good for minor pitch/tempo drift, fails on extreme nightcore/slowed.",
            },
            {
                "provider": "ACRCloud Audio Fingerprinting",
                "features": "Broadcast-grade music recognition, supports custom fingerprint database for anime OSTs/unreleased tracks.",
                "pricing": "$5.00 / 1,000 queries (developer tier), enterprise tiers available.",
                "integration_path": "SDK (Python / C++) or REST API with HMAC auth.",
                "speed_pitch_invariance": "Offers specialized robust fingerprinting mode for covers and pitch-shifted edits.",
            },
            {
                "provider": "Lolixco In-House CENS + Onset Engine (Current)",
                "features": "Zero external dependency, 100% private, speed-sweep (0.80x-1.25x) and circular pitch-shift (+-3 semitones) invariant.",
                "pricing": "$0.00 (Self-hosted on CPU).",
                "scalability_limit": "Requires building an indexed catalog of target tracks.",
            },
        ],
    }

    report = {
        "benchmark_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "catalog_size": len(references),
        "total_queries": len(queries),
        "accuracy_percent": accuracy,
        "query_results": results,
        "commercial_services_proposal": commercial_proposal,
    }

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"\nReport saved to {REPORT_PATH}")
    print("=" * 80)
    return report


if __name__ == "__main__":
    run_real_music_benchmark()
