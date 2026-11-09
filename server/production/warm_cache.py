"""Build-time synthetic audio only; no provider calls, keys or owner media."""
import numpy as np
import librosa
import tempfile
import soundfile as sf

rate = 22050
audio = np.zeros(rate * 5, dtype=np.float32)
audio[::11025] = 0.8
envelope = librosa.onset.onset_strength(y=audio, sr=rate)
librosa.beat.beat_track(onset_envelope=envelope, sr=rate)
librosa.onset.onset_detect(onset_envelope=envelope, sr=rate)
librosa.feature.rms(y=audio)
with tempfile.TemporaryDirectory() as folder:
    path = folder + '/synthetic.wav'
    sf.write(path, audio, rate)
    samples, sr = librosa.load(path, sr=rate, mono=True)
    librosa.beat.beat_track(y=samples, sr=sr, units='frames')
    librosa.onset.onset_detect(y=samples, sr=sr, units='frames')
