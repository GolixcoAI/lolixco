"""Local-only security wrapper; imports research code read-only, never patches it."""
import asyncio,os,sys,secrets,re,time
import numpy as np
from pathlib import Path
import uvicorn
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
ROOT=Path('/home/rohan/Lolixco/scripts/edit-dna');INBOX=Path('/home/rohan/lolixco-owner-media/inbox').resolve()
state=Path.home()/'.lolixco-edit-dna';state.mkdir(mode=0o700,exist_ok=True);cap=state/'codex-local-bridge.token'
if not cap.exists():
 fd=os.open(cap,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(40))
cap.chmod(0o600);token=cap.read_text().strip()
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT))
import local_service
from staged_media import ID, StagedMedia
from staged_jobs import run_staged
from youtube_reference import inspect_reference

def json_values(value):
 """Normalize research NumPy scalars before event streaming or report export."""
 if isinstance(value, np.generic):
  return value.item()
 if isinstance(value, dict):
  return {key: json_values(item) for key, item in value.items()}
 if isinstance(value, list):
  return [json_values(item) for item in value]
 return value

class LocalPhase9Engine(local_service.Phase9QualityEngine):
 def evaluate_full_edit_quality(self, *args, **kwargs):
  return json_values(super().evaluate_full_edit_quality(*args, **kwargs))

local_service.Phase9QualityEngine = LocalPhase9Engine
app = local_service.app
app.user_middleware.clear()
staging = StagedMedia(state / "studio-media", local_service.job_manager)

ResearchEngine = local_service.AnalysisEngine

class StudioEngine(ResearchEngine):
 @staticmethod
 def execute_job(job):
  if Path(job.media_path).parent.parent == staging.root:
   run_staged(job, local_service.PRIVATE_JOBS_DIR)
  else:
   ResearchEngine.execute_job(job)

local_service.AnalysisEngine = StudioEngine

@app.on_event("startup")
async def start_cleanup():
 app.state.media_cleanup = asyncio.create_task(staging.sweep())

@app.on_event("shutdown")
async def stop_cleanup():
 app.state.media_cleanup.cancel()

app.add_api_route("/api/v8/media", staging.upload, methods=["POST"])
app.add_api_route("/api/v8/media/{media_id}", staging.playback, methods=["GET"])
app.add_api_route("/api/v8/media/{media_id}", staging.delete, methods=["DELETE"])

@app.post("/api/v8/media/{media_id}/start")
async def start_staged(media_id: str, request: Request):
 try:
  body = await request.json()
  mode = body.get("quality_mode") if isinstance(body, dict) and set(body) == {"quality_mode"} else None
 except ValueError:
  mode = None
 if mode not in ("phase8", "phase9"):
  raise HTTPException(400, "Select a supported analysis mode.")
 async with staging.lock:
  meta, path = staging.get(media_id)
  if staging.busy(path.parent):
   raise HTTPException(409, "This temporary file is already being analyzed.")
  job = local_service.job_manager.create_job(str(path), quality_mode=mode)
  job.media_filename = meta["name"]
 return {"job_id": job.job_id}

youtube_lock = asyncio.Lock()
youtube_last_request = 0.0

@app.post("/api/v8/youtube/reference")
async def youtube_reference(request: Request):
 global youtube_last_request
 try:
  body = await request.json()
  video_id = body.get("video_id") if isinstance(body, dict) and set(body) == {"video_id"} else None
 except ValueError:
  video_id = None
 if not isinstance(video_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
  raise HTTPException(400, "Enter a valid public YouTube URL.")
 if youtube_lock.locked() or time.monotonic() - youtube_last_request < 3:
  raise HTTPException(429, "Wait a moment before checking another YouTube reference.")
 async with youtube_lock:
  youtube_last_request = time.monotonic()
  return await run_in_threadpool(inspect_reference, video_id)

original_job_status = local_service.AnalysisJob.to_dict
def studio_job_status(job):
 result = original_job_status(job)
 result.pop("media_path", None)
 path = Path(job.media_path)
 media_id = path.parent.name if path.parent.parent == staging.root else (job.v6_report or {}).get("studio_media_id")
 if media_id:
  result["quality_mode"] = (job.v6_report or {}).get("quality_mode", job.quality_mode)
  try:
   meta, _ = staging.get(media_id)
   result["staged_media"] = {"id": media_id, "name": meta["name"], "audio_only": not meta["video"]}
  except HTTPException:
   pass
 result["events"] = [
  {**event, "payload": {k:v for k,v in event["payload"].items() if k not in ("media_path","v6_path","presentation_path")}}
  for event in result["events"]
 ]
 return result

local_service.AnalysisJob.to_dict = studio_job_status

research_cancel = local_service.job_manager.cancel_job
def cancel_studio_job(job_id, reason=""):
 job = local_service.job_manager.get_job(job_id)
 if not job or Path(job.media_path).parent.parent != staging.root:
  return research_cancel(job_id, reason)
 with job.lock:
  if job.status not in ("RUNNING", "QUEUED"):
   return False
  job.cancel_event.set()
  job.status = "CANCELLED"
  job.current_stage = "Analysis cancelled"
 job.add_event("CANCELLED", payload={"message":"Analysis cancelled"})
 return True

local_service.job_manager.cancel_job = cancel_studio_job
@app.middleware('http')
async def local_guard(request:Request,call_next):
 if request.headers.get('host') not in ('127.0.0.1:5055','localhost:5055') or not secrets.compare_digest(request.headers.get('x-lolixco-local-capability',''),token):return JSONResponse({'detail':'Local development bridge required'},status_code=403)
 path = request.url.path
 readable = path in ('/api/v8/health', '/api/v8/inbox') or re.fullmatch(
  r'/api/v8/jobs/job_\d+_[a-f0-9]{6}(?:/events|/report/(?:v6|presentation))?', path)
 writable = path == '/api/v8/jobs/start' or re.fullmatch(r'/api/v8/jobs/job_\d+_[a-f0-9]{6}/cancel', path)
 media = re.fullmatch(rf'/api/v8/media/{ID}', path)
 readable = readable or media
 writable = writable or path in ('/api/v8/media', '/api/v8/youtube/reference') or re.fullmatch(rf'/api/v8/media/{ID}/start', path)
 if not (request.method == 'GET' and readable or request.method == 'POST' and writable
         or request.method == 'DELETE' and media):
  return JSONResponse({'detail':'Route unavailable in Creator Studio'},status_code=403)
 if request.method=='POST' and path=='/api/v8/jobs/start':
  try:
   body=await request.json();name=body.get('inbox_filename');candidate=INBOX/name if isinstance(name,str) else None
   if set(body)!={'inbox_filename','quality_mode'} or body['quality_mode'] not in ('phase8','phase9') or not name or Path(name).name!=name or candidate.resolve().parent!=INBOX or not candidate.is_file():raise ValueError()
  except Exception:return JSONResponse({'detail':'Choose an exact authorized inbox filename; select Phase 8 or Phase 9; arbitrary paths/overrides are disabled'},status_code=400)
 return await call_next(request)
if __name__=='__main__':uvicorn.run(app,host='127.0.0.1',port=5055,log_level='warning')
