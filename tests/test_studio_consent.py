"""Ensure cloud work and credentials follow explicit, immutable job consent."""
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from studio_service_import import isolate_research_service

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/local-dna"))
import staged_jobs
from presentation_v8 import SECTION_IDS, to_six_report


def result():
    return {"v6": {}, "presentation": to_six_report({"assessment_sections": [
        {"section_id": key, "score_0_10": 5 if index < 4 else None,
         "evidence_status": "EXPERIMENTAL_PROXY" if index < 4 else "NOT_YET_ASSESSED",
         "creator_explanation": "Synthetic local evidence", "evidence_refs": {}, "timestamps": []}
        for index, key in enumerate(SECTION_IDS)
    ], "context_evidence": {}})}


class ConsentTests(unittest.TestCase):
    def run_job(self, consent, *, quota_failure=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage = root / "media"
            media = stage / ("a" * 32) / "input.mp4"
            media.parent.mkdir(parents=True)
            media.write_bytes(b"synthetic-test")
            reports, work = root / "reports", root / "work"
            reports.mkdir()
            work.mkdir()
            job = SimpleNamespace(lock=threading.RLock(), cancel_event=threading.Event(),
                                  media_path=str(media), job_id="job_1_abcdef", quality_mode="phase9",
                                  semantic_consent=consent, add_event=lambda *args, **kwargs: None)
            answers = [result(), staged_jobs.WorkerError("Synthetic quota failure", "quota_exceeded")] if quota_failure else [result(), result()]
            with patch.dict(os.environ, {"GEMINI_API_KEY": "SYNTHETIC_SERVER_CREDENTIAL", "LOLIXCO_GEMINI_YOUTUBE": "1"}), \
                 patch.object(staged_jobs, "worker_result", side_effect=answers) as worker:
                staged_jobs.run_analysis(job, reports, work, stage)
            environments = [call.args[3] for call in worker.call_args_list]
            self.assertEqual(job.status, "COMPLETE")
            self.assertNotIn("GEMINI_API_KEY", environments[0])
            self.assertNotIn("LOLIXCO_OWNER_STATE_PARENT", environments[0])
            if consent:
                self.assertEqual(len(environments), 2)
                self.assertEqual(environments[1]["GEMINI_API_KEY"], "SYNTHETIC_SERVER_CREDENTIAL")
            else:
                self.assertEqual(len(environments), 1)
            if quota_failure:
                self.assertEqual(job.presentation_report["context_evidence"]["semantic_provider_status"]["status"], "quota_exceeded")
                self.assertEqual([row["score_0_10"] for row in job.presentation_report["assessment_sections"]], [5, 5, 5, 5, None, None])

    def test_public_job_without_consent_does_not_dispatch_or_receive_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reports, work, stage = root / "reports", root / "work", root / "media"
            for path in (reports, work, stage):
                path.mkdir()
            job = SimpleNamespace(lock=threading.RLock(), cancel_event=threading.Event(),
                                  media_path="https://www.youtube.com/watch?v=jNQXAC9IVRw",
                                  job_id="job_1_abcdef", quality_mode="phase9", semantic_consent=False,
                                  add_event=lambda *args, **kwargs: None)
            with patch.dict(os.environ, {"GEMINI_API_KEY":"SYNTHETIC_SERVER_CREDENTIAL"}), \
                 patch.object(staged_jobs, "worker_result") as worker:
                staged_jobs.run_analysis(job, reports, work, stage)
            self.assertEqual(job.status, "FAILED")
            self.assertEqual(job.error_code, "consent_required")
            self.assertFalse(job.worker_active)
            worker.assert_not_called()

    def test_local_only_never_receives_provider_key_or_starts_cloud(self):
        self.run_job(False)

    def test_explicit_consent_starts_isolated_cloud_worker(self):
        self.run_job(True)

    def test_optional_cloud_failure_preserves_local_evidence(self):
        self.run_job(True, quota_failure=True)


class HybridEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import importlib.util
        import hybrid_worker
        cls.hybrid = hybrid_worker
        spec = importlib.util.spec_from_file_location("consent_test_fixtures", ROOT / "tests/test_studio_gemini.py")
        cls.fixtures = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.fixtures)

    def run_hybrid(self, duration=20, *, visual_content=True, failure=None, second_failure=None, facts_override=None):
        import copy
        import contextlib
        import io
        observation = self.fixtures.rubric_observation()
        observation["visual_content_present"] = visual_content
        provider_result = {
            "status": "success", "model": "synthetic-consent-fixture", "video_uri": "", "usage": {},
            "analysis": {"structured": observation},
        }
        canonical, semantic = self.hybrid._build_reports("fixture", copy.deepcopy(provider_result))
        local = result()
        local["v6"] = canonical
        context = local["presentation"]["context_evidence"]
        context["media_observations"] = {"has_video_stream": True, "has_audio_stream": True,
                                          "audio_activity": True, "duration_seconds": duration,
                                          **(facts_override or {})}
        if not context["media_observations"]["has_audio_stream"] or not context["media_observations"]["audio_activity"]:
            local["presentation"]["assessment_sections"][0].update(score_0_10=None, evidence_status="NOT_YET_ASSESSED")
        context["governance_contract"] = {
            "cloud_upload_permitted": False, "data_governance": {"local_bytes_only": True, "zero_cloud_retention": True},
        }
        context["media_notes"] = ["Local decoded measurements are available."]
        with tempfile.TemporaryDirectory(prefix="studio-hybrid-test-") as directory:
            root = Path(directory)
            local_path = root / "local.json"
            local_path.write_text(json.dumps(local))
            previous_directory = Path.cwd()
            try:
                os.chdir(root)
                responses = [copy.deepcopy(provider_result), second_failure or copy.deepcopy(provider_result)]
                if failure:
                    responses = [failure]
                with patch.object(self.hybrid, "_require_configured_provider"), \
                     patch.object(self.hybrid, "prepare_semantic_copy", side_effect=lambda source, target: target.write_bytes(b"synthetic-rendition")), \
                     patch.object(self.hybrid.provider, "analyze_inline_video", side_effect=responses) as inference, \
                     contextlib.redirect_stdout(io.StringIO()):
                    if failure or second_failure:
                        with self.assertRaises(type(failure or second_failure)):
                            self.hybrid.main(root / "private-original.mov", local_path)
                        self.assertFalse((root / "semantic-review.mp4").exists())
                        return None, list(inference.call_args_list)
                    self.hybrid.main(root / "private-original.mov", local_path)
                self.assertFalse((root / "semantic-review.mp4").exists())
                return json.loads((root / "result.json").read_text()), list(inference.call_args_list)
            finally:
                os.chdir(previous_directory)

    def test_cloud_visual_abstention_remains_unscored_despite_decodable_local_frames(self):
        fused, calls = self.run_hybrid(visual_content=False)
        self.assertEqual([row["score_0_10"] for row in fused["presentation"]["assessment_sections"]], [5, 5, 5, 5, None, None])
        self.assertIsNone(fused["presentation"]["overall_score_0_10"])
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertIn("0 to 20 seconds", call.args[2])
            self.assertIn("00:00 to 00:20.00", call.args[2])
            self.assertNotIn("attached public YouTube video", call.args[2])

    def test_actual_local_duration_bounds_all_semantic_evidence(self):
        fused, calls = self.run_hybrid(duration=4)
        self.assertEqual(fused["presentation"]["context_evidence"]["remote_observation"]["requested_review_seconds"], 4)
        self.assertIsNone(fused["presentation"]["assessment_sections"][4]["score_0_10"])
        self.assertTrue(all(timestamp <= 4 for row in fused["presentation"]["assessment_sections"] for timestamp in row["timestamps"]))
        for call in calls:
            self.assertIn("0 to 4 seconds", call.args[2])

    def test_hybrid_exports_record_actual_cloud_consent_and_provider_terms(self):
        fused, _ = self.run_hybrid()
        governance = fused["v6"]["section_g_privacy_and_contract"]
        self.assertTrue(governance["cloud_upload_permitted"])
        self.assertTrue(governance["data_governance"]["private_video_cloud_consent"])
        self.assertFalse(governance["data_governance"]["reusable_provider_file_created"])
        self.assertNotIn("zero_cloud_retention", governance["data_governance"])
        context = fused["presentation"]["context_evidence"]
        self.assertEqual(context["governance_contract"], governance)
        self.assertNotIn("public video", " ".join(context["media_notes"]))
        self.assertNotIn("did not decode local", " ".join(context["media_notes"]))
        self.assertEqual(context["remote_observation"]["input_kind"], "consented_local_video")

    def test_request_failure_removes_private_semantic_copy(self):
        from gemini_provider import ProviderError
        _, calls = self.run_hybrid(failure=ProviderError("quota_exceeded", "Synthetic quota failure"))
        self.assertEqual(len(calls), 1)

    def test_second_review_failure_removes_the_private_copy(self):
        from gemini_provider import ProviderError
        _, calls = self.run_hybrid(second_failure=ProviderError("quota_exceeded", "Synthetic second-pass failure"))
        self.assertEqual(len(calls), 2)

    def test_local_absent_or_silent_audio_vetoes_both_semantic_passes(self):
        for facts in ({"has_audio_stream": False}, {"audio_activity": False}):
            with self.subTest(facts=facts):
                fused, calls = self.run_hybrid(facts_override=facts)
                self.assertEqual(len(calls), 2)
                self.assertIsNone(fused["presentation"]["assessment_sections"][0]["score_0_10"])
                self.assertIsNone(fused["presentation"]["overall_score_0_10"])
                semantic = fused["v6"]["section_d_semantic_evaluation"]
                self.assertFalse(semantic["model_observation"]["audio_reviewable"])
                self.assertFalse(semantic["rhythm_model_observation"]["audio_reviewable"])

    def test_private_rendition_preparation_downscales_and_strips_metadata(self):
        import subprocess
        with tempfile.TemporaryDirectory(prefix="studio-private-rendition-") as directory:
            root = Path(directory)
            original = root / "source.mov"
            rendition = root / "review.mp4"
            subprocess.run([
                "ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=1",
                "-metadata", "comment=SYNTHETIC_PRIVATE_METADATA", "-c:v", "libx264", "-threads", "1",
                "-preset", "ultrafast", "-crf", "30", "-y", str(original),
            ], check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.hybrid.prepare_semantic_copy(original, rendition)
            metadata = json.loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-show_entries", "stream=width,height,avg_frame_rate:format_tags",
                "-of", "json", str(rendition),
            ], timeout=10))
            self.assertLessEqual(max(metadata["streams"][0]["width"], metadata["streams"][0]["height"]), 480)
            self.assertEqual(metadata["streams"][0]["avg_frame_rate"], "6/1")
            self.assertNotIn("SYNTHETIC_PRIVATE_METADATA", json.dumps(metadata))
            self.assertLess(rendition.stat().st_size, 8 * 1024 * 1024)


