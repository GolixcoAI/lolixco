"""Offline provider boundary and safe error tests using synthetic credentials."""
import base64
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/edit-dna'))
from gemini_provider import GeminiVideoProvider, ProviderError, MAX_INLINE_BYTES


def response(value):
    return io.BytesIO(json.dumps(value).encode())


def discovered(*names):
    return response({'models': [{'name': 'models/' + name, 'supportedGenerationMethods': ['generateContent']} for name in names]})


def generated():
    return response({'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '{"observed":"Synthetic audiovisual observation"}'}]}}],
                     'usageMetadata': {'promptTokenCount': 10, 'candidatesTokenCount': 8, 'totalTokenCount': 18}})


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.provider = GeminiVideoProvider(api_key='SYNTHETIC_PROVIDER_CREDENTIAL', model='gemini-3.8-flash')

    def test_typed_failures_preserve_reason_without_private_diagnostics(self):
        cases = [
            (400, 'API_KEY_INVALID secret', 'authentication_failed'),
            (403, 'API_KEY_SERVICE_BLOCKED secret', 'authentication_failed'),
            (429, 'quota exceeded secret', 'quota_exceeded'),
            (404, 'models/example not found for API version secret', 'model_unavailable'),
            (400, 'video unavailable secret', 'video_unavailable'),
            (400, 'responseJsonSchema rejected secret', 'request_unsupported'),
            (503, 'private server diagnostic secret', 'temporarily_unavailable'),
        ]
        for status, diagnostic, expected in cases:
            with self.subTest(status=status, expected=expected):
                failure = self.provider._http_error(status, diagnostic.lower())
                self.assertEqual(failure.status, expected)
                self.assertNotIn('secret', failure.message)
        zero_quota = self.provider._http_error(429, 'free_tier limit: 0')
        self.assertIn('no free-tier', zero_quota.message)

    def test_discovery_accepts_visible_video_flash_models_and_filters_other_modalities(self):
        with patch.object(self.provider._opener, 'open', return_value=discovered(
            'gemini-3.1-flash-lite', 'gemini-3.8-flash-image', 'gemini-3.1-flash-live', 'gemini-3.1-flash-tts')) as request:
            self.assertEqual(self.provider.discover_models(), ('gemini-3.1-flash-lite',))
            self.assertEqual(self.provider.discover_models(), ('gemini-3.1-flash-lite',))
        self.assertEqual(request.call_count, 1)

    def test_inline_video_stays_inside_one_bounded_generation_request(self):
        with patch.object(self.provider._opener, 'open', side_effect=[discovered('gemini-3.8-flash'), generated()]) as request:
            result = self.provider.analyze_inline_video(b'synthetic-video', 'video/mp4', 'Review the supplied evidence',
                                                         schema={'type':'object'}, max_output_tokens=6000)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(request.call_count, 2)
        inference = request.call_args_list[-1].args[0]
        payload = json.loads(inference.data)
        self.assertEqual(payload['contents'][0]['parts'][0]['inlineData'], {
            'mimeType':'video/mp4', 'data':base64.b64encode(b'synthetic-video').decode('ascii'),
        })
        self.assertEqual(payload['generationConfig']['maxOutputTokens'], 6000)
        self.assertEqual(payload['generationConfig']['thinkingConfig'], {'thinkingLevel':'LOW'})
        self.assertIn(':generateContent', inference.full_url)
        self.assertNotIn('SYNTHETIC_PROVIDER_CREDENTIAL', json.dumps(result))

    def test_inline_limits_fail_before_any_external_request(self):
        for data, mime, limit in [(b'', 'video/mp4', 6000), (b'x' * (MAX_INLINE_BYTES + 1), 'video/mp4', 6000),
                                   (b'synthetic', 'text/plain', 6000), (b'synthetic', 'video/mp4', 6001)]:
            with self.subTest(mime=mime, limit=limit):
                with patch.object(self.provider._opener, 'open') as request:
                    result = self.provider.analyze_inline_video(data, mime, 'Synthetic prompt', max_output_tokens=limit)
                self.assertEqual(result['status'], 'request_unsupported')
                request.assert_not_called()

    def test_quota_error_is_terminal_without_generation_retries(self):
        failure = HTTPError('https://generativelanguage.googleapis.com/', 429, 'quota', {}, io.BytesIO(b'private upstream response'))
        with patch.object(self.provider._opener, 'open', side_effect=[discovered('gemini-3.8-flash', 'gemini-3.5-flash'), failure]) as request:
            result = self.provider.analyze_inline_video(b'synthetic-video', 'video/mp4', 'Synthetic prompt')
        self.assertEqual(result['status'], 'quota_exceeded')
        self.assertEqual(request.call_count, 2)
        self.assertNotIn('private upstream', result['message'])

    def test_timeout_and_truncation_have_specific_sanitized_explanations(self):
        with patch.object(self.provider._opener, 'open', side_effect=TimeoutError('sensitive upstream context')):
            with self.assertRaises(ProviderError) as failure:
                self.provider._request('models', 1)
        self.assertIn('time limit', failure.exception.message)
        self.assertNotIn('sensitive', failure.exception.message)
        with self.assertRaises(ProviderError) as failure:
            self.provider._parse_result({'candidates':[{'finishReason':'MAX_TOKENS'}]}, 'fixture-model', '')
        self.assertEqual(failure.exception.status, 'request_unsupported')
        self.assertIn('output limit', failure.exception.message)

    def test_public_preflight_validates_and_bounds_the_requested_input(self):
        with patch.object(self.provider._opener, 'open', side_effect=[discovered('gemini-3.8-flash'), response({'totalTokens':900})]) as request:
            result = self.provider.count_video_tokens('https://youtu.be/jNQXAC9IVRw', 'Synthetic prompt', clip_seconds=8)
        self.assertEqual(result, {'model':'gemini-3.8-flash','input_tokens':900})
        payload = json.loads(request.call_args_list[-1].args[0].data)
        self.assertEqual(payload['contents'][0]['parts'][0]['videoMetadata']['endOffset'], '8s')
        with patch.object(self.provider._opener, 'open') as request:
            with self.assertRaises(ProviderError):
                self.provider.count_video_tokens('https://external.invalid/video')
            request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
