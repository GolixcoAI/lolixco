"""Owner-run SDK migration. Output is allowlisted; credentials never enter argv/files."""

import argparse
import hashlib
import json
import logging
import os
from pathlib import Path
import stat
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-dna"))
from aws_provider_secrets import (
    PROVIDER_KEYS, ROLE_NAME, SECRET_NAME, SecretConfigurationError, aws_client, validate_keys,
)

TAGS = {"Application": "Lolixco", "Environment": "production", "ManagedBy": "lolixco-provider-migration"}
POLICY_NAME = "ReadLolixcoProductionProviders"


def read_local_keys(path, check_git=True):
    """Read only; never source, expand, chmod, create, copy, or rewrite the file."""
    path = Path(path).absolute()
    if check_git:
        args = {"cwd": path.parent, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        ignored = subprocess.run(["git", "check-ignore", "--quiet", "--no-index", "--", str(path)], **args)
        tracked = subprocess.run(["git", "ls-files", "--error-unmatch", "--", str(path)], **args)
        if ignored.returncode != 0 or tracked.returncode != 1:
            raise SecretConfigurationError("Local configuration must be Git-ignored and untracked.")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK | getattr(os, "O_NOATIME", 0))
    with os.fdopen(descriptor, "rb") as handle:
        metadata = os.fstat(handle.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 16384:
            raise SecretConfigurationError("Use a regular local configuration of at most 16 KiB.")
        raw = handle.read(16385)
        if len(raw) > 16384:
            raise SecretConfigurationError("Local configuration exceeds 16 KiB.")
        text = raw.decode("utf-8")
    values = {}
    for line in text.splitlines():
        content = line.strip()
        if not content or content.startswith("#"):
            continue
        name, separator, value = content.partition("=")
        name, value = name.strip(), value.strip()
        if name not in PROVIDER_KEYS:
            continue  # Only these two values can ever be sent to AWS.
        if not separator or name in values:
            raise SecretConfigurationError("Provider settings must be unique assignments.")
        if value.startswith(("'", '"')):
            if len(value) < 2 or value[-1] != value[0]:
                raise SecretConfigurationError("Provider setting quoting is invalid.")
            value = value[1:-1]
        values[name] = value
    return validate_keys(values)


def backend_trust(account, region, service="ecs"):
    if service == "lambda":
        return {"Version": "2012-10-17", "Statement": [{"Effect": "Allow",
            "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
    return {"Version": "2012-10-17", "Statement": [{
        "Effect": "Allow", "Principal": {"Service": "ecs-tasks.amazonaws.com"},
        "Action": "sts:AssumeRole", "Condition": {
            "StringEquals": {"aws:SourceAccount": account},
            "ArnLike": {"aws:SourceArn": f"arn:aws:ecs:{region}:{account}:*"},
        },
    }]}


def ensure_backend_role(iam, account, region, service="ecs"):
    trust = backend_trust(account, region, service)
    try:
        role = iam.get_role(RoleName=ROLE_NAME)["Role"]
    except iam.exceptions.NoSuchEntityException:
        role = iam.create_role(
            RoleName=ROLE_NAME, AssumeRolePolicyDocument=json.dumps(trust),
            Description="Lolixco production analysis task; no frontend or CI secret access",
            Tags=[{"Key": key, "Value": value} for key, value in TAGS.items()],
        )["Role"]
    if (
        role["Arn"] != f"arn:aws:iam::{account}:role/{ROLE_NAME}"
        or {tag["Key"]: tag["Value"] for tag in role.get("Tags", [])} != TAGS
        or role["AssumeRolePolicyDocument"] != trust
    ):
        raise SecretConfigurationError("Existing backend role ownership or trust differs; migration stopped.")
    # Never widen trust to let an operator assume the runtime role for testing.
    return role["Arn"]


def secret_access_policy(role_arn):
    return {"Version": "2012-10-17", "Statement": [{
        "Sid": "DenyReadsOutsideProductionAIBackend", "Effect": "Deny", "Principal": "*",
        "Action": "secretsmanager:GetSecretValue", "Resource": "*",
        "Condition": {"ArnNotEquals": {"aws:PrincipalArn": role_arn}},
    }]}


def migrate_values(manager, iam, role_arn, values):
    """No GetSecretValue for operators. Install the deny before the first value."""
    payload = json.dumps(validate_keys(values), sort_keys=True, separators=(",", ":"))
    token = hashlib.sha256((SECRET_NAME + "\0" + payload).encode()).hexdigest()
    try:
        metadata = manager.describe_secret(SecretId=SECRET_NAME)
    except manager.exceptions.ResourceNotFoundException:
        try:
            # Deliberately create an EMPTY entry, then enforce its read policy.
            manager.create_secret(
                Name=SECRET_NAME, Description="Lolixco production Gemini and YouTube credentials",
                Tags=[{"Key": key, "Value": value} for key, value in TAGS.items()],
            )
        except manager.exceptions.ResourceExistsException:
            pass  # Another invocation created the same metadata; inspect ownership.
        metadata = manager.describe_secret(SecretId=SECRET_NAME)
    if any({tag["Key"]: tag["Value"] for tag in metadata.get("Tags", [])}.get(k) != v for k, v in TAGS.items()):
        raise SecretConfigurationError("Existing secret is not owned by this migration; no values changed.")
    if metadata.get("DeletedDate") or metadata.get("RotationEnabled") or metadata.get("PrimaryRegion"):
        raise SecretConfigurationError("Secret lifecycle differs; no values changed.")
    arn = metadata["ARN"]
    account = role_arn.split(":")[4]
    if not arn.startswith(f"arn:aws:secretsmanager:{manager.meta.region_name}:{account}:secret:{SECRET_NAME}-"):
        raise SecretConfigurationError("Provider secret account or region differs.")
    policy = secret_access_policy(role_arn)
    manager.put_resource_policy(SecretId=arn, ResourcePolicy=json.dumps(policy), BlockPublicPolicy=True)
    observed = json.loads(manager.get_resource_policy(SecretId=arn)["ResourcePolicy"])
    if observed != policy:
        raise SecretConfigurationError("Secret read restriction could not be verified; no values changed.")
    iam.put_role_policy(RoleName=ROLE_NAME, PolicyName=POLICY_NAME, PolicyDocument=json.dumps({
        "Version": "2012-10-17", "Statement": [{
            "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": arn,
        }],
    }))
    versions = metadata.get("VersionIdsToStages", {})
    current = next((version for version, stages in versions.items() if "AWSCURRENT" in stages), None)
    if current == token:
        status = "unchanged"
    else:
        # Stable SDK request token prevents duplicate versions on retries. A
        # separate stage permits compare-and-swap promotion, including rollback.
        manager.put_secret_value(
            SecretId=arn, SecretString=payload, ClientRequestToken=token,
            VersionStages=["LOLIXCO_MIGRATION_CANDIDATE"],
        )
        promotion = {"SecretId": arn, "VersionStage": "AWSCURRENT", "MoveToVersionId": token}
        if current:
            promotion["RemoveFromVersionId"] = current
        manager.update_secret_version_stage(**promotion)
        status = "configured"
    after = manager.describe_secret(SecretId=arn)
    if "AWSCURRENT" not in after.get("VersionIdsToStages", {}).get(token, []):
        raise SecretConfigurationError("Provider version promotion could not be verified.")
    return {"secret_name": SECRET_NAME, "status": status, "access": "production_ai_backend_only"}


OPERATION_ACTIONS = {
    "GetRole": "iam:GetRole", "CreateRole": "iam:CreateRole", "TagRole": "iam:TagRole",
    "PutRolePolicy": "iam:PutRolePolicy", "DescribeSecret": "secretsmanager:DescribeSecret",
    "CreateSecret": "secretsmanager:CreateSecret", "TagResource": "secretsmanager:TagResource",
    "PutResourcePolicy": "secretsmanager:PutResourcePolicy", "GetResourcePolicy": "secretsmanager:GetResourcePolicy",
    "PutSecretValue": "secretsmanager:PutSecretValue", "UpdateSecretVersionStage": "secretsmanager:UpdateSecretVersionStage",
    "GetCallerIdentity": "sts:GetCallerIdentity",
}


def main(argv=None):
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--profile")
    parser.add_argument("--region", required=True)
    parser.add_argument("--account", required=True)
    parser.add_argument("--backend-service", choices=("ecs", "lambda"), default="ecs")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)
    try:
        values = read_local_keys(args.env_file)
        print(json.dumps({"secret_name": SECRET_NAME, "local_configuration": "valid"}), flush=True)
        if args.validate_only:
            return 0
        import boto3
        session = boto3.Session(profile_name=args.profile, region_name=args.region)
        identity = aws_client(session, "sts", args.region).get_caller_identity()
        if identity["Account"] != args.account:
            raise SecretConfigurationError("AWS account differs from the requested deployment account.")
        iam = aws_client(session, "iam", args.region)
        role = ensure_backend_role(iam, args.account, args.region, args.backend_service)
        result = migrate_values(aws_client(session, "secretsmanager", args.region), iam, role, values)
        print(json.dumps(result))
        return 0
    except Exception as error:
        # Do not print exception text, traceback, HTTP bodies, request IDs, key
        # fingerprints, payloads or an SDK response dictionary.
        result = {"secret_name": SECRET_NAME, "status": "blocked"}
        if isinstance(error, SecretConfigurationError):
            result["configuration_status"] = str(error)
        elif hasattr(error, "operation_name"):
            action = OPERATION_ACTIONS.get(error.operation_name)
            code = getattr(error, "response", {}).get("Error", {}).get("Code", "")
            if action and code in ("AccessDenied", "AccessDeniedException", "UnauthorizedOperation"):
                result["required_iam_action"] = action
                result["required_iam_resource"] = (
                    f"arn:aws:iam::{args.account}:role/{ROLE_NAME}" if action.startswith("iam:")
                    else f"arn:aws:secretsmanager:{args.region}:{args.account}:secret:{SECRET_NAME}-??????"
                )
            else:
                result["configuration_status"] = "AWS operation failed; credentials were not logged."
        else:
            result["configuration_status"] = "Local configuration or AWS SDK is unavailable."
        print(json.dumps(result))
        return 1


if __name__ == "__main__":
    sys.exit(main())
