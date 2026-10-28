# Stage 6 — future deployment, acceptance and rollback

This runbook describes future owner-authorized work. Stage 6 is review-only and
must not execute it. Explicit owner approval is required for every chargeable
resource/deployment and media operation. No deploy script or CI cloud credentials
are shipped. Placeholder JSON is not a directly deployable stack.

## Offline verification now

From the Stage 6 worktree:

```bash
node scripts/validate-stage6-infra.mjs
node scripts/stage6-cost-model.mjs
npm test
npm run typecheck
npm run check:assets
npm run check:content
python3 -m unittest discover -s server/recsys/tests -v
python3 -m server.recsys.export_catalog --check
npm run build
sha256sum src/data/edits.ts
```

Use the trusted Stage 1 shell runner through npm test. Do not substitute test:raw
or fake isolation variables when namespaces fail. These checks use fixtures and
existing assets, not real uploads, YouTube calls or CDN URLs. No test should invoke
AWS CLI or deployment APIs. Local validation checks supported JSON/IAM invariants,
not AWS API schemas in their entirety. No live security certification is claimed.

## Future pilot preflight and deployment sequence

1. Owner approves account, new bucket name, region, exact bootstrap permissions,
   resource count, operators, cost envelope, pricing model, logging/WAF scope,
   expiry time and cleanup owner. Inventory all effective policies privately.
   Reject `golixco-registration-media-*` and all existing-resource names. Staging
   and promotion credentials are separate from current audit profile.
2. In a separately reviewed deployment implementation, resolve every placeholder;
   require explicit authorization manifest, reject protected names, validate JSON
   against current AWS schemas and action/resource mappings, and review a complete
   local change plan. Never put private identifiers/inventory in the public repo.
   Stage 6's assertReleaseReady blocks all release attempts even after substitution.
3. Under that future authorization, create only the new bucket with public blocking,
   ownership, encryption, versioning and approved lifecycle/tags. Bootstrap OAC,
   cache/response policies and a disabled distribution. Resolve distribution ID
   into the exact bucket policy. Attach policy and OAC; verify complete config
   before enabling. No broad temporary read grant needed. Do not weaken private
   denies to troubleshoot OAC. Wait for deployment propagation.
4. Apply separately approved trust/permission scopes. Start a short staging session
   for 1–2 already authorized samples. Preserve owner manifest, hash, full decode,
   rights/audio evidence and object versions outside public output. Verify both
   video and poster. Quarantine failures; never promote on partial success.
5. Owner approves exact artifacts for public distribution. Promoter session is
   constrained to those object/version/destination ARNs. Copy with correct MIME,
   SHA-256 verification and pilot 300-second cache metadata. Check promoted bytes
   before enabling delivery. Deleting staged originals is a separate retention
   decision. Enable distribution only after configuration review; object copies
   are publicly reachable at that point, independently of catalog compilation.
6. Execute live security/playback gates below. A failure blocks publication and
   invokes rollback. Only then configure the trusted exact CDN origin for the
   existing unified compiler, supply complete source audits and recent evidence,
   dry-run/check, and request separate publication authorization.
7. Future publication uses `scripts/compile-catalog.mjs`'s paired output transaction
   and RecSys drift validation. Do not use old runbook direct edits/export writes.
   Preserve current IDs and approved audit history. Run release checks before
   serving the new build. No production publication occurs in Stage 6.

## Future live acceptance matrix — all pending

