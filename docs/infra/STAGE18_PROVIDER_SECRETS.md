# Stage 18 provider secret migration

> Historical milestone evidence. Current main includes the public beta, custom-domain activation and Lambda runtime. Start with [the current handoff](../../GETTING_STARTED.md#verified-state-and-evidence) and [domain activation](CUSTOM_DOMAIN_PREPARATION.md) before applying older release gates or ECS/preview instructions.

Verified on 8 November 2026. This completes the automatic credential migration slice of the owner's Stage 18 release instructions. It does not declare the broader production launch complete.

| Check | Result |
| --- | --- |
| Existing ignored local Gemini and YouTube configuration | Validated directly; neither value printed |
| Managed secret | `lolixco/production/ai/providers`, configured in `ap-south-1` |
| Encryption | AWS managed `aws/secretsmanager` KMS key; TLS SDK requests |
| Production reader | `LolixcoProductionAIBackend`, ECS task role |
| Operator read attempt | Denied by the secret resource policy |
| Repeated migration | Unchanged; no new value version |
| Cloud task secret retrieval | Passed under the production backend role |
| Cloud Gemini authentication/model discovery | Passed |
| Cloud official YouTube metadata access | Passed |
| Gemini generation/media analysis during verification | Not run |
| Verification compute/network cleanup | No verification clusters or security groups remain |

The owner explicitly authorized migration from the existing local configuration and the controlled AWS release. No additional entry of keys is required. The original configuration is opened read-only, with no symlink following, shell evaluation, interpolation, chmod, copy or rewrite. On Linux it is also opened with `O_NOATIME`. Only the two required credential fields are selected; unrelated settings are never uploaded. Nothing uploads the environment file to S3.

## Run during backend deployment

Use an authenticated owner/deployment identity with the permissions below. Run this from the repository before creating/restarting the production workers. The migration is a separate SDK operation; do not add secret values to CloudFormation, Terraform, ECS environment definitions, build arguments, a CI secret dump, or a shell command.

```bash
python3 -m venv "$HOME/.venvs/lolixco-aws"
"$HOME/.venvs/lolixco-aws/bin/pip" install -r scripts/aws/requirements.txt
"$HOME/.venvs/lolixco-aws/bin/python" scripts/aws/migrate_provider_secrets.py \
  --env-file /home/rohan/Lolixco-stage15b/scripts/local-dna/.env.local \
  --profile lolixco-codex --region ap-south-1 --account 247673029886
```

`--validate-only` checks the ignored, untracked local source without making AWS calls. Exit code zero means success; nonzero stops deployment. Console output contains only the managed-secret name, configuration status, and a scoped IAM requirement if permission is denied. Never enable SDK wire logging or print raw exception objects around secret operations.

The first migration creates an empty secret, installs and reads back the explicit read-deny policy, grants the backend `GetSecretValue` on the exact secret ARN, then writes credentials. A failed access-policy check prevents credential upload. Subsequent runs verify ownership tags and role trust before updating anything. They refuse an unrelated or externally managed secret/role with the same name.

A deterministic SDK request token makes value writes idempotent without operator `GetSecretValue` permission. Matching `AWSCURRENT` skips writing a new value version. Rotation writes a candidate and promotes it with the previously observed current version as a concurrency check. Restoring an older local credential pair promotes its existing version rather than creating duplicates. Version identifiers and credential fingerprints are not printed. Run one deployment at a time; if another deployment races a promotion, rerun after it finishes. AWS documents [idempotent value writes](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html) and [version-stage promotion](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_UpdateSecretVersionStage.html).

## Backend delivery

Attach `LolixcoProductionAIBackend` as the production worker's **task role**. The separate ECS execution role does not receive provider secret access. Do not grant `sts:AssumeRole` to the developer/CI identity for testing. The role trusts ECS tasks in this AWS account/region; the deployer must constrain `iam:PassRole` to this exact role and `iam:PassedToService=ecs-tasks.amazonaws.com`.

Set only nonsecret runtime configuration:

- `LOLIXCO_DEPLOYMENT=production`
- `LOLIXCO_PROVIDER_SECRET_ARN`: the complete ARN returned by `DescribeSecret` for the named secret.
- `AWS_REGION=ap-south-1`

`configuration.load_configuration` retrieves `AWSCURRENT` into backend memory before provider imports. Direct Python and ASGI production startup both load managed configuration. ECS/AWS runtime markers also require managed configuration, so omitting the explicit deployment flag cannot silently activate a local fallback inside a cloud task. An unexpected caller role, missing ARN, mismatched region, AWS failure, or invalid secret fails startup; there is no local-file or stale-environment fallback. Managed keys replace inherited developer keys. Existing consent gates and separate `LOLIXCO_GEMINI_YOUTUBE` enablement remain in force; migration does not enable generation.

The resource policy denies `GetSecretValue` to every principal except the production backend role, including the migration operator and unrelated Copilot workloads. Administrative identities able to alter IAM/resource policies retain administrative recovery capabilities. Do not grant secret-policy administration to the frontend, CI build, API caller, or execution role. [AWS resource policy guidance](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_resource-policies.html) and [ECS task versus execution roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html).

## Required IAM operations

The migration identity needs the following operations. It does **not** need `secretsmanager:GetSecretValue` or permission to assume the runtime role.

| Actions | Scope |
| --- | --- |
| `iam:GetRole`, `iam:CreateRole`, `iam:TagRole`, `iam:PutRolePolicy` | `arn:aws:iam::247673029886:role/LolixcoProductionAIBackend` |
| `secretsmanager:DescribeSecret`, `secretsmanager:CreateSecret`, `secretsmanager:TagResource`, `secretsmanager:PutResourcePolicy`, `secretsmanager:GetResourcePolicy`, `secretsmanager:PutSecretValue`, `secretsmanager:UpdateSecretVersionStage` | `arn:aws:secretsmanager:ap-south-1:247673029886:secret:lolixco/production/ai/providers-??????` |

Tagged creation also requires the respective tagging action. [CreateSecret permissions](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_CreateSecret.html). The default AWS managed KMS key avoids a separate customer key and its permissions/charges; substituting a customer managed key requires updating encryption and IAM deliberately. [AWS encryption recommendations](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html).

The optional Fargate verifier additionally needs ECS cluster/task lifecycle operations on its `lolixco-provider-check-*` resources, `iam:PassRole` on the backend and verification execution roles, creation of `LolixcoProviderVerificationExecution` with the same scoped ECS trust, log-group/stream operations on `/lolixco/production/provider-verification`, and EC2 subnet discovery/security-group lifecycle operations in the selected VPC. These broader deployment permissions are not granted to the backend. The verification execution role only writes to that log group; logs expire after seven days.

## Cloud verification without generation

```bash
"$HOME/.venvs/lolixco-aws/bin/python" scripts/aws/run_provider_verification.py \
  --profile lolixco-codex --account 247673029886 --region ap-south-1 \
  --subnet subnet-0d4cd6996fa367738
```

This runs one 0.25 vCPU/512 MiB Fargate task as the production backend role, with no inbound network access, HTTPS-only outbound traffic and no ECS Exec. It installs the pinned SDK into temporary task storage before retrieving credentials. Only program source and the nonsecret secret ARN enter the task definition. Provider credentials are retrieved by the runtime SDK, not ECS secret injection or image build. The task checks `models.list` and one official YouTube `videos.list`; headers carry keys, redirects are refused, bodies are bounded and upstream diagnostics are suppressed. No generation, media upload, user analysis, transcript fetch or stream download occurs. [YouTube metadata request semantics](https://developers.google.com/youtube/v3/docs/videos/list).

The runner stops the task, deregisters its task definition and removes its cluster/security group. The execution role and seven-day status log group remain reusable. It creates no service, scheduler, standing worker, NAT gateway or public API. The orchestrator enforces a four-minute observation deadline and stops the task on failure. Keep the orchestrator running until cleanup completes. If interrupted forcibly, stop any matching task and remove its dedicated cluster/security group before retrying. A failed probe is not production acceptance.

Secrets Manager storage/API requests, the brief Fargate task/public IPv4/image transfer, and minimal status logs have normal AWS charges; no promotional credits are assumed. No recurring compute remains. Review [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/) and [Fargate pricing](https://aws.amazon.com/fargate/pricing/) when expanding usage. Do not invoke generation or launch persistent capacity as part of this credential check.

## Validation and rollback

```bash
python3 -m unittest discover -s tests -p test_aws_provider_secrets.py -v
node scripts/check-release-build.mjs dist
"$HOME/.venvs/lolixco-aws/bin/python" scripts/aws/check_provider_exposure.py \
  --env-file /home/rohan/Lolixco-stage15b/scripts/local-dna/.env.local \
  --build-dir dist
```

The exact-value scanner compares the local keys in memory against tracked/unignored source and explicitly supplied build outputs, without writing the keys or matching snippets. It complements prefix checks for standard Google keys and newer Gemini authorization keys; neither claims to detect every possible unrelated secret. CI uses synthetic credentials only and never loads the owner's local file or production secret.

For a provider rotation, update the existing local key fields outside chat, rerun migration, then restart/drain production workers so cached provider instances refresh. For rollback, restore the intended local pair and rerun the same migration; previous secret versions remain encrypted. Keep the resource read restriction in force throughout. Never weaken the read policy merely to inspect a value.

The full production AI service, durable jobs, tenant isolation, media release, frontend rollout, catalog acceptance, final DNS cutover and full analysis tests are separate Stage 18 deliverables. Their completion is not implied by this credential-migration result.
