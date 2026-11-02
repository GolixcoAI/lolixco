# Stage 9 private staging preflight — 2 November 2026

**NO-GO for uploads.** Read-only inspection and local planning only. No AWS writes,
role creation, delivery copies, CDN publication, DNS changes or deployments occurred.
Private account identifiers, raw API responses, rights evidence and media identities
are retained in the external Stage 9 handoff, outside Git.

## Account and infrastructure findings

STS authenticated the existing `lolixco-codex` IAM user. Bucket inventory returned
one Lolixco pilot candidate in addition to the unrelated registration bucket.
The registration bucket's objects were neither listed nor read. The pilot bucket's
name suggests Mumbai, but its name is not evidence of its actual region or security.

The following read calls were denied: bucket location, public access block,
encryption, ownership controls, versioning, policy and lifecycle; IAM attached/inline
user policies and groups; Free Tier account-plan/usage; Budgets; Route 53 zone listing.
CloudFront listing returned no items/output; this is not proof that no distribution
or other access path exists. Effective permissions, permissions boundaries, SCPs,
other account charges, credit amount/expiry/service coverage and budget alerts
remain unverified. No credentials were read, changed or printed. Cost Explorer was
not called because its query cost was not approved. No access was widened.

The owner must supply a trusted read-only configuration/policy export or separately
authorize the narrow inspection policy in `stage9/inspection-policy.json`. Policy
installation is not part of this mission. Inspect group/managed policy versions,
user boundary and resource policies before concluding the identity is read-only.
A narrow attached policy alone does not prove the absence of write permissions.

## Rights and technical inventory

The final Stage 7B v5 manifest contains 30 prepared edits, 20 landscape and 10 Shorts.
All 30 originals, 30 prepared videos and 30 posters match exact SHA-256 identities.
All prepared videos and posters passed fresh full decode; videos are H.264/AAC
with front-loaded moov atoms. Originals were hashed only and were not modified.
Private item-level JSON/CSV retains sizes, hashes, probe output, dimensions,
original approval state and each blocker.

Creative approval and a hash-bound owner attestation from 1 November exist. That
attestation is preserved as evidence. The same records explicitly retain pending
video/audio distribution permissions, attribution, credit requirements and
restrictions; independent permission documents were not supplied. No review state
has been promoted and **0/30 items are upload-eligible** under this mission's
explicit missing-evidence/needs-review gate. The current instruction authorizes
controlled staging after preflight; it does not resolve those missing rights fields.
Obtain an exact-artifact rights record covering both picture and soundtrack,
permitted AWS storage/use, attribution, restrictions and an accountable reviewer.

Three landscape files also fail the existing canonical compiler's aspect requirement:
Bullet Train: Full Speed (1440×1080), Dune: One Name (1920×960), and Before Doomsday:
A Marvel Prelude (1920×820). Their decode success is not canonical-publication
readiness. Do not crop/re-encode originals or loosen the compiler silently; obtain
an approved alternative or a separately reviewed contract decision. Other records
still require future device/playback and public delivery checks.

## Actual bytes and costs

Fresh measured sizes: videos 877,885,065 bytes; posters 1,127,907 bytes; combined
879,012,972 bytes (0.8186446242 binary GB for this worksheet). Private calculation
uses Decimal and archived AWS public price-list SKUs retrieved 2 November 2026.
No account credits or shared free allowances are deducted.

| Proposed scope | Files | Bytes | 30-day storage | PUTs | HEAD + full GET | One full verification download | Base total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Two-pair pilot | 4 | 139,445,337 | $0.003247 | $0.000020 | $0.0000032 | $0.014195 | $0.017465 |
| Complete 30-pair batch | 60 | 879,012,972 | $0.020466 | $0.000300 | $0.000048 | $0.089478 | $0.110292 |

Pilot proposal: largest landscape pair (Demon Slayer: Die a King) and largest
portrait pair (God of War: God Killer), **only after those exact pairs clear rights**.
This bounds a mixed-format pilot but is not approval of either asset.

