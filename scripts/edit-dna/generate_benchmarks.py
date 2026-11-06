#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — SYNTHETIC BENCHMARK ASSET GENERATOR
Generates 10 ground-truth video files covering varied editing styles,
rhythms, transitions, flash frames, audio anomalies, and silent media.
"""

import os
import json
import subprocess

BENCHMARK_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../test-assets/benchmarks")
)
os.makedirs(BENCHMARK_DIR, exist_ok=True)


def run_ffmpeg(args):
    cmd = ["ffmpeg", "-y"] + args
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {res.stderr.decode('utf-8')}")


def generate_benchmark_suite():
    benchmarks_meta = {}

    print(f"Generating 10 benchmark assets into: {BENCHMARK_DIR}")

    # -------------------------------------------------------------
    # 1. Clean Hard Cuts (6.0s, 30fps) - 5 cuts at t=1,2,3,4,5s. 120 BPM on-beat clicks.
    # -------------------------------------------------------------
    p1 = os.path.join(BENCHMARK_DIR, "bench_01_clean_hard_cuts.mp4")
    v_filter = (
        "color=c=red:s=640x360:d=1[v0];"
        "color=c=blue:s=640x360:d=1[v1];"
        "color=c=green:s=640x360:d=1[v2];"
        "color=c=yellow:s=640x360:d=1[v3];"
        "color=c=magenta:s=640x360:d=1[v4];"
        "color=c=cyan:s=640x360:d=1[v5];"
        "[v0][v1][v2][v3][v4][v5]concat=n=6:v=1:a=0[v];"
        "sine=f=800:d=6,volume='if(lt(mod(t,0.5),0.05),1.0,0.0)':eval=frame[a]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter,
        "-map", "[v]", "-map", "[a]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        p1
    ])
    benchmarks_meta["bench_01_clean_hard_cuts"] = {
        "file": p1,
        "filename": "bench_01_clean_hard_cuts.mp4",
        "description": "Standard clean anime/action cuts every 1.0s with 120 BPM on-beat percussion",
        "duration_seconds": 6.0,
        "fps": 30.0,
        "has_audio": True,
        "expected_cuts": [1.0, 2.0, 3.0, 4.0, 5.0],
        "expected_bpm": 120.0,
        "expected_beats": [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5],
        "expected_sync_classification": "tight",
        "notes": "Optimal baseline test: all cuts align with 0ms delta."
    }

    # -------------------------------------------------------------
    # 2. Offset Sync Cuts (6.0s, 30fps) - Cuts at t=1,2,3,4,5s. Beats offset by +120ms.
    # -------------------------------------------------------------
    p2 = os.path.join(BENCHMARK_DIR, "bench_02_offset_sync_cuts.mp4")
    v_filter_offset = (
        "color=c=red:s=640x360:d=1[v0];"
        "color=c=blue:s=640x360:d=1[v1];"
        "color=c=green:s=640x360:d=1[v2];"
        "color=c=yellow:s=640x360:d=1[v3];"
        "color=c=magenta:s=640x360:d=1[v4];"
        "color=c=cyan:s=640x360:d=1[v5];"
        "[v0][v1][v2][v3][v4][v5]concat=n=6:v=1:a=0[v];"
        "sine=f=800:d=6,volume='if(lt(mod(t-0.12,0.5),0.05),1.0,0.0)':eval=frame[a]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter_offset,
        "-map", "[v]", "-map", "[a]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        p2
    ])
    benchmarks_meta["bench_02_offset_sync_cuts"] = {
        "file": p2,
        "filename": "bench_02_offset_sync_cuts.mp4",
        "description": "Intentionally desynchronized cuts (beats land 120ms after each cut)",
        "duration_seconds": 6.0,
        "fps": 30.0,
        "has_audio": True,
        "expected_cuts": [1.0, 2.0, 3.0, 4.0, 5.0],
        "expected_bpm": 120.0,
        "expected_beats": [0.12, 0.62, 1.12, 1.62, 2.12, 2.62, 3.12, 3.62, 4.12, 4.62, 5.12, 5.62],
        "expected_sync_classification": "off_beat",
        "notes": "Stress test for sync scoring: cuts must be penalized for 120ms delta."
    }

    # -------------------------------------------------------------
    # 3. Fast Phonk Montage (4.0s, 30fps) - Rapid cuts every 0.267s (8 frames).
    # -------------------------------------------------------------
    p3 = os.path.join(BENCHMARK_DIR, "bench_03_fast_phonk_montage.mp4")
    colors = ["black", "white", "red", "blue", "green", "yellow", "purple", "orange",
              "white", "red", "blue", "cyan", "magenta", "black", "yellow"]
    v_parts = []
    con_parts = []
    for i, c in enumerate(colors):
        v_parts.append(f"color=c={c}:s=640x360:d=0.267[v{i}]")
        con_parts.append(f"[v{i}]")
    v_filter_fast = (
        ";".join(v_parts) + ";" + "".join(con_parts) + f"concat=n={len(colors)}:v=1:a=0[v];"
        "sine=f=120:d=4,volume='if(lt(mod(t,0.267),0.04),1.0,0.0)':eval=frame[a]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter_fast,
        "-map", "[v]", "-map", "[a]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        p3
    ])
    expected_phonk_cuts = [round((i + 1) * 0.267, 3) for i in range(len(colors) - 1)]
    benchmarks_meta["bench_03_fast_phonk_montage"] = {
        "file": p3,
        "filename": "bench_03_fast_phonk_montage.mp4",
        "description": "High-velocity phonk montage (8-frame cuts, ASL < 0.3s)",
        "duration_seconds": 4.0,
        "fps": 30.0,
        "has_audio": True,
        "expected_cuts": expected_phonk_cuts,
        "expected_bpm": 140.0,
        "expected_sync_classification": "tight",
        "notes": "Stress test for rapid pacing and high cut density."
    }

    # -------------------------------------------------------------
    # 4. Isolated Flash Frames (6.0s, 30fps) - 2 shots with 1-frame strobe flash in each.
    # -------------------------------------------------------------
    p4 = os.path.join(BENCHMARK_DIR, "bench_04_isolated_flash_frames.mp4")
    v_filter_flash = (
        "color=c=0x0a1a3a:s=640x360:d=1.0[v0];"
        "color=c=white:s=640x360:d=0.033[f1];"
        "color=c=0x0a1a3a:s=640x360:d=1.967[v1];"
        "color=c=0x3a0a0a:s=640x360:d=1.5[v2];"
        "color=c=white:s=640x360:d=0.033[f2];"
        "color=c=0x3a0a0a:s=640x360:d=1.467[v3];"
        "[v0][f1][v1][v2][f2][v3]concat=n=6:v=1:a=0[v];"
        "sine=f=440:d=6[a]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter_flash,
        "-map", "[v]", "-map", "[a]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        p4
    ])
    benchmarks_meta["bench_04_isolated_flash_frames"] = {
        "file": p4,
        "filename": "bench_04_isolated_flash_frames.mp4",
        "description": "2 scenes with single-frame white strobes at 1.0s and 4.5s",
        "duration_seconds": 6.0,
        "fps": 30.0,
        "has_audio": True,
        "expected_cuts": [3.0],
        "expected_flashes": [1.0, 4.5],
        "notes": "Tests detector resilience: naive detectors register 5 cuts; adaptive detector must detect 1 real cut."
    }

    # -------------------------------------------------------------
    # 5. Slow Emotional Takes (12.0s, 30fps) - 2 long takes, 1 cut at t=6.0s.
    # -------------------------------------------------------------
    p5 = os.path.join(BENCHMARK_DIR, "bench_05_slow_emotional_takes.mp4")
    v_filter_slow = (
        "color=c=0x1e3a3a:s=640x360:d=6[v0];"
        "color=c=0x3a2a1e:s=640x360:d=6[v1];"
        "[v0][v1]concat=n=2:v=1:a=0[v];"
        "sine=f=220:d=12,volume='if(lt(mod(t,2.0),0.1),0.6,0.1)':eval=frame[a]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter_slow,
        "-map", "[v]", "-map", "[a]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        p5
    ])
    benchmarks_meta["bench_05_slow_emotional_takes"] = {
        "file": p5,
        "filename": "bench_05_slow_emotional_takes.mp4",
        "description": "Slow emotional cinematography (ASL = 6.0s, CPS = 0.17)",
        "duration_seconds": 12.0,
        "fps": 30.0,
        "has_audio": True,
        "expected_cuts": [6.0],
        "expected_bpm": 60.0,
        "notes": "Verifies classification of slow emotional pace."
    }

    # -------------------------------------------------------------
    # 6. Dissolve Crossfades (6.0s, 30fps) - Smooth crossfades over 0.5s at t=2.0s and t=4.0s.
    # -------------------------------------------------------------
    p6 = os.path.join(BENCHMARK_DIR, "bench_06_dissolves_fades.mp4")
    v_filter_xfade = (
        "color=c=blue:s=640x360:d=2.5[v0];"
        "color=c=green:s=640x360:d=2.5[v1];"
        "color=c=red:s=640x360:d=2.0[v2];"
        "[v0][v1]xfade=transition=fade:duration=0.5:offset=2.0[xf1];"
        "[xf1][v2]xfade=transition=fade:duration=0.5:offset=4.0[v];"
        "sine=f=440:d=6[a]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter_xfade,
        "-map", "[v]", "-map", "[a]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        p6
    ])
    benchmarks_meta["bench_06_dissolves_fades"] = {
        "file": p6,
        "filename": "bench_06_dissolves_fades.mp4",
        "description": "Gradual crossfade/dissolve transitions (0.5s duration) without hard cuts",
        "duration_seconds": 6.0,
        "fps": 30.0,
        "has_audio": True,
        "expected_dissolves": [2.0, 4.0],
        "notes": "Tests detector behavior on gradual dissolves vs hard cuts."
    }

    # -------------------------------------------------------------
    # 7. Silent Video (5.0s, 30fps) - Hard cuts at t=1.5s, 3.0s, 4.2s. ZERO audio stream.
    # -------------------------------------------------------------
    p7 = os.path.join(BENCHMARK_DIR, "bench_07_silent_video.mp4")
    v_filter_silent = (
        "color=c=purple:s=640x360:d=1.5[v0];"
        "color=c=orange:s=640x360:d=1.5[v1];"
        "color=c=teal:s=640x360:d=1.2[v2];"
        "color=c=gray:s=640x360:d=0.8[v3];"
        "[v0][v1][v2][v3]concat=n=4:v=1:a=0[v]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter_silent,
        "-map", "[v]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        p7
    ])
    benchmarks_meta["bench_07_silent_video"] = {
        "file": p7,
        "filename": "bench_07_silent_video.mp4",
        "description": "Clean video cuts with no audio stream present in MP4 container",
        "duration_seconds": 5.0,
        "fps": 30.0,
        "has_audio": False,
        "expected_cuts": [1.5, 3.0, 4.2],
        "notes": "Tests graceful degradation: audio beats reported as absent without crashing."
    }

    # -------------------------------------------------------------
    # 8. Clipping Audio (5.0s, 30fps) - Cuts every 1.0s, extreme digital audio clipping.
    # -------------------------------------------------------------
    p8 = os.path.join(BENCHMARK_DIR, "bench_08_clipping_audio.mp4")
    v_filter_clip = (
        "color=c=black:s=640x360:d=1[v0];"
        "color=c=white:s=640x360:d=1[v1];"
        "color=c=black:s=640x360:d=1[v2];"
        "color=c=white:s=640x360:d=1[v3];"
        "color=c=black:s=640x360:d=1[v4];"
        "[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[v];"
        "sine=f=440:d=5,volume=20dB[a]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter_clip,
        "-map", "[v]", "-map", "[a]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        p8
    ])
    benchmarks_meta["bench_08_clipping_audio"] = {
        "file": p8,
        "filename": "bench_08_clipping_audio.mp4",
        "description": "Video with harsh digital clipping and high True Peak (>0 dBTP)",
        "duration_seconds": 5.0,
        "fps": 30.0,
        "has_audio": True,
        "expected_cuts": [1.0, 2.0, 3.0, 4.0],
        "expected_clipping": True,
        "notes": "Tests audio quality detector: must flag clipping detected."
    }

    # -------------------------------------------------------------
    # 9. Strobe Overload 15Hz (5.0s, 30fps) - 1s of alternating black/white frames at 15Hz.
    # -------------------------------------------------------------
    p9 = os.path.join(BENCHMARK_DIR, "bench_09_strobe_overload.mp4")
    strobe_frames = []
    for f in range(30):
        c = "white" if f % 2 == 0 else "black"
        strobe_frames.append(f"color=c={c}:s=640x360:d=0.0333[s{f}]")
    strobe_concat = "".join(f"[s{f}]" for f in range(30))
    v_filter_strobe = (
        "color=c=red:s=640x360:d=2.0[v0];"
        + ";".join(strobe_frames) + ";"
        "color=c=blue:s=640x360:d=2.0[v1];"
        f"[v0]{strobe_concat}[v1]concat=n=32:v=1:a=0[v];"
        "sine=f=440:d=5[a]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter_strobe,
        "-map", "[v]", "-map", "[a]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        p9
    ])
    benchmarks_meta["bench_09_strobe_overload"] = {
        "file": p9,
        "filename": "bench_09_strobe_overload.mp4",
        "description": "Extreme 15Hz strobe effect inside a scene (stress tests false positive cut rejection)",
        "duration_seconds": 5.0,
        "fps": 30.0,
        "has_audio": True,
        "expected_cuts": [2.0, 3.0],
        "notes": "Crucial test: checks if detector explodes with 30 false cuts or detects flash overload."
    }

    # -------------------------------------------------------------
    # 10. Varied Dynamic Pacing (8.0s, 30fps) - Slow start, rapid acceleration, slow release.
    # -------------------------------------------------------------
    p10 = os.path.join(BENCHMARK_DIR, "bench_10_varied_dynamic_pacing.mp4")
    v_filter_dynamic = (
        "color=c=0x112233:s=640x360:d=2.0[v0];"
        "color=c=0x332211:s=640x360:d=2.0[v1];"
        "color=c=0x551122:s=640x360:d=0.5[v2];"
        "color=c=0x225511:s=640x360:d=0.5[v3];"
        "color=c=0x112255:s=640x360:d=0.5[v4];"
        "color=c=0x444444:s=640x360:d=2.5[v5];"
        "[v0][v1][v2][v3][v4][v5]concat=n=6:v=1:a=0[v];"
        "sine=f=600:d=8,volume='if(eq(t,2.0)+eq(t,4.0)+eq(t,4.5)+eq(t,5.0)+eq(t,5.5),1.0,0.1)':eval=frame[a]"
    )
    run_ffmpeg([
        "-filter_complex", v_filter_dynamic,
        "-map", "[v]", "-map", "[a]",
        "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        p10
    ])
    benchmarks_meta["bench_10_varied_dynamic_pacing"] = {
        "file": p10,
        "filename": "bench_10_varied_dynamic_pacing.mp4",
        "description": "Dramatic pacing shift (buildup 2.0s -> rapid cuts 0.5s -> cooldown 2.5s)",
        "duration_seconds": 8.0,
        "fps": 30.0,
        "has_audio": True,
        "expected_cuts": [2.0, 4.0, 4.5, 5.0, 5.5],
        "notes": "Tests pacing variance and dynamic range of shot lengths."
    }

    # Save ground truth metadata
    gt_path = os.path.join(BENCHMARK_DIR, "ground_truth.json")
    with open(gt_path, "w", encoding="utf-8") as f:
        json.dump(benchmarks_meta, f, indent=2)

    print(f"Successfully generated all 10 benchmark assets and ground truth at: {gt_path}")


if __name__ == "__main__":
    generate_benchmark_suite()
