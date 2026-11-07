"""Consent-only transient Gemini review fused with an already completed local report."""
import copy
import json
import resource
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "edit-dna"))
from gemini_provider import ProviderError
from presentation_v8 import to_six_report
from staged_media import FORMATS
from youtube_analysis import PROMPT, RESPONSE_SCHEMA, _build_reports, _require_configured_provider, provider


def emit(kind, **data):
    print(json.dumps({"kind": kind, **data}, allow_nan=False), flush=True)


def prepare_semantic_copy(source, destination):
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2",
        "-filter_threads", "1", "-max_alloc", "67108864",
        "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS, "-i", str(source),
        "-t", "120", "-map", "0:V:0", "-map", "0:a:0?",
        "-vf", "fps=6,scale=480:480:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-b:v", "280k", "-maxrate", "350k", "-bufsize", "700k",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "1", "-ar", "16000", "-b:a", "32k",
        "-map_metadata", "-1", "-movflags", "+faststart", "-y", str(destination),
    ]
    try:
        subprocess.run(command, check=True, timeout=65, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        raise ProviderError("request_unsupported", "The private semantic review copy could not be prepared within local resource limits.") from None
    if not destination.is_file() or not 0 < destination.stat().st_size <= 8 * 1024 * 1024:
        raise ProviderError("request_unsupported", "The semantic review copy exceeded its bounded upload size.")


def fuse_results(local, semantic, facts):
    original = to_six_report(local["presentation"])
    merged = copy.deepcopy(semantic["presentation"])
    for section, local_section in zip(merged["assessment_sections"], original["assessment_sections"], strict=True):
        section.setdefault("evidence_refs", {})["local_measurements"] = local_section.get("evidence_refs", {})
        section["evidence_refs"]["local_signal_score"] = local_section.get("score_0_10")
        section["limitations"].append("Local measurements accompany the semantic judgment. Their numerical proxy is not averaged into the artistic rubric.")
        if section["score_0_10"] is None and local_section.get("score_0_10") is not None:
            section.update(local_section)
    original_context = original.get("context_evidence", {})
    for key, value in original_context.items():
        if key not in ("visual_recognition", "music_recognition", "media_notes", "remote_observation", "governance_contract", "boundaries_and_unknowns"):
            merged["context_evidence"][key] = value
    semantic_notes = [
        "Local frames and audio were decoded for independent measurements before the explicitly consented semantic review.",
        "Gemini observations use a sampled review copy. Timestamped rubric judgments are experimental and require independent editorial calibration.",
        "Source and soundtrack candidates are unverified hypotheses until corroborated by appropriate references.",
    ]
    merged["context_evidence"]["media_notes"] = [*original_context.get("media_notes", []), *semantic_notes]
    merged["context_evidence"].pop("youtube_reference", None)
    merged["context_evidence"]["semantic_provider_status"] = {"status": "connected", "message": "Consented local audiovisual inference completed."}
    merged["context_evidence"].setdefault("remote_observation", {}).update(
        input_kind="consented_local_video", url="", local_preparation="Transient 480px, 6fps H.264 copy with available audio, bounded by the local input duration",
    )
    merged["context_evidence"].setdefault("media_notes", []).append(
        "An explicitly consented temporary analysis copy was sent to Google Gemini. It was transmitted inline, with no reusable provider file created. Google's API data terms apply."
    )
    merged["media_id"] = original.get("media_id")
    merged["media_type"] = original.get("media_type", "local_video")
    merged["analysis_mode"] = "local_gemini_hybrid"
    merged = to_six_report(merged, aggregate_semantic=True)
    canonical = copy.deepcopy(local["v6"])
    canonical["section_d_semantic_evaluation"] = copy.deepcopy(semantic["v6"]["section_d_semantic_evaluation"])
    canonical["section_a_visual_recognition"] = copy.deepcopy(semantic["v6"]["section_a_visual_recognition"])
    canonical["section_b_music_recognition"] = copy.deepcopy(semantic["v6"]["section_b_music_recognition"])
    governance = {
        "creator_studio_ready": True, "cloud_upload_permitted": True,
        "license_tier": "owner_consented_local_review",
        "data_governance": {
            "private_video_cloud_consent": True, "provider": "Google Gemini", "inline_transient_request": True,
            "owner_feedback_transmitted": False, "reusable_provider_file_created": False,
            "provider_data_handling": "Google Gemini API terms for the configured project apply.",
            "local_temporary_media_ttl_seconds": 3600,
        },
    }
    canonical["section_g_privacy_and_contract"] = governance
    canonical["section_f_boundaries_and_unknowns"] = {"unverified_elements": semantic_notes}
    canonical["section_d_semantic_evaluation"]["remote_observation"] = copy.deepcopy(merged["context_evidence"]["remote_observation"])
    merged["context_evidence"]["governance_contract"] = copy.deepcopy(governance)
    merged["context_evidence"]["boundaries_and_unknowns"] = copy.deepcopy(canonical["section_f_boundaries_and_unknowns"])
    return {"v6": canonical, "presentation": merged}


def main(source, local_report):
    local = json.loads(local_report.read_text())
    facts = local["presentation"].get("context_evidence", {}).get("media_observations", {})
    if not facts.get("has_video_stream") or facts.get("uniform_black_samples"):
        raise ProviderError("request_unsupported", "Cloud visual critique requires meaningful video frames. Local findings remain available.")
    _require_configured_provider()
    review_limit = min(120, float(facts["duration_seconds"]))
    local_prompt = PROMPT.replace("attached public YouTube video", "attached consented local video")
    end_minute = int(review_limit // 60)
    end_seconds = review_limit - end_minute * 60
    end_timecode = f"{end_minute:02d}:{end_seconds:05.2f}"
    local_prompt += (
        f" The actual local review window is 0 to {review_limit:g} seconds, with timecodes 00:00 to {end_timecode}. "
        "Use the visible media clock for evidence timecodes within that window. Leave unsupported timing evidence empty."
    )
    emit("stage", stage="Preparing consented Gemini review copy", progress=80)
    copy_path = Path("semantic-review.mp4")
    try:
        prepare_semantic_copy(source, copy_path)
        emit("stage", stage="Running consented Gemini audiovisual review", progress=86)
        result = provider.analyze_inline_video(copy_path.read_bytes(), "video/mp4", local_prompt, schema=RESPONSE_SCHEMA,
                                               timeout_seconds=90, max_output_tokens=6000)
    finally:
        copy_path.unlink(missing_ok=True)
    if result.get("status") != "success":
        raise ProviderError(result.get("status", "temporarily_unavailable"), result.get("message", "Gemini could not complete the consented review."))
    observed = result["analysis"]["structured"]
    if not facts.get("has_audio_stream") or not facts.get("audio_activity"):
        observed["audio_reviewable"] = False
    result["video_uri"] = ""
    canonical, presentation = _build_reports(local["presentation"].get("media_id", "local_video"), result, review_limit=review_limit)
    fused = fuse_results(local, {"v6": canonical, "presentation": presentation}, facts)
    for section in fused["presentation"]["assessment_sections"]:
        emit("event", event_type="SECTION_COMPLETED" if section["score_0_10"] is not None else "SECTION_UNASSESSED",
             section_id=section["section_id"], payload=section, stage="Preparing results", progress=96, duration_ms=0)
    Path("result.json").write_text(json.dumps(fused, allow_nan=False))


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_CPU, (145, 150))
    resource.setrlimit(resource.RLIMIT_AS, (4 * 1024**3, 4 * 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    try:
        main(Path(sys.argv[1]), Path(sys.argv[2]))
    except ProviderError as error:
        emit("error", message=error.message, code=error.status)
        sys.exit(1)
    except (OSError, ValueError, KeyError):
        emit("error", message="The consented semantic response could not be combined with local evidence.", code="request_unsupported")
        sys.exit(1)
