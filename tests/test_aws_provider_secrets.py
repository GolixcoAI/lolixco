"""Offline credential-migration regressions. All credentials are synthetic."""

import contextlib
import copy
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/aws"))
sys.path.insert(0, str(ROOT / "scripts/local-dna"))
import migrate_provider_secrets as migration
import aws_provider_secrets as delivery
import verify_provider_access as verification
import check_provider_exposure as exposure

ACCOUNT = "123456789012"
REGION = "ap-south-1"
ARN = f"arn:aws:secretsmanager:{REGION}:{ACCOUNT}:secret:{delivery.SECRET_NAME}-AbC123"
ROLE = f"arn:aws:iam::{ACCOUNT}:role/{delivery.ROLE_NAME}"
VALUES = {"GEMINI_API_KEY": "AQ." + "G" * 100, "YOUTUBE_API_KEY": "AIza" + "Y" * 35}


class Missing(Exception):
    pass


class FakeManager:
    exceptions = SimpleNamespace(ResourceNotFoundException=Missing, ResourceExistsException=FileExistsError)
    meta = SimpleNamespace(region_name=REGION)

    def __init__(self):
        self.metadata = None
        self.versions = {}
        self.calls = []
        self.resource_policy = None

    def describe_secret(self, **kwargs):
        if self.metadata is None:
            raise Missing()
        return {**copy.deepcopy(self.metadata), "VersionIdsToStages": copy.deepcopy(self.versions)}

    def create_secret(self, **kwargs):
        assert "SecretString" not in kwargs
        self.metadata = {"ARN": ARN, "Name": kwargs["Name"], "Tags": kwargs["Tags"]}
        self.calls.append("create_empty")

    def put_resource_policy(self, **kwargs):
        assert kwargs["BlockPublicPolicy"] is True
        self.resource_policy = kwargs["ResourcePolicy"]
        self.calls.append("restrict_reads")

    def get_resource_policy(self, **kwargs):
        return {"ResourcePolicy": self.resource_policy}

    def put_secret_value(self, **kwargs):
        assert "restrict_reads" in self.calls
        self.versions.setdefault(kwargs["ClientRequestToken"], list(kwargs["VersionStages"]))
        self.calls.append("write_value")

    def update_secret_version_stage(self, **kwargs):
        previous = kwargs.get("RemoveFromVersionId")
        if previous:
            self.versions[previous].remove("AWSCURRENT")
        self.versions[kwargs["MoveToVersionId"]].append("AWSCURRENT")
        self.calls.append("promote")

    def get_secret_value(self, **kwargs):
        raise AssertionError("Migration must never read AWS secret values")


