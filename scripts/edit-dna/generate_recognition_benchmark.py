#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — PERMISSIONED RECOGNITION BENCHMARK SYNTHESIZER
Generates a permissioned reference catalog and controlled query suite for:
- Anime / series / film visual source recognition (clean, cropped, high-contrast, mirrored, out-of-catalog).
- Music track recognition (clean, slowed+reverb, pitched / nightcore, dialogue-mixed, out-of-catalog).
Zero YouTube downloading, zero unlicensed material, zero external API calls.
"""

import os
import sys
import json
import math
import numpy as np
import cv2
import soundfile as sf
import librosa
from scipy.signal import convolve

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
OUTPUT_DIR = os.path.join(BASE_DIR, "test-assets", "recognition")
os.makedirs(OUTPUT_DIR, exist_ok=True)

SR = 22050
FPS = 24.0
WIDTH, HEIGHT = 640, 360


# ==============================================================================
# VISUAL ASSET SYNTHESIS
# ==============================================================================

def make_video_writer(path: str, fps: float = FPS, width: int = WIDTH, height: int = HEIGHT):
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    return cv2.VideoWriter(path, fourcc, fps, (width, height))


def generate_visual_references():
    print("Generating permissioned visual reference assets...")

    # Reference 1: JJK Shibuya / Toji sequence (dark crimson/black, vertical slashes, floating dark particles)
    p1 = os.path.join(OUTPUT_DIR, "ref_v1_jjk.mp4")
    out = make_video_writer(p1)
    for f in range(int(3.0 * FPS)):
        frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        # Deep charcoal background with subtle pulsing red gradient
        red_val = int(20 + 15 * math.sin(f * 0.2))
        frame[:, :] = [10, 5, red_val]
        # Diagonal / vertical high-contrast crimson slashes
        x_pos = int((f * 20) % (WIDTH + 100)) - 50
        cv2.line(frame, (x_pos, 0), (x_pos - 80, HEIGHT), (20, 20, 220), 12)
        # Silhouette block (representing character figure)
        cv2.rectangle(frame, (WIDTH // 2 - 40, HEIGHT // 3), (WIDTH // 2 + 40, HEIGHT), (5, 5, 5), -1)
        # Energy aura particles
        np.random.seed(f * 10)
        for _ in range(25):
            px = np.random.randint(WIDTH // 2 - 80, WIDTH // 2 + 80)
            py = np.random.randint(HEIGHT // 4, HEIGHT)
            cv2.circle(frame, (px, py), np.random.randint(2, 6), (15, 30, 240), -1)
        out.write(frame)
    out.release()

    # Reference 2: Spider-Man Across the Spider-Verse (halftone comic grid, chromatic aberration, vibrant magenta/cyan)
    p2 = os.path.join(OUTPUT_DIR, "ref_v2_spiderman.mp4")
    out = make_video_writer(p2)
    for f in range(int(3.0 * FPS)):
        frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        # Vibrant magenta background with animated chromatic grid
        frame[:, :] = [140, 20, 180]
        # Cyan geometric overlay
        offset = int(f * 6) % 40
        for y in range(0, HEIGHT, 40):
            cv2.line(frame, (0, y + offset), (WIDTH, y + offset), (220, 200, 20), 3)
        # Comic panel diagonal division
        cv2.line(frame, (0, 0), (WIDTH, HEIGHT), (20, 240, 255), 8)
        # Halftone dots
        for x in range(20, WIDTH, 30):
            for y in range(20, HEIGHT, 30):
                rad = int(3 + 2 * math.sin(f * 0.3 + (x + y) * 0.05))
                cv2.circle(frame, (x, y), max(1, rad), (255, 255, 255), -1)
        out.write(frame)
    out.release()

    # Reference 3: Attack on Titan / Rumbling (sepia clouds, orange steam, massive marching horizontal blocks)
    p3 = os.path.join(OUTPUT_DIR, "ref_v3_aot.mp4")
    out = make_video_writer(p3)
    for f in range(int(3.0 * FPS)):
        frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        # Sepia / burnt orange atmospheric sky
        frame[:, :] = [25, 80, 160]
        # Steam cloud gradient layers
        for y in range(HEIGHT // 2, HEIGHT):
            factor = (y - HEIGHT // 2) / (HEIGHT // 2)
            frame[y, :] = [int(15 + 40 * factor), int(50 + 60 * factor), int(120 + 80 * factor)]
        # Marching colossal silhouettes (horizontal march left-to-right)
        march_x = int(f * 4) % 150
        for i in range(-1, 5):
            bx = i * 150 + march_x
            cv2.rectangle(frame, (bx, HEIGHT // 3), (bx + 80, HEIGHT), (10, 15, 20), -1)
            cv2.circle(frame, (bx + 40, HEIGHT // 3), 25, (10, 15, 20), -1)
        out.write(frame)
    out.release()

    # Reference 4: Demon Slayer / Entertainment District (gold lightning sparks, cyan circular ribbon arcs)
    p4 = os.path.join(OUTPUT_DIR, "ref_v4_demon_slayer.mp4")
    out = make_video_writer(p4)
    for f in range(int(3.0 * FPS)):
        frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        # Midnight navy blue background
        frame[:, :] = [60, 15, 10]
        # Rotating golden lightning arcs
        angle = (f * 12) * (math.pi / 180.0)
        cx, cy = WIDTH // 2, HEIGHT // 2
        for r in range(40, 140, 25):
            x1 = int(cx + r * math.cos(angle + r))
            y1 = int(cy + r * math.sin(angle + r))
            x2 = int(cx - r * math.cos(angle - r))
            y2 = int(cy - r * math.sin(angle - r))
            cv2.line(frame, (x1, y1), (x2, y2), (20, 220, 255), 5)
        # Fast cyan ribbon particles
        for p_i in range(15):
            t = f * 0.15 + p_i * 0.4
            rx = int(cx + 180 * math.cos(t))
            ry = int(cy + 90 * math.sin(t * 1.5))
            cv2.circle(frame, (rx, ry), 8, (240, 220, 20), -1)
        out.write(frame)
    out.release()


def generate_visual_queries():
    print("Generating visual test query clips...")

    # Query V1: Clean 1.5s slice of JJK reference
    p_ref = os.path.join(OUTPUT_DIR, "ref_v1_jjk.mp4")
    p_q1 = os.path.join(OUTPUT_DIR, "q_v1_clean_jjk.mp4")
    cap = cv2.VideoCapture(p_ref)
    out = make_video_writer(p_q1)
    for _ in range(int(1.5 * FPS)):
        ret, frame = cap.read()
        if ret:
            out.write(frame)
    cap.release()
    out.release()

    # Query V2: Spider-Man with 15% center crop + 35% contrast boost
    p_ref = os.path.join(OUTPUT_DIR, "ref_v2_spiderman.mp4")
    p_q2 = os.path.join(OUTPUT_DIR, "q_v2_crop_contrast_spiderman.mp4")
    cap = cv2.VideoCapture(p_ref)
    out = make_video_writer(p_q2)
    crop_y = int(HEIGHT * 0.15)
    crop_x = int(WIDTH * 0.15)
    for _ in range(int(1.5 * FPS)):
        ret, frame = cap.read()
        if ret:
            cropped = frame[crop_y : HEIGHT - crop_y, crop_x : WIDTH - crop_x]
            resized = cv2.resize(cropped, (WIDTH, HEIGHT))
            # Contrast boost: alpha=1.35, beta=10
            contrasted = cv2.convertScaleAbs(resized, alpha=1.35, beta=10)
            out.write(contrasted)
    cap.release()
    out.release()

    # Query V3: Horizontally mirrored JJK clip
    p_ref = os.path.join(OUTPUT_DIR, "ref_v1_jjk.mp4")
    p_q3 = os.path.join(OUTPUT_DIR, "q_v3_mirrored_jjk.mp4")
    cap = cv2.VideoCapture(p_ref)
    out = make_video_writer(p_q3)
    for _ in range(int(1.5 * FPS)):
        ret, frame = cap.read()
        if ret:
            mirrored = cv2.flip(frame, 1)
            out.write(mirrored)
    cap.release()
    out.release()

    # Query V4: AoT clip with heavy cyan/teal color grade
    p_ref = os.path.join(OUTPUT_DIR, "ref_v3_aot.mp4")
    p_q4 = os.path.join(OUTPUT_DIR, "q_v4_color_graded_aot.mp4")
    cap = cv2.VideoCapture(p_ref)
    out = make_video_writer(p_q4)
    for _ in range(int(1.5 * FPS)):
        ret, frame = cap.read()
        if ret:
            # Shift B channel up, R channel down
            graded = frame.astype(np.float32)
            graded[:, :, 0] = np.clip(graded[:, :, 0] * 1.45 + 20, 0, 255)
            graded[:, :, 2] = np.clip(graded[:, :, 2] * 0.55, 0, 255)
            out.write(graded.astype(np.uint8))
    cap.release()
    out.release()

    # Query V5: Unknown Anime (Pastel watercolor floral garden - NOT in catalog) -> TARGET: ABSTAIN
    p_q5 = os.path.join(OUTPUT_DIR, "q_v5_unknown_anime.mp4")
    out = make_video_writer(p_q5)
    for f in range(int(1.5 * FPS)):
        frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        # Soft pastel mint green / pale lemon yellow background
        frame[:, :] = [180, 230, 210]
        # Gentle floating pastel flower petals (soft circles, low contrast)
        for i in range(20):
            fx = int((f * 3 + i * 45) % WIDTH)
            fy = int((f * 2 + i * 35) % HEIGHT)
            cv2.circle(frame, (fx, fy), 18, (170, 160, 250), -1)
            cv2.circle(frame, (fx, fy), 6, (220, 240, 255), -1)
        out.write(frame)
    out.release()

    # Query V6: Extreme distortion Spider-Man (45% crop + heavy blur sigma=15) -> STRESS TEST
    p_ref = os.path.join(OUTPUT_DIR, "ref_v2_spiderman.mp4")
    p_q6 = os.path.join(OUTPUT_DIR, "q_v6_distorted_spiderman.mp4")
    cap = cv2.VideoCapture(p_ref)
    out = make_video_writer(p_q6)
    crop_y = int(HEIGHT * 0.45)
    crop_x = int(WIDTH * 0.45)
    for _ in range(int(1.5 * FPS)):
        ret, frame = cap.read()
        if ret:
            cropped = frame[crop_y : HEIGHT - crop_y, crop_x : WIDTH - crop_x]
            resized = cv2.resize(cropped, (WIDTH, HEIGHT))
            blurred = cv2.GaussianBlur(resized, (31, 31), 15.0)
            out.write(blurred)
    cap.release()
    out.release()


# ==============================================================================
# AUDIO / MUSIC SYNTHESIS
# ==============================================================================

def generate_audio_references():
    print("Generating permissioned music reference tracks...")
    t = np.linspace(0, 8.0, int(8.0 * SR), endpoint=False)

    # Reference A1: NEON BLADE (Phonk / Synthwave, 130 BPM)
    # Fast cowbell arpeggios (523, 659, 783, 1046 Hz) + 808 sub bass (45 Hz) + rolling hi-hats
    bpm_130_step = int(SR * 60 / (130 * 4))  # 16th note steps
    cowbell_freqs = [523.25, 659.25, 783.99, 1046.50, 783.99, 659.25, 523.25, 392.00]
    phonk_sig = np.zeros_like(t)

    # 808 Sub-bass
    bass = 0.5 * np.sin(2 * np.pi * 46.25 * t)  # F#1
    # Distortion
    bass = np.tanh(bass * 2.5)

    # Cowbell lead
    lead = np.zeros_like(t)
    for i in range(0, len(t), bpm_130_step):
        step_idx = (i // bpm_130_step) % len(cowbell_freqs)
        freq = cowbell_freqs[step_idx]
        note_len = min(int(0.12 * SR), len(t) - i)
        note_t = np.linspace(0, 0.12, note_len, endpoint=False)
        envelope = np.exp(-note_t * 22)
        # Cowbell metallic partials
        bell = 0.4 * np.sin(2 * np.pi * freq * note_t) + 0.25 * np.sin(2 * np.pi * freq * 1.52 * note_t)
        lead[i : i + note_len] += bell * envelope

    phonk_sig = 0.5 * bass + 0.6 * lead
    phonk_sig = phonk_sig / (np.max(np.abs(phonk_sig)) + 1e-6)
    sf.write(os.path.join(OUTPUT_DIR, "ref_a1_phonk_neon.wav"), phonk_sig, SR)

    # Reference A2: family ties (Brass Trap, 134 BPM)
    # Staccato horn chords (F minor fanfare) + snappy snare triplets + 808 slide
    trap_sig = np.zeros_like(t)
    # Staccato horn stabs at beats 1, 2.5, 4
    horn_freqs = [174.61, 207.65, 261.63, 349.23]  # F minor triad
    beat_step = int(SR * 60 / 134)
    horns = np.zeros_like(t)
    for b in range(0, len(t), beat_step):
        stab_len = min(int(0.20 * SR), len(t) - b)
        st = np.linspace(0, 0.20, stab_len, endpoint=False)
        env = np.exp(-st * 10)
        chord = sum(np.sin(2 * np.pi * hf * st) for hf in horn_freqs) / len(horn_freqs)
        horns[b : b + stab_len] += 0.7 * chord * env

    trap_sig = horns + 0.4 * np.sin(2 * np.pi * 55.0 * t)
    trap_sig = trap_sig / (np.max(np.abs(trap_sig)) + 1e-6)
    sf.write(os.path.join(OUTPUT_DIR, "ref_a2_trap_family.wav"), trap_sig, SR)

    # Reference A3: Experience (Neo-classical Piano / Strings, 90 BPM)
    # Ascending piano triads (A minor arpeggio) + rich warm cello harmonic overtones
    piano_sig = np.zeros_like(t)
    p_notes = [220.0, 261.63, 329.63, 440.0, 523.25, 659.25]
    p_step = int(SR * 60 / (90 * 2))
    for i in range(0, len(t), p_step):
        idx = (i // p_step) % len(p_notes)
        freq = p_notes[idx]
        n_len = min(int(0.6 * SR), len(t) - i)
        nt = np.linspace(0, 0.6, n_len, endpoint=False)
        p_env = np.exp(-nt * 4.5)
        note = 0.5 * np.sin(2 * np.pi * freq * nt) + 0.25 * np.sin(2 * np.pi * freq * 2 * nt)
        piano_sig[i : i + n_len] += note * p_env

    # Cello cello drone
    cello = 0.3 * np.sin(2 * np.pi * 110.0 * t) + 0.2 * np.sin(2 * np.pi * 220.0 * t)
    cinematic_sig = 0.7 * piano_sig + cello
    cinematic_sig = cinematic_sig / (np.max(np.abs(cinematic_sig)) + 1e-6)
    sf.write(os.path.join(OUTPUT_DIR, "ref_a3_cinematic_exp.wav"), cinematic_sig, SR)

    # Reference A4: Past Lives (Ambient Slowed Dream-Pop, 75 BPM)
    # Reverberant minor-key synth pads and slow low-pass resonant filter sweep
    ambient_sig = np.zeros_like(t)
    pad_freqs = [196.0, 233.08, 293.66, 349.23]  # G minor 7th
    for pf in pad_freqs:
        ambient_sig += np.sin(2 * np.pi * pf * t)
    ambient_sig = ambient_sig / len(pad_freqs)
    # Slow LFO tremolo
    tremolo = 0.6 + 0.4 * np.sin(2 * np.pi * 0.4 * t)
    ambient_sig = ambient_sig * tremolo
    ambient_sig = ambient_sig / (np.max(np.abs(ambient_sig)) + 1e-6)
    sf.write(os.path.join(OUTPUT_DIR, "ref_a4_ambient_past.wav"), ambient_sig, SR)


def generate_audio_queries():
    print("Generating audio test query tracks...")

    # Query A1: Clean 4-second slice of NEON BLADE
    y, _ = sf.read(os.path.join(OUTPUT_DIR, "ref_a1_phonk_neon.wav"))
    sf.write(os.path.join(OUTPUT_DIR, "q_a1_clean_phonk.wav"), y[: int(4.0 * SR)], SR)

    # Query A2: NEON BLADE slowed to 0.85x speed with simulated reverb convolution
    # Slowing down 0.85x means stretching time by 1/0.85 = 1.176x and lowering pitch
    slow_len = int(len(y[: int(4.0 * SR)]) / 0.85)
    slowed = np.interp(
        np.linspace(0, int(4.0 * SR), slow_len),
        np.arange(int(4.0 * SR)),
        y[: int(4.0 * SR)]
    )
    # Simulated exponential decay reverb impulse response
    ir_len = int(0.4 * SR)
    ir_t = np.linspace(0, 0.4, ir_len)
    ir = np.exp(-ir_t * 9) * np.random.randn(ir_len)
    reverb_slowed = convolve(slowed, ir, mode="full")[:slow_len]
    reverb_slowed = 0.7 * slowed + 0.3 * (reverb_slowed / np.max(np.abs(reverb_slowed) + 1e-6))
    reverb_slowed = reverb_slowed / (np.max(np.abs(reverb_slowed)) + 1e-6)
    sf.write(os.path.join(OUTPUT_DIR, "q_a2_slowed_reverb_phonk.wav"), reverb_slowed, SR)

    # Query A3: family ties pitch-shifted up +2 semitones
    # Pitch shifting +2 semitones: frequency factor 2^(2/12) ~ 1.12246
    # Resample to shift pitch and time, then resample time back
    y2, _ = sf.read(os.path.join(OUTPUT_DIR, "ref_a2_trap_family.wav"))
    slice_4s = y2[: int(4.0 * SR)]
    pitch_factor = 2.0 ** (2.0 / 12.0)
    # Shift pitch via librosa.effects.pitch_shift
    pitched_up = librosa.effects.pitch_shift(slice_4s, sr=SR, n_steps=2.0)
    sf.write(os.path.join(OUTPUT_DIR, "q_a3_pitched_family.wav"), pitched_up, SR)

    # Query A4: Experience piano mixed with foreground dialogue/noise at 0 dB SNR
    y3, _ = sf.read(os.path.join(OUTPUT_DIR, "ref_a3_cinematic_exp.wav"))
    slice_exp = y3[: int(4.0 * SR)]
    # Synthesize vocal speech formant simulation (sawtooth pulses + formant filtering)
    t_v = np.linspace(0, 4.0, int(4.0 * SR), endpoint=False)
    voice_sig = np.sin(2 * np.pi * 180 * t_v) * (0.6 + 0.4 * np.sin(2 * np.pi * 3.5 * t_v))
    voice_sig += 0.3 * np.random.randn(len(t_v))
    voice_sig = voice_sig / np.max(np.abs(voice_sig))
    mixed = 0.5 * slice_exp + 0.5 * voice_sig
    mixed = mixed / np.max(np.abs(mixed))
    sf.write(os.path.join(OUTPUT_DIR, "q_a4_dialogue_mixed_exp.wav"), mixed, SR)

    # Query A5: Unknown Audio (Acoustic fingerstyle guitar in D major 3/4 time - NOT in catalog) -> TARGET: ABSTAIN
    t_unk = np.linspace(0, 4.0, int(4.0 * SR), endpoint=False)
    # D major triad arpeggio (293.66, 369.99, 440.0) in 3/4 waltz time (108 BPM)
    unk_step = int(SR * 60 / (108 * 2))
    unk_notes = [293.66, 369.99, 440.0, 587.33]
    unk_sig = np.zeros_like(t_unk)
    for i in range(0, len(t_unk), unk_step):
        idx = (i // unk_step) % len(unk_notes)
        freq = unk_notes[idx]
        nl = min(int(0.25 * SR), len(t_unk) - i)
        nt = np.linspace(0, 0.25, nl)
        env = np.exp(-nt * 8)
        unk_sig[i : i + nl] += np.sin(2 * np.pi * freq * nt) * env
    unk_sig = unk_sig / (np.max(np.abs(unk_sig)) + 1e-6)
    sf.write(os.path.join(OUTPUT_DIR, "q_a5_unknown_audio.wav"), unk_sig, SR)

    # Query A6: Extreme slowed 0.65x (beyond detection boundary stress test)
    slow_len_65 = int(len(slice_4s) / 0.65)
    slowed_65 = np.interp(
        np.linspace(0, len(slice_4s), slow_len_65),
        np.arange(len(slice_4s)),
        slice_4s
    )
    slowed_65 = slowed_65 / (np.max(np.abs(slowed_65)) + 1e-6)
    sf.write(os.path.join(OUTPUT_DIR, "q_a6_extreme_slowed_0_65x.wav"), slowed_65, SR)


def build_benchmark_manifest():
    manifest = {
        "benchmark_version": "1.0.0",
        "synthesized_at": "2026-11-02T16:00:00Z",
        "visual_references": [
            {"ref_id": "ref_v1_jjk", "title": "Jujutsu Kaisen: Shibuya Arc", "franchise": "Jujutsu Kaisen", "path": "test-assets/recognition/ref_v1_jjk.mp4"},
            {"ref_id": "ref_v2_spiderman", "title": "Spider-Man: Across the Spider-Verse", "franchise": "Spider-Man", "path": "test-assets/recognition/ref_v2_spiderman.mp4"},
            {"ref_id": "ref_v3_aot", "title": "Attack on Titan: The Rumbling", "franchise": "Attack on Titan", "path": "test-assets/recognition/ref_v3_aot.mp4"},
            {"ref_id": "ref_v4_demon_slayer", "title": "Demon Slayer: Entertainment District", "franchise": "Demon Slayer", "path": "test-assets/recognition/ref_v4_demon_slayer.mp4"},
        ],
        "audio_references": [
            {"ref_id": "ref_a1_phonk_neon", "title": "NEON BLADE", "artist": "MoonDeity", "path": "test-assets/recognition/ref_a1_phonk_neon.wav"},
            {"ref_id": "ref_a2_trap_family", "title": "family ties", "artist": "Baby Keem & Kendrick Lamar", "path": "test-assets/recognition/ref_a2_trap_family.wav"},
            {"ref_id": "ref_a3_cinematic_exp", "title": "Experience", "artist": "Ludovico Einaudi", "path": "test-assets/recognition/ref_a3_cinematic_exp.wav"},
            {"ref_id": "ref_a4_ambient_past", "title": "Past Lives", "artist": "BØRNS", "path": "test-assets/recognition/ref_a4_ambient_past.wav"},
        ],
        "test_queries": [
            {"query_id": "q_v1_clean_jjk", "modality": "visual", "path": "test-assets/recognition/q_v1_clean_jjk.mp4", "ground_truth_target": "ref_v1_jjk", "expected_status": "identified", "condition": "clean_cut"},
            {"query_id": "q_v2_crop_contrast_spiderman", "modality": "visual", "path": "test-assets/recognition/q_v2_crop_contrast_spiderman.mp4", "ground_truth_target": "ref_v2_spiderman", "expected_status": "identified", "condition": "15pct_crop_35pct_contrast"},
            {"query_id": "q_v3_mirrored_jjk", "modality": "visual", "path": "test-assets/recognition/q_v3_mirrored_jjk.mp4", "ground_truth_target": "ref_v1_jjk", "expected_status": "identified", "condition": "horizontal_mirror"},
            {"query_id": "q_v4_color_graded_aot", "modality": "visual", "path": "test-assets/recognition/q_v4_color_graded_aot.mp4", "ground_truth_target": "ref_v3_aot", "expected_status": "identified", "condition": "heavy_cyan_grade"},
            {"query_id": "q_v5_unknown_anime", "modality": "visual", "path": "test-assets/recognition/q_v5_unknown_anime.mp4", "ground_truth_target": None, "expected_status": "abstain", "condition": "out_of_catalog_unknown"},
            {"query_id": "q_v6_distorted_spiderman", "modality": "visual", "path": "test-assets/recognition/q_v6_distorted_spiderman.mp4", "ground_truth_target": None, "expected_status": "abstain", "condition": "extreme_distortion_stress_test"},
            {"query_id": "q_a1_clean_phonk", "modality": "audio", "path": "test-assets/recognition/q_a1_clean_phonk.wav", "ground_truth_target": "ref_a1_phonk_neon", "expected_status": "identified", "condition": "clean_slice"},
            {"query_id": "q_a2_slowed_reverb_phonk", "modality": "audio", "path": "test-assets/recognition/q_a2_slowed_reverb_phonk.wav", "ground_truth_target": "ref_a1_phonk_neon", "expected_status": "identified", "condition": "slowed_0.85x_with_reverb"},
            {"query_id": "q_a3_pitched_family", "modality": "audio", "path": "test-assets/recognition/q_a3_pitched_family.wav", "ground_truth_target": "ref_a2_trap_family", "expected_status": "identified", "condition": "pitched_plus_2_semitones"},
            {"query_id": "q_a4_dialogue_mixed_exp", "modality": "audio", "path": "test-assets/recognition/q_a4_dialogue_mixed_exp.wav", "ground_truth_target": "ref_a3_cinematic_exp", "expected_status": "identified", "condition": "mixed_with_dialogue_0db_snr"},
            {"query_id": "q_a5_unknown_audio", "modality": "audio", "path": "test-assets/recognition/q_a5_unknown_audio.wav", "ground_truth_target": None, "expected_status": "abstain", "condition": "out_of_catalog_unknown"},
            {"query_id": "q_a6_extreme_slowed_0_65x", "modality": "audio", "path": "test-assets/recognition/q_a6_extreme_slowed_0_65x.wav", "ground_truth_target": None, "expected_status": "abstain", "condition": "extreme_slowed_stress_test"},
        ]
    }
    manifest_path = os.path.join(OUTPUT_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"Benchmark manifest written to {manifest_path}")


def main():
    print("=== SYNTHESIZING EDIT DNA PERMISSIONED RECOGNITION BENCHMARK ===")
    generate_visual_references()
    generate_visual_queries()
    generate_audio_references()
    generate_audio_queries()
    build_benchmark_manifest()
    print("=== BENCHMARK SYNTHESIS COMPLETE ===")


if __name__ == "__main__":
    main()
