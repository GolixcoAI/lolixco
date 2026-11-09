"""Synthetic subprocess checks; no providers, AWS calls or submitted media."""
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server/production'))
from persistent_local import LocalAnalyzer


class WorkerError(Exception):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


FAKE = """
import json, os, pathlib, sys
print(json.dumps({'kind':'ready'}), flush=True)
for line in sys.stdin:
    request=json.loads(line)
    result={'pid':os.getpid(),'provider_keys_present':any(k in os.environ for k in ('GEMINI_API_KEY','YOUTUBE_API_KEY','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN'))}
    pathlib.Path(request['work'],'result.json').write_text(json.dumps(result))
    print(json.dumps({'kind':'finished','ok':True}), flush=True)
"""


class PersistentLocalTests(unittest.TestCase):
    def setUp(self):
        self.module = patch.dict(sys.modules, staged_jobs=types.SimpleNamespace(WorkerError=WorkerError, publish_worker_message=Mock()))
        self.module.start()
        self.worker = LocalAnalyzer([sys.executable,'-u','-c',FAKE])
        self.job = types.SimpleNamespace(job_id='synthetic', cancel_event=Mock())
        self.job.cancel_event.is_set.return_value = False

    def tearDown(self):
        self.worker.close()
        self.module.stop()

    def test_reuses_libraries_without_inheriting_provider_or_cloud_credentials(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, GEMINI_API_KEY='synthetic', YOUTUBE_API_KEY='synthetic', AWS_SECRET_ACCESS_KEY='synthetic', AWS_SESSION_TOKEN='synthetic'):
            work=Path(folder)
            first=self.worker.run(self.job,work,['synthetic-worker',str(work/'synthetic.mp4')],5)
            second=self.worker.run(self.job,work,['synthetic-worker',str(work/'synthetic.mp4')],5)
            self.assertEqual(first['pid'],second['pid'])
            self.assertFalse(first['provider_keys_present'])
            self.assertTrue(self.worker.idle)
            self.worker.run(self.job,work,['synthetic-worker','synthetic.mp4'],5)
            fourth=self.worker.run(self.job,work,['synthetic-worker','synthetic.mp4'],5)
            self.assertNotEqual(first['pid'],fourth['pid'])

    def test_cancellation_kills_process_and_allows_a_fresh_retry(self):
        self.job.cancel_event.is_set.return_value = True
        with tempfile.TemporaryDirectory() as folder:
            result=self.worker.run(self.job,Path(folder),['synthetic-worker','synthetic.mp4'],5)
        self.assertIsNone(result)
        self.assertIsNone(self.worker.process)

    def test_timeout_kills_a_hung_child(self):
        self.worker.command=[sys.executable,'-u','-c','import time; time.sleep(30)']
        with tempfile.TemporaryDirectory() as folder, self.assertRaises(WorkerError) as failure:
            self.worker.run(self.job,Path(folder),['synthetic-worker','synthetic.mp4'],.2)
        self.assertEqual(failure.exception.code,'analysis_timeout')
        self.assertIsNone(self.worker.process)


if __name__ == '__main__':
    unittest.main()
