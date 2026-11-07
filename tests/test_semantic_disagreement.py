"""Private-label isolation and aggregate disagreement regression tests."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('semantic_disagreement', ROOT / 'scripts/local-dna/evaluate_semantic_disagreement.py')
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class FakeProduct:
    def __init__(self):
        self.inputs = []

    def metadata(self, identity):
        self.inputs.append(('metadata', identity))
        return {'context_evidence': {'youtube_reference': {'privacy_status':'public','duration_iso8601':'PT20S'}}}

    def assess(self, identity):
        self.inputs.append(('assessment', identity))
        return {'schema_version':'8.0.0-presentation',
                'context_evidence':{'remote_observation':{'model':'gemini-fixture'}},
                'assessment_sections':[{'section_id':key,'score_0_10':6} for key in evaluation.DIMENSIONS]}


class DisagreementTests(unittest.TestCase):
    def test_duration_and_deterministic_eligibility(self):
        self.assertEqual(evaluation.duration_seconds('PT1M59S'), 119)
        self.assertEqual(evaluation.duration_seconds('PT2M0.1S'), 120.1)
        self.assertIsNone(evaluation.duration_seconds('invalid'))
        labels = dict.fromkeys(evaluation.DIMENSIONS.values(), 6)
        rows = {'z':{'youtube_id':'BBBBBBBBBBB','component_scores':labels},
                'a':{'youtube_id':'AAAAAAAAAAA','component_scores':labels},
                'duplicate':{'youtube_id':'AAAAAAAAAAA','component_scores':labels},
                'synthetic':{'youtube_id':'CCCCCCCCCCC','is_synthetic_benchmark':True,'component_scores':labels},
                'research':{'youtube_id':'_yrPlcZY2jw','component_scores':labels}}
        self.assertEqual([identity for identity, _ in evaluation.candidates({'ratings':rows})], ['AAAAAAAAAAA','BBBBBBBBBBB'])

    def test_ratings_and_notes_stay_local_and_only_aggregates_are_saved(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            rows = {'first':{'youtube_id':'AAAAAAAAAAA','component_scores':dict.fromkeys(evaluation.DIMENSIONS.values(),4),
                             'notes':'PRIVATE_EDITOR_SENTINEL'},
                    'second':{'youtube_id':'BBBBBBBBBBB','component_scores':dict.fromkeys(evaluation.DIMENSIONS.values(),6)}}
            source = state / 'owner_ratings.json'
            source.write_text(json.dumps({'ratings':rows}))
            original = source.read_bytes()
            api = FakeProduct()
            with patch.object(evaluation, 'STATE', state), patch.object(evaluation.time, 'sleep'):
                result = evaluation.run(api)
                output = evaluation.save(result)
            self.assertEqual(result['evaluated_samples'], 2)
            self.assertEqual(result['supported_dimension_predictions'], 12)
            self.assertEqual(result['mean_absolute_error_across_supported_predictions'], 1)
            self.assertEqual(source.read_bytes(), original)
            self.assertTrue(all(isinstance(identity,str) for _,identity in api.inputs))
            exported = output.read_text()
            for value in ('AAAAAAAAAAA','BBBBBBBBBBB','PRIVATE_EDITOR_SENTINEL','component_scores'):
                self.assertNotIn(value, exported)
            self.assertFalse(result['private_labels_sent_to_provider'])
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_provider_quota_stops_evaluation_without_retrying_other_reviewed_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            labels = dict.fromkeys(evaluation.DIMENSIONS.values(), 6)
            source = state / 'owner_ratings.json'
            source.write_text(json.dumps({'ratings':{'a':{'youtube_id':'AAAAAAAAAAA','component_scores':labels},
                                                       'b':{'youtube_id':'BBBBBBBBBBB','component_scores':labels}}}))
            api = FakeProduct()
            with patch.object(evaluation, 'STATE',state), patch.object(evaluation.time,'sleep'), \
                 patch.object(api,'assess',side_effect=evaluation.EvaluationError('quota_exceeded')) as assess:
                result = evaluation.run(api)
            self.assertEqual(assess.call_count,1)
            self.assertEqual(result['evaluated_samples'],0)
            self.assertEqual(result['skipped_counts'],{'quota_exceeded':1})


if __name__ == '__main__':
    unittest.main()
