# Stage 18C mobile recovery and cloud analysis verification

Release candidate: https://d2w2cv3wlh68gg.cloudfront.net/

PR: https://github.com/GolixcoAI/lolixco/pull/21 — update the existing release branch, leave unmerged. This remains an owner-inspection beta. PRs #19/#20 supplied the approved foundation; Stage 18B supplied the AWS candidate and 57-edit catalog. This change does not complete the worldwide launch or authorize custom-domain cutover.

## Repaired behavior

- **Scroll:** reproduced the deployed menu → Immersion → exit failure with real Chromium touch input: Home remained at scroll position zero with `body.overflow=hidden`. The menu's passive effect and viewer's layout effect separately saved/restored overflow, so a viewer could save the menu's temporary lock. A shared owner set now locks once, restores once after the last owner releases, counts inert ownership, preserves scroll position within a route, resets it across routes and restores focus without scrolling. A fixed body also accommodates mobile Safari.
- **Help:** removed the question-mark header action and duplicate footer Help entry. The sidebar/menu retains Help & Support. Existing support, rights and general-contact links use their correct `mailto:` destinations; no email or DNS configuration changed.
- **Shorts:** native vertical scrolling and snapping, with current player and adjacent poster panes. Settled scroll navigation replaces the old touch-end delta/debounce. Disabling scroll anchoring prevents recentering from fighting the browser. Only the current player mounts; official YouTube controls have no transparent autoplay input layer. Arrow and keyboard controls remain.
- **Hosted playback:** central pointer taps toggle once; pans, long presses, seeking and controls are excluded. YouTube keeps its official player controls. The featured native player's frame observer now follows source replacement instead of retaining a removed video node.
- **Immersion:** native fullscreen starts synchronously from the user's click. Landscape orientation lock is attempted for landscape edits, released for portrait/exit, and guarded against late completion. Full-viewport CSS and framing remain usable when fullscreen/orientation APIs are denied. Native WebKit video fullscreen is a hosted-video fallback. No claim that browser policy or an iframe can be forced to rotate.
- **Queues:** seeded randomized draws without replacement, no immediate repeat and at most two consecutive items from one source while alternatives remain. Shared recommendations preserve relevance filters; Shorts preserve portrait eligibility; explicit Immersion category/fandom constraints apply jointly and survive refills. Unavailable records are temporarily excluded. Source-separated Home shelves and the daily featured policy remain.
- **Studio:** mobile score headings/chips, evidence wrapping and touch targets fit 320/390px without horizontal scrolling. RPM, six bars, reactions, replay, export and reduced-motion behavior remain. A tab-session opaque job reference resumes tracking after route changes or refresh; private media/report contents are not stored there. A resumed report does not expose an uploaded preview URL.
- **Progress:** healthy cloud polling every four seconds; hidden tabs back off. Transport errors retry with bounded backoff and online/visibility recovery rather than declaring a running job failed. No cloud SSE request is opened when the endpoint is polling-only. Monotonic event sequence numbers handle the server's rolling 30-event buffer. Queue timeout and worker timeout are separate. Worker publication cannot resurrect a cancelled, expired or failed job.

## Measured cloud performance

The same authorized 14.6-second upload was used. Signal-only comparisons made no Gemini requests and retained the same supported scores, **8.30 and 8.47**, with the same unsupported dimensions left unassessed.

| Actual AWS test | Upload/job/report wall time |
|---|---:|
| Original deployed baseline | 85.41 s |
| First alternative: baked library cache alone | 79.83 s |
| Final implementation, first post-deployment job | 21.93 s |
| Final implementation, subsequent warm job | 12.25 s |

These are individual measured samples, not percentile guarantees. CloudWatch confirmed a 2.126 s Lambda initialization on the first final invocation, 18.196 s handler time, then an 8.380 s warm handler. Memory high-water was 676 MiB against the unchanged 3008 MiB allocation.

The cache-only experiment still spent 36.163 s in audio analysis and 11.629 s in FFprobe. Synthetic build-time library caches alone were insufficient. The final implementation overlaps credential-free library initialization with download/probing and reuses the initialized media subprocess for up to three jobs inside one Lambda environment. It clears per-job globals, deletes temporary workspaces and kills the process group on cancellation, failure or timeout. Child credentials are excluded by an environment allowlist. CPU, memory, media and request bounds remain.

The process waits on stdin between invocations and freezes with Lambda; no keepalive, provisioned concurrency, always-on service or new infrastructure is introduced. Environment reuse is an optimization, not a correctness requirement. See [AWS Lambda runtime lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html).

| Final phase | First post-deployment | Warm signal job |
|---|---:|---:|
| Queue waiting | 2.000 s | 0.000 s |
| Worker imports | 1.852 s | 0.016 s |
| Private media download | 0.052 s | 0.050 s |
| FFprobe | 3.424 s | 0.106 s |
| Worker preparation / initialization wait | 8.213 s | 3.918 s |
| FFmpeg preparation | 2.950 s | 2.932 s |
| Visual analysis | 1.064 s | 0.796 s |
| Audio analysis | 0.308 s | 0.297 s |
| Evidence scoring | 0.052 s | 0.064 s |
| Report preparation | 0.117 s | 0.119 s |
| Private report persistence | 0.091 s | 0.086 s |

