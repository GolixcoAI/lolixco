#!/usr/bin/env python3
"""
Lolixco Edit DNA — Media Capabilities and Stream Inspector
Performs rigorous upfront stream detection, format validation, and edge-case classification
before audio/video signal analysis or external provider calls.

Supported Edge Case Classifications:
  - NORMAL_AUDIOVISUAL: Usable video and audio streams present.
  - NO_AUDIO_STREAM: Video container contains zero audio tracks.
  - AUDIO_PRESENT_BUT_SILENT: Audio stream exists but energy is zero / imperceptible (RMS <= -60 dB).
  - NO_VIDEO_STREAM: Audio-only container (e.g. MP3, WAV, AAC) with zero video tracks.
  - VIDEO_STREAM_PRESENT_BUT_BLACK: Video stream is present but all frames are completely black (luma < 1.0).
  - VIDEO_PRESENT_BUT_STATIC: Video stream is present but has zero inter-frame movement (static image/slide).
  - SHORT_CLIP: Valid clip with total duration <= 1.0 seconds.
  - VERTICAL_SHORT: Portrait orientation (e.g. 9:16 Shorts/Reels).
  - MEDIA_UNSUPPORTED: Missing file, zero-byte file, unreadable container, corrupt bytes.
  - YOUTUBE_URL: Public YouTube watch, shorts, or youtu.be URL (cloud stream evaluation).
"""

import os
import json
import subprocess
from typing import Dict, Any, Optional, List
import cv2
import numpy as np


