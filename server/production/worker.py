"""Isolated queue worker reusing the genuine six-dimension analysis pipeline."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import shutil

os.environ.update(HOME="/tmp", LOLIXCO_DNA_STATE_PARENT="/tmp", NUMBA_CACHE_DIR="/tmp/numba",
                  MPLCONFIGDIR="/tmp/matplotlib", OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1")
os.environ.update(NUMBA_CPU_NAME="generic", LOLIXCO_CLOUD_RUNTIME="1")
if Path('/opt/numba-cache').is_dir() and not Path('/tmp/numba').exists():
    shutil.copytree('/opt/numba-cache', '/tmp/numba')
os.environ["LOLIXCO_GEMINI_MAX_GENERATIONS"] = "2"
sys.path.insert(0, "/app/scripts/local-dna")
sys.path.insert(0, "/app/scripts/edit-dna")
from common import *
from persistent_local import LocalAnalyzer
LOCAL_ANALYZER = LocalAnalyzer()


class CancelEvent:
    def __init__(self, identity):
        self.identity, self.cancelled, self.checked = identity, False, 0

    def is_set(self):
        if time.monotonic() - self.checked > 2:
            row = get("JOB#" + self.identity)
            self.cancelled = not row or row.get("status") in {"CANCELLED", "FAILED"} or row.get("expires", 0) < time.time()
            self.checked = time.monotonic()
        return self.cancelled


class CloudJob:
    def __init__(self, row, path):
        self.row, self.job_id, self.media_path = row, row["job_id"], path
        self.lock = threading.RLock()
        self.cancel_event = CancelEvent(self.job_id)
        self.status, self.current_stage, self.progress_percent = "QUEUED", "Preparing media", 0
        self.events, self.progressive_sections = [], {}
        self.quality_mode, self.semantic_consent = "phase9", row["semantic_consent"]
        self.worker_active = False
        self.v6_report = self.presentation_report = None
        self.error = self.error_code = None
        self.report_ready = False
        self.sequence = 0
        self.phase_timings_ms = dict(row.get('phase_timings_ms', {}))
        self.phase, self.phase_start = 'worker_preparation', time.monotonic()

    def trace_stage(self, stage):
        phase = ('gemini_inference' if any(x in stage.lower() for x in ('gemini', 'consented', 'story')) else
                 'ffmpeg_preparation' if 'rendition' in stage.lower() else
                 'audio_analysis' if 'audio' in stage.lower() else
                 'visual_analysis' if 'video signals' in stage.lower() else
                 'scoring' if 'evaluating' in stage.lower() else
                 'report_preparation' if 'results' in stage.lower() else self.phase)
        if phase != self.phase:
            self.phase_timings_ms[self.phase] = self.phase_timings_ms.get(self.phase, 0) + round((time.monotonic()-self.phase_start)*1000)
            self.phase, self.phase_start = phase, time.monotonic()

    def add_event(self, event_type, section_id=None, payload=None, duration_ms=0):
        self.trace_stage(self.current_stage)
        self.sequence += 1
        self.events.append({"seq": self.sequence, "event_type": event_type, "section_id": section_id, "payload": payload or {}})
        self.events = self.events[-30:]
        self.persist()

    def persist(self):
        preparing = self.status == "COMPLETE" and not self.report_ready
        values = json.loads(json.dumps({"status": "RUNNING" if preparing else self.status, "current_stage": "Preparing report" if preparing else self.current_stage,
            "progress_percent": min(99, self.progress_percent) if preparing else self.progress_percent, "events": self.events, "error": self.error,
            "error_code": self.error_code, "updated_at": int(time.time()), "phase_timings_ms": self.phase_timings_ms,
            "result_status": "complete" if self.presentation_report and self.presentation_report.get("overall_score_0_10") is not None else "partial"}, default=json_default), parse_float=Decimal)
        names = {"#" + k: k for k in values}
        expression = "SET " + ", ".join("#" + k + " = :" + k for k in values)
        try:
            TABLE.update_item(Key={"pk": self.row["pk"]}, UpdateExpression=expression,
                ConditionExpression="attribute_exists(pk) AND #status IN (:running, :queued)",
                ExpressionAttributeNames=names, ExpressionAttributeValues={**{":" + k: v for k, v in values.items()}, ":running": "RUNNING", ":queued": "QUEUED"})
        except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
            self.cancel_event.cancelled = True


def process(row):
    started = time.monotonic()
    if not row.get('youtube_video_id'):
        LOCAL_ANALYZER.start()
    from staged_media import probe, MediaValidationError
    from staged_jobs import run_analysis
    timings = {'worker_imports': round((time.monotonic()-started)*1000),
               'queue_wait': max(0, (int(row.get('worker_started',time.time()))-int(row['created']))*1000)}
    def timed(name, operation):
        begin = time.monotonic()
        result = operation()
        timings[name] = round((time.monotonic()-begin)*1000)
        return result
    with tempfile.TemporaryDirectory(prefix="lolixco-") as directory:
        root = Path(directory)
        staging, reports, work = root / "media", root / "reports", root / "work"
        for folder in (staging, reports, work):
            folder.mkdir(mode=0o700)
        remote = row.get("youtube_video_id")
        if row["semantic_consent"]:
            from aws_provider_secrets import load_aws_configuration
            timed('provider_credentials', lambda: load_aws_configuration(os.environ["LOLIXCO_PROVIDER_SECRET_ARN"], os.environ))
        else:
            for key in ("GEMINI_API_KEY", "YOUTUBE_API_KEY", "GOOGLE_API_KEY"):
                os.environ.pop(key, None)
        if remote:
            from youtube_reference import official_metadata, duration_seconds
            metadata, _ = official_metadata(remote)
            seconds = duration_seconds(metadata.get("duration_iso8601"))
            if metadata.get("availability") == "unavailable" or metadata.get("age_restricted") or seconds is None or seconds > 120:
                raise MediaValidationError("video_unavailable", "Choose an accessible public YouTube video no longer than two minutes.")
            source = "https://www.youtube.com/watch?v=" + remote
        else:
            media = owned("MEDIA", row["media_id"], row["owner"])
            folder = staging / row["media_id"]
            folder.mkdir(mode=0o700)
            source = folder / "input.mp4"
            current = S3.head_object(Bucket=BUCKET, Key=row["media_key"])
            if not 0 < current["ContentLength"] <= MAX_BYTES or current["ContentLength"] != row["media_size"]:
                raise MediaValidationError("media_size_limit", "The uploaded object is invalid or oversized.")
            # Pin the downloaded version to the HEAD ETag to prevent upload races.
            download_start = time.monotonic()
            obj = S3.get_object(Bucket=BUCKET, Key=row["media_key"], IfMatch=current["ETag"])
            size = 0
            with obj["Body"] as stream, source.open("wb") as output:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise MediaValidationError("media_size_limit", "The uploaded object is oversized.")
                    output.write(chunk)
            # Lambda demand-loads image pages; the first FFprobe launch needs a
            # larger cold-start allowance than the already-installed local tool.
            timings['media_download'] = round((time.monotonic()-download_start)*1000)
            facts = timed('ffprobe', lambda: probe(source, timeout=45))
            manifest = {**facts, "name": media["name"], "stored_name": "input.mp4", "size": size,
                        "id": row["media_id"], "created_at": int(time.time())}
            (folder / "manifest.json").write_text(json.dumps(manifest))
        row['phase_timings_ms'] = timings
        job = CloudJob(row, str(source))
        if not remote: job.local_worker = LOCAL_ANALYZER
        run_analysis(job, reports, work, staging)
        if not job.cancel_event.is_set() and job.status == "COMPLETE":
            job.trace_stage('Preparing results')
            persistence_start = time.monotonic()
            for name, value in (("v6", job.v6_report), ("presentation", job.presentation_report)):
                S3.put_object(Bucket=BUCKET, Key="reports/" + row["job_id"] + "/" + name + ".json",
                    Body=json.dumps(value, allow_nan=False).encode(), ContentType="application/json", ServerSideEncryption="AES256")
            job.report_ready = True
            job.phase_timings_ms['report_persistence'] = round((time.monotonic()-persistence_start)*1000)
            job.phase_timings_ms[job.phase] = job.phase_timings_ms.get(job.phase,0) + round((time.monotonic()-job.phase_start)*1000)
            job.persist()
        else:
            job.persist()
        # No user paths, filenames, report text, keys or raw upstream diagnostics.
        print(json.dumps({"event": "analysis_finished", "status": job.status,
                          "seconds": round(time.monotonic() - started, 2), "semantic": row["semantic_consent"], "phase_timings_ms": job.phase_timings_ms}))


def handler(event, context):
    failures = []
    for record in event.get("Records", []):
        job_id = None
        try:
            job_id = json.loads(record["body"])["job_id"]
            if not JOB_ID.fullmatch(job_id):
                continue
            row = get("JOB#" + job_id)
            if not row or row["status"] in TERMINAL:
                continue
            # Acquire once; a retry cannot repeat paid provider inference.
            try:
                TABLE.update_item(Key={"pk": row["pk"]}, UpdateExpression="SET #s = :running, worker_started = :now, current_stage = :stage",
                    ConditionExpression="#s = :queued", ExpressionAttributeNames={"#s": "status"},
                    ExpressionAttributeValues={":running": "RUNNING", ":queued": "QUEUED", ":now": int(time.time()), ":stage": "Validating uploaded media"})
            except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
                continue
            row["worker_started"] = int(time.time())
            process(row)
        except Exception as error:
            if job_id and JOB_ID.fullmatch(job_id):
                code = getattr(error, "code", "temporarily_unavailable")
                allowed = {"duration_limit", "media_probe_failed", "media_probe_timeout", "no_media_stream", "video_unavailable", "media_size_limit", "resource_limit", "decoder_missing", "audio_resource_limit"}
                if code not in allowed:
                    code = "temporarily_unavailable"
                TABLE.update_item(Key={"pk": "JOB#" + job_id},
                    UpdateExpression="SET #s = :failed, #e = :message, error_code = :code, current_stage = :stage",
                    ConditionExpression="attribute_exists(pk) AND #s <> :cancelled",
                    ExpressionAttributeNames={"#s": "status", "#e": "error"},
                    ExpressionAttributeValues={":failed": "FAILED", ":message": "This media could not be analyzed within the supported beta limits.", ":code": code, ":stage": "Analysis failed", ":cancelled": "CANCELLED"})
            print(json.dumps({"event": "analysis_failed", "code": "bounded_worker_failure", "class": type(error).__name__,
                "operation": getattr(error, "operation_name", None),
                "aws_code": getattr(error, "response", {}).get("Error", {}).get("Code")}))
        finally:
            if LOCAL_ANALYZER.process and not LOCAL_ANALYZER.idle: LOCAL_ANALYZER.close()
            if job_id and JOB_ID.fullmatch(job_id):
                try:
                    TABLE.update_item(Key={"pk": "JOB#" + job_id}, UpdateExpression="SET worker_finished = :yes",
                        ConditionExpression="attribute_exists(pk)", ExpressionAttributeValues={":yes": True})
                except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
                    pass
    return {"batchItemFailures": failures}
