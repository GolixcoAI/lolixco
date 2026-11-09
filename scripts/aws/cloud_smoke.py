"""Bounded real acceptance requests. Never logs cookies, signed fields or keys."""
import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["upload", "youtube", "wait", "health"])
    parser.add_argument("--base", required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--file", type=Path)
    parser.add_argument("--video-id")
    parser.add_argument("--semantic", action="store_true")
    args = parser.parse_args()
    args.evidence.mkdir(mode=0o700, parents=True, exist_ok=True)
    cookie_file = args.evidence / "session.cookies"
    cookies = http.cookiejar.MozillaCookieJar(str(cookie_file))
    if cookie_file.exists():
        cookies.load(ignore_discard=True, ignore_expires=True)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))

    def request(path, data=None):
        for attempt in range(3):
            raw = None if data is None else json.dumps(data).encode()
            req = urllib.request.Request(args.base + "/api/v8/" + path, data=raw, headers={"Content-Type": "application/json"})
            try:
                with opener.open(req, timeout=30) as result:
                    return json.load(result)
            except urllib.error.HTTPError as error:
                if error.code == 429 and attempt < 2:
                    time.sleep(3)
                    continue
                diagnostic = json.loads(error.read())
                raise RuntimeError(f"API {error.code}: {diagnostic.get('error_code')}") from None

    health = request("health")
    cookies.save(ignore_discard=True, ignore_expires=True)
    os.chmod(cookie_file, 0o600)
    print(json.dumps({"health": health["status"], "version": health["version"]}), flush=True)
    if args.mode == "health":
        return
    if args.mode == "upload":
        size = args.file.stat().st_size
        item = request("media/presign", {"name": "release-acceptance.mp4", "size": size})
        boundary = uuid.uuid4().hex
        parts = []
        for key, value in item["upload"]["fields"].items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="acceptance.mp4"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(), args.file.read_bytes(), f'\r\n--{boundary}--\r\n'.encode()])
        req = urllib.request.Request(item["upload"]["url"], data=b"".join(parts), headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
        with urllib.request.urlopen(req, timeout=180) as result:
            if result.status not in (200, 201, 204):
                raise RuntimeError("Private upload rejected")
        job = request("media/" + item["id"] + "/start", {"quality_mode": "phase9", "semantic_consent": args.semantic})
        job["media_id"] = item["id"]
    elif args.mode == "youtube":
        job = request("youtube/start", {"video_id": args.video_id, "consent": True})
    else:
        job = json.loads((args.evidence / "job.json").read_text())
    (args.evidence / "job.json").write_text(json.dumps(job))
    os.chmod(args.evidence / "job.json", 0o600)
    print(json.dumps({"job": "accepted", "mode": args.mode}), flush=True)
    deadline = time.monotonic() + 660
    previous = None
    while time.monotonic() < deadline:
        state = request("jobs/" + job["job_id"])
        current = (state["status"], state["current_stage"])
        if current != previous:
            print(json.dumps({"status": current[0], "stage": current[1]}), flush=True)
            previous = current
        if state["status"] == "COMPLETE":
            report = request("jobs/" + job["job_id"] + "/report/presentation")
            (args.evidence / "presentation.json").write_text(json.dumps(report, indent=2))
            os.chmod(args.evidence / "presentation.json", 0o600)
            context = report.get("context_evidence", {})
            print(json.dumps({"result": "complete", "sections": len(report.get("assessment_sections", [])),
                "semantic_status": context.get("semantic_provider_status", {}).get("status"),
                "evidence_statuses": [x.get("evidence_status") for x in report.get("assessment_sections", [])]}), flush=True)
            return
        if state["status"] in {"FAILED", "CANCELLED"}:
            raise RuntimeError("Cloud job ended: " + state["status"] + ": " + str(state.get("error_code")))
        time.sleep(5)
    raise RuntimeError("Cloud job exceeded acceptance timeout")


if __name__ == "__main__":
    main()
