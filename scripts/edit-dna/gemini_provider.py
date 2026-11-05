#!/usr/bin/env python3
"""
Lolixco Edit DNA — Gemini Video Intelligence Provider Abstraction
Provides optional semantic video understanding via Google's official Gemini Developer API (REST generateContent).
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


PRIMARY_GEMINI_MODEL = "gemini-3.8-flash"
FALLBACK_GEMINI_MODELS = ["gemini-3.5-flash", "gemini-flash-latest"]
CACHE_DIR = os.path.expanduser("~/.lolixco-edit-dna/cache")


class GeminiVideoProvider:
    """
    Manages semantic video understanding queries via Google's Gemini API.
    Designed for zero-leakage, token tracking, local caching, and transparent error handling.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = PRIMARY_GEMINI_MODEL,
        mode: str = "hybrid_auto",
        cache_dir: str = CACHE_DIR,
    ):
        self.api_key = api_key or self._discover_api_key()
        self.model = model
        self.mode = mode.lower()
        self.cache_dir = cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)

    @staticmethod
    def _discover_api_key() -> str:
        """Discovers GEMINI_API_KEY from environment or local .env.local file."""
        key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if key:
            return key.strip()

        # Check .env.local in common locations
        candidates = [
            ".env.local",
            "/home/rohan/Lolixco/.env.local",
            os.path.join(os.path.dirname(__file__), "../../.env.local"),
        ]
        for c in candidates:
            if os.path.isfile(c):
                try:
                    with open(c, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line.startswith("GEMINI_API_KEY=") and not line.startswith("#"):
                                return line.split("=", 1)[1].strip()
                except Exception:
                    pass
        return ""

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
        timeout_seconds: int = 60,
    ) -> Dict[str, Any]:
        """
        Submits a public YouTube URL to Gemini using generateContent.
        Enforces a metadata-blind prompt to ensure unbiased recognition.
        """
        canonical_url = self._canonicalize_youtube_url(youtube_url)

        # Standard metadata-blind prompt requesting structured output
        prompt = custom_prompt or (
            "You are an expert film, anime, and video-editing analyst for the Lolixco Edit DNA intelligence system.\n"
            "Examine the provided video thoroughly and return a valid JSON object with the following schema:\n"
            "{\n"
            '  "visual_recognition": {\n'
            '    "entities_identified": ["list of recognized movies, anime, shows, actors, characters, or deepfakes"],\n'
            '    "confidence": 0.0 to 1.0,\n'
            '    "visual_summary": "concise description of visible scenes, costumes, setting, and text title cards"\n'
            "  },\n"
            '  "music_recognition": {\n'
            '    "identified_title": "song name or null if unknown",\n'
            '    "artist": "artist name or null",\n'
            '    "genre_style": "genre, style or acoustic structure",\n'
            '    "confidence": 0.0 to 1.0,\n'
            '    "notes": "acoustic description, presence of dialogue vs music, vocal chops, beat style"\n'
            "  },\n"
            '  "editing_assessment": {\n'
            '    "pacing_style": "description of editing tempo and shot cadence",\n'
            '    "cutting_style": "description of cuts, transitions, strobes, or chapter divisions",\n'
            '    "storytelling_observations": "narrative structure, emotional escalation, or character evolution",\n'
            '    "perceived_strengths": ["list of key strengths"],\n'
            '    "perceived_weaknesses": ["list of weaknesses or visual artifacts"]\n'
            "  },\n"
            '  "hallucination_boundary": {\n'
            '    "what_is_directly_observed": "elements clearly and objectively visible or audible on-screen",\n'
            '    "what_is_inferred_or_uncertain": "elements guessed, uncertain, or inferred from context"\n'
            "  }\n"
            "}\n"
        )

        cache_path = self.get_cache_path(canonical_url, prompt)
        if use_cache and os.path.isfile(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    cached_data = json.load(f)
                    cached_data["cached"] = True
                    return cached_data
            except Exception:
                pass

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
                    "step3": "Export the key locally in your shell or add to .env.local: export GEMINI_API_KEY='your_key_here'",
                    "step4": "Re-run Lolixco Edit DNA to enable hybrid semantic analysis.",
                },
                "analysis": None,
                "usage": {"input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0},
            }

        # Model trial list: primary model followed by active fallbacks
        models_to_try = [self.model]
        for fb in FALLBACK_GEMINI_MODELS:
            if fb not in models_to_try:
                models_to_try.append(fb)

        last_error = None
        start_time = time.time()

        for model_name in models_to_try:
            endpoint_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.api_key}"
            payload = {
                "contents": [{
                    "parts": [
                        {
                            "file_data": {
                                "file_uri": canonical_url,
                                "mime_type": "video/webm",
                            }
                        },
                        {
                            "text": prompt
                        }
                    ]
                }],
                "generationConfig": {
                    "response_mime_type": "application/json",
                    "temperature": 0.2,
                }
            }

            req_body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                endpoint_url,
                data=req_body,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "LolixcoEditDNA/2.0",
                },
                method="POST",
            )

            try:
                with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
                    latency_ms = round((time.time() - start_time) * 1000.0, 1)
                    resp_bytes = response.read()
                    data = json.loads(resp_bytes.decode("utf-8"))

                    output_text = ""
                    cands = data.get("candidates", [])
                    if cands and "content" in cands[0]:
                        parts = cands[0]["content"].get("parts", [])
                        output_text = "\n".join(p.get("text", "") for p in parts if "text" in p)

                    usage_meta = data.get("usageMetadata", {})
                    input_tokens = usage_meta.get("promptTokenCount", 0)
                    output_tokens = usage_meta.get("candidatesTokenCount", 0)

                    # Gemini Flash pricing: $0.00 on Free Tier; ~$0.75 / $3.75 per 1M tokens on Paid Tier
                    estimated_cost_paid_tier = (input_tokens / 1_000_000.0 * 0.75) + (
                        output_tokens / 1_000_000.0 * 3.75
                    )

                    # Parse structured JSON output
                    structured = {}
                    try:
                        structured = json.loads(output_text)
                        if isinstance(structured, list) and len(structured) > 0 and isinstance(structured[0], dict):
                            structured = structured[0]
                    except Exception:
                        structured = self._parse_markdown_sections(output_text)

                    result = {
                        "status": "success",
                        "mode": self.mode,
                        "model": model_name,
                        "video_uri": canonical_url,
                        "latency_ms": latency_ms,
                        "analysis": {
                            "raw_text": output_text,
                            "structured": structured,
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

                    # Cache successful result
                    try:
                        with open(cache_path, "w", encoding="utf-8") as f:
                            json.dump(result, f, indent=2)
                    except Exception:
                        pass

                    return result

            except urllib.error.HTTPError as e:
                err_code = e.code
                err_body = e.read().decode("utf-8", errors="replace")
                last_error = (err_code, err_body)
                # If 503 (demand spike) or 404 (model deprecated), continue loop to try fallback model
                if err_code in (503, 404, 429) and model_name != models_to_try[-1]:
                    time.sleep(1.0)
                    continue
                break
            except Exception as e:
                last_error = (0, str(e))
                break

        # Fallback exhausted or terminal error
        latency_ms = round((time.time() - start_time) * 1000.0, 1)
        err_code, err_msg = last_error if last_error else (500, "Unknown network failure")
        status_desc = "api_error"
        if err_code == 429:
            status_desc = "quota_exhausted"
        elif err_code in (401, 403):
            status_desc = "auth_error"
        elif err_code == 503:
            status_desc = "service_unavailable"

        return {
            "status": status_desc,
            "http_code": err_code,
            "latency_ms": latency_ms,
            "error_message": f"Gemini API returned error: {err_msg[:300]}",
            "mode": self.mode,
            "analysis": None,
            "usage": {"input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0},
        }

    @staticmethod
    def _canonicalize_youtube_url(url: str) -> str:
        """Converts shortened youtu.be, Shorts, or parameter-heavy URLs into standard watch URLs."""
        if not url:
            return ""
        clean_url = url.strip()
        if "youtu.be/" in clean_url:
            vid = clean_url.split("youtu.be/")[1].split("?")[0].split("&")[0].split("/")[0]
            return f"https://www.youtube.com/watch?v={vid}"
        if "youtube.com/shorts/" in clean_url:
            vid = clean_url.split("youtube.com/shorts/")[1].split("?")[0].split("&")[0].split("/")[0]
            return f"https://www.youtube.com/watch?v={vid}"
        if "youtube.com/watch" in clean_url and "v=" in clean_url:
            vid = clean_url.split("v=")[1].split("&")[0].split("#")[0]
            return f"https://www.youtube.com/watch?v={vid}"
        return clean_url

    @staticmethod
    def _parse_markdown_sections(text: str) -> Dict[str, Any]:
        """Fallback markdown section parser if JSON format was corrupted."""
        sections = {}
        current_section = "overview"
        lines = text.splitlines()
        current_lines = []

        for line in lines:
            if line.startswith("#") or (line.strip().endswith(":") and len(line.strip()) < 50):
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

    @classmethod
    def analyze_structured_stream(cls, url: str) -> Dict[str, Any]:
        """Convenience class method returning structured evaluation or fallback defaults."""
        provider = cls()
        res = provider.analyze_youtube_video(url)
        if res.get("status") == "success" and res.get("analysis", {}).get("structured"):
            struct = res["analysis"]["structured"]
            if isinstance(struct, dict):
                struct["model_used"] = res.get("model")
                return struct
        return {
            "visual_recognition": {"identified_work": None, "confidence": 0.0, "visual_style_and_grading": res.get("error_message", "No visual recognition data.")},
            "soundtrack_recognition": {"identified_title": None, "confidence": 0.0, "notes": res.get("error_message", "No audio recognition data.")},
            "macro_pacing_and_flow": {"rhythm_summary": "Remote observation unavailable or unmeasured."},
            "storytelling_interpretation": {"narrative_structure": "Remote narrative analysis unavailable."},
            "originality_and_creative_execution": {"creative_assessment": "Remote originality analysis unavailable."},
        }
