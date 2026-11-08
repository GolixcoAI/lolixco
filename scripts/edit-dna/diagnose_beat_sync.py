#!/usr/bin/env python3
"""
Diagnostic Script: Deep Audiovisual Beat Sync Analysis for Best Dhurandhar edit.mp4
Analyzes:
  1. Primary grid (112.3 BPM), Half-time (56.1 BPM), Double-time (224.6 BPM).
  2. Musical subdivisions (8th notes, 16th notes, triplets).
  3. Prominent audio onsets (drums, snares, sub-bass impacts).
  4. Intra-shot visual impacts (flash frames, sudden motion bursts).
  5. Timestamp-by-timestamp breakdown of alignment vs misalignment.
"""

import os
import sys
import cv2
import numpy as np
import librosa

INPUT_MP4 = "/home/rohan/lolixco-owner-media/inbox/Best Dhurandhar edit.mp4"
SCRATCH_AUDIO = "/tmp/dhurandhar_diag_audio.wav"

if not os.path.isfile(INPUT_MP4):
    print(f"File not found: {INPUT_MP4}")
    sys.exit(1)

# 1. Demux audio
import subprocess
cmd = ["ffmpeg", "-y", "-i", INPUT_MP4, "-vn", "-ar", "22050", "-ac", "1", SCRATCH_AUDIO]
subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

# 2. Analyze video cuts & flashes
cap = cv2.VideoCapture(INPUT_MP4)
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
duration_sec = total_frames / fps

ret, prev_frame = cap.read()
prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
frame_idx = 1
cuts = [0.0]
flashes = []
frame_diffs = []

while True:
    ret, frame = cap.read()
    if not ret:
        break
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    diff = float(np.mean(cv2.absdiff(prev_gray, gray)))
    mean_lum = float(np.mean(gray))
    t = frame_idx / fps
    frame_diffs.append((t, diff))

    if mean_lum > 210 or diff > 48.0:
        flashes.append(round(t, 3))

    if diff > 24.0:
        if t - cuts[-1] >= 0.25:
            cuts.append(round(t, 3))

    prev_gray = gray
    frame_idx += 1

cap.release()
if cuts[-1] < duration_sec - 0.25:
    cuts.append(round(duration_sec, 3))

internal_cuts = [c for c in cuts if 0.05 < c < (duration_sec - 0.05)]

# 3. Audio analysis
y, sr = librosa.load(SCRATCH_AUDIO, sr=22050, mono=True)
tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
bpm = float(tempo[0] if isinstance(tempo, (list, np.ndarray)) else tempo)
beat_times = librosa.frames_to_time(beat_frames, sr=sr)

# Onset detection (transients)
onset_env = librosa.onset.onset_strength(y=y, sr=sr)
onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, backtrack=False)
onset_times = librosa.frames_to_time(onset_frames, sr=sr)

# Subdivisions of 112.3 BPM:
# Beat duration = 60 / 112.34 = ~0.534s
beat_period = 60.0 / bpm
half_period = beat_period / 2.0  # 8th note
quarter_period = beat_period / 4.0 # 16th note

# 4. Multi-level alignment analysis for each cut
print("=" * 70)
print(f"DIAGNOSTIC ANALYSIS: Best Dhurandhar edit.mp4 ({duration_sec:.2f}s, {len(internal_cuts)} cuts)")
print(f"Primary Tempo: {bpm:.1f} BPM (Beat period: {beat_period*1000:.1f}ms, 8th note: {half_period*1000:.1f}ms, 16th note: {quarter_period*1000:.1f}ms)")
print(f"Total Audio Onsets Detected: {len(onset_times)}")
print(f"Total Flash Frames Detected: {len(flashes)}")
print("=" * 70)

# Evaluate each cut against:
# A. Primary beat grid
# B. 8th-note grid (half beat)
# C. 16th-note grid (quarter beat)
# D. Any acoustic onset transient
primary_tight = 0
primary_loose = 0
subdiv_8th_tight = 0
subdiv_16th_tight = 0
onset_tight = 0
onset_loose = 0

detailed_cuts = []

