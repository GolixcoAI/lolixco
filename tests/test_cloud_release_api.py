"""Cloud authorization and publication boundaries using synthetic sessions only."""
import importlib
import json
import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server/production"))
with patch.dict(os.environ, JOBS_TABLE="synthetic", PRIVATE_BUCKET="synthetic", JOB_QUEUE="synthetic",
                PUBLIC_ORIGIN="https://preview.example", AI_ENABLED="true"), patch("boto3.Session"):
    common = importlib.import_module("common")
    api = importlib.import_module("api")


class CloudAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, PUBLIC_ORIGIN="https://preview.example", AI_ENABLED="true")
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def event(self, path, method="GET", body=None):
        return {"rawPath": "/api/v8/" + path, "requestContext": {"http": {"method": method}},
                "body": json.dumps(body) if body is not None else None}

    def test_other_session_cannot_read_status_report_delete_or_cancel(self):
        identity = "job_123_" + "a" * 24
        row = {"owner": "owner-a", "expires": int(time.time()) + 60}
        with patch.object(api, "session", return_value=("owner-b", [])), patch.object(common, "get", return_value=row), patch.object(api, "S3") as storage:
            for suffix, method in [("", "GET"), ("/report/presentation", "GET"), ("", "DELETE"), ("/cancel", "POST")]:
                with self.assertRaises(common.RequestError) as caught:
                    api.route(self.event("jobs/" + identity + suffix, method))
                self.assertEqual(caught.exception.status, 404)
            storage.get_object.assert_not_called()
            storage.delete_objects.assert_not_called()

    def test_expiry_denies_access_even_before_physical_deletion(self):
        with patch.object(common, "get", return_value={"owner": "owner-a", "expires": int(time.time()) - 1}):
            with self.assertRaises(common.RequestError) as caught:
                common.owned("JOB", "synthetic", "owner-a")
        self.assertEqual(caught.exception.status, 410)

    def test_cross_origin_session_is_rejected(self):
        with self.assertRaises(common.RequestError) as caught:
            api.session({"headers": {"Origin": "https://attacker.example"}}, create=True)
        self.assertEqual(caught.exception.status, 403)

    def test_transition_origins_are_exact_and_keep_host_only_cookies(self):
        origins=['https://lol.golixco.com','https://d2w2cv3wlh68gg.cloudfront.net']
        with patch.dict(os.environ,PUBLIC_ORIGIN=origins[0],ALLOWED_ORIGINS=','.join(origins)), patch.object(api,'counter',return_value=True), patch.object(api,'put'):
            for origin in origins:
                _,cookies=api.session({'headers':{'Origin':origin}},create=True)
                self.assertNotIn('Domain=',cookies[0])
            for origin in ['https://golixco.com','https://lol.golixco.com.attacker.example','null','https://lol.golixco.com/']:
                with self.assertRaises(common.RequestError):
                    api.session({'headers':{'Origin':origin}},create=True)

    def test_private_cookie_is_secure_and_not_in_json(self):
        with patch.object(api, "counter", return_value=True), patch.object(api, "put"):
            owner, cookies = api.session({}, create=True)
        self.assertEqual(len(owner), 64)
        for value in ("Secure", "HttpOnly", "SameSite=Strict", "Path=/api/"):
            self.assertIn(value, cookies[0])
        self.assertNotIn(owner, cookies[0])

    def test_oversized_or_path_like_filename_never_gets_upload_capability(self):
        with patch.object(api, "session", return_value=("owner-a", [])), patch.object(api, "counter", return_value=True), patch.object(api, "S3") as storage:
            for body in [{"name": "../private.mp4", "size": 10}, {"name": "video.mp4", "size": common.MAX_BYTES + 1}]:
                with self.assertRaises(common.RequestError):
                    api.route(self.event("media/presign", "POST", body))
            storage.generate_presigned_post.assert_not_called()

    def test_report_is_unavailable_until_the_worker_commits_complete(self):
        row = {"status": "RUNNING", "created": int(time.time()), "owner": "owner-a"}
        with patch.object(api, "session", return_value=("owner-a", [])), patch.object(api, "owned", return_value=row), patch.object(api, "S3") as storage:
            with self.assertRaises(common.RequestError) as caught:
                api.route(self.event("jobs/job_123_" + "a" * 24 + "/report/presentation"))
            self.assertEqual(caught.exception.status, 409)
            storage.get_object.assert_not_called()

    def test_queue_age_does_not_expire_a_worker_that_only_just_started(self):
        now=int(time.time())
        row={"pk":"synthetic","status":"RUNNING","created":now-950,"worker_started":now-10,"owner":"owner-a"}
        with patch.object(api,"session",return_value=("owner-a",[])), patch.object(api,"owned",return_value=row), patch.object(api,"TABLE") as table:
            api.route(self.event("jobs/job_123_"+"a"*24))
            table.update_item.assert_not_called()

    def test_expired_queue_and_worker_have_distinct_timeout_codes(self):
        now=int(time.time())
        for status,code,age in [("QUEUED","queue_timeout",901),("RUNNING","analysis_timeout",661)]:
            row={"pk":"synthetic","status":status,"created":now-age,"worker_started":now-age,"owner":"owner-a"}
            with patch.object(api,"session",return_value=("owner-a",[])), patch.object(api,"owned",return_value=row), patch.object(api,"TABLE") as table:
                api.route(self.event("jobs/job_123_"+"a"*24))
                self.assertEqual(table.update_item.call_args.kwargs['ExpressionAttributeValues'][':code'],code)

    def test_operator_pause_prevents_even_upload_allocation(self):
        with patch.dict(os.environ, AI_ENABLED="false"), patch.object(api, "session", return_value=("owner-a", [])), patch.object(api, "counter", return_value=True), patch.object(api, "put") as put:
            with self.assertRaises(common.RequestError) as caught:
                api.route(self.event("media/presign", "POST", {"name": "video.mp4", "size": 10}))
            self.assertEqual(caught.exception.status, 503)
            put.assert_not_called()

    def test_finished_upload_can_be_reanalyzed_without_a_new_upload(self):
        media = {"pk": "MEDIA#synthetic", "key": "uploads/synthetic", "name": "synthetic.mp4", "size": 100, "job_id": "previous"}
        previous = {"status": "COMPLETE", "worker_finished": True}
        with patch.object(api, "admit"), patch.object(api, "owned", return_value=media), patch.object(api, "get", return_value=previous), patch.object(api, "S3") as storage, patch.object(api, "TABLE") as table, patch.object(api, "SQS"), patch.object(api, "put") as put:
            storage.head_object.return_value = {"ContentLength": 100}
            result = api.start_job("owner-a", media="synthetic")
            self.assertRegex(result["job_id"], r"^job_\d+_[a-f0-9]{24}$")
            self.assertEqual(table.update_item.call_count, 2)
            self.assertEqual(put.call_args.args[0]["status"], "QUEUED")

    def test_gemini_fallback_cannot_exceed_the_per_job_generation_allowance(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/edit-dna"))
        from gemini_provider import GeminiVideoProvider, ProviderError
        provider = GeminiVideoProvider(api_key="synthetic-test-only")
        response = Mock()
        response.read.return_value = b"{}"
        with patch.dict(os.environ, LOLIXCO_GEMINI_MAX_GENERATIONS="2"), patch.object(provider._opener, "open") as transport:
            transport.return_value.__enter__.return_value = response
            for _ in range(2):
                provider._request("models/gemini-flash-latest:generateContent", 1, {})
            with self.assertRaises(ProviderError) as caught:
                provider._request("models/gemini-flash-latest:generateContent", 1, {})
            self.assertEqual(caught.exception.status, "quota_exceeded")
            self.assertEqual(transport.call_count, 2)


if __name__ == "__main__":
    unittest.main()
