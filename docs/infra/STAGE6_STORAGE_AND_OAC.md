# Stage 6 — private storage and CDN security

Retrieved official sources: 2026-10-28. Examples are review-only; placeholders must
never be submitted to AWS. No bucket or distribution is created in this stage.

## Storage layout and controls

| Prefix | Contents | CloudFront | Authorized future writers/readers |
| --- | --- | --- | --- |
| `masters/` | Originals; retained independently of encodes | Explicitly denied | Owner archival workflow; verifier reads |
| `staging/` | Unapproved media and proposed encodes/posters | Explicitly denied | Staging operator writes; verifier/promoter reads |
| `quarantine/` | Rejected/restricted content | Explicitly denied | Owner archival workflow; verifier reads |
| `audit/` | Optional private rights and verification evidence | Explicitly denied | Owner archival workflow; verifier reads |
| `optimized/` | Exact approved delivery copies | Specific distribution GET only | Promoter copy/revocation only |
| `posters/` | Exact approved thumbnails | Specific distribution GET only | Promoter copy/revocation only |

The archival workflow is intentionally not granted by staging/promotion templates.
Keep evidence locally until a separate archival permission design is approved.
The promoter is excepted from the private-read deny to read staging, but its identity
policy grants no masters/quarantine/audit reads. Do not attach supplementary grants.

`bucket-settings.json` specifies all four Block Public Access switches,
BucketOwnerEnforced, AES256 default encryption, versioning and multipart abortion
after seven days. No public ACL or public-read policy exists. Retain source backups
locally too. Policy-level public blocking and disabled ACLs are complementary.
See [S3 security best practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
and [ACL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/acl-overview.html).

Default encryption is SSE-S3 for pilot simplicity. SSE-KMS adds a customer key,
key administration, regional key availability, key-policy permission for the exact
CloudFront distribution and encrypt/data-key permissions for upload/copy roles.
A read-only CDN would need decrypt, not a blanket key-use grant. Key policies do
not replace S3 prefix controls. SSE-KMS has key/request charges; verify regional
rates before adopting it. [KMS pricing](https://aws.amazon.com/kms/pricing/).

Versioning recovers overwrites/deletes but retains full billable copies. Routine
DeleteObject makes a delete marker; historical versions remain. Proposed policy:
retain masters/audit until owner-approved retention expiry; review staging and
quarantine at 30 days; review noncurrent versions at 30 days with at least two
known-good releases retained. These are manual review targets, not automatic deletion
rules. Only incomplete multipart abortion is in the example lifecycle. Automatic
expiration needs separate rights/retention approval.
[S3 versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html).

Keep active delivery and posters in Standard. Consider Standard-IA for cold masters
after access history exists: retrieval fees, 30-day minimum, 128-KB billable minimum.
Glacier Instant/Flexible have 90-day minima; Deep Archive has 180-day minimum.
Flexible/Deep Archive need restore planning and cannot be active playback storage.
Transition requests, metadata, retrieval and temporary restored copies can outweigh
small-pilot savings. [Storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)
and [S3 pricing](https://aws.amazon.com/s3/pricing/).

## Origin policy defense

`bucket-policy.json` allows CloudFront `s3:GetObject` only on the two delivery
prefixes with exact `StringEquals` `AWS:SourceArn`. It denies private object and
version reads to everyone except named verifier/promoter role ARNs. Therefore an
accidental additional CloudFront or unrelated same-account read allow cannot
expose those private keys. A second deny rejects other/missing distribution ARNs.
Only the promoter can modify/delete delivery objects under this bucket policy.
The transport deny rejects insecure ordinary-principal requests; AWS service
principals are exempt from that condition because service network context can be
redacted. Always-sign OAC supplies HTTPS for the service path.
[Condition-key guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/amazon-s3-policy-keys.html).

This is not proof of total account isolation. Inventory identity/resource policies,
role trust, session policies, boundaries, bucket/access-point policies and account
public-access settings before pilot. Identity and resource allows combine, while
explicit denials override. Named-role exceptions need equally careful permission
review; administrative policy writers can remove controls. No Organizations or
SCP setup is required or authorized. Static tests model only the operators actually
used, not AWS's entire authorization engine.
[IAM evaluation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html).

## CloudFront configuration

`oac.json` uses SigV4 and `SigningBehavior: always`. `distribution.json` references
`${MEDIA_BUCKET}.s3.ap-south-1.amazonaws.com`, empty OAI and an explicit OAC ID.
No website endpoint, origin failover, origin-path rewriting or edge function is
needed. Start disabled with the CloudFront default TLS certificate; custom domains
would require separately authorized ACM/DNS work. OAC does not authenticate viewers.
[OAC setup](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

The default behavior points at the private origin even for forbidden paths,
intentionally demonstrating that prefix isolation is enforced at S3. GET/HEAD only,
HTTPS-only viewers, compression off. No query/cookie/header variation in cache key.
Byte ranges are handled by CloudFront and S3 without adding Range to cache keys;
valid ranges should yield 206, Content-Range and the correct partial Content-Length.
Malformed ranges can yield a full response. Avoid chunked transfer and compressed
MP4 transformations. [Range GET behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html).

Use versioned paths `optimized/<approved-identity>/<sha256>.mp4` and matching
`posters/<approved-identity>/<sha256>.webp`. Set video Content-Type `video/mp4`,
poster `image/webp` (or actual PNG/JPEG MIME), correct Content-Length, and pilot
Cache-Control `public,max-age=300`. Cache policy: min 0, default 86400, max 31536000;
origin max-age controls effective TTL inside those bounds. Long immutable caching
is an owner decision after incident procedures are proven. Never overwrite a public
key for a replacement. ETag is not a universal SHA-256, especially for multipart.
[S3 origin behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorS3Origin.html).

`response-headers-policy.json` supplies exact app-origin CORS for GET/HEAD, exposes
range/length/ETag and supplies HSTS and nosniff. Basic native cross-origin playback
usually does not require CORS; JS fetch/canvas or `crossorigin` usage may. The
current plan assumes simple single-range requests, no credentials and no OPTIONS
preflight. If actual clients preflight, separately revise allowed methods/origin
CORS and cache key before pilot acceptance. Do not attach HTML frame-denial/CSP
policies indiscriminately to media that must be embedded.

403/404 stay errors; no SPA fallback or 200 remapping. Error cache TTL target is one
second; S3 origins can impose a minimum error-cache interval. Negative responses
must never expose private object contents or metadata. For urgent removals, revoke
origin delivery and invalidate exact cached paths; do not expect a bucket deny to
evict cached data. [Error caching](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesErrorPages.html).

## Test boundary

Offline tests exercise every private prefix for GetObject and GetObjectVersion,
wrong/missing distribution ARNs, anonymous reads, unexpected broad allows,
normalized traversal/encoded paths, staging escape, promotion-source restrictions,
TLS, encryption, ACL and cache configurations. S3 keys are literal; putting a key
with `../` bytes under `optimized/` still places it in the approved namespace.
Future manifest validation must reject ambiguous names. Tests resolve potential
viewer traversal to its resulting private key and verify denial; they do not
claim to reproduce CloudFront URL normalization.

Live pilot must additionally test every forbidden path through the CDN with
`curl --path-as-is`, cold and warm cache, encoded variants, direct S3 unsigned URLs,
wrong-distribution requests where practical and approved-role boundaries. Use
non-sensitive marker fixtures, never real rights evidence. Offline results cannot
establish live AWS enforcement or browser/CDN acceptance.