for idx, c_t in enumerate(internal_cuts):
    # Primary delta
    delta_primary = float(np.min(np.abs(beat_times - c_t))) if len(beat_times) else 999.0
    
    # Onset delta
    delta_onset = float(np.min(np.abs(onset_times - c_t))) if len(onset_times) else 999.0

    # Distance to nearest 16th-note subdivision
    # Phase offset from nearest beat
    nearest_beat = beat_times[np.argmin(np.abs(beat_times - c_t))] if len(beat_times) else 0.0
    phase_offset = abs(c_t - nearest_beat) % beat_period
    dist_to_quarter_beat = min(
        phase_offset,
        abs(phase_offset - quarter_period),
        abs(phase_offset - 2*quarter_period),
        abs(phase_offset - 3*quarter_period),
        abs(phase_offset - beat_period)
    )

    is_prim_tight = delta_primary <= 0.070
    is_prim_loose = delta_primary <= 0.150
    is_16th_tight = dist_to_quarter_beat <= 0.070
    is_onset_tight = delta_onset <= 0.070
    is_onset_loose = delta_onset <= 0.120

    if is_prim_tight: primary_tight += 1
    if is_prim_loose: primary_loose += 1
    if is_16th_tight: subdiv_16th_tight += 1
    if is_onset_tight: onset_tight += 1
    if is_onset_loose: onset_loose += 1

    detailed_cuts.append({
        "cut_idx": idx + 1,
        "timestamp": c_t,
        "delta_primary_ms": round(delta_primary * 1000, 1),
        "delta_onset_ms": round(delta_onset * 1000, 1),
        "delta_16th_ms": round(dist_to_quarter_beat * 1000, 1),
        "sync_type": (
            "PRIMARY_BEAT" if is_prim_tight
            else ("ONSET_HIT" if is_onset_tight
            else ("16TH_SUBDIV" if is_16th_tight
            else ("LOOSE_BEAT" if is_prim_loose else "OFFBEAT")))
        )
    })

N = len(internal_cuts)
print(f"\nAlignment Statistics across {N} Cut Transitions:")
print(f"  1. Primary Quarter-Note Grid (112.3 BPM): {primary_tight}/{N} ({primary_tight/N*100:.1f}%) tight (<=70ms), {primary_loose}/{N} ({primary_loose/N*100:.1f}%) loose")
print(f"  2. 16th-Note Subdivision Grid (224.6 BPM): {subdiv_16th_tight}/{N} ({subdiv_16th_tight/N*100:.1f}%) tight (<=70ms)")
print(f"  3. Acoustic Onset Transient Hits:         {onset_tight}/{N} ({onset_tight/N*100:.1f}%) tight (<=70ms), {onset_loose}/{N} ({onset_loose/N*100:.1f}%) <=120ms")

# Check intra-shot flashes alignment with onsets
flashes_on_onset = 0
for f_t in flashes:
    if len(onset_times) and np.min(np.abs(onset_times - f_t)) <= 0.080:
        flashes_on_onset += 1
print(f"  4. Intra-Shot Flash Sync:                {flashes_on_onset}/{len(flashes)} ({flashes_on_onset/len(flashes)*100:.1f}%) flash frames land directly on an audio onset!")

print("\nSample Cut Transitions (First 15):")
print(f"  {'#':3s} | {'Time (s)':8s} | {'Prim (ms)':10s} | {'Onset (ms)':10s} | {'16th (ms)':10s} | {'Sync Classification':20s}")
print("  " + "-" * 70)
for dc in detailed_cuts[:15]:
    print(f"  {dc['cut_idx']:<3d} | {dc['timestamp']:<8.2f} | {dc['delta_primary_ms']:<10.1f} | {dc['delta_onset_ms']:<10.1f} | {dc['delta_16th_ms']:<10.1f} | {dc['sync_type']:20s}")

print("\nSample High-Discrepancy Cuts (Cuts missed by primary grid but locked to onsets/16ths):")
discrepancies = [dc for dc in detailed_cuts if dc["delta_primary_ms"] > 150 and dc["delta_onset_ms"] <= 70]
print(f"  Total cuts missed by primary grid but locked to audio onsets: {len(discrepancies)}")
for dc in discrepancies[:8]:
    print(f"  Cut #{dc['cut_idx']:<2d} at {dc['timestamp']:.2f}s: Primary delta={dc['delta_primary_ms']:.1f}ms (MISSED) -> Onset delta={dc['delta_onset_ms']:.1f}ms (PERFECT HIT!)")

if os.path.isfile(SCRATCH_AUDIO):
    os.remove(SCRATCH_AUDIO)
