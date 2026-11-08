# Stage 18B AWS release candidate

Release candidate: https://d2w2cv3wlh68gg.cloudfront.net

This deployment extends the product and secret-management foundation merged in PRs #19 and #20. It is an owner-inspection release, with no custom hostname and no public indexing. It does not complete the worldwide launch. The deployment PR requires owner approval before merging.

## Ownership and publication

The November 2026 Stage 18B owner instructions explicitly authorize publication of the 30 prepared hosted edits and their metadata, superseding the older inventory's pending-publication flags. No new creator identity is invented. Records without verified editor attribution say “Attribution pending.” Rights and removal enquiries go to `rights@golixco.com`.

The active shared catalog has 27 YouTube embeds and 30 hosted edits: 20 landscape, 10 portrait. `KY0xrjzfFLA` is excluded. The frozen 17-demo foundation files remain unchanged. Public hosted IDs use their established video/Shorts partitions. Content-addressed media URLs remain stable independently of catalog IDs.

`public/media-manifest.json` records associations, original/prepared/delivered hashes, duration and dimensions without local paths. Three delivery copies were re-encoded to repair actual Chromium seek failures; their original prepared files remain untouched. All 30 final URLs decoded, started playback, returned HTTP 206 ranges and sought successfully through CloudFront. All 30 posters returned their expected MIME type. Uploads were checked against S3 SHA-256 checksums.

## AWS resources

| Component | Resource | Purpose |
|---|---|---|
| Foundation | `lolixco-rc-foundation`, ap-south-1 | Separate private S3 origins, DynamoDB, encrypted queues, ECR, temporary image builder and CloudFront |
| Runtime | `lolixco-rc-runtime`, ap-south-1 | HTTP API, API Lambda, image Lambda, cleanup schedule and alarms |
| Firewall | `lolixco-rc-firewall`, us-east-1 | Dedicated CloudFront per-client and overall request limits |
| Distribution | `E1PNFKBQZAM8WJ` | HTTPS preview delivery and same-origin API routing |
| API | `lolixco-rc-api` | Admission, private upload capabilities, job status and reports |
| Worker | `lolixco-rc-worker` | Real FFmpeg processing and optional Gemini inference |
| Existing secret | `lolixco/production/ai/providers` | Reused, encrypted, unchanged provider credentials |
| Existing reader role | `LolixcoProductionAIBackend` | Dedicated worker runtime; only provider-secret reader |
| New budget | `Lolixco-ReleaseCandidate-40USD` | Additional tagged-project alerts at $15/$25/$35/$40 |

The existing restricted preview, other distributions, other buckets, EC2, Copilot functions and pre-existing budgets were not deployment targets. No Cloudflare DNS or mail settings were changed. No EC2, NAT gateway, load balancer or idle container service was added.

## Processing and security

The API gives a visitor an opaque Secure, HttpOnly, SameSite=Strict cookie. Only its hash is stored. Every job, report, cancellation and deletion checks session ownership. Job IDs include 96 random bits. Anonymous cross-session access returns 404.

Uploads use a 60-second regional S3 POST capability with a fixed object key, MIME constraint and maximum content length of 100 MiB. Actual size, media streams, duration, codecs and resource limits are checked in the worker. The worker pins downloads to their HEAD ETag. FFmpeg has bounded formats/protocols, subprocess timeouts and resource limits. No arbitrary URL or local path is accepted.

Uploads become inaccessible after one hour; reports after 24 hours. Cleanup runs every 15 minutes, with one-day private-bucket lifecycle backup and later DynamoDB TTL. Private storage is unversioned so deletion does not leave older upload versions. Worker temporary files are removed after processing/cancellation. Operational logs retain seven days and omit credentials, filenames, content, report text and raw provider errors.

The API cannot read provider secrets. It can sign uploads only under the upload prefix. The worker reads uploads and writes reports, with no bucket listing or report deletion permission. The secret resource policy denies reads outside the dedicated backend role. Its Lambda trust replaces the retired ECS verification-task trust. Migration supports either service explicitly and remains idempotent. No operator read access, local-file fallback, frontend provider configuration or CI credential was added.

CloudFront OAC restricts the published S3 origin to this distribution. The private upload/report bucket has no CloudFront origin. HTTPS, CSP, HSTS, frame protections and noindex headers are configured. Public routes keep the intended `lol.golixco.com` canonical; API errors are never rewritten as HTML.

Container scanning reports Debian package advisories. The critical TIFF finding, CVE-2026-52490, concerns the `tiffcrop` tool, which is absent and explicitly asserted absent by the Docker build. Debian classifies this stable-release issue as minor/no-DSA: https://security-tracker.debian.org/tracker/CVE-2026-52490. This is a documented applicability decision, not a claim that all package findings are patched. Continue routine image updates and advisory review.

## Actual analysis acceptance

A public YouTube edit completed Gemini audiovisual inference through the CloudFront API in approximately 22 seconds. Its six assessments contained media-specific explanations and timestamped evidence. Metadata was retrieved with the configured YouTube credential; metadata alone was not treated as inference.

