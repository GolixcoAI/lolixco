"""Run each analysis in a killable worker and publish results atomically."""

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WORKERS = Path(__file__).resolve().parent
LOCAL_SECONDS = 100
REMOTE_SECONDS = 75
YOUTUBE_PREFIX = "https://www.youtube.com/watch?v="


class WorkerError(RuntimeError):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


def worker_result(job, work, arguments, environment, timeout):
    log_path = work / "events.ndjson"
    failure = None
    with log_path.open("wb") as output, log_path.open("rb") as records:
        process = subprocess.Popen(
            [sys.executable, *arguments], cwd=work, env=environment, stdout=output,
            stderr=subprocess.DEVNULL, start_new_session=True,
        )
        deadline = time.monotonic() + timeout
        try:
            while True:
                if job.cancel_event.is_set():
                    return None
                if time.monotonic() >= deadline:
                    message = "Gemini took too long to respond." if timeout == REMOTE_SECONDS else "Local analysis exceeded its 100-second time limit."
                    raise WorkerError(message, "temporarily_unavailable" if timeout == REMOTE_SECONDS else None)
                offset = records.tell()
                line = records.readline()
                if line.endswith(b"\n"):
                    message = json.loads(line)
                    kind = message["kind"]
                    if kind == "error":
                        failure = WorkerError(message["message"], message.get("code"))
                    elif kind in ("stage", "event"):
                        with job.lock:
                            if job.cancel_event.is_set():
                                return None
                            job.current_stage = message["stage"]
                            job.progress_percent = max(job.progress_percent, min(message["progress"], 99))
                            if kind == "stage":
                                job.add_event("STAGE", payload={"message": job.current_stage, "progress": job.progress_percent})
                            elif message["section_id"]:
                                section = message["section_id"]
                                job.progressive_sections[section] = message["payload"]
                                job.add_event(message["event_type"], section, message["payload"], message["duration_ms"])
                    continue
                if process.poll() is not None:
                    # Drain records flushed between the first read and the exit check.
                    records.seek(offset)
                    if not records.readline().endswith(b"\n"):
                        break
                records.seek(offset)
                time.sleep(.08)
        finally:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait()
    result_path = work / "result.json"
    if process.returncode or not result_path.is_file():
        raise failure or WorkerError("Analysis could not complete within the worker limits.")
    return json.loads(result_path.read_text())


def save_reports(root, job_id, result):
    with tempfile.TemporaryDirectory(prefix=".save-", dir=root) as workspace:
        destination = Path(workspace) / job_id
        destination.mkdir(mode=0o700)
        for key in ("v6", "presentation"):
            report = destination / f"report_{key}.json"
            with os.fdopen(os.open(report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
                json.dump(result[key], handle, allow_nan=False)
        destination.rename(root / job_id)


def run_analysis(job, report_root, work_root, staging_root):
    started = time.monotonic()
    with job.lock:
        if job.cancel_event.is_set():
            return
        job.worker_active = True
        job.status = "RUNNING"
        job.started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        job.current_stage = "Preparing media"
        job.add_event("RUNNING", payload={"message": job.current_stage})

    media_path = Path(job.media_path)
    is_remote = job.media_path.startswith(YOUTUBE_PREFIX)
    try:
        with tempfile.TemporaryDirectory(prefix="worker-", dir=work_root) as workspace:
            work = Path(workspace)
            environment = {key: os.environ[key] for key in ("PATH", "HOME", "LANG") if key in os.environ}
            environment.update(
                PYTHONDONTWRITEBYTECODE="1", OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1",
                NUMBA_NUM_THREADS="2", TMPDIR=workspace, LOLIXCO_DNA_STATE_PARENT=workspace,
            )
            if is_remote:
                # The opt-in worker receives only the dedicated server setting and credential.
                environment.update({
                    key: os.environ[key] for key in ("LOLIXCO_GEMINI_YOUTUBE", "GEMINI_API_KEY", "LOLIXCO_GEMINI_MODEL")
                    if key in os.environ
                })
                video_id = job.media_path.removeprefix(YOUTUBE_PREFIX)
                arguments = [str(WORKERS / "youtube_worker.py"), video_id]
                timeout = REMOTE_SECONDS
            elif media_path.parent.parent == staging_root:
                arguments = [str(WORKERS / "media_worker.py"), job.media_path, job.job_id, job.quality_mode, workspace]
                timeout = LOCAL_SECONDS
            else:
                raise WorkerError("This local file was not staged for analysis.")

            result = worker_result(job, work, arguments, environment, timeout)
            if result is None:
                return
            v6 = result["v6"]
            if is_remote:
                v6["youtube_video_id"] = video_id
            else:
                v6["studio_media_id"] = media_path.parent.name
            v6["quality_mode"] = job.quality_mode
            with job.lock:
                if job.cancel_event.is_set():
                    return
                save_reports(report_root, job.job_id, result)
                job.v6_report, job.presentation_report = v6, result["presentation"]
                job.duration_seconds = round(time.monotonic() - started, 2)
                job.completed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                if job.presentation_report.get("overall_score_0_10") is not None:
                    job.current_stage = "Analysis complete"
                else:
                    job.current_stage = "Analysis complete with partial evidence"
                job.progress_percent = 100
                job.status = "COMPLETE"
                job.add_event("COMPLETE")
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as error:
        with job.lock:
            if job.cancel_event.is_set():
                return
            job.error = str(error) if isinstance(error, WorkerError) else "The analysis worker could not complete this media."
            job.error_code = error.code if isinstance(error, WorkerError) else None
            if is_remote and job.error_code == "rate_limited":
                job.provider_retry_at = time.monotonic() + 30
            job.current_stage = "Analysis failed"
            job.status = "FAILED"
            job.add_event("FAILED", payload={"error": job.error, "error_code": job.error_code})
    finally:
        with job.lock:
            job.worker_active = False
