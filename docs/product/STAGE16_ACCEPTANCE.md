# Stage 16 — product cleanup and release verdict

> Historical milestone evidence. Current main includes the public beta, custom-domain activation and Lambda runtime. Start with [the current handoff](../../GETTING_STARTED.md#verified-state-and-evidence) and [domain activation](../infra/CUSTOM_DOMAIN_PREPARATION.md) before applying older release gates or ECS/preview instructions.

Locally verified on 8 November 2026. No deployment, DNS, email route, certificate, paid service or AWS resource was changed.

## Implemented and verified

Home, Search, Explore, collections, Shorts, Immersion and Creator Studio now share product wording, BETA branding, loading and recovery patterns. Settings and placeholder feature dialogs were removed. Help & Support explains discovery, upload limits, all six dimensions, incomplete scores, YouTube restrictions, processing privacy, deletion and troubleshooting. The proposed support address is centrally configured but remains inactive in the UI because recipient delivery is unverified.

Creator Studio presents Upload Video, Paste YouTube Link and one Analyze Edit action. Before any first-use external analysis, an accessible dialog explains Google video/audio processing and links its terms. File and public-link permissions are separate, can be remembered independently, and can be changed for future analyses. Declined file permission retains signal analysis. No sample menu or provider configuration appears in the ordinary workflow. Engineering previews remain explicitly gated to development tools.

The six scoring methods, source evidence, exact-value RPM/bar animations, reactions, reduced motion, skip/replay, cancellation, export and honest missing scores remain. Scoring formulas were not changed or capped to conceal excessive top ratings. Experimental AI Assessment remains visible; score saturation and the limits of previous evaluation are documented in the release audit.

Loading uses a rounded gold-gradient ring with reduced-motion support. Actual pending thumbnails retain aspect-ratio skeletons; completed or failed images settle to content or a fallback. Bundled-catalog search responds synchronously rather than introducing fake delay. Video startup/buffering has finite recovery, and known embedding restrictions offer Watch on YouTube. Narrow recovery controls and recommendation cards were corrected at 320px.

Analysis recovery now pauses after three failed read cycles and resumes on Reconnect, including failures fetching a finished report. Leaving during upload cannot dispatch a late unacknowledged job or rewrite the new route. A known running job remains available through its history link. Lazy-page recovery reloads the same URL to recover a failed chunk.

## Browser evidence

Clean sessions used no existing job, sample or developer flag. Home → play/open → return → Search → another edit, Shorts navigation, Explore empty-state recovery, Immersion, Help, privacy links, keyboard search, navigation focus/Escape and application 404 recovery passed. Width checks covered 320, 390 and 820px plus desktop.

A real generated 1080p/60fps upload received six supported semantic assessments (experimental overall 9.79), opened evidence, exported and restored after refresh. No upload began before the processing choice. A real public YouTube request received six supported assessments (overall 9.06). These smoke-test numbers establish workflow operation, not artistic accuracy.

Actual CDP network throttling produced pending image skeletons and successful image requests at 640–935ms, with stable before/after thumbnail geometry. Offline, restored connection, retry, reduced motion and startup timeout passed. External YouTube streaming was not consistently available in the test environment; those runs reached an honest unavailable fallback, and are not reported as successful stream playback.

Controlled browser failures covered 403, 500, quota/429, expired jobs, failed/corrupt/oversized uploads, invalid links and unavailable YouTube analysis. Messages contained no provider bodies or private filesystem paths. Permission-scope isolation, interrupted upload navigation, late start cancellation and recovery of an acknowledged job were tested independently with intercepted APIs rather than live provider calls.

Final verification passed all 640 isolated Node tests with concurrency one, all 51 backend regressions, production build/type checking, asset/content checks and the artifact scanner. The earlier parallel run had one stale Shorts expectation and one 15-second legacy benchmark timeout; the expectation was corrected to the unchanged approved policy, and the complete isolated rerun passed. Browser receipts, test logs, screenshots and reproducing scripts are outside git at `/home/rohan/lolixco-stage16-evidence`.

## Release verdict

**A — Implemented and locally verified:** the product cleanup, contextual permission workflow, loader/skeleton/error system, navigation, Help and local analyzer integration.

**B — Frontend prepared for an approved release:** a static build with lazy Studio/Help chunks, same-origin API configuration, no embedded secrets or loopback endpoints, and public analysis disabled by default. The flag is not authentication or production security.

**C — Public launch remains blocked:** a tenant-isolated public analysis service, secure identity/guest ownership checks, abuse admission and per-user/global cost ceilings, durable jobs/private storage/deletion reconciliation, approved provider data policy, verified support delivery, approved hostname/TLS/preview-gate change and rights clearance for the 30 privately prepared hosted files. Those files were not published. Social/canonical metadata needs the approved public origin. The current trusted local worker must not be exposed through a public proxy.

See [the infrastructure and security release review](../infra/STAGE16_RELEASE_READINESS.md) for the dated read-only AWS findings, concrete acceptance gates, costs and rollback plan. Support activation requires verification of the exact `support@golixco.com` forwarding/mailbox rule and delivery; MX records alone do not prove it. No email was sent.
