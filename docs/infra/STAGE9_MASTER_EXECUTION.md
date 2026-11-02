# Stage 9 master execution plan — full 58-edit release

The approved product target is 28 official YouTube embeds + 30 hosted edits. Keep all
30 hosted slots. A pilot or a 28-item eligible projection is an intermediate check,
not a reduced launch scope. No cloud writes, IAM changes, upload, promotion, public
publication, DNS changes or deployment is authorized by this document.

## Least-privilege owner setup

The new `stage9/bucket-inspection-policy.json` isolates media bucket inspection from
account-wide IAM/billing information. The private master handoff contains the exact
account/bucket-resolved `OWNER_BUCKET_INSPECTION_POLICY.json`, plus fresh official
operation→action/resource/write-annotation evidence. Ten bucket operations map to
named read actions; GetBucketEncryption maps to `s3:GetEncryptionConfiguration` and
GetPublicAccessBlock maps to `s3:GetBucketPublicAccessBlock`. No object reads, IAM,
billing or writes are included. No dependent write permission is needed for those
read calls. This supersedes the combined Stage 9 inspection policy for new setup;
the earlier file is retained as historical review material, not a requested grant.

Owner-only Console procedure:

1. Sign into the exact intended account with an existing authorized owner identity.
   Compare account/region/candidate bucket with the private approval packet. Do not
   configure keys or change the existing audit user's credentials.
2. Review the resolved bucket-only JSON. If approved, IAM → Users → existing
   lolixco-codex → Permissions → Add permissions → Create inline policy → JSON.
   Review only the named read actions on that exact bucket, name it descriptively,
   and record the change. Codex must not attach this policy itself.
3. Review the user's attached/inline policies, group policies, default managed policy
   versions, boundary and relevant organization/resource constraints owner-side.
   Export only necessary policy evidence privately. Do not delegate account-wide
   IAM discovery merely to inspect one bucket. A single read policy does not prove
   all effective permissions are read-only.
4. Billing owner checks Credits amount/expiry/services, Free Tier/account plan,
   Bills/account exposure and Budgets actual/forecast alerts, sharing a redacted
   summary privately. Budgets does not enforce a hard cap. Confirm whether Cost
   Explorer paid queries are desired before calling them.
5. Export the relevant CloudFront origins/behaviors/OAC/source ARN, account BPA and
   access-point policies owner-side. No registration-media object inspection.
6. Run the exact read checks in the private `owner-readonly-checks.sh` after approval.
   Record errors; do not respond to denial by escalating. No data-plane upload yet.

Previous denied bucket/IAM/Free Tier/Budgets calls remain evidence gaps until
permissions/configuration actually change. No authorization is inferred from this
plan. CloudFront's empty listing is not a certificate of private-prefix isolation.

## Separate temporary roles

- Staging: existing `staging-policy.json`, session narrowed to exact approved
  video/poster object ARNs, AES256, single PUT, no ACLs or policy/config/role/DNS/CDN
  permissions. Prefer 15-minute sessions. No long-lived new keys.
- Verification: exact object/version GetObject/GetObjectVersion only, separate from
  write role. Record checksum, full downloaded-byte hash, version, MIME, length,
  encryption/cache metadata and decoded media identity.
- Promotion: `exact-promotion-policy.json` narrows Stage 6's design to one exact
  source version and destination per statement. Duplicate statements for each
  approved video/poster pair. Copy-source encoding must include the actual version;
  test against AWS policy syntax and simulate before activation. No arbitrary PUT,
  completed-object deletion, bucket admin or distribution edits. Explicit owner
  approval of public delivery is required even before catalog publication.
- Revocation: separate approved cleanup/revocation session for exact delivery
  DeleteObject and exact distribution invalidation, no permanent version deletion.
- Provisioning/maintenance: reuse Stage 6 infrastructure-maintenance and Stage 9
  bootstrap templates with resolved resources and current action mapping. Creation
  is a separate owner operation; uploader never inherits configuration privileges.
  Exact owner trust principal and role setup remain unresolved. No wildcard trust,
  AdministratorAccess, PowerUserAccess, iam:*, or broad service allow is requested.

