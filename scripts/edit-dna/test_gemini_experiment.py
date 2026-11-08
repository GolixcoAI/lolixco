#!/usr/bin/env python3
"""Run the public YouTube research experiment after an explicit live opt-in."""
import argparse
import json
import time
from pathlib import Path

from gemini_provider import GeminiVideoProvider

OWNER_YOUTUBE_URL = "https://youtu.be/_yrPlcZY2jw"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Submit this public URL to Gemini using your API quota")
    parser.add_argument("--output", type=Path, help="Explicit destination for the research report")
    args = parser.parse_args()
    print("LOLIXCO EDIT DNA — EXPERIMENT 1: GEMINI VIDEO UNDERSTANDING")
    print(f" Target YouTube URL : {OWNER_YOUTUBE_URL}")
    if not args.live:
        print("Offline by default. Use --live to submit the public URL to Gemini.")
        return

    provider = GeminiVideoProvider(mode="gemini_semantic")
    result = provider.analyze_youtube_video(OWNER_YOUTUBE_URL, use_cache=False)
    report = {
        "experiment_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "target_url": OWNER_YOUTUBE_URL,
        "canonical_url": provider._canonicalize_youtube_url(OWNER_YOUTUBE_URL),
        "evaluation_protocol": "metadata_blind_prompting",
        "provider_status": result["status"],
        "has_live_credentials": provider.is_available,
        "api": "Gemini Developer API generateContent",
        "model": result.get("model"),
        "observations": result["analysis"],
        "reported_usage": result.get("usage"),
        "error": result.get("message"),
    }
    document = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(document + "\n", encoding="utf-8")
        print(f"Report written to {args.output}")
    else:
        print(document)
    if result["status"] != "success":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
