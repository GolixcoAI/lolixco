"""Private, bounded browser ingestion for the loopback service."""
import asyncio
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import time
from fractions import Fraction
from pathlib import Path
from urllib.parse import unquote

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

MAX_BYTES = 100 * 1024 * 1024
MAX_SECONDS = 120
TTL = 3600
MAX_ITEMS = 5
ID = r"[a-f0-9]{32}"
FORMATS = "mov,matroska,webm,mp3,wav,flac,ogg,aac"
VIDEO_CODECS = {"h264", "hevc", "vp8", "vp9", "av1", "mpeg4"}
AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", "flac", "alac", "pcm_s16le", "pcm_s24le", "pcm_f32le"}
EXTENSIONS = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".aac"}


def probe(path):
    raw = subprocess.check_output([
        "ffprobe", "-v", "error", "-max_streams", "8", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS,
        "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels:stream_disposition=attached_pic",
        "-of", "json", str(path),
    ], stderr=subprocess.DEVNULL, timeout=12)
    data = json.loads(raw)
    duration = float(data["format"]["duration"])
    if not math.isfinite(duration) or not 0 < duration <= MAX_SECONDS:
        raise ValueError(f"Duration must be between 0 and {MAX_SECONDS} seconds.")
    videos = [s for s in data["streams"] if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")]
    audio = [s for s in data["streams"] if s["codec_type"] == "audio"]
    if len(videos) > 1 or len(audio) > 1 or not (videos or audio):
        raise ValueError("Choose media with one video stream and/or one audio stream.")
    video = videos[0] if videos else None
    sound = audio[0] if audio else None
    if video:
        width, height = video["width"], video["height"]
        fps = float(Fraction(video["avg_frame_rate"]))
        if video["codec_name"] not in VIDEO_CODECS or not (0 < width * height <= 1920 * 1080 and max(width, height) <= 1920 and 0 < fps <= 60.1):
            raise ValueError("Video exceeds the supported codec, 1080p-equivalent resolution, or 60 fps limit.")
    if sound and (sound["codec_name"] not in AUDIO_CODECS or not 0 < int(sound["sample_rate"]) <= 96000 or not 0 < sound["channels"] <= 8):
        raise ValueError("Audio codec, sample rate or channel count is unsupported.")
    return {"duration": duration, "video": video, "audio": sound, "container": data["format"]["format_name"]}


class StagedMedia:
    def __init__(self, root, manager):
        self.root = root
        self.root.mkdir(mode=0o700, exist_ok=True)
        self.root.chmod(0o700)
        self.manager = manager
        self.lock = asyncio.Lock()
        self.receiving = set()

    def busy(self, directory):
        return any(Path(job.media_path).parent == directory
                   and (job.status in ("QUEUED", "RUNNING") or getattr(job, "worker_active", False))
                   for job in list(self.manager.jobs.values()))

    def prune(self):
        now = time.time()
        for directory in self.root.iterdir():
            if directory.is_dir() and not directory.is_symlink() and re.fullmatch(ID, directory.name):
                if directory.name not in self.receiving and now - directory.stat().st_mtime >= TTL and not self.busy(directory):
                    shutil.rmtree(directory)

    async def sweep(self):
        while True:
            async with self.lock:
                self.prune()
            await asyncio.sleep(30)

    def get(self, media_id):
        if not re.fullmatch(ID, media_id) or media_id in self.receiving:
            raise HTTPException(404, "Temporary media unavailable.")
        folder = self.root / media_id
        try:
            meta = json.loads((folder / "manifest.json").read_text())
            path = folder / meta["stored_name"]
            if not path.is_file():
                raise FileNotFoundError()
        except (FileNotFoundError, ValueError, KeyError):
            raise HTTPException(404, "Temporary media unavailable.") from None
        return meta, path

    async def upload(self, request: Request):
        if request.headers.get("content-type") != "application/octet-stream":
            raise HTTPException(415, "Send the selected file as a binary upload.")
        name = unquote(request.headers.get("x-media-name", ""))
        suffix = Path(name).suffix.lower()
        if not name or len(name) > 180 or re.search(r"[/\\\x00-\x1f\x7f]", name) or suffix not in EXTENSIONS:
            raise HTTPException(415, "Choose a supported video or audio filename.")
        try:
            declared = int(request.headers.get("content-length", "0"))
        except ValueError:
            raise HTTPException(400, "Invalid upload length.") from None
        if declared > MAX_BYTES:
            raise HTTPException(413, "Local upload limit is 100 MiB.")
        media_id = secrets.token_hex(16)
        folder = self.root / media_id
        async with self.lock:
            self.prune()
            if self.receiving or sum(1 for item in self.root.iterdir() if re.fullmatch(ID, item.name)) >= MAX_ITEMS:
                raise HTTPException(429, "Local staging is full or receiving another file. Delete a temporary copy or retry.")
            folder.mkdir(mode=0o700)
            self.receiving.add(media_id)
        success = False
        try:
            path = folder / ("input" + suffix)
            count = 0
            with path.open("xb") as sink:
                path.chmod(0o600)
                try:
                    async with asyncio.timeout(45):
                        async for chunk in request.stream():
                            count += len(chunk)
                            if count > MAX_BYTES:
                                raise HTTPException(413, "Local upload limit is 100 MiB.")
                            sink.write(chunk)
                except TimeoutError:
                    raise HTTPException(408, "Local upload timed out.") from None
            if not count or (declared and count != declared):
                raise HTTPException(400, "The selected file was empty or incomplete.")
            try:
                facts = await run_in_threadpool(probe, path)
            except (ValueError, ZeroDivisionError) as error:
                message = str(error) if isinstance(error, ValueError) and str(error).endswith(".") else "Unsupported media metadata."
                raise HTTPException(422, message) from None
            except (KeyError, subprocess.SubprocessError, OSError):
                raise HTTPException(422, "The file could not be probed as supported video or audio.") from None
            meta = {"id": media_id, "name": name, "stored_name": path.name, "size_bytes": count, **facts}
            manifest = folder / "manifest.json"
            manifest.write_text(json.dumps(meta))
            manifest.chmod(0o600)
            success = True
            return {key: value for key, value in meta.items() if key != "stored_name"}
        finally:
            self.receiving.discard(media_id)
            if not success:
                shutil.rmtree(folder)

    async def playback(self, media_id: str):
        meta, path = self.get(media_id)
        return FileResponse(path, filename=meta["name"], content_disposition_type="inline",
                            headers={"Cache-Control": "private, no-store"})

    async def delete(self, media_id: str):
        async with self.lock:
            _, path = self.get(media_id)
            if self.busy(path.parent):
                raise HTTPException(409, "Cancel or finish the active job before deleting its media.")
            shutil.rmtree(path.parent)
        return {"deleted": True}