class MigrationTests(unittest.TestCase):
    def test_reads_only_required_values_without_touching_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.local"
            text = '\n'.join(f'{k}="{v}"' for k, v in VALUES.items()) + '\nUNRELATED=owner-private-data\n'
            path.write_text(text)
            path.chmod(0o640)
            before = path.stat()
            self.assertEqual(migration.read_local_keys(path, check_git=False), VALUES)
            self.assertEqual(path.read_text(), text)
            after = path.stat()
            self.assertEqual((before.st_mode, before.st_mtime_ns, before.st_ino), (after.st_mode, after.st_mtime_ns, after.st_ino))

    def test_invalid_duplicate_missing_and_symlink_rejected_without_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.local"
            for text in (
                f'GEMINI_API_KEY={VALUES["GEMINI_API_KEY"]}\n',
                '\n'.join(f'{k}={v}' for k, v in VALUES.items()) + f'\nGEMINI_API_KEY={VALUES["GEMINI_API_KEY"]}',
                f'GEMINI_API_KEY="{VALUES["GEMINI_API_KEY"]}\nYOUTUBE_API_KEY={VALUES["YOUTUBE_API_KEY"]}',
                f'GEMINI_API_KEY=$(cat credential)\nYOUTUBE_API_KEY={VALUES["YOUTUBE_API_KEY"]}',
                'GEMINI_API_KEY=' + 'X' * 17000,
            ):
                path.write_text(text)
                with self.assertRaises(delivery.SecretConfigurationError) as error:
                    migration.read_local_keys(path, check_git=False)
                for value in VALUES.values():
                    self.assertNotIn(value, str(error.exception))
            link = path.with_name("link")
            link.symlink_to(path)
            with self.assertRaises(OSError):
                migration.read_local_keys(link, check_git=False)

    def test_tracked_file_is_rejected(self):
        with patch.object(migration.subprocess, "run", side_effect=[SimpleNamespace(returncode=0), SimpleNamespace(returncode=0)]):
            with self.assertRaises(delivery.SecretConfigurationError):
                migration.read_local_keys("/unused/.env.local")

    def test_first_write_then_repeat_rotate_and_rollback(self):
        manager, iam = FakeManager(), Mock()
        first = migration.migrate_values(manager, iam, ROLE, VALUES)
        self.assertEqual(first["status"], "configured")
        self.assertLess(manager.calls.index("restrict_reads"), manager.calls.index("write_value"))
        first_version = next(iter(manager.versions))
        manager.calls.clear()
        self.assertEqual(migration.migrate_values(manager, iam, ROLE, VALUES)["status"], "unchanged")
        self.assertNotIn("write_value", manager.calls)
        self.assertNotIn("promote", manager.calls)
        changed = {**VALUES, "GEMINI_API_KEY": "AQ." + "Z" * 100}
        migration.migrate_values(manager, iam, ROLE, changed)
        self.assertEqual(len(manager.versions), 2)
        migration.migrate_values(manager, iam, ROLE, VALUES)
        self.assertIn("AWSCURRENT", manager.versions[first_version])
        self.assertEqual(len(manager.versions), 2)
        policy = json.loads(manager.resource_policy)["Statement"][0]
        self.assertEqual(policy["Effect"], "Deny")
        self.assertEqual(policy["Condition"]["ArnNotEquals"]["aws:PrincipalArn"], ROLE)
        granted = json.loads(iam.put_role_policy.call_args.kwargs["PolicyDocument"])
        self.assertEqual(granted["Statement"], [{"Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": ARN}])

    def test_no_value_sent_when_policy_or_ownership_validation_fails(self):
        for reason in ("policy", "ownership"):
            manager, iam = FakeManager(), Mock()
            manager.create_secret(Name=delivery.SECRET_NAME, Tags=[{"Key": k, "Value": v} for k, v in migration.TAGS.items()])
            if reason == "policy":
                manager.get_resource_policy = lambda **kwargs: {"ResourcePolicy": '{}'}
            else:
                manager.metadata["Tags"] = []
            with self.assertRaises(delivery.SecretConfigurationError):
                migration.migrate_values(manager, iam, ROLE, VALUES)
            self.assertNotIn("write_value", manager.calls)

    def test_existing_role_trust_is_not_widened(self):
        iam = Mock()
        iam.get_role.return_value = {"Role": {
            "Arn": ROLE, "Tags": [{"Key": k, "Value": v} for k, v in migration.TAGS.items()],
            "AssumeRolePolicyDocument": {"Statement": [{"Principal": "*"}]},
        }}
        with self.assertRaises(delivery.SecretConfigurationError):
            migration.ensure_backend_role(iam, ACCOUNT, REGION)
        iam.update_assume_role_policy.assert_not_called()

    def test_cli_never_echoes_unexpected_exception_details(self):
        output = io.StringIO()
        with patch.object(migration, "read_local_keys", side_effect=RuntimeError(VALUES["GEMINI_API_KEY"])), contextlib.redirect_stdout(output):
            self.assertEqual(migration.main(["--env-file", "/unused", "--region", REGION, "--account", ACCOUNT]), 1)
        self.assertNotIn(VALUES["GEMINI_API_KEY"], output.getvalue())

    def test_exposure_scan_catches_cross_chunk_credentials_without_echoing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bundle.js"
            path.write_bytes(b"x" * (1024 * 1024 - 7) + VALUES["GEMINI_API_KEY"].encode())
            result = exposure.inspect_files([path], VALUES)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["files_with_credentials"], [str(path)])
            self.assertNotIn(VALUES["GEMINI_API_KEY"], json.dumps(result))


class DeliveryTests(unittest.TestCase):
    def test_only_production_role_can_load_and_overrides_inherited_keys(self):
        sts, manager = Mock(), Mock()
        sts.get_caller_identity.return_value = {"Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/{delivery.ROLE_NAME}/task"}
        manager.get_secret_value.return_value = {"SecretString": json.dumps(VALUES)}
        environment = {"GEMINI_API_KEY": "stale-local-key", "AWS_REGION": REGION}
        with patch.object(delivery, "aws_client", side_effect=[sts, manager]):
            result = delivery.load_aws_configuration(ARN, environment, session=Mock())
        self.assertEqual(result["GEMINI_API_KEY"], VALUES["GEMINI_API_KEY"])
        manager.get_secret_value.assert_called_once_with(SecretId=ARN, VersionStage="AWSCURRENT")

    def test_wrong_role_rejected_before_secret_read(self):
        sts = Mock()
        sts.get_caller_identity.return_value = {"Arn": f"arn:aws:iam::{ACCOUNT}:user/operator"}
        with patch.object(delivery, "aws_client", return_value=sts) as factory:
            with self.assertRaises(delivery.SecretConfigurationError):
                delivery.load_aws_configuration(ARN, {}, session=Mock())
        self.assertEqual(factory.call_count, 1)

    def test_production_without_secret_never_creates_or_reads_local_configuration(self):
        configuration = importlib.import_module("configuration")
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / ".env.local"
            for settings in ({"LOLIXCO_DEPLOYMENT": "production"}, {"AWS_EXECUTION_ENV": "AWS_ECS_FARGATE"},
                             {"ECS_CONTAINER_METADATA_URI_V4": "http://169.254.170.2/v4/task"}):
                with self.assertRaises(delivery.SecretConfigurationError):
                    configuration.load_configuration(local, {**settings, **VALUES})
            self.assertFalse(local.exists())

    def test_upstream_diagnostic_with_secret_is_not_reported(self):
        with patch.object(verification, "build_opener", side_effect=RuntimeError(VALUES["GEMINI_API_KEY"])):
            status = verification.check_endpoint("https://example.invalid", VALUES["GEMINI_API_KEY"], lambda data: True)
        self.assertEqual(status, "provider_unavailable")


if __name__ == "__main__":
    unittest.main()