Browser Performance measures use fixed phase names, without job IDs, filenames or credentials. A real mobile upload measured file-selection rendering 28 ms, presign 134 ms, private upload 683 ms, job creation 389 ms, polling 53–60 ms/request, report delivery 179/195 ms and presentation animation 846 ms. Polling adds up to one normal four-second interval to result discovery. These client values are from the genuine provider-failure acceptance below, not a successful six-score inference.

## Provider acceptance and limits

Two controlled genuine Gemini-enabled uploads were attempted. Both received a temporary provider error, completed with the two supported signal scores and displayed the provider limitation. The retry completed in 13.705 s from job acceptance through presentation; its Gemini phase spent 5.287 s before failing. This is **not** a successful semantic-latency benchmark. Further live provider calls were stopped. No provider plan, workload cap or quota counter was changed.

Six-score layout/export/replay tests used a previously generated genuine six-score report imported as a recorded fixture. Network-failure/reconnect tests used intercepted synthetic job transport and that recorded report. Neither is represented as new Gemini inference. Fresh successful six-score cloud acceptance remains to be checked when the provider is available.

## Actual deployed browser verification

| Engine / viewport | Verified |
|---|---|
| Chromium touch, 390×844 | 20 complete Home → Shorts → Home → Studio → Home → Help → Home → Immersion → Home cycles; all 80 Home touch-scroll checks passed; footer reachable; zero JS errors |
| Chromium touch, 390×844 | 20 consecutive center swipes including four backward; mixed YouTube/hosted; one current player, no simultaneous native playback |
| Chromium touch, 390×844 | Hosted tap pause/play, pan rejection, eight rapid swipes, cleanup after exit; zero residual players/inert/overflow locks |
| Chromium, 320×844 and 390×844 | Real recorded partial/full six-dimension reports, zero horizontal overflow with expanded evidence, valid JSON exports, RPM endpoint and reduced-motion replay disabled |
| Chromium, 768×844 tablet and 1366×844 desktop | Reports, Help/mail links, three Immersion entry/exit/resize cycles, Back and offline/online |
| WebKit, 390×844 mobile and 1280×844 desktop | Same report/export/reduced-motion checks, three Immersion entry/exit/resize cycles, Back and offline/online |
| Firefox, 1366×844 | Same report/export/reduced-motion checks, three Immersion entry/exit/resize cycles, Back and offline/online |
| Chromium mocked job transport | Studio reentry, refresh, repeated failed polls, nonterminal interruption notice, online recovery and six-score report retrieval |

The long touch run retained one Home player after each transition, with no accumulating inactive players. The rapid-gesture test ended with zero players on the Shorts grid, 525 DOM nodes and approximately 33.1 MB reported JS heap after collection. This is a bounded resource observation, not proof of a leak-free lifetime.

Real Android Chrome, Google-app/in-app browsers, iPhone Safari/Chrome, macOS Safari and Microsoft Edge hardware/apps were unavailable. Chromium/WebKit emulation does not certify those devices. Physical-device orientation, native fullscreen and background/foreground media behavior remain owner device checks. Publisher/regional YouTube restrictions remain external constraints.

## Validation, deployment and rollback

- Production TypeScript/Vite build; 653 isolated Node tests passed. Focused mobile ownership/queue checks cover 250 randomized source sessions and 100 constrained Immersion sessions with repeated refills. Python subprocess tests cover reuse/retirement, exclusion of AWS/provider credentials, cancellation and timeout; cloud API tests distinguish queue/worker age and preserve owner/report publication boundaries. CI runs these Python checks.
- Exact configured provider values were read into memory from the ignored original environment file for the exposure scan. Tracked/unignored sources and the production build contained no matches. The file was not modified. No credentials, private media, raw private reports or owner evaluations were added to Git or the worker source package.
- Published 106 scanned site files and invalidated the existing distribution. Runtime stack update reached `UPDATE_COMPLETE`. The 57 catalog entries and 30 video/poster associations are unchanged. Public origin remains private S3/OAC; provider permission remains confined to the production worker role. Existing cost/security controls and the $30–$40 planning target are unchanged.
- Frontend rollback assets and the pre-change runtime template were saved before mutation. Their content-addressed assets and the prior ECR digest remain available. To roll back, restore the saved site files and invalidate, and update only the existing runtime stack to the saved template/image/API versions. Do not reset job data or republish media. Rollback was not needed; the current candidate passed deployed verification.
- No DNS, email routing, unrelated AWS workload, `main` ref or Git history change is part of Stage 18C. GitHub Actions validates only; it does not deploy. Keep PR #21 open for owner approval.

Operational logs, timing JSON, browser snapshots and screenshots are retained outside the repository. Raw private cookies/reports remain private local evidence, not publication artifacts.