class MediaInspector:
    """
    Robust media probe utilizing ffprobe and OpenCV frame inspection.
    Enforces honest capability reporting without filename-based assumptions.
    """

    @classmethod
    def is_youtube_url(cls, target: str) -> bool:
        """Determines if the target string is a public YouTube URL."""
        if not target or not isinstance(target, str):
            return False
        t = target.strip().lower()
        return ("youtube.com/watch" in t or "youtu.be/" in t or "youtube.com/shorts/" in t)

    @classmethod
    def inspect(cls, target: str) -> Dict[str, Any]:
        """
        Inspects either a local media path or a public YouTube URL.
        Returns a comprehensive capability record.
        """
        if cls.is_youtube_url(target):
            return cls._inspect_youtube_url(target)
        return cls._inspect_local_file(target)

    @classmethod
    def _inspect_youtube_url(cls, url: str) -> Dict[str, Any]:
        """Inspects and classifies a public YouTube URL."""
        clean_url = url.strip()
        is_shorts = "shorts" in clean_url.lower()

        # Extract video ID
        vid = ""
        if "youtu.be/" in clean_url:
            vid = clean_url.split("youtu.be/")[1].split("?")[0].split("&")[0].split("/")[0]
        elif "shorts/" in clean_url:
            vid = clean_url.split("shorts/")[1].split("?")[0].split("&")[0].split("/")[0]
        elif "v=" in clean_url:
            vid = clean_url.split("v=")[1].split("&")[0].split("#")[0]

        canonical = f"https://www.youtube.com/watch?v={vid}" if vid else clean_url

        return {
            "media_target": clean_url,
            "canonical_target": canonical,
            "media_type": "youtube_url",
            "is_supported": bool(vid),
            "classification_tag": "YOUTUBE_SHORTS" if is_shorts else "YOUTUBE_WATCH",
            "capabilities": {
                "has_video_stream": True,
                "has_audio_stream": True,
                "is_remote_stream": True,
                "is_byte_stream_accessible": False,
                "is_shorts": is_shorts,
                "video_id": vid,
            },
            "supported_analyses": [
                "multimodal_semantic_recognition",
                "character_and_source_identification",
                "macro_pacing_and_chaptering_summary",
                "soundtrack_genre_and_audible_elements",
            ],
            "unsupported_analyses": {
                "beat_synchronization": "Raw audio waveform inaccessible in URL-only mode; beat delta distribution cannot be measured.",
                "visual_measurements": "Exact decoded video frame buffer inaccessible in URL-only mode; Laplacian sharpness and frame contrast cannot be measured.",
                "exact_cut_frequency": "Frame-accurate scene boundary differencing requires raw byte decoding.",
            },
        }

    @classmethod
    def _inspect_local_file(cls, file_path: str) -> Dict[str, Any]:
        """Inspects local media file bytes, streams, and physical signals."""
        if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
            return {
                "media_target": file_path,
                "media_type": "local_media",
                "is_supported": False,
                "classification_tag": "MEDIA_UNSUPPORTED",
                "error": "File does not exist or has 0 bytes.",
                "capabilities": {
                    "has_video_stream": False,
                    "has_audio_stream": False,
                    "duration_sec": 0.0,
                },
                "supported_analyses": [],
                "unsupported_analyses": {
                    "all": "Media file is absent, empty, or unreadable."
                },
            }

        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,duration,nb_frames,sample_rate,channels",
            "-of", "json",
            file_path,
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            return {
                "media_target": file_path,
                "media_type": "local_media",
                "is_supported": False,
                "classification_tag": "MEDIA_UNSUPPORTED",
                "error": f"FFprobe decoding failed: {res.stderr.strip()[:200]}",
                "capabilities": {
                    "has_video_stream": False,
                    "has_audio_stream": False,
                    "duration_sec": 0.0,
                },
                "supported_analyses": [],
                "unsupported_analyses": {
                    "all": "Container corrupted or unsupported codec."
                },
            }

        try:
            data = json.loads(res.stdout)
        except Exception as e:
            return {
                "media_target": file_path,
                "media_type": "local_media",
                "is_supported": False,
                "classification_tag": "MEDIA_UNSUPPORTED",
                "error": f"JSON parse error: {str(e)}",
                "capabilities": {"has_video_stream": False, "has_audio_stream": False, "duration_sec": 0.0},
                "supported_analyses": [],
                "unsupported_analyses": {"all": "Unparseable stream metadata"},
            }

        format_info = data.get("format", {})
        duration_sec = float(format_info.get("duration", 0.0) or 0.0)

        video_stream = None
        audio_stream = None
        for s in data.get("streams", []):
            if s.get("codec_type") == "video" and video_stream is None:
                video_stream = s
            elif s.get("codec_type") == "audio" and audio_stream is None:
                audio_stream = s

        has_video = video_stream is not None
        has_audio = audio_stream is not None

        if not has_video and not has_audio:
            return {
                "media_target": file_path,
                "media_type": "local_media",
                "is_supported": False,
                "classification_tag": "MEDIA_UNSUPPORTED",
                "error": "No audio or video streams found in container.",
                "capabilities": {"has_video_stream": False, "has_audio_stream": False, "duration_sec": duration_sec},
                "supported_analyses": [],
                "unsupported_analyses": {"all": "Empty stream multiplex"},
            }

        width = int(video_stream.get("width") or 0) if has_video else 0
        height = int(video_stream.get("height") or 0) if has_video else 0

        # Frame rate calculation
        fps = 30.0
        if has_video:
            r_rate = video_stream.get("r_frame_rate", "30/1")
            if "/" in r_rate:
                num, den = r_rate.split("/")
                fps = float(num) / float(den) if float(den) > 0 else 30.0
            else:
                fps = float(r_rate or 30.0)

        # Orientation & Aspect ratio
        orientation = "unknown"
        aspect_ratio = "unknown"
        if has_video and width > 0 and height > 0:
            if height > width:
                orientation = "portrait"
                aspect_ratio = "9:16" if abs(height / width - 16 / 9) < 0.1 else f"{width}:{height}"
            elif width > height:
                orientation = "landscape"
                aspect_ratio = "16:9" if abs(width / height - 16 / 9) < 0.1 else f"{width}:{height}"
            else:
                orientation = "square"
                aspect_ratio = "1:1"

        # Check visual characteristics if video stream is present
        is_black = False
        is_static = False
        if has_video:
            cap = cv2.VideoCapture(file_path)
            if cap.isOpened():
                frames = []
                for _ in range(12):
                    ret, frame = cap.read()
                    if not ret:
                        break
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    frames.append(gray)
                cap.release()

                if frames:
                    mean_lums = [float(np.mean(f)) for f in frames]
                    mean_contrasts = [float(np.std(f)) for f in frames]
                    if all(l < 1.0 for l in mean_lums) and all(c < 1.0 for c in mean_contrasts):
                        is_black = True
                    elif len(frames) >= 2:
                        diffs = [float(np.mean(cv2.absdiff(frames[i], frames[i - 1]))) for i in range(1, len(frames))]
                        if all(d < 0.05 for d in diffs):
                            is_static = True

        # Check acoustic characteristics if audio stream is present
        is_silent = False
        if has_audio:
            cmd_vol = [
                "ffmpeg", "-i", file_path, "-vn", "-af", "volumedetect",
                "-f", "null", "-",
            ]
            res_vol = subprocess.run(cmd_vol, capture_output=True, text=True)
            if "max_volume: -inf dB" in res_vol.stderr or "mean_volume: -inf dB" in res_vol.stderr:
                is_silent = True
            else:
                for line in res_vol.stderr.splitlines():
                    if "mean_volume:" in line:
                        try:
                            v = float(line.split("mean_volume:")[1].split("dB")[0].strip())
                            if v <= -60.0:
                                is_silent = True
                        except Exception:
                            pass

        # Formulate Primary Classification Tag
        if not has_video and has_audio:
            tag = "NO_VIDEO_STREAM"
        elif has_video and not has_audio:
            tag = "NO_AUDIO_STREAM"
        elif is_black:
            tag = "VIDEO_STREAM_PRESENT_BUT_BLACK"
        elif is_static:
            tag = "VIDEO_PRESENT_BUT_STATIC"
        elif is_silent:
            tag = "AUDIO_PRESENT_BUT_SILENT"
        elif duration_sec <= 1.0:
            tag = "SHORT_CLIP"
        elif orientation == "portrait":
            tag = "VERTICAL_SHORT"
        else:
            tag = "NORMAL_AUDIOVISUAL"

        supported_analyses = []
        unsupported_analyses = {}

        if has_video and not is_black:
            supported_analyses.extend(["cuts_and_transitions", "visual_measurements"])
        elif not has_video:
            unsupported_analyses["visual_measurements"] = "No video stream in container"
            unsupported_analyses["cuts_and_transitions"] = "No video stream in container"
        elif is_black:
            unsupported_analyses["cuts_and_transitions"] = "Video stream is completely black (zero scene boundaries)"

        if has_audio and not is_silent:
            supported_analyses.extend(["music_recognition", "acoustic_dynamic_range"])
            if has_video and not is_black and not is_static:
                supported_analyses.append("beat_synchronization")
        else:
            unsupported_analyses["beat_synchronization"] = "Audio track absent or silent"
            unsupported_analyses["music_recognition"] = "Audio track absent or silent"

        return {
            "media_target": file_path,
            "media_type": "local_media",
            "is_supported": True,
            "classification_tag": tag,
            "capabilities": {
                "has_video_stream": has_video,
                "has_audio_stream": has_audio,
                "is_video_black": is_black,
                "is_video_static": is_static,
                "is_audio_silent": is_silent,
                "is_short_clip": duration_sec <= 1.0,
                "orientation": orientation,
                "aspect_ratio": aspect_ratio,
                "width": width,
                "height": height,
                "fps": round(fps, 2),
                "duration_sec": round(duration_sec, 3),
                "video_codec": video_stream.get("codec_name") if has_video else None,
                "audio_codec": audio_stream.get("codec_name") if has_audio else None,
            },
            "supported_analyses": supported_analyses,
            "unsupported_analyses": unsupported_analyses,
        }

