"""Same-origin admission/status API; no provider keys or local research endpoints."""
import base64
import json
import os
import re
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import unquote

from common import *


def response(status, body, cookies=None, extra=None):
    return {"statusCode": status, "headers": {"content-type": "application/json", "cache-control": "no-store",
        "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", **(extra or {})},
        "body": json.dumps(body, default=json_default), **({"cookies": cookies} if cookies else {})}


def body_json(event):
    raw = event.get("body") or "{}"
    if not isinstance(raw, str) or len(raw) > 6144:
        raise RequestError(413, "The request is too large.")
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw, validate=True).decode()
        except (ValueError, UnicodeDecodeError):
            raise RequestError(400, "Send a valid JSON object.") from None
    if len(raw) > 4096:
        raise RequestError(413, "The request is too large.")
    try:
        value = json.loads(raw)
    except ValueError:
        raise RequestError(400, "Send a valid JSON object.") from None
    if not isinstance(value, dict):
        raise RequestError(400, "Send a valid JSON object.")
    return value


def session(event, create=False):
    headers = {k.lower(): v for k, v in event.get("headers", {}).items()}
    origin = headers.get("origin")
    if origin and origin != os.environ["PUBLIC_ORIGIN"]:
        raise RequestError(403, "Use the Lolixco website to access analysis.")
    cookie = ";".join(event.get("cookies", [])) or headers.get("cookie", "")
    match = re.search(r"(?:^|;\s*)lolixco_session=([a-f0-9]{64})(?:;|$)", cookie)
    if match:
        owner = digest(match[1])
        existing = get("SESSION#" + owner)
        if existing and existing["expires"] > int(time.time()):
            return owner, []
    if not create:
        raise RequestError(403, "Your private session expired. Reload Creator Studio.")
    ip = event.get("requestContext", {}).get("http", {}).get("sourceIp", "unknown")
    if not counter("sessions-global", 100) or not counter("sessions-ip-" + digest(ip), 20, 3600):
        raise RequestError(429, "The beta visitor limit is temporarily reached. Try again later.")
    token = secrets.token_hex(32)
    owner = digest(token)
    now = int(time.time())
    put({"pk": "SESSION#" + owner, "expires": now + 86400, "ttl": now + 172800})
    return owner, [f"lolixco_session={token}; Path=/api/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400"]


def admit(owner, semantic):
    if os.environ.get("AI_ENABLED") != "true":
        raise RequestError(503, "Analysis is temporarily paused.", "configured_disabled")
    if not counter("jobs-session-" + owner, 3) or not counter("jobs-global", 10):
        raise RequestError(429, "Today's beta analysis limit is reached. Try again tomorrow.", "rate_limited")
    if semantic and not counter("semantic-global", 8):
        raise RequestError(429, "Today's Gemini review limit is reached. Signal analysis remains available.", "quota_exceeded")


def start_job(owner, media=None, youtube=None, consent=False):
    admit(owner, consent)
    now = int(time.time())
    job = f"job_{now}_{secrets.token_hex(12)}"
    if media:
        item = owned("MEDIA", media, owner)
        previous_id = item.get("job_id")
        previous = get("JOB#" + previous_id) if previous_id else None
        if previous_id and (not previous or previous["status"] in TERMINAL and previous.get("worker_finished")):
            TABLE.update_item(Key={"pk": item["pk"]}, UpdateExpression="SET busy = :no",
                ConditionExpression="job_id = :previous", ExpressionAttributeValues={":no": False, ":previous": previous_id})
        obj = S3.head_object(Bucket=BUCKET, Key=item["key"])
        if not 0 < obj["ContentLength"] <= MAX_BYTES or obj["ContentLength"] != item["size"]:
            raise RequestError(422, "Uploaded media size does not match the selected file.")
        try:
            TABLE.update_item(Key={"pk": "MEDIA#" + media},
                UpdateExpression="SET busy = :yes, job_id = :job", ConditionExpression="attribute_not_exists(busy) OR busy = :no",
                ExpressionAttributeValues={":yes": True, ":no": False, ":job": job})
        except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
            raise RequestError(409, "This upload is still being processed. Retry after the worker finishes.") from None
    row = {"pk": "JOB#" + job, "job_id": job, "owner": owner, "created": now,
        "expires": now + 86400, "ttl": now + 172800, "status": "QUEUED", "progress_percent": 0,
        "current_stage": "Waiting for the analysis worker", "events": [], "quality_mode": "phase9",
        "semantic_consent": consent, "media_filename": item["name"] if media else "Public YouTube video",
        "media_id": media or "", "youtube_video_id": youtube or ""}
    if media:
        row["media_key"], row["media_size"] = item["key"], item["size"]
    put(row)
    try:
        SQS.send_message(QueueUrl=QUEUE, MessageBody=json.dumps({"job_id": job}))
    except Exception:
        TABLE.update_item(Key={"pk": row["pk"]}, UpdateExpression="SET #s = :failed, #e = :error",
            ExpressionAttributeNames={"#s": "status", "#e": "error"},
            ExpressionAttributeValues={":failed": "FAILED", ":error": "Dispatch failed. Try again later."})
        raise RequestError(503, "The worker could not be scheduled. Try again later.") from None
    return {"job_id": job}


