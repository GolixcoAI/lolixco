"""Offline contract tests for the consent-gated Studio Gemini client."""
import copy
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
from presentation_adapter import EditDNAPresentationAdapter
from semantic_rubric import RUBRICS, evaluate_rubric


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


def rubric_observation():
    """Synthetic integration cues, never a claim of real provider inference."""
    observation = copy.deepcopy(OBSERVATION)
    observation.update(
        edit_style="hype_montage", artistic_direction="Build anticipation before a restrained action reveal",
        reviewed_duration_sec=20, review_scope="complete_edit", audio_reviewable=True,
    )
    cues = [
        (1, "The title holds over a still doorway.", "The quiet opening establishes a focused subject."),
        (6, "A close-up gives way to a wider running shot.", "The change links the subject to the surrounding action."),
        (12, "The repeated doorway returns with the moving subject.", "The return develops the motif toward the reveal."),
        (18, "The music pauses as the title resolves.", "The pause gives the ending a clear emphasis."),
    ]
    for rubric in RUBRICS.values():
        values = {}
        for criterion, level, (timestamp, cue, effect) in zip(rubric["criteria"], [3, 4, 2, 3], cues, strict=True):
            values[criterion] = {
                "level": level, "approximate_timestamp_sec": timestamp,
                "observed_cue": cue, "editorial_effect": effect,
            }
        values.update(
            strengths=["The held doorway and its later return give the action a recurring visual motif."],
            weaknesses=["The middle repeats the same framing without developing the subject's position."],
            suggestion="Keep the doorway motif and vary the middle shot's distance to clarify the escalation.",
        )
        observation[rubric["field"]] = values
    return observation


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

    def test_timestamped_rubric_scores_are_scoped_independent_and_preserved_in_exports(self):
        observation = rubric_observation()
        observation["overall_score"] = 10
        observation["confidence"] = 1.0
        for rubric in RUBRICS.values():
            observation[rubric["field"]]["score"] = 10
        with patch.object(self.provider._opener, "open", side_effect=[models("gemini-3.8-flash"), content(observation)]):
            raw, presentation = youtube_analysis.analyze_youtube(VIDEO_ID)
        sections = presentation["assessment_sections"]
        self.assertEqual([section["score_0_10"] for section in sections], [None, None, None, None, 7.5, 7.5, None])
        self.assertEqual(sections[4]["evidence_status"], "EXPERIMENTAL_SEMANTIC_SCORE")
        self.assertEqual(sections[4]["method_version"], "gemini_storytelling_rubric_v1")
        self.assertEqual(sections[5]["method_version"], "gemini_creative_execution_rubric_v1")
        self.assertEqual(sections[4]["timestamps"], [1, 6, 12, 18])
        self.assertEqual(sections[4]["evidence_refs"]["supported_criteria"], 4)
        self.assertIn("comparative originality is unassessed", sections[5]["evidence_refs"]["assessment_scope"])
        self.assertEqual(sections[5]["evidence_refs"]["comparative_originality"], "unassessed; no reference collection supplied")
        self.assertIsNone(presentation["overall_score_0_10"])
        self.assertIsNone(sections[6]["score_0_10"])
        self.assertIn("independently verified", sections[4]["limitations"][-1])
        self.assertEqual(EditDNAPresentationAdapter.from_v6_report(raw)["assessment_sections"][4], sections[4])
        for section in sections[4:6]:
            for field in ("strengths", "weaknesses", "suggestion"):
                self.assertTrue(section["evidence_refs"][field])
        for invalid_id, invalid_method in (("visual_measurements", "gemini_storytelling_rubric_v1"),
                                            ("storytelling_interpretation", "unverified_method")):
            invalid = copy.deepcopy(presentation)
            section = invalid["assessment_sections"][3 if invalid_id == "visual_measurements" else 4]
            section.update(evidence_status="EXPERIMENTAL_SEMANTIC_SCORE", score_0_10=5, method_version=invalid_method)
            with self.assertRaises(AssertionError):
                EditDNAPresentationAdapter.validate_presentation_report(invalid)

    def test_rubric_abstains_without_coverage_context_or_supported_evidence(self):
        for change in (
            {"reviewed_duration_sec": None}, {"reviewed_duration_sec": 121}, {"reviewed_duration_sec": True},
            {"edit_style": "unknown"}, {"artistic_direction": None},
        ):
            with self.subTest(change=change):
                observation = rubric_observation()
                observation.update(change)
                assessment = evaluate_rubric("storytelling_emotion", observation, "fixture-model")
                self.assertIsNone(assessment["score"])
                self.assertTrue(assessment["metric_details"]["assessment_reason"])
        observation = rubric_observation()
        criteria = observation["storytelling_rubric"]
        criteria["direction_clarity"]["level"] = True
        criteria["sequence_coherence"]["approximate_timestamp_sec"] = 500
        self.assertIsNone(evaluate_rubric("storytelling_emotion", observation, "fixture-model")["score"])
        observation = rubric_observation()
        for key in RUBRICS["storytelling_emotion"]["criteria"]:
            observation["storytelling_rubric"][key]["approximate_timestamp_sec"] = 1
        self.assertIsNone(evaluate_rubric("storytelling_emotion", observation, "fixture-model")["score"])

    def test_restraint_excerpt_scope_zero_and_absent_audio_have_explicit_meanings(self):
        observation = rubric_observation()
        observation.update(edit_style="single_shot", review_scope="excerpt_or_unknown", audio_reviewable=False)
        for key in RUBRICS["storytelling_emotion"]["criteria"]:
            observation["storytelling_rubric"][key]["level"] = 3
        assessment = evaluate_rubric("storytelling_emotion", observation, "fixture-model")
        self.assertEqual(assessment["score"], 7.5)
        self.assertEqual(assessment["metric_details"]["supported_criteria"], 3)
        self.assertEqual(assessment["metric_details"]["review_scope"], "excerpt_or_unknown")
        for key in RUBRICS["storytelling_emotion"]["criteria"]:
            observation["storytelling_rubric"][key]["level"] = 0
        self.assertEqual(evaluate_rubric("storytelling_emotion", observation, "fixture-model")["score"], 0)


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
