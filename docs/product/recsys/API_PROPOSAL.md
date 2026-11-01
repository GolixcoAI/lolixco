# Recommendation API proposal v1

**RESEARCH HANDOFF to Antigravity (Linux) — proposed, not implemented.** Date: 2026-10-16.
Evidence and architecture: [RECOMMENDATION_RESEARCH.md](RECOMMENDATION_RESEARCH.md).
This is an independent Lolixco contract. It does not reproduce a private YouTube API.

## Compatibility and ownership

**OBSERVED:** `src/data/edits.ts` uses numeric `Edit.id` values starting at zero. Preserve every existing Edit field and type. No current application route, player, A–B looping, search, discovery or loader behavior changes in this proposal. Antigravity owns frontend discovery/search/loading; it must review a future adapter before integration. Existing frontend fetches are not assumed to use this API.

**PROPOSED:** JSON item IDs are strict integers in [0, 9007199254740991]. Reject numeric strings, fractions, booleans and negative values. ID 0 is valid and distinct from null. Stable IDs must not be renumbered when items are sorted or removed. Internal model indices and padding are separate from public IDs. Stable creator IDs are strings in sidecar metadata; the existing `creator` field remains display text.

Base path `/api/v1`; response `schema_version` is `1.0`. Breaking changes require `/api/v2`. Additive optional response fields may extend v1; clients ignore unknown response fields. Request models reject unknown fields to detect misspellings. No recommendation endpoint accepts Python code, model paths or external fetch URLs.

## Endpoints

| Method / path | Purpose | Status |
| --- | --- | --- |
| POST `/api/v1/recommendations` | First recommendation page or cursor continuation | Proposed first implementation |
| GET `/api/v1/health` | Process liveness; no user data | Proposed first implementation |
| GET `/api/v1/ready` | Catalog/policy readiness; reports model availability separately | Proposed first implementation |
| POST `/api/v1/events` | Bounded, idempotent impression/playback/feedback ingestion | Proposed later stage, disabled until instrumentation is reviewed |

Local development binds to `127.0.0.1:8000`. Permit only the explicitly configured Lolixco development origin through CORS. Do not infer deployment authentication requirements from a loopback demonstration. No authentication provider or cloud deployment is introduced here.

## First-page request

```json
{
  "surface": "up_next",
  "current_edit_id": 0,
  "limit": 3,
  "mode": "auto",
  "filters": { "category": null, "tags_all": [] },
  "exclude_edit_ids": [2],
  "context": {
    "history": [
      { "edit_id": 6, "unique_watch_ms": 9000, "occurred_at": "2026-10-16T08:00:00Z" }
    ]
  }
}
```

| Field | Rules and default |
| --- | --- |
| `surface` | Required `home` or `up_next`. |
| `current_edit_id` | Required non-null ID for `up_next`; null/absent for `home`. Unknown or unavailable current item returns 404 without disclosing its private status. |
| `limit` | Integer 1–50; default 12. Persisted in cursor snapshot. |
| `mode` | `auto` default, `baseline`, or `neural`. Auto uses only a validated compatible model explicitly promoted by server configuration, otherwise baseline. Explicit neural without a usable model returns 503. |
| `filters.category` | Null or one of Cinematic, Gaming, Anime, Movies, Series, Phonk, Multifandom, Motivation. Unknown value: 422. Case-insensitive input normalized to canonical spelling. Featured/New/Trending are not categories; frontend tab mapping needs separate review. |
| `filters.tags_all` | At most 10 distinct normalized tags, each 1–64 characters after normalization. All requested tags must match; no match returns empty, not relaxed filtering. Default empty. |
| `exclude_edit_ids` | At most 200 strict IDs. Duplicates collapse; absent catalog IDs are harmless. Default empty. |
| `context.history` | At most 50 entries ordered oldest to newest; default empty. Each requires ID, nonnegative integer `unique_watch_ms`, UTC RFC3339 time. Reject out-of-order/future entries (allow 5-minute clock skew). |

Server clamps client watch time to authoritative duration and the 60-second cap. Unknown/unavailable history IDs are ignored with `history_items_ignored`; items missing duration contribute categorical context only. Request history affects only this session's recommendations and is **not** trusted training telemetry. No personal identity or persistent user profile is required. Do not log raw history. Defaults for omitted filters/context are empty objects with the above defaults.

Freshness weights, creator caps, catalog selection and model version are server configuration, never arbitrary client overrides. Request processing freezes server `as_of` and configuration versions.

## Response envelope

Illustrative response to a separate cold-home request with `limit=1`, baseline mode and empty context. It shows ID zero deliberately. Asset URLs below assume the app is served at root; production/base-path resolution must use the catalog's existing asset mapping.