def cleanup():
    now = int(time.time())
    # TTL is deliberately later than access expiry, leaving time for deletion.
    for page in TABLE.meta.client.get_paginator("scan").paginate(TableName=TABLE.name):
        for row in page.get("Items", []):
            if row.get("expires", now + 1) > now:
                continue
            if row["pk"].startswith("MEDIA#"):
                S3.delete_object(Bucket=BUCKET, Key=row["key"])
            elif row["pk"].startswith("JOB#"):
                remove_prefix("reports/" + row["job_id"] + "/")
            TABLE.delete_item(Key={"pk": row["pk"]})
    delivery_guard()
    return {"cleanup": "complete"}


def delivery_guard():
    """A practical cutoff, not a promise of instantaneous or exact billing limits."""
    distribution = os.environ.get("DISTRIBUTION_ID")
    if not distribution:
        return
    monitor = SESSION.client("cloudwatch", region_name="us-east-1", config=CONFIG)
    now = datetime.now(timezone.utc)
    totals = {}
    for metric in ("BytesDownloaded", "Requests"):
        data = monitor.get_metric_statistics(Namespace="AWS/CloudFront", MetricName=metric,
            Dimensions=[{"Name": "DistributionId", "Value": distribution}, {"Name": "Region", "Value": "Global"}],
            StartTime=now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), EndTime=now,
            Period=86400, Statistics=["Sum"])
        totals[metric] = sum(point["Sum"] for point in data["Datapoints"])
    if totals["BytesDownloaded"] < 50 * 1024 ** 3 and totals["Requests"] < 1_000_000:
        return
    cdn = SESSION.client("cloudfront", config=CONFIG)
    current = cdn.get_distribution_config(Id=distribution)
    if current["DistributionConfig"]["Enabled"]:
        current["DistributionConfig"]["Enabled"] = False
        cdn.update_distribution(Id=distribution, IfMatch=current["ETag"], DistributionConfig=current["DistributionConfig"])
        print(json.dumps({"event": "release_delivery_cutoff", "reason": "monthly_beta_allowance"}))


