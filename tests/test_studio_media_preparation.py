"""Regression coverage for source-timeline preservation and wider decode support."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

LOCAL_DNA = Path(__file__).resolve().parents[1] / "scripts" / "local-dna"
sys.path.insert(0, str(LOCAL_DNA))
from media_preparation import prepare_analysis
from staged_media import MAX_BYTES, MAX_SECONDS, MediaValidationError, probe


def run_ffmpeg(*arguments):
    return subprocess.check_output(
        ["ffmpeg", "-v", "error", "-nostdin", "-threads", "1", "-filter_threads", "1", *arguments],
        stderr=subprocess.DEVNULL, timeout=40,
    )


class MediaPreparationTests(unittest.TestCase):
    def test_vfr_normalization_preserves_cut_and_audio_offset_without_touching_source(self):
        with tempfile.TemporaryDirectory(prefix="studio-timeline-") as directory:
            workspace = Path(directory)
            source = workspace / "variable-offset.mov"
            run_ffmpeg(
                "-f", "lavfi", "-i", "color=red:size=320x180:rate=30:duration=1",
                "-f", "lavfi", "-i", "color=blue:size=320x180:rate=30:duration=1",
                "-itsoffset", "0.2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2",
                "-filter_complex_threads", "1", "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1:a=0,select='if(lt(t,1),not(mod(n,2)),1)'[video]",
                "-map", "[video]", "-map", "2:a", "-fps_mode", "vfr", "-c:v", "libx264",
                "-preset", "ultrafast", "-c:a", "pcm_s16le", "-y", str(source),
            )
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            metadata = probe(source)
            normalized, facts = prepare_analysis(source, workspace, metadata)
            self.assertTrue(facts["variable_frame_timing"])
            self.assertEqual(facts["analysis_video_fps"], 60)
            self.assertAlmostEqual(facts["analysis_timing_resolution_ms"], 1000 / 60, places=3)
            raw = run_ffmpeg("-i", str(normalized), "-an", "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "pipe:1")
            frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 36, 64)
            differences = np.abs(np.diff(frames.astype(np.int16), axis=0)).mean(axis=(1, 2))
            cut_time = (int(np.argmax(differences)) + 1) / facts["analysis_video_fps"]
            self.assertAlmostEqual(cut_time, 1.0, delta=1 / 60)
            decoded = run_ffmpeg("-i", str(normalized), "-vn", "-ar", "22050", "-ac", "1", "-f", "f32le", "pipe:1")
            audio = np.frombuffer(decoded, dtype="<f4")
            first_audible = int(np.flatnonzero(np.abs(audio) > .005)[0]) / 22050
            self.assertAlmostEqual(first_audible, .2, delta=.01)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)
            self.assertLess(normalized.stat().st_size, 128 * 1024 * 1024)

    def test_full_hd_sixty_fps_is_accepted_and_downscaled_for_analysis(self):
        with tempfile.TemporaryDirectory(prefix="studio-fullhd-") as directory:
            workspace = Path(directory)
            source = workspace / "unseen-fullhd.mp4"
            run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=60:duration=1",
                       "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-threads", "2", "-y", str(source))
            metadata = probe(source)
            self.assertEqual((metadata["video"]["width"], metadata["video"]["height"]), (1920, 1080))
            normalized, facts = prepare_analysis(source, workspace, metadata)
            analysis = probe(normalized)
            self.assertEqual(facts["analysis_video_fps"], 60)
            self.assertLessEqual(max(analysis["video"]["width"], analysis["video"]["height"]), 640)
            self.assertLessEqual(source.stat().st_size, MAX_BYTES)
            self.assertLessEqual(metadata["duration"], MAX_SECONDS)

    def test_corrupt_input_has_a_specific_diagnostic(self):
        with tempfile.TemporaryDirectory(prefix="studio-corrupt-") as directory:
            source = Path(directory) / "corrupt.mp4"
            source.write_bytes(b"invalid media container")
            with self.assertRaises(MediaValidationError) as raised:
                probe(source)
            self.assertEqual(raised.exception.code, "media_probe_failed")
            self.assertNotIn(str(source), str(raised.exception))


if __name__ == "__main__":
    unittest.main()