Mumbai Standard storage $0.025/GB-month; PUT $0.005/1,000; GET/HEAD $0.004/10,000;
ordinary Mumbai internet egress $0.1093/GB in the first paid tier. Upload ingress
has no data-transfer charge. All files fit single PUT: use that deterministic path,
not automatic multipart. The model includes one complete verification download,
retention for 30 days, no retries/replacements, and no new noncurrent versions.
[S3 pricing](https://aws.amazon.com/s3/pricing/),
[S3 regional price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-south-1/index.json),
[transfer price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-south-1/index.json).

Private staging has no CDN delivery. For a **future unauthorized** public-delivery
sensitivity, 1,000 full plays of each of the 30 files in India costs approximately
$89.262 for video bytes and four HTTPS requests/play, before account allowances,
origin requests, logs, security services or taxes. Retrieved first-band India CDN
rates are $0.109/GB and $0.012/10,000 HTTPS requests.
[CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/).

These are base estimates, not all-in limits or measured bills. Existing resource
charges, taxes/FX, retries, versions, downloads beyond verification, access logs,
CloudTrail data events, request metrics, alarms and optional WAF are excluded.
Recommend encrypted, restricted access logging with short retention, targeted
CloudTrail data events and useful CloudWatch metrics; price and approve these
before enabling them. Stage 6's proposed $5 pilot envelope is still a proposal.
The owner must approve the revised all-in envelope and confirm credits and billing
exposure. Alerts at $1/$3/$5 actual and forecast are proposed, not installed.
[Budgets updates lag and do not impose a hard cap](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

## Conditional bucket bootstrap and operator scope

First inspect the existing candidate. Do not create a duplicate just because an
inspection call was denied. The private approval packet names the account, Mumbai
region, existing candidate and conditional new bucket name. If the candidate is
unsuitable, the owner reviews that exact packet, cost envelope and operator first.

For a newly approved dedicated bucket only: CreateBucket in `ap-south-1`, set all
four Block Public Access flags, BucketOwnerEnforced ownership, SSE-S3 AES256,
versioning Enabled, Project/Owner/Stage/ExpiresOn tags, and seven-day incomplete
multipart abort lifecycle. Install HTTPS-only policy and an explicit CloudFront
GetObject deny for `staging/*`, `masters/*`, `audit/*`, `quarantine/*`. No CloudFront
allow is required for private staging. Verify every configuration and effective
policy, including account BPA, access points and existing distributions. No website
hosting, delivery-prefix writes, CDN, IAM-admin or DNS permissions are needed.
See `stage9/bootstrap-policy.json` and `stage9/private-bucket-policy.json`; these are
review templates, not an executable stack. New-bucket names must never resolve to
the registration bucket or silently adopt any preexisting resource.

A trusted owner performs any separately approved IAM role setup. The temporary
staging role trusts one exact existing owner principal, uses a short session and
an exact reviewed session policy listing only cleared `staging/stage9/<hash>/...`
object ARNs. No broad root principal, ACL/tag/policy administration, PassRole,
completed-object delete, promotion, or unrestricted reads. The verifier is a separate
short-lived role/session with exact object/version reads. Review effective role
policies/boundaries as well as templates. `staging-policy.json` and
`verification-policy.json` show the split. The private resolved packet remains
blocked until the actual trusted owner principal and cleared objects are supplied.

## Future pilot and batch acceptance

1. Record owner approval of account, resource, hashes, rights, operator, time window,
   telemetry, retention/cleanup owner and spending envelope. Review expiry and all
   applicable credits; no automatic allowance assumptions.
2. Assume the approved staging role without saving session secrets to evidence.
   Upload only two cleared video/poster pairs, unique content-addressed keys under
   `staging/`, `If-None-Match: *`, explicit AES256, SHA-256 checksum, video/mp4 or
   image/webp, and `private, no-store` cache metadata. Send no originals or audits.
   Save returned VersionId/checksum privately; an ETag is not a SHA-256 proof.
3. Verifier HEADs the exact versions with checksum mode and GETs bytes to hash.
   Reconcile length, MIME, cache metadata, encryption, hash, dimensions, codecs,
   duration and faststart against the approved manifest. Avoid presigned URLs in
   evidence. Partial success never clears a pair.
4. Unsigned S3 GET and HEAD must return denial. Inspect actual distribution origins,
   behaviors, origin paths and effective bucket policy; probe exact staging paths
   on every relevant distribution, warm/cold and encoded variants. No 200 SPA
   fallback may conceal access. A CDN probe requires the relevant domain/config;
   none can be certified now. Do not try unauthorized writes as a permission test.
5. Record request count, bytes, telemetry, failures and delayed actual billing.
   Stop on any unexpected permission, identity, public exposure or budget issue.
   If all gates pass, stage only remaining cleared pairs within the same approved
   manifest and envelope. Do not silently expand scope or retry without a bound.
6. Reconcile every object/version against the private manifest and preserve errors.
   Quarantine failures logically in the ledger; copying to quarantine or deleting
   stored versions needs separate authorized cleanup. Revoke temporary sessions.
   No copies into `optimized/` or `posters/`, publication or promotion follow.

No objects were uploaded, so there are no staged object identities or measured
upload/storage/delivery charges to reconcile. Read-only inventory is not an upload
pilot. Remaining decisions are rights resolution, inspection evidence/permissions,
credits, trusted operator, and a reviewed resource/cost/time envelope.
