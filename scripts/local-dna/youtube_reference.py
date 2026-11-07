"""Inspect official publisher metadata, with an oEmbed fallback independent of inference."""
import json
import os
import re
from urllib.parse import urlencode
from urllib.request import Request, HTTPRedirectHandler, build_opener

from edit_dna_schema_v6 import EditDNASchemaV6
from presentation_adapter import EditDNAPresentationAdapter
from presentation_v8 import to_six_report


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def duration_seconds(value):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", value)
    if not match:
        return None
    hours, minutes, seconds = (float(part or 0) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def official_metadata(video_id):
    key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not key:
        return {}, []
    endpoint = "https://www.googleapis.com/youtube/v3/videos?" + urlencode({"part": "snippet,status,contentDetails", "id": video_id})
    try:
        request = Request(endpoint, headers={"Accept": "application/json", "X-Goog-Api-Key": key})
        with build_opener(NoRedirect()).open(request, timeout=6) as response:
            data = json.loads(response.read(65537))
        items = data.get("items", [])
        if not items:
            return {"availability": "unavailable"}, ["YouTube did not return an accessible video for this ID."]
        item = items[0]
        snippet, status, details = item.get("snippet", {}), item.get("status", {}), item.get("contentDetails", {})
        return {
            "title": str(snippet.get("title", ""))[:300], "author_name": str(snippet.get("channelTitle", ""))[:300],
            "embeddable": status.get("embeddable"), "privacy_status": status.get("privacyStatus"),
            "age_restricted": details.get("contentRating", {}).get("ytRating") == "ytAgeRestricted",
            "duration_iso8601": details.get("duration"), "metadata_provider": "youtube_data_api_v3",
        }, []
    except (OSError, ValueError, TypeError, AttributeError, IndexError):
        return {}, ["YouTube Data API metadata could not be retrieved. Gemini access and official playback are checked independently."]


def inspect_reference(video_id):
    url = "https://www.youtube.com/watch?v=" + video_id
    endpoint = "https://www.youtube.com/oembed?" + urlencode({"url": url, "format": "json"})
    metadata, metadata_notes = official_metadata(video_id)
    notes = ["Only publisher metadata was requested. Audiovisual analysis requires an authorized provider.",
             "Cuts, BPM, beat synchronization, source identity and soundtrack identity were not measured."]
    if not metadata.get("title"):
        try:
            with build_opener(NoRedirect()).open(Request(endpoint, headers={"Accept": "application/json"}), timeout=6) as response:
                data = json.loads(response.read(65537))
            metadata.update({key: data[key][:300] for key in ("title", "author_name") if isinstance(data.get(key), str)})
            notes.append("Publisher metadata does not verify source footage or music identity.")
        except (OSError, ValueError, TypeError, AttributeError):
            notes.append("YouTube publisher metadata is unavailable. The embed may be restricted or the service unreachable.")
    notes.extend(metadata_notes)
    unknown = {"status": "UNKNOWN", "provenance": "youtube_oembed_metadata_only"}
    raw = EditDNASchemaV6.create_report(
        video_id, "public_youtube_url", unknown, unknown, {"provenance": "measured_signal"},
        {"status": "NOT_YET_ASSESSED", "provenance": "unassessed_dimensions"},
        {"status": "NOT_YET_ASSESSED", "provenance": "unassessed_dimensions"},
        {"unverified_elements": notes},
    )
    report = EditDNAPresentationAdapter.from_v6_report(raw)
    report["context_evidence"]["youtube_reference"] = {"url": url, **metadata}
    report["context_evidence"]["media_notes"] = notes
    # The legacy adapter defaults several physical counters to zero.
    # A metadata lookup did not measure any of them.
    for section in report["assessment_sections"]:
        section["evidence_refs"] = {}
        section["timestamps"] = []
        section["creator_explanation"] = "Unavailable from publisher metadata."
        section["method_version"] = "youtube_oembed_metadata_only"
    return to_six_report(report)
