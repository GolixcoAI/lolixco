"""Loopback Studio regressions using generated media and isolated private state."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from fastapi.testclient import TestClient

LOCAL_DNA = Path(__file__).resolve().parents[1] / "scripts" / "local-dna"
sys.path.insert(0, str(LOCAL_DNA))


def generate(path, *arguments):
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", *arguments, "-t", "2", "-threads", "1", str(path)],
        check=True, timeout=15,
    )


class StudioLocalServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="studio-api-test-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        environment = patch.dict(os.environ, {"LOLIXCO_DNA_STATE_PARENT": str(cls.root), "LOLIXCO_GEMINI_YOUTUBE": "0"})
        environment.start()
        cls.addClassCleanup(environment.stop)
        spec = importlib.util.spec_from_file_location("studio_local_test", LOCAL_DNA / "serve.py")
        cls.service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.service)
        cls.service.INBOX = cls.root / "inbox"
        cls.service.INBOX.mkdir()
        cls.client = TestClient(
            cls.service.app,
            base_url="http://127.0.0.1:5055",
            headers={"x-lolixco-local-capability": cls.service.capability},
        )
        cls.client.__enter__()
        cls.addClassCleanup(cls.client.__exit__, None, None, None)

        video = ["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24"]
        silence = ["-f", "lavfi", "-i", "anullsrc=r=22050"]
        tone = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=22050"]
        black = ["-f", "lavfi", "-i", "color=black:size=160x90:rate=24"]
        generate(cls.root / "video-only.mp4", *video, "-c:v", "libx264")
        generate(cls.root / "silent.mp4", *video, *silence, "-c:v", "libx264", "-c:a", "aac")
        generate(cls.root / "black.mp4", *black, *tone, "-c:v", "libx264", "-c:a", "aac")
        generate(cls.root / "audio.wav", *tone, "-c:a", "pcm_s16le")

    def request(self, method, path, status=200, **options):
        response = self.client.request(method, f"/api/v8/{path}", **options)
        self.assertEqual(response.status_code, status, response.text)
        return response

    def upload(self, filename):
        result = self.request(
            "POST", "media", content=(self.root / filename).read_bytes(),
            headers={"Content-Type": "application/octet-stream", "X-Media-Name": quote(filename)},
        ).json()
        self.addCleanup(self.client.delete, f"/api/v8/media/{result['id']}")
        return result

    def start(self, media_id):
        job_id = self.request("POST", f"media/{media_id}/start", json={"quality_mode": "phase9"}).json()["job_id"]
        self.addCleanup(self.client.delete, f"/api/v8/jobs/{job_id}")
        return job_id

    def wait_until(self, job_id, *statuses):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            snapshot = self.request("GET", f"jobs/{job_id}").json()
            if snapshot["status"] in statuses:
                return snapshot
            time.sleep(.08)
        self.fail(f"Job did not reach {statuses}: {snapshot}")

    def test_api_guards_and_intake(self):
        self.request("GET", "health", 403, headers={"Origin": "https://external.invalid"})
        health = self.request("GET", "health").json()
        self.assertEqual(health["media_limits"]["max_bytes"], 100 * 1024 * 1024)
        self.assertEqual(health["provider"]["status"], "not_configured")
        self.request("POST", "jobs/ingest", 404, json={"source_path": "/tmp/elsewhere.mp4"})
        self.request("POST", "jobs/start", 415, json={"inbox_filename": "../video-only.mp4"})
        self.request("POST", "youtube/start", 400, json={"video_id": "_yrPlcZY2jw", "consent": False})
        self.request("POST", "youtube/start", 503, json={"video_id": "_yrPlcZY2jw", "consent": True})
        headers = {"Content-Type": "application/octet-stream", "X-Media-Name": "broken.mp4"}
        self.request("POST", "media", 422, headers=headers, content=b"broken container")
        self.request("POST", "media", 413, headers={**headers, "Content-Length": "104857601"}, content=b"x")

    def test_bounded_edge_cases_and_cleanup(self):
        for filename, expected_visual in (("video-only.mp4", True), ("silent.mp4", True),
                                          ("black.mp4", True), ("audio.wav", False)):
            with self.subTest(filename=filename):
                media = self.upload(filename)
                self.request("GET", f"media/{media['id']}", 206, headers={"Range": "bytes=0-63"})
                job_id = self.start(media["id"])
                snapshot = self.wait_until(job_id, "COMPLETE", "FAILED")
                self.assertEqual(snapshot["status"], "COMPLETE", snapshot)
                self.assertEqual(snapshot["result_status"], "partial")
                event_data = self.request("GET", f"jobs/{job_id}/events").text
                events = [json.loads(line[6:]) for line in event_data.splitlines() if line.startswith("data: ")]
                self.assertIn("Inspecting streams", [event["payload"].get("message") for event in events])
                self.assertEqual(len({event["section_id"] for event in events if event["section_id"]}), 7)
                self.assertNotIn(str(self.root), event_data)
                report = self.request("GET", f"jobs/{job_id}/report/presentation").json()
                raw = self.request("GET", f"jobs/{job_id}/report/v6").json()
                self.assertNotIn(str(self.root), json.dumps(raw))
                self.assertIsNone(report["overall_score_0_10"])
                sections = {row["section_id"]: row for row in report["assessment_sections"]}
                self.assertEqual(len(sections), 7)
                self.assertIsNone(sections["beat_synchronization"]["score_0_10"])
                self.assertEqual(sections["visual_measurements"]["score_0_10"] is not None, expected_visual)
                if filename == "black.mp4":
                    self.assertEqual(sections["visual_measurements"]["score_0_10"], 0)
                self.request("DELETE", f"media/{media['id']}")
                self.request("GET", f"media/{media['id']}", 404)
                self.request("DELETE", f"jobs/{job_id}")
                self.request("GET", f"jobs/{job_id}", 404)

    def test_cancel_and_retry_previous_file(self):
        source = self.service.INBOX / "previous.mp4"
        source.write_bytes((self.root / "video-only.mp4").read_bytes())
        (self.service.INBOX / "outside.mp4").symlink_to(self.root / "video-only.mp4")
        samples = self.request("GET", "inbox").json()["files"]
        self.assertEqual([file["filename"] for file in samples], ["previous.mp4"])
        self.request("POST", "jobs/start", 404, json={"inbox_filename": "outside.mp4"})
        job_id = self.request("POST", "jobs/start", json={"inbox_filename": "previous.mp4"}).json()["job_id"]
        snapshot = self.wait_until(job_id, "RUNNING")
        media_id = snapshot["staged_media"]["id"]
        self.addCleanup(self.client.delete, f"/api/v8/media/{media_id}")
        self.request("POST", f"jobs/{job_id}/cancel")
        self.wait_until(job_id, "CANCELLED")
        retry = self.start(media_id)
        self.assertEqual(self.wait_until(retry, "COMPLETE", "FAILED")["status"], "COMPLETE")
        self.request("DELETE", f"jobs/{job_id}")
        self.assertTrue(source.is_file())


if __name__ == "__main__":
    unittest.main()