| Gate | Procedure | Required outcome |
| --- | --- | --- |
| Private namespace | Request known non-sensitive markers at masters/staging/quarantine/audit via CDN; repeat warm/cold, encoded/traversal variants and HEAD | No successful object body or metadata; 403/404; no 200 fallback |
| Direct origin | Unsigned S3 REST GET/HEAD on delivery and private markers | Access denied; not publicly readable |
| Distribution binding | Verify exact SourceArn in effective bucket policy, then negative wrong/missing-origin identity where feasible | Alternate distribution receives no origin read |
| Role separation | Staging attempts delivery writes; nonpromoter writes delivery; audit mutation scope evaluated without a real mutation | Denial; staging cannot publish; inspect/simulate instead of probing writes outside authorized pilot |
| HTTP transport | HTTP viewer and origin configuration inspection | HTTP viewer rejected; signed HTTPS origin |
| Video headers | HTTPS GET/HEAD on approved MP4 and poster | Actual MIME, Content-Length, nosniff, expected cache/security headers |
| Byte ranges | Range bytes=0-1023 then a later valid offset; repeat cold/warm and seek near end | 206; exact Content-Range, partial length and bytes; Accept-Ranges compatible with seeking |
| Browser CORS | Native playback plus actual fetch/canvas/crossorigin usage if any | Exact allowed app origin; exposed length/range; no credentials; no assumed preflight support |
| Layout/codecs | Landscape and portrait H.264/AAC MP4 faststart, actual PNG/WebP poster, mobile browsers including Safari | Correct dimensions/audio; smooth start, seek, completion and poster |
| Player lifecycle | Featured → Shorts/Immersion, rapid close/reopen/navigation, hidden tab, autoplay block, retry/error and removed media | Stage 4 single-owner audio, bounded errors, stale callbacks cancelled, user resume works |
| Replacement | New versioned key, switch approved catalog reference, request old/new | Fresh new bytes; known-old key handled under retention/revocation plan |
| Cost/monitoring | Compare measured storage/requests/bytes and applicable plan/credits with private bill | Within approved scope; alert/logging behavior known; cleanup scheduled |

No live acceptance item is satisfied by the static evaluator. After pilot, record
exact URL identity, test time, config versions, browser results, byte hashes and
failures privately. Do not copy rights documents or private S3 references into the
public catalog or build.

## Rollback and emergency revocation

Catalog rollback: retain allocated audit record, move to appropriate unavailable/
rejected state and record explicit approved `publicationRemoval` evidence. Use the
unified compiler and paired recovery procedure; restore only known-good matching
frontend/snapshot outputs. Removing public catalog references does not disable
CDN delivery or invalidate existing URLs. Do not revoke the player's lifetime
protections or edit the frozen demo fallback to hide errors.

Delivery revocation: separately authorized promoter deletes the affected current
objects (versioned S3 creates delete markers), and invalidates exact CDN paths.
Infrastructure operator can remove the OAC allow or disable the distribution for
wider incidents. Origin revocation alone does not remove cached responses; wait
for invalidation/distribution propagation and verify from multiple clients/edges.
Browser caches and already downloaded copies cannot be recalled. Pilot TTL is kept
short for this reason. Signed URLs do not recall downloaded bytes either.

Keep emergency actions narrowly scoped and separately preauthorized during pilot
approval. Re-enable only after owner review and the full failed gate passes. Store
policy/distribution prechange JSON and ETags privately for optimistic-concurrency
updates; never overwrite a concurrent change blindly. Price invalidations before
large batches. Document actual cutoff latency rather than promising immediacy.

## Resource cleanup after pilot

Owner approves cleanup inventory/diff against preflight. Preserve required evidence
and local originals. Disable distribution and await deployed state before deleting
it; detach/remove only pilot OAC/cache/response policies no longer referenced.
Remove approved pilot objects, ALL retained versions and delete markers when
retention permits; abort incomplete multipart uploads. An empty current-object
listing is not proof a versioned bucket is empty. Review archival minimum-duration
charges before deletion if classes were changed. Delete only the dedicated empty
pilot bucket after retention approval.

Remove separately created log objects/versions, log buckets/groups, CloudTrail data
event settings, alarms/budgets/notifications, WAF ACLs, keys, DNS/certificates, role
access and plan subscriptions if they exist and are exclusively pilot-owned.
KMS deletion has a waiting period and dependency risks; handle with explicit owner
approval. Do not delete shared/preexisting resources or the registration-media bucket.
CloudFront flat-rate plan billing/termination needs separate verification rather
than assuming disabling a distribution cancels a subscription. No EC2 is part of
this media architecture; if an independently approved credit exercise occurred,
check its volumes, snapshots and public IPs under that exercise's cleanup scope.

Finally re-inventory, compare with baseline, check all regions used, and inspect
Bills/usage after reporting latency. Save residual-resource list, ongoing charges,
retention exceptions and responsible owner. Zero active playback does not imply
zero storage/log/subscription cost.
