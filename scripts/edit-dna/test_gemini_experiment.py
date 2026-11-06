#!/usr/bin/env python3
"""
Lolixco Edit DNA — Experiment 1: Authorized Gemini YouTube Video Understanding
Evaluates the owner-provided YouTube reference:
  https://youtu.be/_yrPlcZY2jw?si=YIb3fHK5Ftet75iy

Protocol:
  - Metadata-Blind Prompting: Does NOT supply the title ("Dhurandhar"), actors ("Ranveer Singh"),
    or soundtrack ("Raga of revenge", "Anirudh") to the model.
  - Verification & Safety: Strictly avoids downloading or scraping the YouTube stream.
  - Quota & Billing: Confirms free-tier availability (YouTube URL preview feature at no charge).
  - Provider Abstraction: Uses GeminiVideoProvider with caching and fallback.
"""

import os
import sys
import json
import time
from typing import Dict, Any

from gemini_provider import GeminiVideoProvider

OWNER_YOUTUBE_URL = "https://youtu.be/_yrPlcZY2jw?si=YIb3fHK5Ftet75iy"
REPORT_PATH = "data/edit-dna/gemini_youtube_experiment_report.json"


def run_gemini_experiment():
    print("=" * 80)
    print("   LOLIXCO EDIT DNA — EXPERIMENT 1: GEMINI VIDEO UNDERSTANDING")
    print("=" * 80)
    print(f" Target YouTube URL : {OWNER_YOUTUBE_URL}")
    print(f" Protocol           : Metadata-Blind Direct Video Evaluation")
    print(f" Zero-Scrape Policy : Enforced (Google documented API URI input only)")

    # 1. Initialize Provider
    provider = GeminiVideoProvider(mode="hybrid_auto")
    has_key = provider.is_available

    print(f" API Key Detected   : {has_key} ({'Live Key Ready' if has_key else 'Missing GEMINI_API_KEY'})")
    print("-" * 80)

    # 2. Run Analysis
    start_t = time.time()
    result = provider.analyze_youtube_video(OWNER_YOUTUBE_URL)
    duration_ms = round((time.time() - start_t) * 1000.0, 1)

    # 3. Process Result
    report: Dict[str, Any] = {
        "experiment_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "target_url": OWNER_YOUTUBE_URL,
        "canonical_url": provider._canonicalize_youtube_url(OWNER_YOUTUBE_URL),
        "evaluation_protocol": "metadata_blind_prompting",
        "provider_status": result.get("status"),
        "has_live_credentials": has_key,
        "quota_and_terms": {
            "api_endpoint": "https://generativelanguage.googleapis.com/v1beta/interactions",
            "model": provider.model,
            "feature_status": "Preview (available at no charge for public YouTube URLs)",
            "free_tier_daily_limit": "Up to 8 hours of YouTube video processing per day",
            "terms_data_handling": "Free tier inputs/outputs may be reviewed to improve products. Paid tier has zero-day retention.",
            "google_ai_pro_distinction": "Google AI Pro subscription grants higher web Playground quotas, but API keys are governed separately by Gemini Developer API tiers.",
        },
    }

    if result.get("status") == "success":
        print("\n[SUCCESS] Live Gemini Video Understanding Response Received!")
        analysis = result.get("analysis", {})
        usage = result.get("usage", {})
        print(f" Tokens Used: {usage.get('total_tokens')} (Input: {usage.get('input_tokens')}, Output: {usage.get('output_tokens')})")
        print(f" Estimated Paid Cost: ${usage.get('estimated_paid_tier_cost_usd'):.6f} (Free Tier Cost: $0.00)")
        print(f" Latency: {result.get('latency_ms')} ms")
        print("\n--- Model Output Summary ---")
        print(analysis.get("raw_markdown", "")[:800] + "...")

        report["observations"] = analysis
        report["usage_and_costs"] = usage

    elif result.get("status") == "missing_credentials":
        print("\n[STATUS: MISSING_ACCESS] Gemini API Key is not set in environment.")
        print("Following owner directive: Prepared exact setup instructions and stopped at missing access step.")
        print("\n--- Owner-Side Setup Instructions ---")
        for step, desc in result.get("setup_guide", {}).items():
            print(f"  * {step.upper()}: {desc}")

        report["missing_access_details"] = {
            "reason": "GEMINI_API_KEY environment variable not populated.",
            "setup_guide": result.get("setup_guide"),
            "ready_for_key": True,
        }

        # Provide simulated baseline comparison to illustrate metadata vs signal gap
        report["evidence_gap_analysis"] = {
            "metadata_claims": {
                "title": "DHURANDHAR ft. Raga of revenge | Anirudh | Ranveer Singh .",
                "author": "The Bad Speaker",
                "claimed_movie": "Dhurandhar",
                "claimed_actor": "Ranveer Singh",
                "claimed_soundtrack": "Raga of revenge (Anirudh Ravichander)",
            },
            "unverified_signals_without_byte_stream": [
                "Cannot confirm whether Anirudh's actual audio master is playing or a third-party cover/mashup.",
                "Cannot measure precise beat-sync synchronization deltas in URL-only mode.",
                "Cannot compute frame-accurate cut frequency or pacing without raw frame access.",
            ],
            "what_gemini_adds_when_active": [
                "Direct Google-side decoding of public YouTube video frames and audio track without scraping.",
                "High-level scene recognition, actor face verification, and narrative sequence summary.",
                "Identification of visible transitions, macro pacing, and soundtrack changes.",
            ],
            "what_local_system_retains": [
                "100% offline mathematical precision on authorized video bytes (FFmpeg/OpenCV).",
                "Private owner rating preference model (11 reviews, 4 comparisons) completely shielded from third parties.",
                "Zero third-party dependency for core technical measurement pipeline.",
            ],
        }

    else:
        print(f"\n[STATUS: {result.get('status').upper()}] {result.get('error_message')}")
        report["error_details"] = result

    # Save structured report
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"\nReport written to {REPORT_PATH}")
    print("=" * 80)
    return report


if __name__ == "__main__":
    run_gemini_experiment()
