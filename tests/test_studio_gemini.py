"""Offline contract tests for the consent-gated Studio Gemini client."""
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root / "scripts" / name) for name in ("local-dna", "edit-dna")]

import youtube_analysis
from gemini_provider import GeminiVideoProvider, ProviderError


VIDEO_ID = "_yrPlcZY2jw"
URL = "https://www.youtube.com/watch?v=" + VIDEO_ID
OBSERVATION = {
    "stream_reviewable": True,
    "directly_observed": "At 00:03 a title card separates the action scenes.",
    "cuts": "The action cuts from a close-up to a wide shot at 00:02.",
    "pacing": "The edit holds on the title before the shots shorten.",
    "visuals": "The opening appears dark with bright title lettering.",
    "storytelling": "The title marks a shift from setup to action.",
    "creative_execution": "The held title provides a pause before the fast montage.",
    "source_candidates": [{"title": "Example film", "type": "Movie", "evidence": "A matching costume at 00:06."}],
    "music_title": "Example theme",
    "music_description": "A distinctive repeated bass phrase at 00:06.",
    "music_artist": None,
}


def response(data):
    return io.BytesIO(json.dumps(data).encode())


def models(*names):
    return response({"models": [
        {"name": f"models/{name}", "supportedGenerationMethods": ["generateContent"]} for name in names
    ]})


def content(observation):
    return response({
        "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(observation)}]}}],
        "modelVersion": "example-model-version",
        "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 60, "totalTokenCount": 160},
    })


def error(code, diagnostic):
    return HTTPError("https://generativelanguage.googleapis.com/", code, "upstream", {}, io.BytesIO(diagnostic.encode()))


class StudioGeminiTest(unittest.TestCase):
    def setUp(self):
        self.provider = GeminiVideoProvider(api_key="test-placeholder", mode="gemini_semantic")
        provider_patch = patch.object(youtube_analysis, "provider", self.provider)
        provider_patch.start()
        self.addCleanup(provider_patch.stop)
        env_patch = patch.dict(os.environ, {"LOLIXCO_GEMINI_YOUTUBE": "1"})
        env_patch.start()
        self.addCleanup(env_patch.stop)

    def test_discovery_selects_available_model_and_reuses_check(self):
        with patch.object(self.provider._opener, "open", side_effect=[models("gemini-3.5-flash"), content(OBSERVATION)]) as open_request:
            self.assertEqual(youtube_analysis.provider_status()["model"], "gemini-3.5-flash")
            raw, presentation = youtube_analysis.analyze_youtube(VIDEO_ID)
        self.assertEqual(open_request.call_count, 2)
        discovery, inference = (call.args[0] for call in open_request.call_args_list)
        self.assertTrue(discovery.full_url.endswith("/models?pageSize=100"))
        self.assertTrue(inference.full_url.endswith("/models/gemini-3.5-flash:generateContent"))
        self.assertEqual(inference.get_header("X-goog-api-key"), "test-placeholder")
        body = json.loads(inference.data)
        self.assertEqual(body["contents"][0]["parts"][0], {
            "fileData": {"fileUri": URL},
            "videoMetadata": {"startOffset": "0s", "endOffset": "120s"},
        })

        self.assertEqual(raw["section_c_physical_signals"], {"status": "NOT_YET_ASSESSED", "provenance": "measured_signal"})
        self.assertEqual(presentation["analysis_status"], "PARTIAL")
        self.assertIsNone(presentation["overall_score_0_10"])
        self.assertEqual(presentation["gauge_presentation"]["gauge_state"], "unassessed_standby")
        self.assertEqual(len(presentation["assessment_sections"]), 7)
        self.assertTrue(all(section["score_0_10"] is None for section in presentation["assessment_sections"]))
        self.assertEqual(
            [section["evidence_status"] for section in presentation["assessment_sections"]],
            ["NOT_YET_ASSESSED", *(["EVALUATED_SEMANTIC_EXPERIMENTAL"] * 5), "NOT_YET_ASSESSED"],
        )
        context = presentation["context_evidence"]
        self.assertEqual(context["visual_recognition"]["status"], "POSSIBLE_MATCH")
        self.assertEqual(context["music_recognition"]["status"], "POSSIBLE_MATCH")
        self.assertEqual(context["remote_observation"]["model_version"], "example-model-version")
        self.assertNotIn("test-placeholder", json.dumps(presentation))

    def test_removed_model_falls_back_to_discovered_model(self):
        responses = [
            models("gemini-3.8-flash", "gemini-flash-latest"),
            error(404, "models/gemini-3.8-flash is not found for API version v1beta"),
            content(OBSERVATION),
        ]
        with patch.object(self.provider._opener, "open", side_effect=responses) as open_request:
            _, presentation = youtube_analysis.analyze_youtube(VIDEO_ID)
        self.assertEqual(open_request.call_count, 3)
        self.assertEqual(presentation["context_evidence"]["remote_observation"]["model"], "gemini-flash-latest")

    def test_quota_error_does_not_trigger_another_generation(self):
        responses = [models("gemini-3.8-flash", "gemini-3.5-flash"), error(429, "private diagnostic")]
        with patch.object(self.provider._opener, "open", side_effect=responses) as open_request:
            with self.assertRaises(ProviderError) as caught:
                youtube_analysis.analyze_youtube(VIDEO_ID)
        self.assertEqual(open_request.call_count, 2)
        self.assertEqual(caught.exception.status, "rate_limited")
        self.assertNotIn("private diagnostic", caught.exception.message)

    def test_unavailable_stream_is_never_reported_as_analysis(self):
        responses = [models("gemini-3.8-flash"), content({"stream_reviewable": False, "directly_observed": "Title only"})]
        with patch.object(self.provider._opener, "open", side_effect=responses):
            with self.assertRaises(ProviderError) as caught:
                youtube_analysis.analyze_youtube(VIDEO_ID)
        self.assertEqual(caught.exception.status, "unsupported")

    def test_disabled_and_invalid_inputs_do_not_contact_google(self):
        with patch.object(self.provider._opener, "open") as open_request:
            with self.assertRaises(ProviderError):
                youtube_analysis.analyze_youtube("https://example.com/youtu.be/_yrPlcZY2jw")
            with patch.dict(os.environ, {"LOLIXCO_GEMINI_YOUTUBE": "0"}):
                self.assertEqual(youtube_analysis.provider_status()["status"], "not_configured")
                with self.assertRaises(ProviderError):
                    youtube_analysis.analyze_youtube(VIDEO_ID)
        open_request.assert_not_called()
        self.assertEqual(self.provider._canonicalize_youtube_url(f"https://youtube.com/shorts/{VIDEO_ID}?si=x"), URL)
        self.assertEqual(self.provider._canonicalize_youtube_url(f"https://youtube.com.example.com/watch?v={VIDEO_ID}"), "")


if __name__ == "__main__":
    unittest.main()
