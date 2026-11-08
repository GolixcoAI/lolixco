"""Server-side Gemini Developer API client for public YouTube audiovisual input."""
import base64
import hashlib
import http.client
import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlencode, urlsplit


PRIMARY_GEMINI_MODEL = "gemini-3.8-flash"
FALLBACK_GEMINI_MODELS = ("gemini-3.5-flash", "gemini-flash-latest")
CACHE_DIR = os.path.expanduser("~/.lolixco-edit-dna/cache")
API_ROOT = "https://generativelanguage.googleapis.com/v1beta/"
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
MODEL_ID = re.compile(r"gemini-[a-z0-9.-]{1,80}")
MAX_RESPONSE_BYTES = 512 * 1024
MAX_INLINE_BYTES = 14 * 1024 * 1024
MAX_OUTPUT_TOKENS = 6000
VIDEO_MODEL = re.compile(r"gemini-(?:\d+(?:\.\d+)?-flash(?:-lite)?(?:-[a-z0-9.-]+)?|flash-latest)")


class ProviderError(Exception):
    def __init__(self, status, message, http_code=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.http_code = http_code


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class GeminiVideoProvider:
    def __init__(self, api_key=None, model=PRIMARY_GEMINI_MODEL, mode="hybrid_auto", cache_dir=CACHE_DIR):
        key = api_key if api_key is not None else os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
        self.api_key = key.strip()
        self.model = model
        self.mode = mode.lower()
        self.cache_dir = cache_dir
        self._opener = urllib.request.build_opener(NoRedirect())
        self._discovery_lock = threading.Lock()
        self._discovery = None

    @property
    def is_available(self):
        return bool(self.api_key) and self.mode != "local_only"

    def _request(self, path, timeout, payload=None):
        headers = {"x-goog-api-key": self.api_key, "Accept": "application/json"}
        body = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(API_ROOT + path, data=body, headers=headers)
        try:
            with self._opener.open(request, timeout=timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ValueError("oversize response")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("unexpected response")
            return data
        except urllib.error.HTTPError as error:
            # Upstream diagnostics can contain identifiers or request data.
            diagnostic = ""
            try:
                with error:
                    diagnostic = error.read(8192).decode("utf-8", errors="replace").lower()
            except (OSError, http.client.HTTPException):
                pass
            raise self._http_error(error.code, diagnostic) from None
        except TimeoutError:
            raise ProviderError("temporarily_unavailable", "Gemini exceeded the request time limit. Try a faster available model or a shorter review interval.") from None
        except urllib.error.URLError as error:
            message = "The local analyzer could not connect to Gemini. Check the network connection and retry."
            if isinstance(error.reason, TimeoutError):
                message = "Gemini exceeded the request time limit. Try a faster available model or a shorter review interval."
            raise ProviderError("temporarily_unavailable", message) from None
        except (OSError, http.client.HTTPException, ValueError):
            raise ProviderError("temporarily_unavailable", "Gemini did not return a usable response. Try again later.") from None

    @staticmethod
    def _http_error(code, diagnostic):
        if code == 429:
            message = "Gemini request or token quota was exceeded. Check the selected model's project quota and retry later."
            if "free_tier" in diagnostic and any(term in diagnostic for term in ("limit: 0", '"limit":"0"', '"quotavalue":"0"')):
                message = "Gemini reports no free-tier generation quota for the selected model. Select another eligible model or review the project's quota."
            return ProviderError("quota_exceeded", message, code)
        if "api_key_invalid" in diagnostic or "api key not valid" in diagnostic or code == 401:
            return ProviderError("authentication_failed", "Gemini rejected the configured API credential. Check the backend key and restart Studio.", code)
        if code == 403:
            if any(term in diagnostic for term in ("api_key_service_blocked", "referer", "referrer", "ip_address_blocked")):
                message = "The API key's application or service restrictions block this server-side Gemini request."
            else:
                message = "The Gemini project or key does not have permission for this request. Check API access and key restrictions."
            return ProviderError("authentication_failed", message, code)
        if code == 404 and any(term in diagnostic for term in ("models/", "not found for api version", "not supported for generatecontent")):
            return ProviderError("model_unavailable", "The selected Gemini model is unavailable for generation. Refresh model discovery or select another model.", code)
        if code == 404 or (code == 400 and "video" in diagnostic and any(
            term in diagnostic for term in ("unavailable", "private", "unlisted", "not found", "cannot access", "can't access", "failed to fetch")
        )):
            return ProviderError("video_unavailable", "Gemini could not access this video. It may be private, removed, restricted, or temporarily unreachable.", code)
        if code in (400, 422):
            if any(term in diagnostic for term in ("responsejsonschema", "response_schema", "response schema", "invalid json payload")):
                message = "Gemini rejected the structured assessment request. Its schema or model options need adjustment."
            elif "failed_precondition" in diagnostic and any(term in diagnostic for term in ("country", "region", "free tier")):
                message = "Gemini reports that the selected API tier is unavailable in this region. Review the project's supported access options."
            else:
                message = "The selected Gemini model could not support this video request. Try another eligible model or accessible video."
            return ProviderError("request_unsupported", message, code)
        return ProviderError("temporarily_unavailable", "Gemini returned a temporary provider error. Retry after a short wait.", code)

    def discover_models(self, timeout=5):
        """List account-visible generateContent models with bounded, cached discovery."""
        if not self.is_available:
            raise ProviderError("not_configured", "Set GEMINI_API_KEY in the analyzer environment.")
        with self._discovery_lock:
            if self._discovery and time.monotonic() < self._discovery[0]:
                result = self._discovery[1]
                if isinstance(result, ProviderError):
                    raise ProviderError(result.status, result.message, result.http_code)
                return result
            try:
                result = self._list_models(timeout)
            except ProviderError as error:
                self._discovery = (time.monotonic() + 15, ProviderError(error.status, error.message, error.http_code))
                raise
            self._discovery = (time.monotonic() + 300, result)
            return result

    def _list_models(self, timeout):
        if not self._video_model(self.model):
            raise ProviderError("request_unsupported", "Select a supported Gemini Flash video-understanding model.")
        candidates = tuple(dict.fromkeys((self.model, *FALLBACK_GEMINI_MODELS)))
        discovered = set()
        params = {"pageSize": 100}
        deadline = time.monotonic() + timeout
        for _ in range(4):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProviderError("temporarily_unavailable", "Gemini model discovery timed out.")
            page = self._request("models?" + urlencode(params), remaining)
            models = page.get("models")
            if not isinstance(models, list):
                raise ProviderError("temporarily_unavailable", "Gemini model discovery returned an unusable response.")
            for model in models:
                if isinstance(model, dict) and isinstance(model.get("name"), str) and isinstance(
                    model.get("supportedGenerationMethods"), list
                ) and "generateContent" in model["supportedGenerationMethods"]:
                    name = model["name"].removeprefix("models/")
                    if self._video_model(name):
                        discovered.add(name)
            next_page = page.get("nextPageToken")
            if not isinstance(next_page, str) or not next_page or set(candidates) <= discovered:
                break
            params["pageToken"] = next_page
        eligible = [name for name in candidates if name in discovered]
        eligible.extend(sorted(discovered - set(eligible), reverse=True))
        if not eligible:
            raise ProviderError("model_unavailable", "No Gemini Flash model with generateContent is visible to this API key.")
        return tuple(eligible)

    @staticmethod
    def _video_model(name):
        return isinstance(name, str) and bool(VIDEO_MODEL.fullmatch(name)) and not any(
            kind in name for kind in ("image", "audio", "tts", "live", "research", "robotics")
        )

    @staticmethod
    def _canonicalize_youtube_url(url):
        """Reduce only recognized YouTube watch, Shorts, and share URLs to a video ID."""
        if not isinstance(url, str) or len(url) > 2048:
            return ""
        try:
            parsed = urlsplit(url.strip())
            port = parsed.port
        except ValueError:
            return ""
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or port is not None:
            return ""
        if parsed.hostname == "youtu.be":
            video_id = parsed.path.lstrip("/")
        elif parsed.hostname in ("www.youtube.com", "youtube.com", "m.youtube.com"):
            if parsed.path == "/watch":
                values = parse_qs(parsed.query).get("v", [])
                video_id = values[0] if len(values) == 1 else ""
            else:
                video_id = parsed.path.removeprefix("/shorts/") if parsed.path.startswith("/shorts/") else ""
        else:
            return ""
        return f"https://www.youtube.com/watch?v={video_id}" if VIDEO_ID.fullmatch(video_id) else ""

    def get_cache_path(self, video_uri, prompt):
        digest = hashlib.sha256(f"{self.model}::{video_uri}::{prompt}".encode("utf-8")).hexdigest()
        return os.path.join(self.cache_dir, f"gemini_{digest}.json")

    def analyze_youtube_video(self, youtube_url, custom_prompt=None, use_cache=True, timeout_seconds=60,
                              *, schema=None, clip_seconds=None, max_output_tokens=2500):
        """Return structured observations, or a safe classified failure without invented evidence."""
        canonical_url = self._canonicalize_youtube_url(youtube_url)
        if not canonical_url:
            return self._failed(ProviderError("unsupported", "Enter a valid public YouTube URL."))
        if self.mode == "local_only":
            return self._failed(ProviderError("bypassed", "Gemini was bypassed in offline mode."))
        if not self.is_available:
            return self._failed(ProviderError("missing_credentials", "Set GEMINI_API_KEY in the analyzer environment."))

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

        cache_path = self.get_cache_path(canonical_url, json.dumps([prompt, schema, clip_seconds], sort_keys=True))
        if use_cache:
            try:
                with open(cache_path, encoding="utf-8") as source:
                    cached = json.load(source)
                if cached.get("status") == "success":
                    return {**cached, "cached": True}
            except (OSError, ValueError, AttributeError):
                pass

        start = time.monotonic()
        try:
            models = self.discover_models(min(5, timeout_seconds))
            result = self._generate(models, canonical_url, prompt, schema, clip_seconds, start + timeout_seconds, max_output_tokens)
        except ProviderError as error:
            return self._failed(error)
        result["latency_ms"] = round((time.monotonic() - start) * 1000, 1)
        if use_cache:
            self._write_cache(cache_path, result)
        return result

    def _write_cache(self, cache_path, result):
        temp_path = None
        try:
            os.makedirs(self.cache_dir, mode=0o700, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.cache_dir, delete=False) as output:
                temp_path = output.name
                json.dump(result, output)
            os.replace(temp_path, cache_path)
        except OSError:
            if temp_path is not None:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

    @staticmethod
    def _output_limit(value):
        if type(value) is not int or not 64 <= value <= MAX_OUTPUT_TOKENS:
            raise ProviderError("request_unsupported", "The requested assessment output exceeds the configured token limit.")
        return value

    def count_video_tokens(self, youtube_url, custom_prompt="", *, clip_seconds=None, timeout_seconds=20):
        """Perform the non-generation token preflight for a public YouTube input."""
        url = self._canonicalize_youtube_url(youtube_url)
        if not url:
            raise ProviderError("request_unsupported", "Enter a valid public YouTube URL.")
        model = self.discover_models(min(5, timeout_seconds))[0]
        video = {"fileData": {"fileUri": url}}
        if clip_seconds is not None:
            video["videoMetadata"] = {"startOffset": "0s", "endOffset": f"{clip_seconds}s"}
        result = self._request(f"models/{model}:countTokens", timeout_seconds,
                               {"contents": [{"parts": [video, {"text": custom_prompt}]}]})
        total = result.get("totalTokens")
        if type(total) is not int or total <= 0:
            raise ProviderError("temporarily_unavailable", "Gemini did not return a usable input token count.")
        return {"model": model, "input_tokens": total}

    def analyze_inline_video(self, data, mime_type, prompt, schema=None, timeout_seconds=65, *, max_output_tokens=6000,
                             preferred_model=None):
        """Analyze already-consented inline bytes without creating a provider Files API object."""
        if not self.is_available:
            return self._failed(ProviderError("not_configured", "Set GEMINI_API_KEY in the analyzer environment."))
        if not isinstance(data, bytes) or not data or len(data) > MAX_INLINE_BYTES or mime_type not in (
            "video/mp4", "video/webm", "video/quicktime",
        ):
            return self._failed(ProviderError("request_unsupported", "The prepared cloud analysis copy must be a supported video below 14 MiB."))
        started = time.monotonic()
        try:
            limit = self._output_limit(max_output_tokens)
            if preferred_model is not None and not self._video_model(preferred_model):
                raise ProviderError("request_unsupported", "Select a supported Gemini Flash video-understanding model.")
            models = self.discover_models(min(5, timeout_seconds))
            if preferred_model in models:
                models = (preferred_model, *(model for model in models if model != preferred_model))
            video = {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(data).decode("ascii")}}
            result = self._generate_part(models, video, prompt, schema, started + timeout_seconds, "consented_inline_video", limit)
        except ProviderError as error:
            return self._failed(error)
        result["latency_ms"] = round((time.monotonic() - started) * 1000, 1)
        return result

    def _generate(self, models, url, prompt, schema, clip_seconds, deadline, max_output_tokens=2500):
        video = {"fileData": {"fileUri": url}}
        if clip_seconds is not None:
            video["videoMetadata"] = {"startOffset": "0s", "endOffset": f"{clip_seconds}s"}
        return self._generate_part(models, video, prompt, schema, deadline, url, self._output_limit(max_output_tokens))

    def _generate_part(self, models, video, prompt, schema, deadline, source, max_output_tokens):
        config = {"responseMimeType": "application/json", "maxOutputTokens": max_output_tokens}
        if schema is not None:
            config["responseJsonSchema"] = schema
        payload = {"contents": [{"parts": [video, {"text": prompt}]}], "generationConfig": config}
        for index, model in enumerate(models):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProviderError("temporarily_unavailable", "Gemini analysis timed out. Try again later.")
            if model.startswith("gemini-3."):
                config["thinkingConfig"] = {"thinkingLevel": "LOW"}
            else:
                config.pop("thinkingConfig", None)
            try:
                result = self._request(f"models/{model}:generateContent", remaining, payload)
            except ProviderError as error:
                if error.status == "model_unavailable" and index + 1 < len(models):
                    continue
                if error.status == "model_unavailable":
                    raise ProviderError("model_unavailable", "The discovered Gemini Flash models were unavailable for this request.")
                raise
            return self._parse_result(result, model, source)

    def _parse_result(self, result, model, url):
        try:
            candidate = result["candidates"][0]
            reason = candidate.get("finishReason")
            if reason == "MAX_TOKENS":
                raise ProviderError("request_unsupported", "Gemini reached the assessment output limit before completing the report. Shorten the request or increase its bounded output budget.")
            if reason not in (None, "STOP"):
                raise ValueError("generation did not complete")
            parts = candidate["content"]["parts"]
            output_text = "\n".join(part["text"] for part in parts if isinstance(part.get("text"), str) and not part.get("thought"))
            structured = json.loads(output_text)
            if isinstance(structured, list) and len(structured) == 1:
                structured = structured[0]
            if not isinstance(structured, dict) or not structured:
                raise ValueError("empty observation")
        except (AttributeError, KeyError, IndexError, TypeError, ValueError):
            raise ProviderError("request_unsupported", "Gemini did not return usable audiovisual observations for this video.") from None
        usage = result.get("usageMetadata")
        usage = usage if isinstance(usage, dict) else {}
        counts = {}
        for field, key in (("promptTokenCount", "input_tokens"), ("candidatesTokenCount", "output_tokens"),
                           ("thoughtsTokenCount", "thinking_tokens"), ("totalTokenCount", "total_tokens")):
            if type(usage.get(field)) is int and usage[field] >= 0:
                counts[key] = usage[field]
        return {
            "status": "success",
            "mode": self.mode,
            "model": model,
            "model_version": result.get("modelVersion"),
            "video_uri": url,
            "analysis": {"raw_text": output_text, "structured": structured},
            "usage": counts,
            "cached": False,
        }

    def _failed(self, error):
        return {
            "status": error.status,
            "mode": self.mode,
            "message": error.message,
            "error_message": error.message,
            "http_code": error.http_code,
            "analysis": None,
        }

    @classmethod
    def analyze_structured_stream(cls, url):
        """Legacy research convenience interface. Studio uses the typed result."""
        result = cls().analyze_youtube_video(url)
        if result.get("status") == "success":
            return {**result["analysis"]["structured"], "model_used": result["model"]}
        return {}
