"""Inspect publisher metadata through YouTube's official oEmbed endpoint."""
import json
from urllib.parse import urlencode
from urllib.request import Request, HTTPRedirectHandler, build_opener

from edit_dna_schema_v6 import EditDNASchemaV6
from presentation_adapter import EditDNAPresentationAdapter


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def inspect_reference(video_id):
    url = "https://www.youtube.com/watch?v=" + video_id
    endpoint = "https://www.youtube.com/oembed?" + urlencode({"url": url, "format": "json"})
    metadata = {}
    notes = ["Only publisher metadata was requested. Audiovisual analysis requires an authorized provider.",
             "Cuts, BPM, beat synchronization, source identity and soundtrack identity were not measured."]
    try:
        with build_opener(NoRedirect()).open(Request(endpoint, headers={"Accept": "application/json"}), timeout=6) as response:
            data = json.loads(response.read(65537))
        metadata = {key: data[key][:300] for key in ("title", "author_name") if isinstance(data.get(key), str)}
        if metadata:
            notes.append("YouTube supplied publisher metadata. Title and channel do not verify footage or music identity.")
        else:
            notes.append("YouTube returned no usable publisher metadata.")
    except (OSError, ValueError, TypeError, AttributeError):
        notes.append("YouTube publisher metadata is unavailable. The embed may be restricted or the service unreachable.")
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
    return report
