"""Route staged inputs through a killable worker while retaining the existing job API."""
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WORKER = Path(__file__).with_name("media_worker.py")
WALL_SECONDS = 100


def run_staged(job, report_root):
    started = time.monotonic()
    with job.lock:
        if job.cancel_event.is_set():
            return
        job.worker_active = True
        job.status = "RUNNING"
        job.current_stage = "Preparing local media worker"
    job.add_event("RUNNING", payload={"message": "Preparing local media worker"})
    try:
        with tempfile.TemporaryDirectory(prefix="worker-", dir=Path(job.media_path).parent) as tmp:
            work = Path(tmp)
            log_path = work / "events.ndjson"
            failure = None
            environment = {key: os.environ[key] for key in ("PATH", "HOME", "LANG") if key in os.environ}
            environment.update(PYTHONDONTWRITEBYTECODE="1", OMP_NUM_THREADS="1",
                               OPENBLAS_NUM_THREADS="1", NUMBA_NUM_THREADS="2")
            with log_path.open("wb") as output, log_path.open("rb") as records:
                process = subprocess.Popen(
                    [sys.executable, str(WORKER), job.media_path, job.job_id, job.quality_mode, tmp],
                    cwd=tmp, env=environment, stdout=output, stderr=subprocess.DEVNULL, start_new_session=True,
                )
                try:
                    while True:
                        if job.cancel_event.is_set():
                            return
                        if time.monotonic() - started > WALL_SECONDS:
                            raise TimeoutError("Local media analysis exceeded its 100-second time limit.")
                        offset = records.tell()
                        line = records.readline()
                        if line.endswith(b"\n"):
                            message = json.loads(line)
                            kind = message["kind"]
                            if kind in ("event", "stage"):
                                job.current_stage = message["stage"]
                                job.progress_percent = max(job.progress_percent, min(message["progress"], 99))
                            if kind == "event" and message["event_type"] != "RUNNING":
                                section = message["section_id"]
                                if section:
                                    job.progressive_sections[section] = message["payload"]
                                job.add_event(message["event_type"], section, message["payload"], message["duration_ms"])
                            if kind == "error":
                                failure = message["message"]
                            continue
                        if process.poll() is not None:
                            break
                        records.seek(offset)
                        time.sleep(.1)
                finally:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            if process.returncode != 0 or not (work / "result.json").is_file():
                raise RuntimeError(failure or "The media could not be analyzed within local worker limits.")
            if job.cancel_event.is_set():
                return
            result = json.loads((work / "result.json").read_text())
            v6 = result["v6"]
            v6["studio_media_id"] = Path(job.media_path).parent.name
            v6["quality_mode"] = job.quality_mode
            job.media_filename = v6["media_id"]
            with job.lock:
                if job.cancel_event.is_set():
                    return
                destination = Path(report_root) / job.job_id
                destination.mkdir(mode=0o700, exist_ok=True)
                for name, value in (("v6", v6), ("presentation", result["presentation"])):
                    report = destination / f"report_{name}.json"
                    report.write_text(json.dumps(value, allow_nan=False))
                    report.chmod(0o600)
                job.v6_report, job.presentation_report = v6, result["presentation"]
                job.duration_seconds = round(time.monotonic() - started, 2)
                job.completed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                job.current_stage = "Analysis complete"
                job.progress_percent = 100
                job.status = "COMPLETE"
            job.add_event("COMPLETE")
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as error:
        with job.lock:
            if job.cancel_event.is_set():
                return
            job.error = str(error) if isinstance(error, (RuntimeError, TimeoutError)) else "The local worker could not complete this media."
            job.current_stage = "Analysis failed"
            job.status = "FAILED"
        job.add_event("FAILED", payload={"error": job.error})
    finally:
        job.worker_active = False
