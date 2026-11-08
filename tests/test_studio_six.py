"""Six-dimension evidence, legacy compatibility and hybrid fusion regressions."""
import copy
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "scripts/local-dna"), str(ROOT / "scripts/edit-dna")]
import youtube_analysis
from hybrid_worker import combine_semantic_passes, fuse_results
from presentation_v8 import SECTION_IDS, to_six_report
from semantic_rubric import RUBRICS, normalize_rubric_observations

spec = importlib.util.spec_from_file_location("gemini_test_fixtures", ROOT / "tests/test_studio_gemini.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


def semantic_result(observation):
    return {"model": "fixture-model", "video_uri": fixtures.URL, "usage": {},
            "analysis": {"structured": observation}}


class SixAssessmentTests(unittest.TestCase):
    def test_flat_24_criterion_transport_validates_indices_duplicates_and_abstention(self):
        observation = fixtures.rubric_observation()
        observation["criterion_evidence"] = []
        observation["dimension_notes"] = []
        for dimension, (key, rubric) in enumerate(RUBRICS.items()):
            entry = observation.pop(rubric["field"])
            for criterion, name in enumerate(rubric["criteria"]):
                observation["criterion_evidence"].append({
                    "dimension_index": dimension, "criterion_index": criterion,
                    "supported": True, **entry[name],
                })
                observation["criterion_evidence"][-1].pop("approximate_timestamp_sec")
                observation["criterion_evidence"][-1]["approximate_timecode"] = f"00:{entry[name]['approximate_timestamp_sec']:02}"
            observation["dimension_notes"].append({
                "dimension_index": dimension, "strengths": entry["strengths"][0],
                "weaknesses": entry["weaknesses"][0], "suggestion": entry["suggestion"],
            })
        _, report = youtube_analysis._build_reports("flat24", semantic_result(observation))
        self.assertEqual([section["score_0_10"] for section in report["assessment_sections"]], [7.5] * 6)
        observation["criterion_evidence"][0]["approximate_timecode"] = "01:05"
        normalized = normalize_rubric_observations(observation)
        self.assertEqual(normalized["rhythm_rubric"]["audible_visual_accents"]["approximate_timestamp_sec"], 65)
        # Timecodes are parsed strictly; a malformed MM:SS cannot become evidence.
        observation["criterion_evidence"][0]["approximate_timecode"] = "00:65"
        normalized = normalize_rubric_observations(observation)
        self.assertIsNone(normalized["rhythm_rubric"]["audible_visual_accents"]["approximate_timestamp_sec"])
        observation["criterion_evidence"][0]["supported"] = False
        observation["criterion_evidence"][1]["dimension_index"] = 99
        _, partial = youtube_analysis._build_reports("flat24", semantic_result(observation))
        self.assertIsNone(partial["assessment_sections"][0]["score_0_10"])
        self.assertIsNone(partial["overall_score_0_10"])
        observation["criterion_evidence"].append(observation["criterion_evidence"][2])
        with self.assertRaises(ValueError):
            normalize_rubric_observations(observation)

    def test_flat_schema_preserves_criteria_and_ignores_invented_total(self):
        observation = fixtures.rubric_observation()
        observation["assessments"] = []
        for key, rubric in RUBRICS.items():
            entry = observation.pop(rubric["field"])
            observation["assessments"].append({
                "dimension": key,
                "criteria": [{"criterion": name, "supported": True, **entry[name]} for name in rubric["criteria"]],
                **{name: entry[name] for name in ("strengths", "weaknesses", "suggestion")},
            })
        observation["overall_score"] = 10
        _, presentation = youtube_analysis._build_reports("synthetic-video", semantic_result(observation))
        self.assertEqual(presentation["schema_version"], "8.0.0-presentation")
        self.assertEqual([section["score_0_10"] for section in presentation["assessment_sections"]], [7.5] * 6)
        self.assertEqual(presentation["overall_score_0_10"], 7.5)
        observation["assessments"].append(observation["assessments"][0])
        with self.assertRaises(ValueError):
            normalize_rubric_observations(observation)

    def test_modality_absence_never_forces_six_scores(self):
        silent = fixtures.rubric_observation()
        silent["audio_reviewable"] = False
        _, report = youtube_analysis._build_reports("silent-fixture", semantic_result(silent))
        self.assertIsNone(report["assessment_sections"][0]["score_0_10"])
        self.assertIsNone(report["overall_score_0_10"])
        black = fixtures.rubric_observation()
        black["visual_content_present"] = False
        _, report = youtube_analysis._build_reports("black-fixture", semantic_result(black))
        self.assertTrue(all(section["score_0_10"] is None for section in report["assessment_sections"]))

    def test_independent_passes_preserve_models_and_combine_only_supported_rhythm(self):
        rhythm = semantic_result(fixtures.rubric_observation())
        rhythm["model"] = "focused-rhythm-fixture"
        rhythm["usage"] = {"input_tokens":100,"output_tokens":40,"total_tokens":140}
        for criterion in RUBRICS["beat_synchronization"]["criteria"]:
            rhythm["analysis"]["structured"]["rhythm_rubric"][criterion]["level"] = 4
        editorial = semantic_result(fixtures.rubric_observation())
        editorial["model"] = "editorial-fixture"
        editorial["usage"] = {"input_tokens":200,"output_tokens":80,"total_tokens":280}
        canonical, report = combine_semantic_passes(rhythm, editorial, "combined-fixture", 20)
        self.assertEqual(report["assessment_sections"][0]["score_0_10"], 10)
        self.assertEqual(report["assessment_sections"][0]["evidence_refs"]["provider_model"], "focused-rhythm-fixture")
        self.assertTrue(all(section["evidence_refs"]["provider_model"] == "editorial-fixture"
                            for section in report["assessment_sections"][1:]))
        self.assertEqual(report["overall_score_0_10"], 7.92)
        remote = report["context_evidence"]["remote_observation"]
        self.assertEqual(len(remote["passes"]), 2)
        self.assertEqual({item["model"] for item in remote["passes"]}, {"focused-rhythm-fixture", "editorial-fixture"})
        self.assertEqual(remote["usage"]["input_tokens"], 300)
        self.assertEqual(remote["usage"]["output_tokens"], 120)
        self.assertEqual(remote["usage"]["total_tokens"], 420)
        self.assertEqual(canonical["section_d_semantic_evaluation"]["scorecard"]["beat_synchronization"]["score"], 10)

    def test_focused_rhythm_abstention_cannot_be_overridden_by_the_editorial_pass(self):
        for reviewable in (False, None):
            with self.subTest(audio_reviewable=reviewable):
                rhythm = semantic_result(fixtures.rubric_observation())
                rhythm["analysis"]["structured"]["audio_reviewable"] = reviewable
                editorial = semantic_result(fixtures.rubric_observation())
                _, report = combine_semantic_passes(rhythm, editorial, "rhythm-abstention-fixture", 20)
                self.assertIsNone(report["assessment_sections"][0]["score_0_10"])
                self.assertTrue(all(section["score_0_10"] == 7.5 for section in report["assessment_sections"][1:]))
                self.assertIsNone(report["overall_score_0_10"])

    def test_legacy_overall_is_withheld_and_fusion_preserves_evidence_sources(self):
        canonical, semantic = youtube_analysis._build_reports("fixture", semantic_result(fixtures.rubric_observation()))
        legacy = copy.deepcopy(semantic)
        legacy["schema_version"] = "7.0.0-presentation"
        legacy["assessment_sections"].append({"section_id": "personalized_owner_fit", "score_0_10": 9})
        converted = to_six_report(legacy)
        self.assertEqual(len(converted["assessment_sections"]), 6)
        self.assertIsNone(converted["overall_score_0_10"])
        local = copy.deepcopy(converted)
        local["context_evidence"].update(
            visual_recognition={"status": "UNKNOWN"}, music_recognition={"status": "UNKNOWN"},
            media_observations={"has_video_stream": True}, local_input_sha256="a" * 64,
        )
        for section in local["assessment_sections"]:
            section.update(evidence_status="EXPERIMENTAL_PROXY", score_0_10=4,
                           evidence_refs={"measured_fact": 2})
        result = fuse_results({"v6": canonical, "presentation": local},
                              {"v6": canonical, "presentation": semantic}, {})
        report = result["presentation"]
        self.assertEqual(report["context_evidence"]["music_recognition"]["status"], "POSSIBLE_MATCH")
        self.assertEqual(report["assessment_sections"][0]["score_0_10"], 7.5)
        self.assertEqual(report["assessment_sections"][0]["evidence_refs"]["local_signal_score"], 4)
        self.assertEqual(report["overall_score_0_10"], 7.5)
        self.assertEqual([section["section_id"] for section in report["assessment_sections"]], list(SECTION_IDS))


if __name__ == "__main__":
    unittest.main()