```json
{
  "schema_version": "1.0",
  "request_id": "req_example_01",
  "session_token": "opaque_example_session",
  "surface": "home",
  "mode_used": "baseline",
  "model_version": null,
  "catalog_version": "demo-catalog-v1",
  "policy_version": "baseline-v1",
  "as_of": "2026-10-16T08:05:00Z",
  "items": [
    {
      "rank": 1,
      "edit": {
        "id": 0,
        "title": "Into the Light",
        "category": "Cinematic",
        "tags": ["cinematic", "original", "demo", "landscape"],
        "description": "Original geometric artwork. Silent motion study for player testing; not finished creator footage.",
        "creator": "Lolixco demo",
        "poster": "/illustrative-catalog-poster.svg",
        "source": "/media/motion-study.webm",
        "duration": "0:12",
        "trending": false
      },
      "reason_codes": ["cold_start", "category_balance"]
    }
  ],
  "next_cursor": "opaque_example_page_2",
  "has_more": true,
  "diagnostics": {
    "fallback_reason": null,
    "warnings": ["creator_cap_relaxed", "publication_time_missing"]
  }
}
```

This is a schema example, not a measured baseline ranking: category ordering may put a different item first. The poster string is an explicit placeholder, not a new asset or promised path. Actual returned Edit DTOs must be copied from the catalog projection, with no invented assets. Model scores are not exposed as probabilities. `rank` is one-based absolute position in the frozen ordering, so eligibility removals can leave gaps. `request_id` is per HTTP response. Session/cursor strings are illustrative and unusable.

`reason_codes` are bounded factual codes such as `cold_start`, `category_balance`, `category_match`, `tag_match`, `recent_publication`, `exploration`; never claim a model explanation that was not computed. `recent_publication` requires a known timestamp and the configured freshness window. `diagnostics.fallback_reason` is null or a stable code (`model_missing`, `model_incompatible`, `model_error`). Warnings include `creator_cap_relaxed`, `publication_time_missing`, `history_items_ignored`. No internal paths, stack traces or raw features in responses.

For an empty eligible set, return 200 with `items=[]`, `next_cursor=null`, `has_more=false`; metadata still explains mode/version. Short pages are valid. Never return excluded content to fill a page.

## Cursor and session semantics

First response issues a cryptographically random, short-lived session token. This is a request-continuation capability, not an authenticated user identity. Store only a token hash and bounded snapshot state server-side; use a 10-minute TTL and cap total live snapshots (initial proposal 1,000). Bound each ranked snapshot to 500 eligible IDs; neural mode initially ranks at most 200 candidates. Thus `has_more=false` means this snapshot is exhausted, not that the entire catalog is exhausted. Baseline can cover all 17 current fixtures.

Continuation is a discriminated request shape; do not mix cursor and new context:

```json
{
  "session_token": "opaque_example_session",
  "cursor": "opaque_example_page_2"
}
```

Store the ordered ID list, immutable Edit projection/catalog version, model/policy versions, as-of time, exclusions, limit and cursor offset. Hold creator counts across page boundaries. Recheck live availability and session suppressions before each page. Partition the snapshot into immutable segments of limit positions. Remove newly ineligible IDs from the requested segment without backfilling from later segments; do not recompute ranking or inject items. Return a cursor for the next segment, even if this page became empty. Clients must follow has_more rather than treating an empty page as exhaustion. Preserve rank positions from the original ordering.

Repeated use of a cursor returns the same segment except newly ineligible/suppressed items are removed; it never advances hidden state. A client must replace/deduplicate retried pages by numeric ID rather than append a retry twice. Distinct sequential cursor pages have no overlapping IDs. A revoked item must not reappear from a response cache. New context, changed filters or desired freshness requires a new first-page request; cross-snapshot repetition is possible unless the caller supplies exclusions. A service restart may invalidate cursors in the first local implementation; return 410 when expiry can be established, otherwise 400 invalid_cursor, and restart pagination. Do not pretend an expired cursor is an empty catalog.

## Errors and readiness

```json
{
  "schema_version": "1.0",
  "request_id": "req_example_error",
  "error": {
    "code": "cursor_expired",
    "message": "Start a new recommendation request.",
    "retryable": false,
    "field": "cursor"
  }
}
```

| HTTP | Code | Meaning / client action |
| --- | --- | --- |
| 422 | `invalid_request` | Invalid shape, ID/type, context timestamp, limit or filters; fix request. |
| 404 | `current_edit_unavailable` | Unknown/ineligible current edit; return to a home request if appropriate. |
| 400 | `invalid_cursor` | Malformed/unrecognized token; do not disclose session existence. |
| 403 | `cursor_session_mismatch` | Valid cursor presented with a different session token. |
| 410 | `cursor_expired` | Expired or restart-invalidated known cursor; refresh first page. |
| 429 | `capacity_limited` | Rate/snapshot bound; honor Retry-After. |
| 503 | `catalog_unavailable` | Cannot safely serve baseline; retry later. |
| 503 | `model_unavailable` | Explicit neural mode cannot be served; caller may choose baseline. |

