"""Backend-only Secrets Manager delivery. No local-file fallback in AWS mode."""

import json
import logging
import re

PROVIDER_KEYS = ("GEMINI_API_KEY", "YOUTUBE_API_KEY")
SECRET_NAME = "lolixco/production/ai/providers"
ROLE_NAME = "LolixcoProductionAIBackend"
# Credentials are opaque. Gemini also issues authorization keys; do not assume
# the historical standard Google API key prefix or length.
KEY_PATTERN = re.compile(r"[A-Za-z0-9._~+/=-]{20,4096}")
ARN_PATTERN = re.compile(
    r"arn:aws:secretsmanager:([a-z0-9-]+):(\d{12}):secret:"
    r"lolixco/production/ai/providers-[A-Za-z0-9]{6}"
)


class SecretConfigurationError(RuntimeError):
    """Contains only fixed messages, never provider or SDK diagnostics."""


def validate_keys(values):
    if not isinstance(values, dict) or any(
        not isinstance(values.get(key), str)
        or not KEY_PATTERN.fullmatch(values[key])
        or values[key].lower() in {"your_api_key_here", "replace_with_your_api_key"}
        for key in PROVIDER_KEYS
    ):
        raise SecretConfigurationError("Required provider keys are missing or invalid.")
    return {key: values[key] for key in PROVIDER_KEYS}


def aws_client(session, service, region):
    from botocore.config import Config

    # In particular, do not honor AWS_ENDPOINT_URL overrides for secret traffic.
    return session.client(service, region_name=region, config=Config(
        connect_timeout=5, read_timeout=15,
        retries={"mode": "standard", "total_max_attempts": 3},
        ignore_configured_endpoint_urls=True,
    ))


def load_aws_configuration(secret_arn, environment, session=None):
    match = ARN_PATTERN.fullmatch(secret_arn)
    if not match:
        raise SecretConfigurationError("Use the complete production provider secret ARN.")
    region, account = match.groups()
    configured_region = environment.get("AWS_REGION") or environment.get("AWS_DEFAULT_REGION")
    if configured_region and configured_region != region:
        raise SecretConfigurationError("Provider secret and backend regions must match.")
    try:
        import boto3

        session = session or boto3.Session(region_name=region)
        # Suppress wire logging during this startup-only operation.
        previous_logging = logging.root.manager.disable
        logging.disable(logging.CRITICAL)
        try:
            identity = aws_client(session, "sts", region).get_caller_identity()
            expected = f"arn:aws:sts::{account}:assumed-role/{ROLE_NAME}/"
            if not identity["Arn"].startswith(expected):
                raise SecretConfigurationError("Provider secrets require the production AI backend role.")
            data = aws_client(session, "secretsmanager", region).get_secret_value(
                SecretId=secret_arn, VersionStage="AWSCURRENT",
            )
            values = validate_keys(json.loads(data["SecretString"]))
        finally:
            logging.disable(previous_logging)
    except SecretConfigurationError:
        raise
    except Exception:
        raise SecretConfigurationError("AWS provider secret retrieval failed; local fallback is disabled.") from None
    # Do not allow inherited developer keys to override the production secret.
    environment.update(values)
    return environment
