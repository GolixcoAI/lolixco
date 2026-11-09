# Custom-domain preparation — 10 November 2026 (IST)

The existing release distribution is prepared for `https://lol.golixco.com`. Traffic DNS and public indexing remain pending owner activation. PR #21 remains unmerged; this is not a worldwide-launch completion claim.

## AWS state

- Account `247673029886`; CloudFront `E1PNFKBQZAM8WJ`, domain `d2w2cv3wlh68gg.cloudfront.net`, **Deployed**.
- ACM `arn:aws:acm:us-east-1:247673029886:certificate/e72270a3-5d05-43a8-88e9-286ab2d73344`: **ISSUED**, attached and in use; SNI; minimum viewer policy `TLSv1.2_2021`.
- Alternate domain `lol.golixco.com` is attached. AWS `ListDomainConflicts` returned only this distribution/account, with no other association.
- Foundation/runtime updates completed through reviewed CloudFormation change sets. No stateful resource replacement or removal was requested. Existing origins, OAC, WAF, queues, quotas, secrets and worker allocation remain.

## Persistent deployment settings

`config/aws-release.json` contains public deployment identifiers, the certificate, the exact production and preview origin allowlist, and `public_indexing: false`. No credentials are stored there. Deployment scripts load and validate it. Foundation/route updates preserve the existing API and WAF parameters; runtime updates preserve the production origin. Subsequent deployments retain the custom certificate and alias.

The API validates both exact HTTPS origins. Private S3 CORS permits those same two origins, without a wildcard origin. The API remains same-origin `/api/v8/*`, with caching disabled and the viewer Host excluded at the API Gateway origin. Cookies remain host-only, Secure, HttpOnly and SameSite=Strict. A new hostname creates a new private browser session; preview reports do not transfer automatically.

All 30 hosted video/poster pairs use relative `/media/hosted/...` URLs, and the publication generator now emits relative paths. The integrity manifest, IDs, hashes and delivered objects are unchanged. Build asset validation recognizes only exact integrity-bound manifest entries as externally delivered; unlisted missing media still fails. The strict same-origin CSP remains.

## Indexing activation gate

The homepage title remains `Lolixco | Discover Edits`; branding, favicon, OG image, sitemap and llms.txt are preserved. Canonicals and social URLs already use the official hostname. Public HTML, response headers and robots remain unindexed during preparation.

At the owner-authorized final cutover, after public DNS/TLS verification:

1. Change `public_indexing` to `true` in `config/aws-release.json`.
2. Build with `LOLIXCO_PUBLIC_RELEASE=1 VITE_ANALYSIS_ENABLED=true VITE_RECSYS_ENABLED=false npm run build`.
3. Deploy the existing foundation/route configuration, publish the scanned frontend, invalidate, and verify public/private indexing behavior.

The publisher rejects a build whose robots mode differs from the committed configuration. A viewer-response function keeps the temporary CloudFront hostname, private analysis URLs, API and errors noindex after activation. The preview robots response always disallows crawling. Private uploads/reports have no public origin or discovery links. Do not enable indexing simply because the certificate/alias exists.

## Actual pre-DNS verification

These tests connected to a CloudFront edge using a DNS override for **the original `lol.golixco.com` hostname**, preserving SNI and Host. TLS verification stayed enabled; there was no intercepted application response or TLS bypass. They are not final public-DNS verification.

- Curl: HTTPS 200 with successful certificate validation under TLS 1.2; HTTP redirects to HTTPS. Chromium negotiated TLS 1.3 with the correct Amazon-issued hostname certificate.
- Ten public routes returned 200 with correct canonical/social metadata and staging noindex. Homepage layouts passed at 320, 390, 768 and 1366 pixels with zero horizontal overflow. Three repeated mobile navigation cycles passed 12 touch-scroll checks with zero JS errors.
- The shared catalog retains **57 records: 27 YouTube and 30 hosted**. All 30 hosted videos and posters returned their expected MIME/range responses; all videos decoded, advanced playback, matched manifest duration/dimensions and sought successfully. Official YouTube iframe integration and its dynamic page-origin configuration remain.
- Production-domain private upload returned HTTP 204 and the exact production CORS origin. OPTIONS allowed production and preview; an unrelated origin received 403 with no allowed-origin header. Preview API access also remains operational.
- A genuine Gemini-enabled upload created a job, showed real stages, survived page refresh, completed with supported partial results and exported valid JSON. A second session received 404 for the first job. A separate signal-only job was cancelled and remained CANCELLED. No additional generation workload was used for cancellation.
- The actual inference attempt returned the pre-existing temporary provider error. It produced two supported signal scores, not a new successful six-score semantic assessment. A separate non-generative model-discovery request authenticated the original configured Gemini credential successfully and made zero generation requests. This local authentication diagnostic does not claim backend inference success. No keys were printed, changed, placed in arguments or added to Git.
- Acceptance used the remaining daily beta job admissions. Do not raise/reset counters or repeatedly retry Gemini to force a pass. The ten-job admission window resets at 00:00 UTC / 05:30 IST; Gemini-generation availability remains an external-provider check.
- 656 network-isolated Node tests passed. Python tests cover exact transition origins, cookie/report isolation and deployment persistence. cfn-lint passed; temporary official Guard 3.1.2 checks passed the scoped private-bucket, TLS and worker-bound rules; CloudFormation service/change-set validation completed. These scoped Guard checks are not a full compliance-framework certification. Exact configured provider-value exposure scanning passed for sources and the production build.

Physical Android/iOS, in-app browsers and macOS Safari hardware remain unavailable. The earlier Stage 18C WebKit/Firefox UI checks are not represented as new custom-domain DNS/TLS tests.

## Cloudflare handoff and final verification

Keep the existing ACM validation CNAME unchanged. When the owner chooses to switch traffic, add only:

| Type | Name in the golixco.com zone | Target | Proxy | TTL |
|---|---|---|---|---|
| CNAME | `lol` | `d2w2cv3wlh68gg.cloudfront.net` | DNS only / grey cloud | Auto |

After owner confirmation, verify public DNS without overrides, TLS, routes, all media, upload/session isolation, job lifecycle and one successful semantic inference when quota/provider availability permit. Enable indexing deliberately through the gate above. Leave PR #21 open until the owner's separate merge authorization.

Rollback evidence outside Git includes the prior stack templates, distribution configuration, CORS and site object-version IDs. Revert only this release's stacks/site versions and invalidate if needed; do not reset stored jobs or touch media objects. No Cloudflare DNS, validation record, parent website, email/MX or unrelated AWS workload was modified. No new distribution, bucket, always-on compute or provider plan was created.