Persist a bounded expired-token tombstone/hash or authenticated token expiry if 410 must be distinguished from an unknown token after restart; otherwise returning `invalid_cursor` is acceptable and the client still restarts. Never silently change explicit neural to baseline. Auto-mode failures may return 200 baseline with diagnostic reason; eligibility/catalog validation must still pass.

Health returns 200 `{ "status": "ok" }`. Readiness returns 200 when catalog and baseline policy are usable, e.g. `{ "status": "ready", "baseline": true, "neural": false }`; 503 otherwise. Neural being unavailable is not a readiness failure for baseline serving. These small endpoints need no session token.

## Catalog sidecar and model contract

Keep the current Edit projection unchanged. Versioned sidecar keyed by numeric ID stores `creator_id`, `published_at` (nullable), authoritative `duration_ms` (nullable), `visibility`, `moderation_status`, `playable`, optional `canonical_content_id`, and metadata provenance. JSON map keys are strings by serialization, so prefer an array of records with numeric `edit_id` when exporting. The serving catalog loader validates uniqueness and referential integrity.

```json
{
  "catalog_version": "demo-catalog-v1",
  "demo_only": true,
  "records": [
    {
      "edit_id": 0,
      "creator_id": "creator:demo",
      "published_at": null,
      "duration_ms": null,
      "visibility": "public",
      "moderation_status": "demo_allowlisted",
      "playable": true,
      "canonical_content_id": null
    }
  ]
}
```

This illustrates a proposed explicit demo allowlist, not a completed media validation. Do not manufacture publication dates or stable creator identities for real uploads. Model bundle manifest must identify feature schema, vocabulary hashes, training cutoff/data hash, model version and supported catalog feature schema. Item vectors carry their catalog version and exact numeric-ID row map. Reject mismatched dimensions, NaNs, missing rows without an OOV path, or unsafe/untrusted model files. Load only locally produced reviewed bundles; no arbitrary model upload endpoint.

## Future events contract — separate instrumentation approval

Events are required for trustworthy real training but are not required for the synthetic demo. Proposed POST batch has `session_token` and at most 100 events, each with unique `event_id`, server-issued recommendation `request_id`, `edit_id`, `occurred_at`, and type. Limit body to 64 KiB. Validate item membership in the served response, idempotency and clock skew; assign server receive time. Idempotency uses `(session,event_id)`; duplicate identical events are acknowledged once, differing duplicates rejected with 409. Atomic batch validation avoids ambiguous partial ingestion.

Types: `impression` (at least 50% visible for one second, future frontend observation); `playback_summary` (playback ID, impression event ID, nonoverlapping played intervals, autoplay flag, finalization); `feedback` (`not_interested` or `hide_creator`). Request ID is an attribution key, not an impression. Intervals must satisfy `0 <= start_ms < end_ms <= duration_ms`, maximum 100 intervals; merge overlaps and clip against server duration before deriving unique coverage. Seeking contributes no unplayed interval; looping contributes only new covered time. Playback summary must be finalized before labeling; updates use new event IDs and an increasing playback revision, retaining only the latest valid revision.

For training, join finalized playback within 30 minutes of an impression. An exposed impression with no play is a zero only after that window and only when telemetry is known complete; otherwise mark censored. These definitions must be tested with the player owner before collecting real data. The current player is untouched. Feedback suppressions apply for the session and future cursor pages; account-level persistence is out of scope. Raw demo events expire after a proposed seven days; real retention/consent/deletion behavior needs separate review. Training uses the synthetic dataset until that decision.

## Implementation review checklist

- ID zero and every existing Edit field survive JSON round-trip; no string-ID migration.
- Hard eligibility/deduplication and explicit exclusions survive both fallback and pagination.
- Cursor retries, expiry, revocation and page boundaries have contract tests.
- Unknown metadata does not create fabricated freshness/quality.
- Shared source URLs preserve distinct demo items; one-creator relaxation is explicit.
- Model/catalog mismatch fails safely; no request-time training or remote model loading.
- API examples validate against future strict models; frontend adapter is reviewed with Antigravity.
- CPU latency, relevance, memory and production quality are **NOT MEASURED** yet.

**Review decision needed before coding:** approve the baseline-first sequence, numeric Edit envelope, temporary session/cursor semantics and synthetic-only initial model work. All endpoints, event collection, policies and thresholds above remain proposals.
