"""Local-only security wrapper; imports research code read-only, never patches it."""
import os,sys,secrets,re
import numpy as np
from pathlib import Path
import uvicorn
from fastapi import Request
from fastapi.responses import JSONResponse
ROOT=Path('/home/rohan/Lolixco/scripts/edit-dna');INBOX=Path('/home/rohan/lolixco-owner-media/inbox').resolve()
state=Path.home()/'.lolixco-edit-dna';state.mkdir(mode=0o700,exist_ok=True);cap=state/'codex-local-bridge.token'
if not cap.exists():
 fd=os.open(cap,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(40))
cap.chmod(0o600);token=cap.read_text().strip()
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT))
import local_service

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
@app.middleware('http')
async def local_guard(request:Request,call_next):
 if request.headers.get('host') not in ('127.0.0.1:5055','localhost:5055') or not secrets.compare_digest(request.headers.get('x-lolixco-local-capability',''),token):return JSONResponse({'detail':'Local development bridge required'},status_code=403)
 path = request.url.path
 readable = path in ('/api/v8/health', '/api/v8/inbox') or re.fullmatch(
  r'/api/v8/jobs/job_\d+_[a-f0-9]{6}(?:/events|/report/(?:v6|presentation))?', path)
 writable = path == '/api/v8/jobs/start' or re.fullmatch(r'/api/v8/jobs/job_\d+_[a-f0-9]{6}/cancel', path)
 if not (request.method == 'GET' and readable or request.method == 'POST' and writable):
  return JSONResponse({'detail':'Route unavailable in Creator Studio'},status_code=403)
 if request.method=='POST' and path=='/api/v8/jobs/start':
  try:
   body=await request.json();name=body.get('inbox_filename');candidate=INBOX/name if isinstance(name,str) else None
   if set(body)!={'inbox_filename','quality_mode'} or body['quality_mode'] not in ('phase8','phase9') or not name or Path(name).name!=name or candidate.resolve().parent!=INBOX or not candidate.is_file():raise ValueError()
  except Exception:return JSONResponse({'detail':'Choose an exact authorized inbox filename; select Phase 8 or Phase 9; arbitrary paths/overrides are disabled'},status_code=400)
 return await call_next(request)
if __name__=='__main__':uvicorn.run(app,host='127.0.0.1',port=5055,log_level='warning')
