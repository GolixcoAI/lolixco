# Stage 6 — IAM and CLI boundary

Official guidance retrieved 2026-10-28:
[IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html),
[policy evaluation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html),
[CloudFront machine-readable service authorization](https://servicereference.us-east-1.amazonaws.com/v1/cloudfront/cloudfront.json).

## Current audit identity

Existing WSL2 CLI `/home/rohan/.local/bin/aws`, version 2.39.0; existing IAM user
and profile `lolixco-codex`. Existing policy name `LolixcoCodexStage6ReadOnly` is
owner-reported, not independently audited for all effective permissions. Do not
reinstall, configure credentials, use default credentials, read credential files,
install/configure AWS MCP, or widen permissions. Selecting Codex/MCP during setup
does not authorize those changes. Stage 6 read-only limits apply even if the
identity unexpectedly has broader access.

Approved calls used (all with explicit profile, region, no pager):

```bash
/home/rohan/.local/bin/aws --version
/home/rohan/.local/bin/aws sts get-caller-identity --profile lolixco-codex --region ap-south-1 --no-cli-pager
/home/rohan/.local/bin/aws s3api list-buckets --profile lolixco-codex --region ap-south-1 --no-cli-pager
/home/rohan/.local/bin/aws cloudfront list-distributions --profile lolixco-codex --region ap-south-1 --no-cli-pager
/home/rohan/.local/bin/aws ec2 describe-regions --profile lolixco-codex --region ap-south-1 --no-cli-pager
/home/rohan/.local/bin/aws ec2 describe-instances --profile lolixco-codex --region ap-south-1 --no-cli-pager
```

All five API calls succeeded during this stage; private output and exact timestamps
are in the external handoff. This establishes basic identity and inventory access,
not the absence of write permissions or full multi-region inventory. No bucket
objects were inspected. Denials must be recorded and worked around with local
design, never by expanding access. No Cost Explorer API calls were made; paid
query/API costs and account credit details are not assumed.

`audit-policy.json` is a proposed minimal inspection example, not a copy of the
installed policy. Resource `*` is used only for the named inventory/identity APIs
that do not support the desired individual-resource restriction. It includes no
object reads, IAM administration, billing mutation or write API.

## Three tiers with separate scopes

| Tier | Proposed permissions | Boundary |
| --- | --- | --- |
| A: current read-only audit | Named inventory and identity calls | No writes, no new auth integration |
| B: future staging operator | List `staging/*`; PutObject, multipart part listing/abort there | No reads/private evidence, no ACL/tag/admin APIs, no delivery writes |
| C: separately authorized operators | Promotion and infrastructure maintenance as distinct roles/sessions | Never combine daily upload with policy administration |

`staging-policy.json` includes an explicit delivery-write deny. It cannot upload to
masters, quarantine or audit. Multipart creation/upload/completion use PutObject;
abort/list-parts have separate actions. Interrupted sessions rely on the seven-day
abort rule. No delete of completed objects is granted. Owner can request cleanup
through a separately reviewed operation.

`promotion-policy.json` reads exact staging namespace, permits CopyObject via
`s3:PutObject` only with a staging copy-source condition, permits delivery
DeleteObject for revocation, and scopes invalidations to the one distribution.
It cannot change policies or upload arbitrary payloads directly. Limit its future
session policy further to the reviewed source versions and destination object ARNs.
Review source hash, rights, metadata, poster pairing, exact copy-source encoding and
copy result. A namespace allow is not per-object editorial approval. Do not grant
permanent DeleteObjectVersion: retained-version destruction needs a cleanup session.

`infrastructure-maintenance-policy.json` scopes bucket configuration changes and
CloudFront/OAC update/get operations to exact future resources. This role is highly
trusted: PutBucketPolicy can weaken isolation, and UpdateDistribution can alter
origin routing. Use an independently reviewed change set, owner-supervised short
session and rollback evidence. It has no IAM/PassRole, creation, deletion or media
permissions. It is a maintenance scope, not an end-to-end bootstrap policy.

Bootstrap must be a separate owner authorization and permission review for the
specific new bucket, distribution, OAC, cache/response policies, tags, budgets/logs
and cleanup scope. Some creation/list APIs require `Resource: *`; do not hide that
fact with a misleading scoped ARN. No bootstrap role granting those operations is
shipped here. Future deployment is NO-GO until that resource/action mapping and
cost are reviewed. Approved promotion is likewise separate from deploying infra.

## Temporary credentials and trust

Prefer short assume-role sessions from an existing trusted owner role or existing
federation. `operator-trust.json` is a minimal exact-principal relationship; resolve
it to an actual owner role only during a separately approved setup. Configure MFA
at that trusted upstream identity; do not assume federated MFA populates IAM's
`aws:MultiFactorAuthPresent` identically to IAM-user MFA. No broad account-root or
wildcard trust. Require useful session identity, review logs, and per-session scope.
A role chain has a one-hour session maximum. Do not create/join Organizations or
Control Tower for authentication, because credit eligibility could be affected.

Before activation, evaluate all policies attached to the new roles; keep permissions
exclusive and review boundaries/session policies. A narrow example policy alone
does not prevent an unrelated attached policy granting extra access. Existing
resource administrators can change policies, which the offline verifier cannot stop.
Future IAM Access Analyzer/Policy Simulator review is useful but not performed in
Stage 6, and is not a replacement for authorized pilot denials.

Rotation/offboarding: inventory authorized principals; move future engineering to
short-lived sessions; review access on each pilot and periodically thereafter.
For the existing user, owner rotates long-lived keys through their own secure
process and disables superseded keys after verifying dependents, without putting
secrets in chat/Git. On offboarding, revoke role trust/access and active sessions,
disable user keys as appropriate, remove local secret copies via the owner's
credential tooling, and retain audit evidence. All are future owner-authorized
changes, not Stage 6 actions.

`IAM_ACTION_EVIDENCE.json` preserves official service-reference action names, access
annotations and resource types retrieved from public AWS endpoints. Offline tests
check all example allow actions against that snapshot; this is not a live Access
Analyzer validation or a complete AWS schema validator.
