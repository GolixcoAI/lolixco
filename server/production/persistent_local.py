"""A bounded, credential-free media subprocess cached in a Lambda environment.

It is idle between requests and freezes with Lambda. Cancellation kills the
process group. No workload or keepalive runs between invocations.
"""
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import threading
import time


class LocalAnalyzer:
    def __init__(self, command=None):
        self.command = command or [sys.executable, '/app/scripts/local-dna/cloud_local_worker.py']
        self.process = None
        self.messages = None
        self.idle = False
        self.jobs = 0

    def start(self):
        if self.process and self.process.poll() is None and self.jobs < 3:
            return
        self.close()
        env = {k: os.environ[k] for k in ('PATH','HOME','LANG') if k in os.environ}
        env.update(PYTHONDONTWRITEBYTECODE='1', OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1',
                   NUMBA_NUM_THREADS='2', NUMBA_CPU_NAME='generic', NUMBA_CACHE_DIR='/tmp/numba',
                   LOLIXCO_PERSISTENT_LOCAL='1', LOLIXCO_DNA_STATE_PARENT='/tmp')
        self.process = subprocess.Popen(self.command,
            cwd='/tmp', env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, start_new_session=True, bufsize=1)
        self.messages = messages = queue.Queue(maxsize=128)
        stream = self.process.stdout
        def read():
            for line in stream:
                try:
                    message = json.loads(line)
                    messages.put(message, timeout=1)
                except (ValueError, queue.Full):
                    continue
            messages.put({'kind':'exit'})
        self.reader = threading.Thread(target=read,daemon=True)
        self.reader.start()

    def close(self):
        if self.process:
            if self.process.poll() is None:
                try: os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            self.process.wait(timeout=5)
            self.reader.join(timeout=2)
            for stream in (self.process.stdin,self.process.stdout):
                stream.close()
        self.process, self.idle, self.jobs = None, False, 0

    def run(self, job, work, arguments, timeout):
        from staged_jobs import WorkerError, publish_worker_message
        self.start()
        self.idle = False
        started = time.monotonic()
        self.process.stdin.write(json.dumps({'work':str(work),'source':arguments[1],'job_id':job.job_id})+'\n')
        self.process.stdin.flush()
        try:
            while time.monotonic()-started < timeout:
                if job.cancel_event.is_set():
                    self.close()
                    return None
                try: message = self.messages.get(timeout=.1)
                except queue.Empty: continue
                if message['kind']=='ready':
                    continue
                if message['kind']=='finished':
                    self.jobs += 1
                    self.idle = True
                    if not message['ok']:
                        raise WorkerError('Media processing could not complete.',message.get('code'))
                    return json.loads((work/'result.json').read_text())
                if message['kind']=='exit':
                    raise WorkerError('The media worker stopped.', 'media_analysis_failed')
                error = publish_worker_message(job,message,arguments[0])
                if error: raise error
            raise WorkerError('Media processing exceeded its bounded time limit.','analysis_timeout')
        except Exception:
            self.close()
            raise
