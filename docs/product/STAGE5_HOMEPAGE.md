# Stage 5: source-aware homepage and unified featured discovery

Base: `549bea685ca49ba85ba6d83120fde7322be03fc7` (accepted Stage 4 merge).
This stage changes discovery presentation, public metadata and featured selection.
It does not change publication gates, the catalog, recommendation ranking,
playback coordination, infrastructure, or media assets.

## Public catalog boundary

Production App imports `src/data/edits.ts`, the public output of the accepted
compiler. Only the compiler verifies approval, provenance, rights and playback
before publication. Source type is a playback discriminator, not evidence of
approval. No frontend `approved` flag or private audit lookup is introduced.

`App.initialEdits`, the recommendation helpers' optional catalog argument, and
pure feed/featured helpers accept a public catalog for isolated tests. These are
code-level injection points, not public upload/intake APIs. The synthetic records
in `tests/fixtures/stage5-public-catalog.ts` use allocated ID ranges and public
fields; they are explicitly not genuine published media or approval evidence.
They are never imported into the production entry point or compiler.

Recommendation responses supply ranked candidate IDs. Both the API adapter and
feed composer resolve them against the supplied canonical public catalog; nested
server titles, URLs and other media metadata cannot replace catalog records.
Unknown, repeated and portrait candidate IDs cannot enter landscape rows. Request
cancellation and catalog identity protect against delayed responses after a
catalog replacement. Local fallback also uses that same catalog. Watch-history
request context and the Python tag-IDF weighted Jaccard ranking are unchanged.

## Homepage composition

`composeHomeFeed` has three separate responsibilities: build canonical ranked
landscape candidates, partition source previews, and allocate each video ID once.
It excludes the current featured item from discovery cards, as before.

| Section | Selection and order |
| --- | --- |
| Videos from YouTube | First six remaining public YouTube landscape records in catalog order |
| Curated Shorts | First ten explicit portrait Shorts across both sources, in catalog order |
| Lolixco Uploads | First six remaining public hosted landscape records in catalog order |
| More to Discover | First eight remaining landscape records, recommendation order then catalog backfill |

The existing `maxRecommendedVideos` budget controls each source preview (and the
legacy demo recommendation row). `maxShortsPerShelf` and `maxMoreVideos` retain
their meanings. These are bounded discovery previews; Explore/category/search
continue to expose the complete catalog. A short duration never defines a Short.

Source previews contain populated category groups in the shared canonical order:
Anime, Movies, Series, Multifandom, Gaming, Phonk. Items retain catalog order within
each group. Unknown/legacy categories follow in first-seen order; an absent label
uses Other. No empty sections or category headings are emitted. Group and item
keys use stable category/source IDs and catalog IDs, not positions.

Category groups occupy responsive columns, preventing a one-card group from
expanding into an oversized full-width poster. The existing charcoal and yellow
identity remains. Immersion has an independent homepage entry before the dynamic
sections, including when the catalog has only Shorts or is empty.

Without real landscape content the existing Recommended Edits / More to Discover
layout remains, with deterministic ranked/canonical fallback. The current 17
demos remain discoverable through the homepage, Up Next and Explore. There are no
fabricated YouTube/upload sections or empty Shorts shelves.

## Public presentation

Cards and hero metadata use one shared formatter: YouTube, YouTube Short,
Lolixco, Lolixco Short, or Demo / Sample. Reviewed nonempty `channelTitle` is
rendered as YouTube attribution. Missing attribution is omitted; creator names,
channel identities, popularity, views and likes are never inferred. Missing or
failed posters use the accessible existing fallback. Public UI reads no audit,
rights-clearance, internal storage or credential fields.

## Edit of the Moment

Real landscape records from both sources share one deduplicated pool, sorted by
stable ID. UTC epoch day modulo pool length chooses the default. Each record gets
one turn per cycle regardless of source; with a stable pool of at least two items,
consecutive UTC days always differ, including month/year boundaries. A manual
shuffle advances through the same pool and wraps deterministically.

With zero real landscape candidates, only Demo ID 0 is the fallback, independent
of date, catalog order and shuffle offset. If that demo is unavailable, the hero
is absent. Empty and all-Shorts catalogs never place a portrait video into the
landscape hero. A single real item remains selected for every offset.

The default refreshes at UTC midnight and when a background tab becomes visible.
A manual card/shuffle selection remains in place for that catalog. Replacing the
catalog prop resets to the new policy and canonical records, updates Up Next,
and closes a Short that is no longer present. Existing player lifecycles and
overlay coordination continue to own media operations.

## Verification and reproduction

Use the native WSL2 toolchain and the unchanged trusted launcher. Example:

```bash
/usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/rohan /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh --check-isolation
/usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/rohan /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh
/usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/rohan /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh tests/*.test.mjs
```

Focused Stage 5: `tests/stage5-homepage.test.mjs` and
`tests/edit-of-the-moment.test.mjs` (27 tests). The full suite has 462 tests, up
from 440. Two old demo-rotation assertions now run against the real-source
synthetic pool because the explicit Demo 0 policy supersedes demo rotation.

The unchanged Stage 4 browser driver and new `scripts/verify-homepage.mjs` run in
separate loopback-only network namespaces after the same trusted preflight:

```bash
/usr/bin/env -i \
  PATH=/home/rohan/.nvm/versions/node/v24.22.1/bin:/usr/bin:/bin \
  HOME=/home/rohan \
  RUNTIME_MODULES=/home/rohan/.local/share/lolixco-codex/browser-tools \
  VERIFY_OUTPUT_DIR=/home/rohan/lolixco-review-handoff/stage5-homepage/evidence/homepage-browser \
  /usr/bin/unshare -rn /bin/bash --noprofile --norc -c '
    /usr/sbin/ip link set lo up &&
    /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/rohan /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh --check-isolation &&
    node scripts/verify-homepage.mjs
  '
```

The new driver checks six catalog configurations at each of seven viewports:
1672×941, 1440×900, 1280×800, 1024×768, 768×1024, 390×844 and 360×800.
Four additional cases cover catalog replacement/missing metadata, repeated
shuffle, search/fandom/Shorts routes, and the actual 17-demo production entry.
It takes 42 full-page screenshots and checks keyboard card selection, both Shorts
adapters, source/category visibility, attribution, duplicates, and horizontal
bounds. Synthetic hosted URLs are intercepted with the frozen silent WebM; the
YouTube API is simulated. All external traffic is blocked by the namespace.

The external handoff contains exact commits/tree/patch checksums, final logs,
screenshots, 62 Python tests, seven HTTP smoke checks, build/content/asset/drift
results and the 21-case Stage 4 playback/browser regression run. Evidence is
outside Git. The production demo source remains pinned to:
`43d214282ba2122c3f3b95e0c047d92027ea33f05a54f6832e17543a2e575b88`.

## Limits

Browser evidence is Linux Edge/Chromium with simulated YouTube and local silent
media. It does not certify genuine embedding permissions, hosted CDN delivery,
audible-track exclusivity, Safari/WebKit, or physical mobile devices. No real
content has been sourced, approved or published. Source previews intentionally
have finite budgets; complete discovery remains available through Explore.
This milestone stops at a local commit and independent-review handoff.
