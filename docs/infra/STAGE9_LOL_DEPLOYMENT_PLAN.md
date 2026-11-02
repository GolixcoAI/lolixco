# lol.golixco.com deployment readiness

Plan only, 2 November 2026. No deployment, certificate request, DNS change or
CloudFront promotion is authorized. Follow Stage 6's separation of private staging,
media promotion and catalog publication.

## Observed DNS and hosting

Public DNS-over-HTTPS inspection returned Cloudflare authoritative nameservers
`fay.ns.cloudflare.com` and `rustam.ns.cloudflare.com`, Cloudflare Email Routing
MX targets `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`,
`route3.mx.cloudflare.net`, and SPF `v=spf1 include:_spf.mx.cloudflare.net ~all`.
A/AAAA/CNAME checks returned no answers for the apex or `lol`; HTTPS probes to
apex, `www` and `lol` failed DNS resolution. This identifies the DNS/email provider,
but **does not establish the parent website's hosting provider or absence of a
configured website**. Route 53 inventory was denied. Resolver snapshots are not a
complete authoritative zone export; forwarding destinations and custom DKIM
selectors cannot be discovered reliably from public queries. Sample DKIM and DMARC
queries had no answers; that does not authorize creating, deleting or replacing them.

Before any future change the owner exports the Cloudflare zone, hosting/project
configuration, proxy state, redirects/workers, email-routing rules, all MX/TXT,
SPF/DKIM/DMARC and TTLs. Verify current parent hosting with that export and reconcile
public answers. Preserve every existing record and forwarding rule. Do not move
nameservers, the apex, `www`, or email to AWS. Resolve discrepancies before release.

## Smallest initial deployment

