"""Bounded provider authentication checks inside the production AI task role.

No generateContent, media upload, transcript download, or analysis request.
"""

import json
import logging
import os
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-dna"))
from aws_provider_secrets import SECRET_NAME, load_aws_configuration


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def check_endpoint(url, key, expected):
    try:
        request = Request(url, headers={"x-goog-api-key": key, "Accept": "application/json"})
        with build_opener(NoRedirect()).open(request, timeout=15) as response:
            raw = response.read(262145)
        if len(raw) > 262144:
            return "response_limit_exceeded"
        return "passed" if expected(json.loads(raw)) else "no_supported_result"
    except HTTPError as error:
        status = error.code
        error.close()  # Never read or print an upstream diagnostic body.
        return {400: "request_rejected", 401: "authentication_failed", 403: "permission_denied", 429: "quota_exceeded"}.get(status, "provider_unavailable")
    except Exception:
        return "provider_unavailable"


def probe(environment):
    load_aws_configuration(environment.get("LOLIXCO_PROVIDER_SECRET_ARN", ""), environment)
    return {
        "secret_name": SECRET_NAME,
        "secret_retrieval": "passed",
        "gemini_model_discovery": check_endpoint(
            "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
            environment["GEMINI_API_KEY"],
            lambda data: any("generateContent" in model.get("supportedGenerationMethods", []) for model in data.get("models", [])),
        ),
        "youtube_metadata": check_endpoint(
            "https://www.googleapis.com/youtube/v3/videos?part=status,contentDetails&id=0vswe8D3UTk",
            environment["YOUTUBE_API_KEY"],
            lambda data: any(item.get("id") == "0vswe8D3UTk" for item in data.get("items", [])),
        ),
        "inference": "not_run",
    }


def main():
    logging.disable(logging.CRITICAL)
    try:
        result = probe(os.environ)
    except Exception:
        result = {"secret_name": SECRET_NAME, "secret_retrieval": "failed", "inference": "not_run"}
    print(json.dumps(result), flush=True)
    return 0 if all(result.get(key) == "passed" for key in (
        "secret_retrieval", "gemini_model_discovery", "youtube_metadata",
    )) else 1


if __name__ == "__main__":
    sys.exit(main())
