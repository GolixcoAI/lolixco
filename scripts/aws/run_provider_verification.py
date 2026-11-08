"""Run one bounded Fargate credential probe, then remove its compute/network resources."""

import argparse
import json
import logging
from pathlib import Path
import sys
import time
import uuid

from migrate_provider_secrets import TAGS, ROLE_NAME, SECRET_NAME, aws_client, backend_trust

LOG_GROUP = "/lolixco/production/provider-verification"
EXECUTION_ROLE = "LolixcoProviderVerificationExecution"


def run(session, account, region, subnet):
    ecs, ec2, iam, logs, manager = [aws_client(session, name, region) for name in (
        "ecs", "ec2", "iam", "logs", "secretsmanager",
    )]
    if aws_client(session, "sts", region).get_caller_identity()["Account"] != account:
        raise RuntimeError("AWS account mismatch")
    secret_arn = manager.describe_secret(SecretId=SECRET_NAME)["ARN"]
    vpc = ec2.describe_subnets(SubnetIds=[subnet])["Subnets"][0]["VpcId"]
    trust = backend_trust(account, region)
    try:
        role = iam.get_role(RoleName=EXECUTION_ROLE)["Role"]
    except iam.exceptions.NoSuchEntityException:
        role = iam.create_role(RoleName=EXECUTION_ROLE, AssumeRolePolicyDocument=json.dumps(trust),
                               Tags=[{"Key": k, "Value": v} for k, v in TAGS.items()])["Role"]
    if role["AssumeRolePolicyDocument"] != trust or any(
        {tag["Key"]: tag["Value"] for tag in role.get("Tags", [])}.get(k) != v for k, v in TAGS.items()
    ):
        raise RuntimeError("Verification execution role ownership differs")
    iam.put_role_policy(RoleName=EXECUTION_ROLE, PolicyName="VerificationLogsOnly", PolicyDocument=json.dumps({
        "Version": "2012-10-17", "Statement": [{"Effect": "Allow",
            "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
            "Resource": f"arn:aws:logs:{region}:{account}:log-group:{LOG_GROUP}:*"}],
    }))
    try:
        logs.create_log_group(logGroupName=LOG_GROUP, tags=TAGS)
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    logs.put_retention_policy(logGroupName=LOG_GROUP, retentionInDays=7)
    run_id = "lolixco-provider-check-" + uuid.uuid4().hex[:12]
    cluster = group = definition = task = None
    # The task receives source code and a secret NAME/ARN, never secret values.
    shared = Path(__file__).resolve().parents[1] / "local-dna/aws_provider_secrets.py"
    probe = Path(__file__).with_name("verify_provider_access.py")
    bootstrap = (
        "import os,pathlib,subprocess,sys\n"
        "os.environ['PIP_DISABLE_PIP_VERSION_CHECK']='1'\n"
        "subprocess.run([sys.executable,'-m','pip','install','--quiet','--no-cache-dir',"
        "'--target','/tmp/sdk','boto3==1.43.126'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=65)\n"
        "sys.path[:0]=['/tmp/sdk','/tmp']\n"
        f"pathlib.Path('/tmp/aws_provider_secrets.py').write_text({shared.read_text()!r})\n"
        f"exec(compile({probe.read_text()!r},'/tmp/verify_provider_access.py','exec'),"
        "{'__name__':'__main__','__file__':'/tmp/verify_provider_access.py'})\n"
    )
    try:
        cluster = ecs.create_cluster(clusterName=run_id, tags=[{"key": k, "value": v} for k, v in TAGS.items()])["cluster"]["clusterArn"]
        group = ec2.create_security_group(GroupName=run_id, Description="No inbound; HTTPS-only provider verification", VpcId=vpc,
            TagSpecifications=[{"ResourceType": "security-group", "Tags": [{"Key": k, "Value": v} for k, v in TAGS.items()]}])["GroupId"]
        ec2.revoke_security_group_egress(GroupId=group, IpPermissions=[{"IpProtocol": "-1", "IpRanges": [{"CidrIp": "0.0.0.0/0"}]}])
        ec2.authorize_security_group_egress(GroupId=group, IpPermissions=[{
            "IpProtocol": "tcp", "FromPort": 443, "ToPort": 443, "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
        }])
        definition = ecs.register_task_definition(
            family=run_id, requiresCompatibilities=["FARGATE"], networkMode="awsvpc", cpu="256", memory="512",
            executionRoleArn=role["Arn"], taskRoleArn=f"arn:aws:iam::{account}:role/{ROLE_NAME}",
            runtimePlatform={"cpuArchitecture": "X86_64", "operatingSystemFamily": "LINUX"},
            containerDefinitions=[{
                "name": "verify", "image": "public.ecr.aws/docker/library/python:3.12-slim", "essential": True,
                "user": "65534:65534", "readonlyRootFilesystem": False,
                "linuxParameters": {"capabilities": {"drop": ["ALL"]}}, "stopTimeout": 2,
                "entryPoint": ["python", "-c"], "command": [bootstrap],
                "environment": [{"name": "LOLIXCO_PROVIDER_SECRET_ARN", "value": secret_arn},
                                {"name": "AWS_REGION", "value": region}],
                "logConfiguration": {"logDriver": "awslogs", "options": {
                    "awslogs-group": LOG_GROUP, "awslogs-region": region, "awslogs-stream-prefix": run_id,
                }},
            }], tags=[{"key": k, "value": v} for k, v in TAGS.items()],
        )["taskDefinition"]["taskDefinitionArn"]
        started = ecs.run_task(cluster=cluster, taskDefinition=definition, launchType="FARGATE", platformVersion="1.4.0",
            count=1, enableExecuteCommand=False, networkConfiguration={"awsvpcConfiguration": {
                "subnets": [subnet], "securityGroups": [group], "assignPublicIp": "ENABLED",
            }})
        if not started.get("tasks") or started.get("failures"):
            raise RuntimeError("Verification task could not start")
        task = started["tasks"][0]["taskArn"]
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            observed = ecs.describe_tasks(cluster=cluster, tasks=[task])["tasks"][0]
            if observed["lastStatus"] == "STOPPED":
                break
            time.sleep(4)
        else:
            raise RuntimeError("Verification task timed out")
        stream = run_id + "/verify/" + task.rsplit("/", 1)[-1]
        result = None
        for _ in range(8):
            try:
                events = logs.get_log_events(logGroupName=LOG_GROUP, logStreamName=stream)["events"]
            except logs.exceptions.ResourceNotFoundException:
                events = []
            for event in events:
                try:
                    candidate = json.loads(event["message"])
                    if isinstance(candidate, dict) and candidate.get("secret_name") == SECRET_NAME:
                        result = candidate
                except (ValueError, TypeError):
                    pass
            if result:
                break
            time.sleep(2)
        if not result:
            raise RuntimeError("Verification result unavailable")
        # Allowlist output even if an unrelated log message gets injected.
        statuses = {"passed", "failed", "not_run", "provider_unavailable", "response_limit_exceeded",
                    "no_supported_result", "request_rejected", "authentication_failed", "permission_denied", "quota_exceeded"}
        safe = {"secret_name": SECRET_NAME}
        for key in ("secret_retrieval", "gemini_model_discovery", "youtube_metadata", "inference"):
            safe[key] = result.get(key) if result.get(key) in statuses else "failed"
        print(json.dumps(safe), flush=True)
        return 0 if all(safe[k] == "passed" for k in ("secret_retrieval", "gemini_model_discovery", "youtube_metadata")) else 1
    finally:
        if task:
            ecs.stop_task(cluster=cluster, task=task, reason="Bounded provider verification completed")
            for _ in range(30):
                if ecs.describe_tasks(cluster=cluster, tasks=[task])["tasks"][0]["lastStatus"] == "STOPPED":
                    break
                time.sleep(2)
        if definition:
            ecs.deregister_task_definition(taskDefinition=definition)
        if cluster:
            ecs.delete_cluster(cluster=cluster)
        if group:
            for attempt in range(15):
                try:
                    ec2.delete_security_group(GroupId=group)
                    break
                except ec2.exceptions.ClientError as error:
                    if error.response["Error"]["Code"] != "DependencyViolation" or attempt == 14:
                        raise
                    time.sleep(2)


def main():
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile")
    parser.add_argument("--account", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--subnet", required=True)
    args = parser.parse_args()
    try:
        import boto3
        return run(boto3.Session(profile_name=args.profile, region_name=args.region), args.account, args.region, args.subnet)
    except Exception:
        print(json.dumps({"secret_name": SECRET_NAME, "production_verification": "failed", "inference": "not_run"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
