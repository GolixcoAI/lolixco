"""Private stdin protocol. Reuse libraries, never user data or provider credentials."""
import gc
import json
import os
from pathlib import Path
import resource
import sys
import tempfile

resource.setrlimit(resource.RLIMIT_CPU, (475, 480))
import media_worker
import numpy as np
import librosa
import soundfile as sf

# Complete library initialization with deterministic synthetic audio. This can
# overlap the parent's S3/FFprobe work, without reading the submitted media.
with tempfile.TemporaryDirectory(prefix='library-init-') as folder:
    y = np.zeros(22050 * 5, dtype=np.float32)
    y[::11025] = .8
    path = Path(folder) / 'synthetic.wav'
    sf.write(path, y, 22050)
    samples, rate = librosa.load(path, sr=22050, mono=True)
    librosa.beat.beat_track(y=samples, sr=rate, units='frames')
    librosa.onset.onset_detect(y=samples, sr=rate, units='frames')
del y, samples
print(json.dumps({'kind': 'ready'}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    work = Path(request['work']).resolve()
    source = Path(request['source']).resolve()
    if not work.is_relative_to('/tmp') or not source.is_relative_to('/tmp') or not source.is_file():
        raise ValueError('Invalid private worker paths')
    try:
        os.chdir(work)
        media_worker.main(source, request['job_id'], 'phase9', work)
        print(json.dumps({'kind': 'finished', 'ok': True}), flush=True)
    except Exception as error:
        print(json.dumps({'kind': 'finished', 'ok': False, 'code': getattr(error,'code','media_analysis_failed')}), flush=True)
    finally:
        os.chdir('/tmp')
        media_worker.WorkerQualityEngine.facts = {}
        media_worker.research.PRIVATE_JOBS_DIR = ''
        gc.collect()
