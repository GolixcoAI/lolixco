"""Serve the Creator Studio subset of Edit DNA through a loopback-only bridge."""

import asyncio
import json
import os
import re
import secrets
import shutil
import sys
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

if __name__ == "__main__":
    from configuration import load_configuration
    load_configuration()

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "edit-dna"))
import local_service

from staged_media import MEDIA_LIMITS, StagedMedia
from staged_jobs import run_analysis
from youtube_analysis import provider_status
from youtube_reference import inspect_reference

STATE = local_service.PRIVATE_STATE_DIR
INBOX = Path(local_service.AUTHORIZED_INBOX).resolve()
REPORTS = Path(local_service.PRIVATE_JOBS_DIR)
WORK = STATE / "studio-work"
JOB_ID = re.compile(r"job_\d+_[a-f0-9]{6}")
YOUTUBE_ID = re.compile(r"[A-Za-z0-9_-]{11}")
LOCAL_ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"}
QUALITY_MODES = ("phase8", "phase9")
PROVIDER_HTTP = {"not_configured": 503, "rate_limited": 429, "unsupported": 422, "temporarily_unavailable": 503}

for directory in (STATE, REPORTS, WORK):
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)

capability_path = STATE / "codex-local-bridge.token"
try:
    capability_fd = os.open(capability_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    pass
else:
    with os.fdopen(capability_fd, "w") as token_file:
        token_file.write(secrets.token_urlsafe(40))
capability_path.chmod(0o600)
capability = capability_path.read_text().strip()
if not capability:
    raise RuntimeError("Local bridge capability is empty.")

manager = local_service.job_manager
staging = StagedMedia(STATE / "studio-media", manager)


class StudioEngine(local_service.AnalysisEngine):
    @staticmethod
    def execute_job(job):
        run_analysis(job, REPORTS, WORK, staging.root)


local_service.AnalysisEngine = StudioEngine


@asynccontextmanager
async def lifespan(_app):
    cleanup = asyncio.create_task(staging.sweep())
    yield
    cleanup.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup
    for job_id in list(manager.jobs):
        manager.cancel_job(job_id)
    manager.executor.shutdown(wait=True, cancel_futures=True)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def local_guard(request: Request, call_next):
    host = request.headers.get("host")
    origin = request.headers.get("origin")
    if (
        host not in ("127.0.0.1:5055", "localhost:5055")
        or origin is not None and origin not in LOCAL_ORIGINS
        or not secrets.compare_digest(request.headers.get("x-lolixco-local-capability", ""), capability)
    ):
        return JSONResponse({"detail": "Local development bridge required."}, status_code=403)
    job_path = request.url.path.removeprefix("/api/v8/jobs/").split("/", 1)[0]
    if request.url.path.startswith("/api/v8/jobs/") and job_path != "start" and not JOB_ID.fullmatch(job_path):
        return JSONResponse({"detail": "This analysis route is unavailable."}, status_code=404)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/v8/health")
def health():
    return {
        "status": "ok",
        "service": "lolixco-edit-dna",
        "version": "8.0.0",
        "max_concurrent_jobs": manager.max_concurrent,
        "max_queue_capacity": manager.MAX_QUEUE_CAPACITY,
        "media_limits": MEDIA_LIMITS,
        "provider": studio_provider_status(),
    }


@app.get("/api/v8/inbox")
def list_samples():
    files = staging.list_samples(INBOX)
    return {"total_files": len(files), "files": files}


app.add_api_route("/api/v8/media", staging.upload, methods=["POST"])
app.add_api_route("/api/v8/media/{media_id}", staging.playback, methods=["GET", "HEAD"])
app.add_api_route("/api/v8/media/{media_id}", staging.delete, methods=["DELETE"])


async def parse_body(request):
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > 4096:
            raise HTTPException(413, "The analysis request is too large.")
        content.extend(chunk)
    try:
        body = json.loads(content)
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise HTTPException(400, "Send a valid JSON object.")
    return body


def quality_mode(body, allowed_keys):
    if set(body) - allowed_keys or body.get("quality_mode", "phase9") not in QUALITY_MODES:
        raise HTTPException(400, "Select a supported analysis mode.")
    return body.get("quality_mode", "phase9")


@app.post("/api/v8/media/{media_id}/start")
async def start_staged(media_id: str, request: Request):
    mode = quality_mode(await parse_body(request), {"quality_mode"})
    async with staging.lock:
        meta, path = staging.get(media_id)
        if staging.busy(path.parent, include_cancelling=False):
            raise HTTPException(409, "This temporary file is already being analyzed.")
        job = manager.create_job(str(path), quality_mode=mode, media_filename=meta["name"])
    return {"job_id": job.job_id}


@app.post("/api/v8/jobs/start")
async def start_sample(request: Request):
    body = await parse_body(request)
    mode = quality_mode(body, {"quality_mode", "inbox_filename"})
    meta, path = await staging.stage_sample(INBOX, body.get("inbox_filename"))
    try:
        job = manager.create_job(str(path), quality_mode=mode, media_filename=meta["name"])
    except HTTPException:
        await staging.delete(meta["id"])
        raise
    return {"job_id": job.job_id}


youtube_lock = asyncio.Lock()
youtube_last_request = 0.0


def video_id_from(body):
    video_id = body.get("video_id")
    if not isinstance(video_id, str) or not YOUTUBE_ID.fullmatch(video_id):
        raise HTTPException(400, "Enter a valid public YouTube URL.")
    return video_id


@app.post("/api/v8/youtube/reference")
async def youtube_reference(request: Request):
    global youtube_last_request
    body = await parse_body(request)
    video_id = video_id_from(body)
    if set(body) != {"video_id"}:
        raise HTTPException(400, "Send a YouTube video ID.")
    if youtube_lock.locked() or time.monotonic() - youtube_last_request < 3:
        raise HTTPException(429, "Wait a moment before checking another YouTube reference.")
    async with youtube_lock:
        youtube_last_request = time.monotonic()
        return await run_in_threadpool(inspect_reference, video_id)


def studio_provider_status():
    now = time.monotonic()
    with manager.lock:
        limited = any(getattr(job, "provider_retry_at", 0) > now for job in manager.jobs.values())
    if limited:
        return {"status": "rate_limited", "message": "Gemini is rate-limited. Wait a moment before trying another public video."}
    return provider_status()


@app.post("/api/v8/youtube/start")
async def start_youtube(request: Request):
    body = await parse_body(request)
    video_id = video_id_from(body)
    if set(body) != {"video_id", "consent"} or body.get("consent") is not True:
        raise HTTPException(400, "Confirm that Gemini may process the public YouTube video.")
    provider = await run_in_threadpool(studio_provider_status)
    status = provider["status"]
    if status != "connected":
        return JSONResponse(
            {"detail": provider["message"], "error_code": status},
            status_code=PROVIDER_HTTP.get(status, 503),
        )
    url = f"https://www.youtube.com/watch?v={video_id}"
    job = manager.create_job(url, quality_mode="phase9", media_filename=f"YouTube video {video_id}")
    return {"job_id": job.job_id}


def studio_job_status(job_id: str):
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(404, "This analysis is unavailable.")
    result = job.to_dict()
    result.pop("media_path", None)
    report = job.v6_report or {}
    presentation = job.presentation_report or {}
    path = Path(job.media_path)
    media_id = path.parent.name if path.parent.parent == staging.root else report.get("studio_media_id")
    if isinstance(media_id, str):
        try:
            meta, _ = staging.get(media_id)
            result["staged_media"] = {"id": media_id, "name": meta["name"], "audio_only": not meta["video"]}
        except HTTPException:
            pass
    youtube_video_id = report.get("youtube_video_id") or job.media_path.removeprefix("https://www.youtube.com/watch?v=")
    if isinstance(youtube_video_id, str) and YOUTUBE_ID.fullmatch(youtube_video_id):
        result["youtube_video_id"] = youtube_video_id
    if job.status == "COMPLETE":
        result["result_status"] = "partial" if presentation.get("overall_score_0_10") is None else "complete"
        result["quality_mode"] = report.get("quality_mode", job.quality_mode)
    if getattr(job, "error_code", None):
        result["error_code"] = job.error_code
    return result


app.add_api_route("/api/v8/jobs/{job_id}", studio_job_status, methods=["GET"])
app.add_api_route("/api/v8/jobs/{job_id}/events", local_service.stream_job_events, methods=["GET"])


@app.post("/api/v8/jobs/{job_id}/cancel")
async def cancel_analysis(job_id: str):
    if not manager.cancel_job(job_id):
        raise HTTPException(409, "This analysis is already finished or unavailable.")
    return {"job_id": job_id, "status": "CANCELLED"}


app.add_api_route("/api/v8/jobs/{job_id}/report/v6", local_service.get_job_v6_report, methods=["GET"])
app.add_api_route("/api/v8/jobs/{job_id}/report/presentation", local_service.get_job_presentation_report, methods=["GET"])


@app.delete("/api/v8/jobs/{job_id}")
def delete_report(job_id: str):
    if not JOB_ID.fullmatch(job_id):
        raise HTTPException(404, "This analysis is unavailable.")
    with manager.lock:
        job = manager.get_job(job_id)
        if not job:
            raise HTTPException(404, "This analysis is unavailable.")
        with job.lock:
            if job.status in ("RUNNING", "QUEUED") or getattr(job, "worker_active", False):
                raise HTTPException(409, "Wait for the job to stop before deleting its report.")
            destination = REPORTS / job_id
            if destination.is_dir() and not destination.is_symlink():
                shutil.rmtree(destination)
            del manager.jobs[job_id]
    return {"deleted": True}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=5055, log_level="warning")
