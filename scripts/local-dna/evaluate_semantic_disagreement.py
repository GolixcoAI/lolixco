"""Compare private held-out editor labels with generic public-video assessments.

Only a public video identifier and consent enter the local product API. Historical
ratings and notes stay in this process. The saved report contains aggregates.
"""
import argparse
import hashlib
import json
import math
import os
import re
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler

STATE = Path.home() / ".lolixco-edit-dna"
ORIGIN = "http://127.0.0.1:5173"
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
EXCLUDED_RESEARCH_VIDEO = "_yrPlcZY2jw"
DIMENSIONS = {
    "beat_synchronization": "beat_synchronization",
    "cuts_and_transitions": "transitions",
    "pacing": "pacing",
    "visual_measurements": "visual_quality",
    "storytelling_interpretation": "storytelling_emotion",
    "originality_creativity": "originality_creativity",
}


class EvaluationError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def valid_score(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 10


def duration_seconds(value):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", value)
    if not match or not any(match.groups()):
        return None
    hours, minutes, seconds = (float(field or 0) for field in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def candidates(data):
    """Select by stable identity and label availability, without reading score magnitude."""
    rows = data.get("ratings", {})
    values = {}
    for storage_key, row in sorted(rows.items()):
        if not isinstance(row, dict) or row.get("is_synthetic_benchmark") is True:
            continue
        identity = row.get("youtube_id") or row.get("canonical_id") or row.get("asset_id")
        if not isinstance(identity, str) or not VIDEO_ID.fullmatch(identity) or identity == EXCLUDED_RESEARCH_VIDEO:
            continue
        labels = row.get("component_scores", {})
        if not isinstance(labels, dict) or not all(valid_score(labels.get(key)) for key in DIMENSIONS.values()):
            continue
        values.setdefault(identity, {key: labels[key] for key in DIMENSIONS.values()})
    return sorted(values.items())


class ProductAPI:
    def __init__(self):
        self.opener = build_opener(ProxyHandler({}))

    def request(self, path, payload=None, method=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request = Request(ORIGIN + "/api/v8/" + path, data=body, method=method,
                          headers={"Content-Type": "application/json", "Origin": ORIGIN})
        try:
            with self.opener.open(request, timeout=20) as response:
                content = response.read(2_000_001)
            if len(content) > 2_000_000:
                raise EvaluationError("product_response_oversized")
            return json.loads(content)
        except HTTPError as error:
            # Preserve only an allowlisted status code, never diagnostic text or linked identities.
            code = None
            try:
                with error:
                    failure = json.loads(error.read(4096))
                detail = failure.get("detail")
                code = failure.get("error_code") or (detail.get("code") if isinstance(detail, dict) else None)
            except (OSError, ValueError, AttributeError):
                pass
            known = {"quota_exceeded", "authentication_failed", "configured_disabled", "not_configured",
                     "model_unavailable", "request_unsupported", "video_unavailable", "temporarily_unavailable"}
            raise EvaluationError(code if code in known else "product_http_" + str(error.code)) from None
        except (OSError, URLError, ValueError):
            raise EvaluationError("product_connection_or_response_error") from None

    def metadata(self, identity):
        return self.request("youtube/reference", {"video_id": identity})

    def assess(self, identity):
        deadline = time.monotonic() + 90
        while True:
            try:
                job = self.request("youtube/start", {"video_id": identity, "consent": True})["job_id"]
                break
            except EvaluationError as error:
                if error.code != "product_http_429" or time.monotonic() >= deadline:
                    raise
                time.sleep(3)
        if not re.fullmatch(r"job_\d+_[a-f0-9]{6}", job):
            raise EvaluationError("product_job_identifier_invalid")
        try:
            deadline = time.monotonic() + 360
            while time.monotonic() < deadline:
                snapshot = self.request("jobs/" + job)
                status = snapshot.get("status")
                if status == "COMPLETE":
                    return self.request("jobs/" + job + "/report/presentation")
                if status in ("FAILED", "CANCELLED"):
                    code = snapshot.get("error_code", "assessment_failed")
                    raise EvaluationError(code if isinstance(code, str) and re.fullmatch(r"[a-z_]+", code) else "assessment_failed")
                time.sleep(1)
            self.request("jobs/" + job + "/cancel", {}, "POST")
            raise EvaluationError("assessment_deadline_exceeded")
        finally:
            try:
                self.request("jobs/" + job, method="DELETE")
            except EvaluationError:
                pass


def run(api, count=2):
    source = STATE / "owner_ratings.json"
    before = hashlib.sha256(source.read_bytes()).digest()
    population = candidates(json.loads(source.read_text()))
    errors = {key: [] for key in DIMENSIONS}
    skipped = {}
    model_names = set()
    evaluated = 0
    metadata_eligible = 0
    for identity, labels in population:
        if evaluated >= count:
            break
        try:
            preview = api.metadata(identity)
            metadata = preview.get("context_evidence", {}).get("youtube_reference", {})
            seconds = duration_seconds(metadata.get("duration_iso8601"))
            if metadata.get("privacy_status") != "public" or seconds is None or not 0 < seconds <= 120:
                skipped["public_duration_or_access_not_verified"] = skipped.get("public_duration_or_access_not_verified", 0) + 1
                time.sleep(3.1)
                continue
            metadata_eligible += 1
            report = api.assess(identity)
            if report.get("schema_version") != "8.0.0-presentation":
                raise EvaluationError("six_dimension_schema_required")
            evaluated += 1
            model = report.get("context_evidence", {}).get("remote_observation", {}).get("model")
            if isinstance(model, str) and re.fullmatch(r"gemini-[a-z0-9.-]+", model):
                model_names.add(model)
            for section in report.get("assessment_sections", []):
                dimension = section.get("section_id")
                predicted = section.get("score_0_10")
                if dimension in DIMENSIONS and valid_score(predicted):
                    errors[dimension].append(abs(predicted - labels[DIMENSIONS[dimension]]))
        except EvaluationError as error:
            skipped[error.code] = skipped.get(error.code, 0) + 1
            if error.code in {"quota_exceeded", "authentication_failed", "configured_disabled", "not_configured", "model_unavailable"}:
                break
        time.sleep(3.1)
    preserved = hashlib.sha256(source.read_bytes()).digest() == before
    if not preserved:
        raise EvaluationError("private_source_changed_during_evaluation")
    total = sum(len(values) for values in errors.values())
    return {
        "method": "two_deterministic_historical_public_inputs_with_labels_withheld_until_prediction",
        "selection": "Sorted public identities, non-synthetic, excluding the prior research target, access and duration verified by metadata. Score magnitude does not affect selection.",
        "requested_samples": count,
        "eligible_reviewed_identities": len(population),
        "metadata_eligible_attempts": metadata_eligible,
        "evaluated_samples": evaluated,
        "supported_dimension_predictions": total,
        "possible_dimension_predictions": evaluated * len(DIMENSIONS),
        "models": sorted(model_names),
        "per_dimension": {key: {
            "supported_predictions": len(values),
            "mean_absolute_error": round(sum(values) / len(values), 4) if values else None,
            "within_one_point": sum(error <= 1 for error in values),
        } for key, values in errors.items()},
        "mean_absolute_error_across_supported_predictions": round(sum(sum(values) for values in errors.values()) / total, 4) if total else None,
        "skipped_counts": skipped,
        "private_labels_sent_to_provider": False,
        "private_source_preserved": preserved,
        "limitations": [
            "Two examples and one editor cannot establish general artistic-rating accuracy or calibrated confidence.",
            "The historical rubric differs from perceived rhythm, visual craftsmanship and creative-impact rubric scopes.",
            "Missing predictions affect coverage and are excluded from error averages, never replaced with default scores.",
            "These labels were not supplied to the model or used to tune predictions. Existing private review notes stayed local.",
        ],
    }


def save(report):
    directory = STATE / "owner_evaluations"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    destination = directory / "stage15d_semantic_disagreement.json"
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, prefix=".semantic-evaluation-", delete=False) as output:
        temporary = Path(output.name)
        try:
            json.dump(report, output, indent=2, allow_nan=False)
            output.flush()
            os.fsync(output.fileno())
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    destination.chmod(0o600)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Keep historical editor labels local while assessing public videos through Studio.")
    parser.add_argument("--run", action="store_true", help="Run two public-video product assessments using the configured provider quota.")
    args = parser.parse_args()
    if not args.run:
        parser.exit(message="Prepared. Use --run only after the product is idle and live inference is verified.\n")
    try:
        summary = run(ProductAPI())
        location = save(summary)
        print(json.dumps({"aggregate_report": str(location), **summary}, indent=2))
    except (EvaluationError, OSError, ValueError, KeyError):
        raise SystemExit("The private disagreement evaluation could not complete. No source ratings were changed.") from None
