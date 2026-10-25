# Stage 3: unified catalog compilation and RecSys alignment

The authoritative writer is `scripts/compile-catalog.mjs`. It builds the frontend
catalog and Python snapshot from the same verified records. Default invocation is
validation/dry-run; neither default nor `--check` writes output. Publication needs
`--publish` and separate owner authorization. This development milestone does not
authorize real catalog publication, API intake, infrastructure or later stages.

## Inputs and trust boundaries

Both complete source audits are required, even when one contains an explicit
empty `items` array. Missing files, malformed JSON, malformed records, duplicate
identities, conflicting historical ownership and missing previously public
records cause failure. No production audit is read implicitly. The compiler never
loads `.env.local` or calls a network API.

The API is `compileCatalog({youtubeAudit, hostedAudit, previousCatalog?, policy?,
now?, outputPath?, snapshotPath?, catalogVersion?, publish?, check?})`. It returns
`{success, catalog, source, snapshot, totalCount, written, matches}` on success,
or sanitized errors without private input values. `now` is trusted caller context
for reproducible verification; it never comes from candidate JSON. `io` overrides
exist only for isolated fixture transaction testing and are forbidden for real
production destinations.

Audits are private owner-controlled documents, not public request payloads. The
compiler can validate their shape, identity, provenance and evidence consistency;
it cannot authenticate an invented owner audit cryptographically. Operators must
keep these inputs protected and obtain real owner approval/playback evidence.
There is no synthetic-production bypass option.

### YouTube

The existing importer audit envelope and fields remain intact. Every record needs
its canonical video identity and lifecycle state. Unallocated drafts may retain
unknown format; allocated or approved items need explicit format. All current and
historical `auditHistory[].assignedLolixcoId` allocations are reserved, including
rejected/recheck/unavailable items. The compiler never assigns or migrates IDs.

Approved/published entries use the existing reusable YouTube projection, followed
by Stage 2's authoritative audit approval, positive ID/metadata identity, genuine
API provenance, successful retrieval, freshness, embeddability, attribution,
duration and confirmation checks. Stage 3 also requires private playback evidence:

```json
{"playbackVerification":{"identity":"VIDEO_ID_11","status":"passed","verifiedAt":"2026-10-25T12:00:00Z"}}
```

The identity must equal the actual 11-character canonical video ID. Verification
must be recent (30 days, five-minute future-clock tolerance), as must API metadata.
API embeddability does not substitute for in-app playback. Historical approved or
published records missing this evidence require an owner recheck before unified
publication; the compiler does not fabricate timestamps or change audit state.

### Hosted media

No production hosted domain is configured or assumed. The caller must supply a
separate trusted `policy` document with an exact `approvedOrigins` array. Origin
claims inside candidate records have no authority. Stage 2's public URL rules
enforce HTTPS, approved exact origins and matching optimized-video/poster paths.

Hosted audit records retain `assetRef`, `assignedLolixcoId`, `format`,
`contentReviewStatus`, `rightsCleared`, `rightsDocumentation`, `deliveryUrl`, and
`posterDeliveryUrl`. Required private additions:

- `provenance: "owner_direct_upload"`; approved/published owner state.
- `rights.videoDistribution` and `rights.audioDistribution` must both be true;
  `rights.documentationRef` must equal nonempty `rightsDocumentation`, and
  `rightsCleared` must also be true.
- `formatConfirmed: true` and `confirmedFormat` matching the explicit format.
- `mediaVerification`: `assetRef`, `source`, `poster`, `format`, `sha256`,
  `decodeVerified`, `verifiedAt`, `width`, `height`, `durationSec`, `codec`,
  `audioCodec`. Asset/URLs/format must match; hash is 64 lowercase hex characters;
  verified decode must be positive and recent. H.264/AAC and verified landscape or
  portrait dimensions are required. Display/measured duration must agree; Shorts
  must be at most 180 seconds.
- `playbackVerification` as above, with identity equal to `assetRef`.

These fields record checks performed by a trusted future ingestion/inspection
workflow; this compiler does not download hosted files or provision/transcode
them. Missing origin, rights, inspection or playback evidence fails closed. The
Stage 2 generic hosted projection remains unavailable; the new unified compiler
has the explicit stronger hosted gate and public projection described here.

Private documentation, hashes, asset references, notes and evidence never enter
public output. Hosted/demo records do not receive fabricated YouTube fields.

## Preservation and explicit removal

IDs remain 0–16 demos; 17–99 reserved; 100–199 YouTube video; 200–299 YouTube
Shorts; 300–399 hosted video; 400–499 hosted Shorts; 500+ reserved. Real records
are sorted by ID after the exact 17 demos. No quotas or format allocation are
inferred from the provisional target of 58 real edits.

When publishing/checking existing paired outputs, the existing snapshot is the
previous catalog. A caller-provided previous catalog must agree with it; it cannot
omit a source to bypass deletion protection. The existing frontend must match the
same generation. Incomplete, malformed or mismatched output pairs are rejected.
An explicit previous snapshot may seed an isolated initial generation.

A previously public entry cannot disappear because an audit file or record was
omitted. To remove it, retain the original allocated audit record, move it to
`rejected`, `unavailable` or `embed_restricted`, and supply a private
`publicationRemoval` block with `approved: true`, exact `id`, `identity`, current
`status`, nonempty `reason`, and recent `approvedAt`. Existing allocations remain
reserved. Routine source updates preserve other-source records. Delivery-identity
or format migration requires a separately reviewed workflow.