Use the existing React/Vite static build, one new private frontend S3 REST origin
and one frontend CloudFront distribution. Keep media in the separately secured
media distribution; the frontend role must never upload to the media bucket.
Use OAC with always-signed HTTPS, SSE-S3, ownership enforcement, public access
blocking and an exact distribution SourceArn on the frontend read policy.
No S3 website endpoint, public bucket or EC2/NAT/load balancer is required.
[AWS OAC guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

The app already works without a live backend: `src/api/recommendations.ts` disables
API access in production without explicit configuration and supplies deterministic
local fallback results. This keeps initial launch static, but does not run Python's
weighted Jaccard/session recommendation engine. Set `VITE_RECSYS_ENABLED=false`,
leave `VITE_RECSYS_API_URL` unset, build with `BASE_URL=/`, and test fallback source
telemetry and navigation. No frontend YouTube Data API key or AWS credentials.
Vite variables are public build inputs, never a place for secrets.

If live recommendations are a launch requirement, the existing FastAPI app needs
server-side Python execution. The smallest proposed AWS extension is one on-demand
Lambda plus HTTP API Gateway with a reviewed ASGI adapter or equivalent packaging,
using the exact paired public snapshot as an immutable deployment artifact. This
requires a future implementation/benchmark decision; the repository currently has
no Lambda adapter or deployment stack. Preserve lifespan/catalog initialization,
readiness, request limits, timeouts and error shapes; benchmark startup and ranking
before choosing memory/timeout/concurrency. No database is required by the current
in-memory deterministic engine. No API deployment is performed here.

Prefer `/api/v1/*` on the frontend CloudFront distribution to the HTTPS API origin,
with POST/OPTIONS only where needed, disabled caching for recommendation responses,
body-size/rate controls and exact origin isolation. Otherwise use a separate API
hostname with `LOLIXCO_ALLOWED_ORIGINS=https://lol.golixco.com`, no wildcard origins
or credentialed CORS. Set `VITE_RECSYS_ENABLED=true` and the exact `/api/v1` base only
after readiness and version checks. The current client accepts `demo-catalog-v1`
and `catalog-v2`; use a mutually supported approved version and synchronized pair.
Do not expose a new candidate version without updating/reviewing this contract.
The default FastAPI file loader currently pins `demo-catalog-v1`; simply changing
`LOLIXCO_CATALOG_PATH` to the candidate `catalog-v2` snapshot makes readiness fail.
The future backend adapter must explicitly load the approved expected version and
pass the validated Catalog, or implement reviewed version configuration. Also exclude
protected demo IDs from API ranking requests/candidate pools to avoid wasting slots;
the frontend already rejects IDs absent from its real discovery catalog.

## HTTPS, routing and security

Request an ACM certificate for `lol.golixco.com` in `us-east-1` only after deployment
authorization. Owner reviews the validation CNAME at Cloudflare. Retain it for
renewal; do not replace unrelated records. Add the exact alternate domain to the
frontend distribution after certificate validation. Use modern TLS, viewer HTTPS,
GET/HEAD for static assets and compression. CloudFront's S3 origin stays regional
REST with OAC. [Certificate region requirement](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

Prefer a DNS-only Cloudflare CNAME for `lol` to the approved frontend distribution
target, avoiding an unreviewed second proxy/cache layer. Change only that record
and the certificate-validation name(s), after diffing the zone export. If a `lol`
record already exists at change time, stop and review its owner/dependencies rather
than replacing it from this snapshot. Do not create a Route 53 zone or alter NS/MX.

Use immutable hashed JS/CSS with long cache lifetime; `index.html` short/no-cache.
Navigation currently uses query parameters; avoid globally converting S3 403/404
to 200 HTML. Any future route rewrite must apply only to known frontend document
paths, never missing assets, API, or media/private prefixes. Media distribution
only serves approved `optimized/` and `posters/`; staging is always denied.

Review CSP against actual network usage: self scripts/styles/fonts plus required
style allowances, YouTube iframe/API domains, i.ytimg.com posters and the exact
approved media origin; add no unrestricted script source. Validate report-only
CSP before enforcement, including the IFrame API and inline component styles.
Use nosniff, a YouTube-compatible strict-origin-when-cross-origin referrer policy,
appropriate frame/permissions policy for autoplay and fullscreen, and HTTPS-only
media. Check byte ranges, CORS where needed, MIME, cache behavior and private
prefix denials independently of the catalog. OAC protects the origin; it does not
make delivered videos private to viewers.

## Future release and rollback

1. Resolve private-media rights/IAM/budget gates and independently decide whether
   the first release is YouTube-only. Approve exact publication manifest and paired
   compiler outputs; run the Stage 9 read-only review again with fresh evidence.
2. Approve account, new frontend resource names, distribution/plan, certificate,
   DNS-only diff, operator, monitoring, cost envelope, test window and cleanup owner.
   Price frontend storage/requests/transfer, API (if chosen), logs, alarms, security
   and taxes separately. Media staging's small quote is not a launch budget.
3. Build from reviewed local commits with locked dependencies and empty unintended
   environment inputs. Scan output for private paths/audits/secrets. Save old build,
   exact catalog/snapshot, config ETags and zone export. Use versioned release
   artifacts with controlled index selection; no in-place unreviewed replacement.
4. Provision only reviewed resources, inspect security and establish rollback before
   switching DNS. Test the distribution hostname and certificate/domain validation
   without changing parent site/email. Publish only after explicit release approval.
5. Check desktop/mobile Chrome, Firefox and Safari/iOS: search, categories, fandoms,
   Shorts header, Shuffle fading and focus, Watch Now/seek separation, fullscreen,
   shared audio, autoplay rejection, reduced motion, navigation, deep links and
   native MP4 byte-range seeking. Exercise live official YouTube embeds on the final
   origin; the offline browser adapter does not certify live embed availability.
6. Use restricted/encrypted short-retention access logs, CloudTrail data events,
   CloudWatch 4xx/5xx/request/byte metrics and API latency/error/readiness alarms
   where approved. Set cost alerts and nominate a responder; alerts lag and cannot
   enforce a hard spending cap. Price WAF/logging rather than assuming free service.
7. Roll back the frontend index/release to its prior matching public generation;
   invalidate only necessary index paths under approved scope. Restore the exact
   previous `lol` DNS record if needed, preserving all parent/email records. If the
   API is introduced, roll back its alias and paired snapshot together.
8. For media exposure, catalog rollback alone is insufficient: separately authorized
   revocation must block/remove delivery objects and invalidate cached paths, or
   disable the media distribution. Keep staging private throughout. Already
   downloaded media cannot be recalled. Inventory residual resources and charges
   after billing lag; cleanup only explicitly approved dedicated resources.

Remaining owner decisions: parent hosting/complete zone evidence, YouTube-only vs
hosted launch, backend requirement, rights resolution, exact approved resource and
DNS plan, launch budget/monitoring, and separate publication/deployment approval.
