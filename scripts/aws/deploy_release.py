"""Controlled release operations with persistent custom-domain settings; no DNS writes."""
import argparse
import hashlib
import io
import json
import logging
from pathlib import Path
import subprocess
import sys
import time
import zipfile

import boto3
from botocore.config import Config

from release_templates import foundation, runtime, firewall
from release_config import load_release_config

ROOT = Path(__file__).resolve().parents[2]
ACCOUNT = "247673029886"
REGION = "ap-south-1"
STACK = "lolixco-rc-foundation"
RUNTIME = "lolixco-rc-runtime"
TAGS = [{"Key": "Project", "Value": "Lolixco"}, {"Key": "Environment", "Value": "release-candidate"}]
CONFIG = Config(connect_timeout=5, read_timeout=30, retries={"mode": "standard", "total_max_attempts": 3}, ignore_configured_endpoint_urls=True)


def client(session, service, region=REGION):
    return session.client(service, region_name=region, config=CONFIG)


def apply(session, name, template, parameters=None, region=REGION):
    cfn = client(session, "cloudformation", region)
    body = json.dumps(template)
    cfn.validate_template(TemplateBody=body)
    args = {"StackName": name, "TemplateBody": body, "Capabilities": ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"], "Tags": TAGS}
    if parameters:
        args["Parameters"] = [{"ParameterKey": k, "ParameterValue": v} for k, v in parameters.items()]
    try:
        cfn.describe_stacks(StackName=name)
    except cfn.exceptions.ClientError as error:
        if "does not exist" not in error.response["Error"].get("Message", ""):
            raise
        cfn.create_stack(**args)
        action = "create"
    else:
        try:
            cfn.update_stack(**args)
        except cfn.exceptions.ClientError as error:
            if "No updates are to be performed" not in error.response["Error"].get("Message", ""):
                raise
            action = "unchanged"
        else:
            action = "update"
    print(json.dumps({"stack": name, "operation": action}), flush=True)
    if action != "unchanged":
        cfn.get_waiter("stack_" + action + "_complete").wait(StackName=name, WaiterConfig={"Delay": 5, "MaxAttempts": 240})
    return outputs(session, name, region)


def outputs(session, name=STACK, region=REGION):
    data = client(session, "cloudformation", region).describe_stacks(StackName=name)["Stacks"][0]
    return {v["OutputKey"]: v["OutputValue"] for v in data.get("Outputs", [])}


def package_source():
    names = subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT).split(b"\0")
    selected = []
    for value in names:
        if not value:
            continue
        name = value.decode()
        if (name.startswith(("scripts/local-dna/", "scripts/edit-dna/")) and name.endswith((".py", "/requirements.txt"))
                or name == "scripts/aws/requirements.txt" or name.startswith("server/production/") and name.endswith((".py", "/Dockerfile"))):
            if ".env" in name or "save_owner_feedback" in name:
                raise RuntimeError("Private source excluded")
            selected.append(name)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(set(selected)):
            archive.write(ROOT / name, name)
    return stream.getvalue()


def package_api():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ("common.py", "api.py"):
            compile((ROOT / "server/production" / name).read_text(), name, "exec")
            archive.write(ROOT / "server/production" / name, name)
    return stream.getvalue()


def start_build(session, base):
    source = package_source()
    s3 = client(session, "s3")
    source_version = s3.put_object(Bucket=base["ArtifactBucket"], Key="source/worker.zip", Body=source, ServerSideEncryption="AES256")["VersionId"]
    s3.put_object(Bucket=base["ArtifactBucket"], Key="source/api.zip", Body=package_api(), ServerSideEncryption="AES256")
    tag = hashlib.sha256(source).hexdigest()[:16]
    ecr = client(session, "ecr")
    try:
        existing = ecr.describe_images(repositoryName=base["ImageUri"].split("/", 1)[1], imageIds=[{"imageTag": tag}])["imageDetails"][0]
    except ecr.exceptions.ImageNotFoundException:
        pass
    else:
        return {"build_id": None, "status": "reused", "image": base["ImageUri"] + "@" + existing["imageDigest"]}
    build = client(session, "codebuild").start_build(projectName=base["BuildProject"],
        sourceVersion=source_version,
        environmentVariablesOverride=[{"name": "IMAGE_TAG", "value": tag, "type": "PLAINTEXT"}])["build"]
    return {"build_id": build["id"], "image": base["ImageUri"] + ":" + tag}