Review effective policies, boundaries, session scoping and trust, not just examples.
An operator who can change bucket/distribution policies is intentionally distinct
from a media uploader. No template is an activated role or a cloud authorization.

## Full collection operation sequence

Preflight: exact account/region and approved dedicated bucket, all BPA flags,
BucketOwnerEnforced, SSE-S3, versioning, lifecycle, no public ACL/policy, private
prefix CloudFront deny, exact OAC grants only on approved delivery prefixes.
Inspect every actual access path; preserve existing unrelated buckets. Resolve
per-item visual/audio/finished-edit use basis, attribution conditions, derivative
approval, exact hashes, approved origin, costs/credits, telemetry, retention,
shutdown operator and a bounded spending/time envelope. Do not confuse small
storage estimates with a launch budget.

Pilot after gates: one or two cleared pairs, content-addressed `staging/` keys,
If-None-Match, explicit MIME/AES256/SHA256 and private cache metadata. Verify exact
versions and bytes with the separate verifier. Unsigned S3 and all relevant CDN
paths must deny access, including encoded paths, warm/cold checks and HEAD. Record
requests, bytes, failures and delayed bill/credit evidence. No unapproved retries.

Full batch: after successful pilot **and owner batch-scope approval**, upload all
remaining cleared pairs. Reconcile all 30 planned entries as staged, pending,
failed or awaiting use evidence; do not lose slots or double-upload changed hashes.
Record object/version identities in the private manifest. Quarantine failures in
the ledger. Preserve originals and prior derivatives, and price retained versions.

Delivery: separately approved exact-version copies into `optimized/` and `posters/`,
OAC HTTPS GET/HEAD with the exact distribution ARN, and no access to staging/audit/
masters/quarantine. Check bytes, MIME, ranges/206, seek near end, audio, browser
playback and credits. Promoted objects are reachable regardless of catalog listing.
No delivery is executed by this mission.

Publication: all 58 eligible real records + 17 unchanged protected demos, unified
compiler only, version `catalog-v2`, paired preview diff and owner release decision.
The version-aware API configuration must explicitly match that version. Default
remains `demo-catalog-v1`; mismatches fail closed. Static local fallback is valid
for the complete 58-item app, but does not run Python's weighted Jaccard/session
ranking. Do not substitute a YouTube-only release.

Deployment: retain Cloudflare nameservers, parent site, all MX/SPF/DKIM/DMARC and
email forwarding; obtain owner zone/hosting export. Frontend private S3 + separate
CloudFront, independent media origin/distribution, ACM us-east-1, only reviewed
lol CNAME/validation names changed after approval. The owner verified rights@golixco.com; policy drafts remain unpublished until final review. Use the existing deployment
plan, superseding its prior YouTube-only release option with the full 58 target.

Rollback: known matching frontend/snapshot generation and API version; preserve
transaction journals, release builds, config ETags and the DNS export. Delivery
revocation needs exact object restriction/removal plus cache invalidation or
separately authorized distribution disable. Catalog removal alone is insufficient.
Do not destroy evidence/originals, change unrelated resources or assume downloaded
copies can be recalled. Inventory residual charges after billing delay.

## Owner review packet and evidence limits

The external private `stage9-master` packet contains the resolved bucket JSON,
Console instructions, 30-row eligibility matrix, local 75-record review manifest,
repair hashes/comparisons and separate staging/public-service cost scenarios.
Account-specific records and owner media remain outside Git. Read-only action
mapping was checked against the downloaded AWS service reference. No policy was
attached and no role assumed or activated.

[Official Console inline-policy instructions](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_manage-attach-detach.html).
Select CloudFront pay-as-you-go versus a flat-rate plan explicitly before approval;
the cost worksheet uses pay-as-you-go sensitivity, not a claim about the account's
current plan, credits, or bill. Review both frontend and media distributions.
