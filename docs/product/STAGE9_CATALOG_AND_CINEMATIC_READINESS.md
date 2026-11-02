# Stage 9 cinematic and catalog readiness

Base: merged main `e70bea0999d56dd94e66a8b16b87f32b82057191`.
Local-only work; no push, PR, `--publish`, production pair edits or deployment.
AWS planning is in the independent `codex/stage9-aws-readiness` worktree.

## Cinematic information group

The previous fade selectors hid the moment label/title/metadata but omitted
Shuffle. The complete `.hero-info` now shares one opacity transition, including
Shuffle, metadata and Watch Now. Its hidden descendants cannot receive pointer
hits. Opacity preserves tab stops; `:focus-within` keeps the entire group visible
while a keyboard user focuses an action. There are no invisible clickable overlays.
The existing three-second hook still resets on source, playback and interaction;
pause reveals information. Reduced motion removes animation. Shared audio, source
leases, fullscreen and seek behavior are unchanged. The PR #16 68px information
clearance, control stacking and in-flow Shorts header layout remain in place.

`verify-cinematic.mjs` tests actual Chromium layout/hit-testing and native playback,
with the existing offline YouTube adapter. It does not certify live official embeds.
It exercises normal/reduced motion, keyboard Tab/Enter, focus retention, hidden
pointer hit-testing, hover/touch, source reset, pause, fullscreen, Watch Now/timeline
separation, and desktop/mobile Shorts headers. Evidence stays in the external handoff.

## Canonical candidate

`content/stage9/youtube-selection.json` is the exact reviewed public selection from
the official Stage 8 handoff and merged readiness document: IDs 100–112 and 200–214,
13 landscape and 15 Shorts. IDs 112 and 214 remain Motivation. ID 204 retains approved
0:25 display duration; inherited runtime evidence measured 26 seconds. No silent
metadata change was made. YouTube content stays on official embeds; no video was
downloaded or rehosted. The 26 restricted candidates and 10 alternates remain excluded.

The read-only helper takes both complete source audits explicitly, validates the
30-item hosted audit, calls the authoritative unified compiler, and compares every
selected identity/title/category/format/duration with the approved manifest. It
rejects publication flags and does not refresh evidence, allocate IDs or write the
production pair. It returns 45 records: the exact 17 protected demos plus 28 YouTube
edits, zero approved hosted entries. Candidate snapshot version is `catalog-v2`,
which the existing API client accepts. The Python API now accepts explicit `catalog_version` or `LOLIXCO_CATALOG_VERSION=catalog-v2`. The default stays `demo-catalog-v1`; file/version mismatch returns readiness 503, unsupported versions and mismatched injected catalogs fail closed. Tests cover these paths.
The proposed static launch uses API-disabled local fallback. Source and snapshot SHA-256s are recorded
in the private check report for later review.

`discoveryCatalog` filters demos at the app's common catalog boundary once real
source records exist. All discovery, search, categories, fandoms, recommendations,
Shorts, featured selection/Shuffle and immersion consume that same filtered list.
The compiled pair still retains the unchanged protected 17. Demo-only builds retain
their current experience, and Shorts-only real catalogs cannot fall back to a demo.
This is a public-catalog projection, never an approval or intake bypass.

Registered fandoms remain unchanged. Approved records use only registered slugs;
other subjects remain searchable through tags/text. Expanding the registry and
reclassifying records is a separate reviewed content change, not silently inferred.

## Fail-closed publication decision

A successful dry run is structural validation of supplied audit evidence, not proof
of a new API fetch, rights grant or owner publication approval. Stage 8's audit
wrapper generator copied handoff claims and assigned preparation-time verification
fields. Preserve the original manifest and raw playback receipts, and have a trusted
reviewer reconcile metadata provenance and actual observation times before release.
Do not regenerate timestamps to pass freshness gates. Refresh metadata/playback
through the established intake workflow if stale or unsupported. In-app browser
adapter success is not replacement evidence for real YouTube availability.

Before any future publication:

1. Review the complete lifecycle audits, identity allocation/history and excluded
   quarantine/alternate sets, including both sources even when hosted items remain
   `needs_review`. Resolve the ID 204 annotation explicitly. Preserve originals.
2. Reconcile actual metadata/API and live official embed receipts for all 28,
   at the final intended origin and within the compiler's freshness window.
3. Run this helper with the exact audits. Review the generated public diff and
   hashes, protected-demo identity, optional attribution, categories, fandoms,
   Shorts, recommendation/API version compatibility, fullscreen and Shuffle.
4. Obtain separate owner approval of the exact paired generation and maintenance
   window. The current mission explicitly forbids `--publish`; do not interpret
   the review helper or this plan as release permission.
5. In a future authorized window, stop readers/builds, use only the unified
   compiler's paired transaction, and retain its recovery evidence. Validate
   content, Python snapshot drift and a fresh build before resuming readers.
   Never run the retired YouTube-only writer or edit one output independently.
6. Roll back only to a known matching frontend/snapshot pair. Use the documented
   recovery process for an interrupted transaction; do not delete its journal to
   bypass checks. Public URL revocation is a separate media/CDN operation.

## Reproduction

```bash
npm test
npm run typecheck
npm run build
npm run check:content
npm run check:assets
python3 -m unittest discover -s server/recsys/tests -v
python3 -m server.recsys.export_catalog --check
node scripts/validate-stage6-infra.mjs
node --import ./tests/register-ts.mjs scripts/stage9-catalog-readiness.mjs YOUTUBE_AUDIT HOSTED_AUDIT
```

Use the existing isolated test launcher. Python requires the pinned packages in
`server/recsys/requirements.txt`; this session reused the existing Stage 7A virtual
environment after system Python reported missing FastAPI. No dependency changes.

Browser reproduction (existing Playwright installation required): run
`node --import ./tests/register-ts.mjs scripts/verify-cinematic.mjs` inside a fresh
`unshare -rn` namespace with loopback up. Set `RUNTIME_MODULES` to its package directory
and `VERIFY_OUTPUT_DIR` to a private evidence directory. Optional explicit
`STAGE9_YOUTUBE_AUDIT` and `STAGE9_HOSTED_AUDIT` enable the approved-catalog browser
case; only compiler-projected public records enter the browser. Requests outside
loopback are blocked, and Vite uses an empty environment directory. The production
pair and frozen demo artifact remain byte-for-byte equal to merged main.

## Full 58-edit master review

The release target is exactly 28 YouTube + 30 hosted real edits, with 17 unchanged
protected demos retained and hidden from real discovery. The 45-record eligible
projection is intermediate evidence, never an approved reduced release.
`reviewStage9(..., { requireFullRelease: true })` rejects partial eligibility.
An entirely synthetic 75-record compiler rehearsal tests full discovery and negative
audio-rights, aspect and playback gates without fabricating real approvals.

The private handoff contains all 75 actual planned metadata records, with loopback
media paths and explicit UNPUBLISHED/UNAPPROVED status. This review manifest is not
a compiler-approved release pair. The production source and snapshot are untouched.
Hosted credit rendering now uses reviewed creator attribution, including Immersion.
No attribution names or licenses were invented. Policy drafts remain unpublished.