## Frozen demo trust

`src/data/edits.ts` remains byte-for-byte unchanged during Stage 3 development:

`43d214282ba2122c3f3b95e0c047d92027ea33f05a54f6832e17543a2e575b88`.

An exact copy of that public source is retained at `content/baseline/edits.ts`.
Stage 2's demo identity predicate now verifies that fixed artifact against the
same pinned SHA before comparing every demo field and allowed base transformation.
The path is fixed in trusted code, not supplied by a candidate or bypass flag.
This preserves checksum-anchored identity while allowing a future authorized
generated catalog to grow and be compiled again. Previously pinning the entire
mutable output made subsequent expanded compilation impossible. Both artifacts
must match the pin throughout this development milestone; the immutable template
continues to match it after future authorized publication.

The existing generator preserves `assetUrl(..., import.meta.env?.BASE_URL ?? "/")`
handling for demos and exports the same frontend helpers. Both generated outputs
are tested against each other by importing generated TypeScript and loading the
snapshot through Python. No trusted demo definition comes from incoming audits.

## Transaction and recovery

All validation completes before output writes. An exclusive journal directory
locks each output pair. Old public bytes are backed up, staged bytes are fsynced
on each target filesystem, and each destination is replaced with atomic rename.
Files and journal directories are fsynced around commit. A normal write failure
restores both original files (or removes both newly created outputs).

If a process dies after preparation, a later explicit `--recover` checks that the
recorded writer PID is gone and restores both outputs from checksummed backups.
Recovery refuses live writers and mismatched journals. Committed journals are
cleaned without undoing a completed generation. Rollback failure retains recovery
evidence and blocks a new writer. Never delete a pending journal to bypass it.

Two arbitrary filesystem paths cannot be renamed atomically as one operation.
Concurrent readers can observe the short rename interval, and after abrupt death
the pair needs recovery before readers/builds resume. Publication must therefore
run in an owner-controlled maintenance/build window, not against live readers.
No claim of cross-file atomic visibility is made. A crash before the prepared
journal exists leaves outputs unchanged but can require manual stale-lock cleanup;
PID reuse can require operator inspection. Disk/filesystem durability guarantees
remain platform-dependent. These limitations are explicit rather than silently
claiming multi-file ACID transactions.

## Commands

```bash
# Inspect interface; no audit or environment files are accessed.
node scripts/compile-catalog.mjs --help

# Validate complete, explicit owner-controlled inputs; no writes.
node scripts/compile-catalog.mjs --youtube-audit YOUTUBE.json --hosted-audit HOSTED.json --policy POLICY.json

# Check an isolated existing pair without writing.
node scripts/compile-catalog.mjs --youtube-audit YOUTUBE.json --hosted-audit HOSTED.json --policy POLICY.json --output /tmp/fixture/edits.ts --snapshot /tmp/fixture/snapshot.json --check

# Fixture-only writes during development; real publication needs new authorization.
node scripts/compile-catalog.mjs --youtube-audit YOUTUBE.json --hosted-audit HOSTED.json --policy POLICY.json --output /tmp/fixture/edits.ts --snapshot /tmp/fixture/snapshot.json --publish

# Explicit recovery for the same isolated pair after its writer has stopped.
node scripts/compile-catalog.mjs --output /tmp/fixture/edits.ts --snapshot /tmp/fixture/snapshot.json --recover

# Real read-only drift check remains supported.
python3 -m server.recsys.export_catalog --check
```

Default production output paths are `src/data/edits.ts` and
`server/recsys/catalog_snapshot.json`; production writes require both canonical
paths together. Test isolation forbids these destinations and aliases. The CLI
also rejects outputs overlapping audit/policy inputs. Do not execute production
publication as part of this mission. Keep output pairs stable, not symlink-swapped
by other writers, throughout an owner-controlled transaction.

## Legacy writers and roadmap discrepancies

The legacy YouTube CLI (including `--write`) is retired before environment/audit
loading. It directs users to the unified compiler. `compileYouTubeCatalog` remains
a reusable preview/fixture API for existing regression tooling: real production
writes are always blocked; isolated nonprotected fixture writes retain old gate
coverage. The TypeScript generator and projection functions remain reusable.
The Python exporter cannot independently write the canonical production snapshot;
its read-only drift command and explicit nonproduction fixture export remain.

Older runbooks' YouTube-only publication commands are historical and superseded
by this document. The old roadmap's mandatory demo source/format fields, fixed
60-edit allocation, and compiled-as-approval wording do not override accepted
Stage 2 behavior. Demos keep optional fields, 58 remains provisional with no split,
and only authoritative approved/published audit state can authorize compilation.

## RecSys contract alignment

Export, drift comparison, runtime loader, `EditItem` and API payloads preserve
optional `channelTitle`, `channelId` and canonical matching `sourceUrl`. Missing
demo metadata stays absent in the snapshot/None in the model. Unexpected/private
properties and malformed optional values are rejected. Drift compares optional
presence, types and changed values, validating both live and snapshot shapes.
No ranking code changes: tag-IDF weighted Jaccard, category weighting and session
affinity remain exactly as before.
