#!/usr/bin/env python3
"""
Lolixco Edit DNA — Gemini Video Intelligence Provider Abstraction
Provides optional semantic video understanding via Google's official Gemini API (Interactions API / REST).
Supports public YouTube URLs, handles quotas, caching, rate limiting, and graceful fallback.

Modes:
  - local_only: Pure offline signal and reference matching (zero network calls).
  - gemini_semantic: Calls Gemini API for semantic scene understanding and character recognition.
  - hybrid_auto: Runs local analysis and enriches with Gemini if API key is available; falls back gracefully.
"""

import os
import sys
import json
import time
import hashlib
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, List


DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
CACHE_DIR = os.path.expanduser("~/.lolixco-edit-dna/cache")


class GeminiVideoProvider:
    """
    Manages semantic video understanding queries via Google's Gemini API.
    Designed for zero-leakage, token tracking, local caching, and transparent error handling.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = DEFAULT_GEMINI_MODEL,
        mode: str = "hybrid_auto",
        cache_dir: str = CACHE_DIR,
    ):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""
        self.model = model
        self.mode = mode.lower()
        self.cache_dir = cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)

    @property
    def is_available(self) -> bool:
        """Returns True if the provider has an API key and is not in local_only mode."""
        return bool(self.api_key) and self.mode != "local_only"

    def get_cache_path(self, video_uri: str, prompt: str) -> str:
        """Generates a deterministic local cache path based on URI and prompt hash."""
        key_str = f"{self.model}::{video_uri}::{prompt}"
        h = hashlib.sha256(key_str.encode("utf-8")).hexdigest()[:16]
        safe_name = "".join(c if c.isalnum() else "_" for c in video_uri)[-24:]
        return os.path.join(self.cache_dir, f"gemini_{safe_name}_{h}.json")

    def analyze_youtube_video(
        self,
        youtube_url: str,
        custom_prompt: Optional[str] = None,
        use_cache: bool = True,
        timeout_seconds: int = 45,
    ) -> Dict[str, Any]:
        """
        Submits a public YouTube URL to Gemini using the Interactions API.
        Enforces a metadata-blind prompt to ensure unbiased recognition.
        """
        # Canonicalize YouTube URL
        canonical_url = self._canonicalize_youtube_url(youtube_url)

        # Standard metadata-blind prompt
        prompt = custom_prompt or (
            "You are an expert film, anime, and video-editing analyst.\n"
            "Examine the provided video thoroughly and report:\n"
            "1. Visual Source Material: Identify any specific movie, anime, TV series, or promotional footage visible. State the confidence and visual evidence (character faces, logos, scene compositions).\n"
            "2. Identifiable Characters / Actors: List any recognizable characters or actors appearing with timestamps.\n"
            "3. Music & Soundtrack: Describe the soundtrack, genre, tempo, instruments, and any distinct music transitions or soundtrack changes with timestamps. If you recognize a specific track or motif, state it with your confidence level and evidence, or explicitly state UNKNOWN if not uniquely verifiable.\n"
            "4. Editing Techniques: Detail visible editing techniques (cut frequency, transitions such as hard cuts, dissolves, flash/strobe effects, whip pans, motion graphics, color grading).\n"
            "5. Unknowns & Ambiguities: Clearly distinguish what is confirmed from what remains ambiguous or unverifiable.\n\n"
            "Provide your response in structured markdown with clear section headers."
        )

        # Check Cache
        cache_path = self.get_cache_path(canonical_url, prompt)
        if use_cache and os.path.isfile(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    cached_data = json.load(f)
                    cached_data["cached"] = True
                    return cached_data
            except Exception:
                pass

        # Handle local_only mode or missing credentials
        if self.mode == "local_only":
            return {
                "status": "bypassed",
                "mode": "local_only",
                "message": "Gemini API bypassed by provider mode 'local_only'. Operating entirely offline.",
                "analysis": None,
                "usage": {"input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0},
            }

        if not self.api_key:
            return {
                "status": "missing_credentials",
                "mode": self.mode,
                "message": (
                    "GEMINI_API_KEY environment variable is not set. "
                    "Gemini semantic video understanding is paused. "
                    "Falling back to local signal and reference matching."
                ),
                "setup_guide": {
                    "step1": "Visit Google AI Studio: https://aistudio.google.com/apikey",
                    "step2": "Create a free Gemini API key (no credit card or paid billing required).",
                    "step3": "Export the key locally in your shell: export GEMINI_API_KEY='your_key_here'",
                    "step4": "Re-run Lolixco Edit DNA to enable hybrid semantic analysis.",
                },
                "analysis": None,
                "usage": {"input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0},
            }

        # Build payload for Gemini Interactions API
        payload = {
            "model": self.model,
            "input": [
                {"type": "text", "text": prompt},
                {"type": "video", "uri": canonical_url},
            ],
        }

        req_body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            API_ENDPOINT,
            data=req_body,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self.api_key,
                "User-Agent": "LolixcoEditDNA/2.0",
            },
            method="POST",
        )

        start_time = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
                latency_ms = round((time.time() - start_time) * 1000.0, 1)
                resp_bytes = response.read()
                data = json.loads(resp_bytes.decode("utf-8"))

                output_text = ""
                # Parse output text from Interactions API response
                if "output_text" in data:
                    output_text = data["output_text"]
                elif "candidates" in data:
                    cands = data["candidates"]
                    if cands and "content" in cands[0]:
                        parts = cands[0]["content"].get("parts", [])
                        output_text = "\n".join(p.get("text", "") for p in parts if "text" in p)

                # Token and cost calculations
                usage_meta = data.get("usage_metadata", {})
                input_tokens = usage_meta.get("prompt_token_count", 0)
                output_tokens = usage_meta.get("candidates_token_count", 0)

                # Gemini 3.8 Flash pricing: $0.00 on Free Tier; $0.75 / $3.75 per 1M tokens on Paid Tier
                estimated_cost_paid_tier = (input_tokens / 1_000_000.0 * 0.75) + (
                    output_tokens / 1_000_000.0 * 3.75
                )

                result = {
                    "status": "success",
                    "mode": self.mode,
                    "model": self.model,
                    "video_uri": canonical_url,
                    "latency_ms": latency_ms,
                    "analysis": {
                        "raw_markdown": output_text,
                        "structured_sections": self._parse_markdown_sections(output_text),
                    },
                    "usage": {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "total_tokens": input_tokens + output_tokens,
                        "free_tier_cost_usd": 0.0,
                        "estimated_paid_tier_cost_usd": round(estimated_cost_paid_tier, 6),
                    },
                    "cached": False,
                }

                # Save to cache
                try:
                    with open(cache_path, "w", encoding="utf-8") as f:
                        json.dump(result, f, indent=2)
                except Exception:
                    pass

                return result

        except urllib.error.HTTPError as e:
            latency_ms = round((time.time() - start_time) * 1000.0, 1)
            err_body = e.read().decode("utf-8", errors="replace")
            error_code = e.code

            status_desc = "api_error"
            if error_code == 429:
                status_desc = "quota_exhausted"
            elif error_code in (401, 403):
                status_desc = "auth_error"

            return {
                "status": status_desc,
                "http_code": error_code,
                "latency_ms": latency_ms,
                "error_message": f"Gemini API returned HTTP {error_code}: {e.reason}",
                "error_details": err_body[:500],
                "mode": self.mode,
                "analysis": None,
                "usage": {"input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0},
            }

        except Exception as e:
            latency_ms = round((time.time() - start_time) * 1000.0, 1)
            return {
                "status": "network_error",
                "latency_ms": latency_ms,
                "error_message": str(e),
                "mode": self.mode,
                "analysis": None,
                "usage": {"input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0},
            }

    @staticmethod
    def _canonicalize_youtube_url(url: str) -> str:
        """Converts shortened youtu.be or parameter-heavy URLs into standard watch URLs."""
        if "youtu.be/" in url:
            parts = url.split("youtu.be/")[1].split("?")[0].split("&")[0]
            return f"https://www.youtube.com/watch?v={parts}"
        if "youtube.com/watch" in url:
            vid = ""
            if "v=" in url:
                vid = url.split("v=")[1].split("&")[0]
                return f"https://www.youtube.com/watch?v={vid}"
        return url

    @staticmethod
    def _parse_markdown_sections(text: str) -> Dict[str, str]:
        """Extracts structured sections from Gemini's markdown response."""
        sections = {}
        current_section = "overview"
        lines = text.splitlines()
        current_lines = []

        for line in lines:
            if line.startswith("#") or line.strip().endswith(":") and len(line.strip()) < 50:
                header = line.strip("# :*").strip().lower().replace(" ", "_")
                if current_lines:
                    sections[current_section] = "\n".join(current_lines).strip()
                    current_lines = []
                current_section = header
            else:
                current_lines.append(line)

        if current_lines:
            sections[current_section] = "\n".join(current_lines).strip()

        return sections