A real 14.6-second local edit completed cloud FFmpeg processing and consented Gemini review in approximately 115 seconds. Lambda used 638 MB peak within the account's 3,008 MB memory ceiling. The larger memory allocation provides CPU capacity and avoids a permanently running service. The worker has a 600-second outer timeout; FFprobe receives a bounded 45-second cold-image allowance. The production mobile UI also completed a real upload, rendered the report and exported valid six-section JSON without JavaScript errors. A separate session was denied the report.

The full network-isolated regression suite passed 649 tests. Additional synthetic API tests cover ownership, expiry, cross-origin rejection, secure cookies, size/path rejection, report readiness, emergency pause, reuse and Gemini call limits. No real provider credentials are used in CI. Infrastructure templates passed cfn-lint. Release-bundle inspection found no secrets, workstation paths or loopback URLs.

## Cost and capacity

The account is on the AWS Free Account Plan, which is ineligible for CloudFront flat-rate plans. No account upgrade was performed. These estimates deliberately deduct neither promotional credits nor free allowances.

| Scenario | Monthly AWS estimate |
|---|---:|
| Low: 30 short analyses, 3 GB delivery | $9.13 |
| Expected: 100 analyses, 10 GB delivery | $11.15 |
| Busy: 300 analyses, 25 GB delivery | $16.58 |
| Sustained bounded workload / abuse scenario | $34.73 |
| Operational allowance for the last scenario | $4.00 |

The model includes WAF, S3, ECR, Secrets Manager, queueing, logs, alarms, Lambda, API Gateway, DynamoDB, CloudFront requests, functions and delivery. Prices use conservative Mumbai/India allowances; one-off image builds cost extra cents. See AWS service pricing pages for rates. This is a forecast, not a guaranteed bill cap.

Controls: ten analyses/day overall; three/session/day; eight Gemini jobs/day; at most two generation requests/job; twenty upload admissions/day; at most two SQS workers; API rate one request/second with burst eight; WAF 300 requests/client and 1,000 overall per five minutes. Every 15 minutes, the delivery guard checks month-to-date traffic and disables only this distribution after 50 GiB or one million requests. Metrics, rate limits and propagation are delayed; budget alerts do not stop spending at an exact dollar amount.

Gemini is billed separately by Google under the existing project configuration. API keys do not expose the project's billing tier. No paid provider plan was activated. Discovery calls do not substitute for the verified generation requests; conservative call caps also apply to fallback attempts.

## Repeatable operations

Use the authenticated non-root `lolixco-codex` profile. Python dependencies are pinned in `scripts/aws/requirements.txt`. Deployment phases are in `scripts/aws/deploy_release.py`: `foundation`, `firewall`, `budgets`, `build`, `runtime --image <built-image>`, `route`, and `status`. Wait for each CodeBuild image before runtime deployment. Routing preserves existing API and firewall parameters unless explicitly overridden. No GitHub Action deploys resources or publishes content.

Run `publish_media.py <local-inventory>` to validate the explicit inventory, upload only selected video/poster files and produce the public manifest/catalog. It never uploads a directory, environment file or original private inbox. Build with `VITE_ANALYSIS_ENABLED=true VITE_RECSYS_ENABLED=false`, scan with `check-release-build.mjs`, and run `publish_site.py`. This publishes only scanned `dist` files. `verify_cdn.mjs` checks real delivery, decode and seeking using an operator-supplied Playwright installation.

For key synchronization, run `migrate_provider_secrets.py` with the ignored local environment-file path, account, region, authenticated profile and `--backend-service lambda`. Values remain inside the SDK request and the original file remains unchanged. Reports contain names and status only.

Emergency stop: set only the release API's `AI_ENABLED` environment variable to `false`, preserving its other variables, and disable this runtime's SQS event-source mapping. Cleanup still runs. Existing processing can finish within its timeout. To stop public delivery, disable distribution `E1PNFKBQZAM8WJ`; do not alter any other distribution. Resume deliberately after inspection. Runtime deployment currently enables analysis, so do not redeploy it while intentionally paused.

## Domain handoff

An ACM DNS-validation certificate was requested in us-east-1. It is pending validation; the actual CNAME and Console references are in the owner handoff, not a deployment action. The existing failed certificate was left unchanged.

After owner inspection and explicit cutover approval: add the certificate-validation CNAME with DNS-only proxying, wait for ISSUED, configure the distribution alias and certificate, then set Cloudflare `lol` CNAME to `d2w2cv3wlh68gg.cloudfront.net` with DNS-only proxying initially. Verify HTTPS, routes, playback, private API, headers and canonical tags. Enable indexing only in a separately approved production build/header update. Do not change the apex, MX, SPF, DKIM or Email Routing records.

Remaining limitations: real iOS/Android hardware is not available; emulation is not hardware testing. YouTube publishers can change embedding or regional availability, and the player must offer its existing unavailable/open-source pathway. AI findings remain experimental, with unsupported evidence unassessed. The temporary hostname, indexing state and unmerged deployment PR intentionally preserve the final launch decision for the owner.
