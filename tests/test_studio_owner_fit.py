"""Regression tests for leakage, feature compatibility, and private feedback."""
import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("owner_fit", ROOT / "scripts/local-dna/owner_fit.py")
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


def report(features, identity):
    return {
        "schema_version": "7.0.0-presentation",
        "context_evidence": {"local_input_sha256": identity},
        "assessment_sections": [{"section_id": key, "score_0_10": value,
                                 "method_version": "phase9_test_signal_v1", "evidence_status": "MEASURED_SIGNAL"}
                                for key, value in zip(owner.FEATURE_IDS, features, strict=True)],
    }


class OwnerFitTest(unittest.TestCase):
    def test_empty_and_incompatible_cohort_abstains_without_default_scores(self):
        with tempfile.TemporaryDirectory() as directory:
            sample = report([6, 7, 8, 4], "a" * 64)
            result = owner.assess_owner_fit(sample, directory)
            self.assertIsNone(result["score_0_10"])
            self.assertEqual(result["evidence_refs"]["compatible_reviews"], 0)
            sample["assessment_sections"][0]["score_0_10"] = None
            self.assertIsNone(owner.assess_owner_fit(sample, directory)["score_0_10"])
            sample["is_synthetic_fixture"] = True
            with self.assertRaises(ValueError):
                owner.record_feedback(sample, 7, directory)

    def test_duplicate_upload_revises_feedback_and_excludes_self(self):
        with tempfile.TemporaryDirectory() as directory:
            sample = report([6, 7, 8, 4], "a" * 64)
            self.assertEqual(owner.record_feedback(sample, 8, directory), 1)
            self.assertEqual(owner.record_feedback(sample, 6, directory), 1)
            result = owner.assess_owner_fit(sample, directory)
            self.assertEqual(result["evidence_refs"]["compatible_reviews"], 0)
            saved = owner.feedback_file(directory)
            self.assertEqual(saved.stat().st_mode & 0o777, 0o600)
            self.assertEqual(owner.load_feedback(directory)[0]["owner_score"], 6)
            self.assertNotIn("source_path", json.dumps(owner.load_feedback(directory)))

    def test_supported_prediction_uses_independent_labels_and_same_methods(self):
        rng = np.random.default_rng(1515)
        features = rng.uniform(1, 9, size=(32, 4))
        with tempfile.TemporaryDirectory() as directory:
            for index, row in enumerate(features):
                owner.record_feedback(report(row.tolist(), f"{index:064x}"), float(row[0]), directory)
            sample = report([7, 3, 6, 4], "f" * 64)
            result = owner.assess_owner_fit(sample, directory)
            self.assertEqual(result["evidence_status"], "PERSONALIZED_ESTIMATE")
            self.assertTrue(result["evidence_refs"]["validation"]["passes_baselines"])
            self.assertAlmostEqual(result["score_0_10"], 7, delta=.5)
            self.assertGreater(abs(result["score_0_10"] - np.mean([7, 3, 6, 4])), 1)
            sample["assessment_sections"][0]["method_version"] = "phase9_changed_scale"
            self.assertIsNone(owner.assess_owner_fit(sample, directory)["score_0_10"])
            outside = report([10, 3, 6, 4], "f" * 64)
            self.assertIsNone(owner.assess_owner_fit(outside, directory)["score_0_10"])

    def test_model_that_cannot_beat_equal_weight_abstains(self):
        rng = np.random.default_rng(2525)
        features = rng.uniform(1, 9, size=(16, 4))
        with tempfile.TemporaryDirectory() as directory:
            for index, row in enumerate(features):
                owner.record_feedback(report(row.tolist(), f"{index:064x}"), float(np.mean(row)), directory)
            result = owner.assess_owner_fit(report([4, 4, 5, 6], "f" * 64), directory)
            self.assertIsNone(result["score_0_10"])
            self.assertFalse(result["evidence_refs"]["validation"]["passes_baselines"])

    def test_pairwise_audit_holds_out_both_endpoints(self):
        ratings = {}
        for index in range(8):
            features = [float(index + 1)] * len(owner.HUMAN_FEATURES)
            ratings[str(index)] = {
                "youtube_id": str(index), "component_scores": dict(zip(owner.HUMAN_FEATURES, features)),
                "overall_subjective_score": index + 1,
            }
        comparisons = [{"candidate_a": "0", "candidate_b": "1", "chosen_asset": "1"}]
        training_sets = []
        fit = owner.fit_weights

        def capture(features, targets):
            training_sets.append(np.asarray(features).copy())
            return fit(features, targets)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "owner_ratings.json").write_text(json.dumps({"ratings": ratings}))
            (root / "owner_comparisons.json").write_text(json.dumps({"comparisons": comparisons}))
            with patch.object(owner, "fit_weights", side_effect=capture):
                audit = owner.audit_existing_owner_data(directory)
            self.assertEqual(audit["pairwise_validation"]["n_pairs"], 1)
            self.assertEqual(training_sets[-1].shape, (6, 6))
            self.assertTrue(np.all(training_sets[-1][:, 0] >= 3))
            self.assertEqual(audit["pairwise_validation"]["model_correct"], 1)

    def test_holdout_fit_uses_only_training_targets(self):
        rng = np.random.default_rng(3838)
        features = rng.uniform(1, 9, size=(14, 4))
        targets = features[:, 1].copy()
        first = features[0] @ owner.fit_weights(features[1:], targets[1:])
        targets[0] = 10 - targets[0]
        second = features[0] @ owner.fit_weights(features[1:], targets[1:])
        self.assertEqual(first, second)
        self.assertEqual(owner.validate_model(features, targets)["n_reviews"], 14)


if __name__ == "__main__":
    unittest.main()