def prepare_role(session):
    iam = client(session, "iam")
    role = iam.get_role(RoleName="LolixcoProductionAIBackend")["Role"]
    tags = {v["Key"]: v["Value"] for v in role.get("Tags", [])}
    if tags.get("Application") != "Lolixco" or tags.get("ManagedBy") != "lolixco-provider-migration":
        raise RuntimeError("Unexpected role ownership")
    iam.update_assume_role_policy(RoleName="LolixcoProductionAIBackend", PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": [{
        "Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]}))


def main():
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["foundation", "build", "runtime", "route", "status", "firewall", "budgets"])
    parser.add_argument("--profile", default="lolixco-codex")
    parser.add_argument("--image")
    parser.add_argument("--api-domain")
    parser.add_argument("--waf-arn")
    args = parser.parse_args()
    session = boto3.Session(profile_name=args.profile, region_name=REGION)
    identity = client(session, "sts").get_caller_identity()
    if identity["Account"] != ACCOUNT or identity["Arn"].endswith(":root"):
        raise RuntimeError("Use the authorized non-root account")
    release = load_release_config()
    if release['account'] != ACCOUNT or release['region'] != REGION:
        raise RuntimeError('Release configuration targets an unexpected account or region')
    if args.phase in {"foundation", "route"}:
        cfn = client(session, 'cloudformation')
        try:
            stack = cfn.describe_stacks(StackName=STACK)['Stacks'][0]
            current = {x['ParameterKey']:x['ParameterValue'] for x in stack.get('Parameters',[])}
        except cfn.exceptions.ClientError as error:
            if 'does not exist' not in error.response['Error'].get('Message',''): raise
            current = {}
        certificate = client(session, 'acm', 'us-east-1').describe_certificate(CertificateArn=release['certificate_arn'])['Certificate']
        if certificate['Status'] != 'ISSUED' or release['public_origin'].removeprefix('https://') not in certificate['SubjectAlternativeNames']:
            raise RuntimeError('The configured custom hostname requires an issued covering certificate')
        result = apply(session, STACK, foundation(), {'AllowedOrigins': ','.join(release['allowed_origins']),
            'ApiDomain': args.api_domain if args.api_domain is not None else current.get('ApiDomain',''),
            'WafArn': args.waf_arn if args.waf_arn is not None else current.get('WafArn','')})
    elif args.phase == "firewall":
        result = apply(session, "lolixco-rc-firewall", firewall(), region="us-east-1")
    elif args.phase == "budgets":
        budgets = client(session, "budgets", "us-east-1")
        name = "Lolixco-ReleaseCandidate-40USD"
        budget = {"BudgetName": name, "BudgetLimit": {"Amount": "40", "Unit": "USD"},
            "TimeUnit": "MONTHLY", "BudgetType": "COST", "CostFilters": {"TagKeyValue": ["user:Project$Lolixco"]}}
        try:
            budgets.describe_budget(AccountId=ACCOUNT, BudgetName=name)
        except budgets.exceptions.NotFoundException:
            budgets.create_budget(AccountId=ACCOUNT, Budget=budget, NotificationsWithSubscribers=[{
                "Notification": {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": threshold,
                    "ThresholdType": "ABSOLUTE_VALUE"}, "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "Lolixco@gmail.com"}]}
                for threshold in (15, 25, 35, 40)])
        else:
            budgets.update_budget(AccountId=ACCOUNT, NewBudget=budget)
        result = {"budget": name, "monthly_usd": 40, "alerts_usd": [15, 25, 35, 40]}
    elif args.phase == "build":
        result = start_build(session, outputs(session))
    elif args.phase == "runtime":
        if not args.image:
            parser.error("--image is required")
        base = outputs(session)
        if not args.image.startswith(base["ImageUri"] + ":") and not args.image.startswith(base["ImageUri"] + "@sha256:"):
            raise RuntimeError("Use an image from this release's private repository")
        image_id = {"imageDigest": args.image.split("@", 1)[1]} if "@" in args.image else {"imageTag": args.image.rsplit(":", 1)[1]}
        digest = client(session, "ecr").describe_images(repositoryName=base["ImageUri"].split("/", 1)[1], imageIds=[image_id])["imageDetails"][0]["imageDigest"]
        api_zip = package_api()
        base["ApiKey"] = "source/api-" + hashlib.sha256(api_zip).hexdigest()[:16] + ".zip"
        client(session, "s3").put_object(Bucket=base["ArtifactBucket"], Key=base["ApiKey"], Body=api_zip, ServerSideEncryption="AES256")
        prepare_role(session)
        secret = client(session, "secretsmanager").describe_secret(SecretId="lolixco/production/ai/providers")["ARN"]
        result = apply(session, RUNTIME, runtime(base, base["ImageUri"] + "@" + digest, secret, release['public_origin'], ACCOUNT))
    else:
        result = outputs(session)
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