def route(event):
    path = event.get("rawPath", "").removeprefix("/api/v8/").strip("/")
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    owner, cookies = session(event, create=path == "health" and method == "GET")
    if path == "health" and method == "GET":
        return response(200, {"status": "ok", "version": "8.0.0", "direct_upload": True,
            "provider": {"status": "connected" if os.environ.get("AI_ENABLED") == "true" else "configured_disabled",
                "message": "Consented Gemini review is available within beta quotas."},
            "limits": {"daily_jobs": 10, "daily_semantic_jobs": 8, "concurrent_workers": 2}}, cookies)
    if method not in ("GET", "HEAD"):
        if not counter("mutations-" + owner, 20, 60):
            raise RequestError(429, "Please wait before sending another request.")
    if path == "media/presign" and method == "POST":
        if os.environ.get("AI_ENABLED") != "true":
            raise RequestError(503, "Analysis is temporarily paused.", "configured_disabled")
        data = body_json(event)
        if set(data) != {"name", "size"}:
            raise RequestError(400, "Send a filename and file size.")
        name, size = data.get("name"), data.get("size")
        if not isinstance(name, str) or not 1 <= len(name) <= 180 or re.search(r"[\x00-\x1f/\\]", name):
            raise RequestError(400, "Choose a supported local media file.")
        if type(size) is not int or not 0 < size <= MAX_BYTES:
            raise RequestError(413, "Choose a file no larger than 100 MiB.")
        if not counter("uploads-global", 20) or not counter("uploads-" + owner, 4):
            raise RequestError(429, "The beta upload limit is temporarily reached.")
        identity = secrets.token_hex(16)
        key = "uploads/" + owner + "/" + identity + "/input"
        now = int(time.time())
        put({"pk": "MEDIA#" + identity, "owner": owner, "key": key, "name": name,
             "size": size, "expires": now + 3600, "ttl": now + 172800})
        signed = S3.generate_presigned_post(Bucket=BUCKET, Key=key,
            Fields={"Content-Type": "application/octet-stream"},
            Conditions=[["content-length-range", 1, size], {"Content-Type": "application/octet-stream"}], ExpiresIn=60)
        return response(200, {"id": identity, "name": name, "video": True, "upload": signed})
    parts = path.split("/")
    if len(parts) >= 2 and parts[0] == "media" and MEDIA_ID.fullmatch(parts[1]):
        row = owned("MEDIA", parts[1], owner)
        if method == "DELETE" and len(parts) == 2:
            job = get("JOB#" + row.get("job_id", ""))
            if job and job["status"] not in TERMINAL:
                raise RequestError(409, "Cancel the running analysis before deleting its upload.")
            S3.delete_object(Bucket=BUCKET, Key=row["key"])
            TABLE.delete_item(Key={"pk": row["pk"]})
            return response(200, {"deleted": True})
        if method == "POST" and parts[2:] == ["start"]:
            data = body_json(event)
            if set(data) - {"quality_mode", "semantic_consent"} or type(data.get("semantic_consent", False)) is not bool:
                raise RequestError(400, "Confirm your processing choice.")
            return response(200, start_job(owner, media=parts[1], consent=data.get("semantic_consent", False)))
    if path.startswith("youtube/") and method == "POST":
        data = body_json(event)
        video = data.get("video_id")
        if not isinstance(video, str) or not VIDEO_ID.fullmatch(video):
            raise RequestError(400, "Enter a valid public YouTube URL.")
        if path == "youtube/reference":
            if not counter("reference-" + owner, 10, 3600):
                raise RequestError(429, "Wait before checking another public video.")
            # Publisher metadata is fetched inside the consented worker with its key.
            return response(200, {"context_evidence": {"youtube_reference": {"url": "https://www.youtube.com/watch?v=" + video}},
                "assessment_sections": [], "schema_version": "8.0.0-presentation"})
        if path == "youtube/start" and data.get("consent") is True and set(data) == {"video_id", "consent"}:
            return response(200, start_job(owner, youtube=video, consent=True))
        raise RequestError(400, "Confirm that Gemini may process this public video.")
    if len(parts) >= 2 and parts[0] == "jobs" and JOB_ID.fullmatch(parts[1]):
        row = owned("JOB", parts[1], owner)
        if row["status"] not in TERMINAL and int(time.time()) - row["created"] > 900:
            TABLE.update_item(Key={"pk": row["pk"]}, UpdateExpression="SET #s = :failed, #e = :error",
                ConditionExpression="#s IN (:queued, :running)", ExpressionAttributeNames={"#s": "status", "#e": "error"},
                ExpressionAttributeValues={":failed": "FAILED", ":error": "Analysis timed out. Please try again.", ":queued": "QUEUED", ":running": "RUNNING"})
            row = owned("JOB", parts[1], owner)
        if method == "GET" and len(parts) == 2:
            public = {k: v for k, v in row.items() if k not in {"pk", "owner", "media_key", "report_prefix", "ttl"}}
            return response(200, public)
        if method == "GET" and parts[2:] == ["events"]:
            return {"statusCode": 200, "headers": {"content-type": "text/event-stream", "cache-control": "no-store"},
                "body": "data: {}\n\n"}
        if method == "POST" and parts[2:] == ["cancel"]:
            if row["status"] not in TERMINAL:
                TABLE.update_item(Key={"pk": row["pk"]}, UpdateExpression="SET #s = :s, current_stage = :stage",
                    ExpressionAttributeNames={"#s": "status"},
                    ExpressionAttributeValues={":s": "CANCELLED", ":stage": "Analysis cancelled"})
            return response(200, {"status": "CANCELLED", "job_id": row["job_id"]})
        if method == "GET" and len(parts) == 4 and parts[2] == "report" and parts[3] in {"v6", "presentation"}:
            if row["status"] != "COMPLETE":
                raise RequestError(409, "This report is not ready.")
            result = S3.get_object(Bucket=BUCKET, Key="reports/" + row["job_id"] + "/" + parts[3] + ".json")
            with result["Body"] as stream:
                report = json.loads(stream.read(1024 * 1024))
            return response(200, report)
        if method == "DELETE" and len(parts) == 2:
            if row["status"] not in TERMINAL:
                raise RequestError(409, "Cancel the running job before deleting its report.")
            if row["status"] == "CANCELLED" and not row.get("worker_finished") and int(time.time()) - row["created"] < 900:
                raise RequestError(409, "The worker is finishing cancellation. Retry deletion shortly.")
            remove_prefix("reports/" + row["job_id"] + "/")
            TABLE.delete_item(Key={"pk": row["pk"]})
            return response(200, {"deleted": True})
    raise RequestError(404, "This analysis route is unavailable.")


def handler(event, context):
    if event.get("source") == "aws.events":
        return cleanup()
    try:
        return route(event)
    except RequestError as error:
        return response(error.status, {"detail": error.message, "error_code": error.code})
    except Exception as error:
        print(json.dumps({"event": "api_failure", "class": type(error).__name__,
            "operation": getattr(error, "operation_name", None),
            "code": getattr(error, "response", {}).get("Error", {}).get("Code")}))
        return response(503, {"detail": "Analysis is temporarily unavailable. Please retry.", "error_code": "temporarily_unavailable"})