class WorkerCancellationTests(unittest.TestCase):
    def test_cancellation_stops_the_worker_process_group(self):
        import time
        with tempfile.TemporaryDirectory(prefix="studio-cancel-test-") as directory:
            work = Path(directory)
            script = work / "slow_worker.py"
            script.write_text(
                "import json,subprocess,sys,time\n"
                "from pathlib import Path\n"
                "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'])\n"
                "Path('child.pid').write_text(str(child.pid))\n"
                "print(json.dumps({'kind':'stage','stage':'Preparing analysis rendition','progress':6}),flush=True)\n"
                "time.sleep(30)\n"
            )
            cancel = threading.Event()
            job = SimpleNamespace(lock=threading.RLock(), cancel_event=cancel, add_event=lambda *args, **kwargs: None)
            def request_cancellation():
                deadline = time.monotonic() + 3
                while not (work / "child.pid").exists() and time.monotonic() < deadline:
                    time.sleep(.01)
                cancel.set()
            timer = threading.Thread(target=request_cancellation)
            timer.start()
            try:
                self.assertIsNone(staged_jobs.worker_result(job, work, [str(script)], {"PATH": os.environ["PATH"]}, 5))
            finally:
                timer.join(timeout=4)
            pid = int((work / "child.pid").read_text())
            status = Path(f"/proc/{pid}/stat")
            self.assertTrue(not status.exists() or status.read_text().split()[2] == "Z", "A cancelled worker child remained active")


class DispatchConsentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import importlib.util
        cls.temporary = tempfile.TemporaryDirectory(prefix="studio-dispatch-test-")
        cls.addClassCleanup(cls.temporary.cleanup)
        isolate_research_service(cls)
        with patch.dict(os.environ, {"LOLIXCO_DNA_STATE_PARENT": cls.temporary.name, "GEMINI_API_KEY": "", "LOLIXCO_GEMINI_YOUTUBE": "0"}):
            spec = importlib.util.spec_from_file_location("studio_consent_service", ROOT / "scripts/local-dna/serve.py")
            cls.service = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.service)

    def test_age_restricted_video_is_rejected_before_job_dispatch(self):
        from fastapi.testclient import TestClient
        client = TestClient(self.service.app, base_url="http://127.0.0.1:5055",
                            headers={"x-lolixco-local-capability": self.service.capability})
        with patch.object(self.service, "studio_provider_status", return_value={"status":"connected","message":"Synthetic test"}), \
             patch.object(self.service, "official_metadata", return_value=({"privacy_status":"public","age_restricted":True}, [])), \
             patch.object(self.service.manager, "create_job") as create:
            response = client.post("/api/v8/youtube/start", json={"video_id":"jNQXAC9IVRw","consent":True})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error_code"], "video_unavailable")
        self.assertIn("age-restricted", response.json()["detail"])
        create.assert_not_called()
        client.close()

    def test_embed_disabled_public_video_can_still_dispatch(self):
        from fastapi.testclient import TestClient
        client = TestClient(self.service.app, base_url="http://127.0.0.1:5055",
                            headers={"x-lolixco-local-capability": self.service.capability})
        with patch.object(self.service, "studio_provider_status", return_value={"status":"connected","message":"Synthetic test"}), \
             patch.object(self.service, "official_metadata", return_value=({"privacy_status":"public","age_restricted":False,"embeddable":False}, [])), \
             patch.object(self.service.manager, "create_job", return_value=SimpleNamespace(job_id="job_1_abcdef")) as create:
            response = client.post("/api/v8/youtube/start", json={"video_id":"jNQXAC9IVRw","consent":True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(create.call_args.kwargs["semantic_consent"])
        client.close()

    def test_consent_is_set_before_the_job_reaches_its_executor(self):
        manager = self.service.local_service.AnalysisJobManager()
        observed = []
        with patch.object(manager.executor, "submit", side_effect=lambda function, job: observed.append(job.semantic_consent)):
            manager.create_job("/tmp/synthetic.mp4", semantic_consent=True)
            manager.create_job("/tmp/synthetic.mp4")
        self.assertEqual(observed, [True, False])
        manager.executor.shutdown()


if __name__ == "__main__":
    unittest.main()
