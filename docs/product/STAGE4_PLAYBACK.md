# Stage 4: playback lifecycle and audio coordination

Stage 4 starts at `c4c3a2b7f1eab161327aa7b6f1523a081fb1fdb9`. It changes the
existing player adapters and viewers, without changing the catalog, recommendation
queue selection, media assets, or publication pipeline.

## Ownership and cancellation

`playbackCoordinator.registerPlayer()` returns a callable, generation-safe lease.
Call it to dispose; use its `playing()`, `paused()` and `canPlay()` methods for
instance-bound notifications. Cleanup or callbacks from an older registration
cannot delete, pause, or clear a replacement that happens to use the same ID.
Legacy ID-based methods remain available for existing callers, but components use
leases. Unknown IDs cannot claim playback.

A registration is initially idle. Native `playing` and iframe `PLAYING` events
claim ownership. The coordinator sets the new owner before pausing other players,
so synchronous pause events cannot clear the new owner. Every other registration
is paused, including a player whose asynchronous start has not completed yet.
Pause, completion, error, and disposal release active ownership.

A viewer reserves a modal scope separately from active playback. Entering the
viewer cancels background playback immediately, even when autoplay is disabled.
Only registrations in that scope may start until it closes. Mounting a paused
viewer does not invent an active player. Closing a viewer releases its reservation
and stops its media; it does not restart the featured player. Empty Shorts lists
do not acquire a reservation or lock scrolling.

`useNativePlayback` captures the exact media element and registration for every
play request. Cancellation invalidates intent; a late promise settles against the
captured old element, never the replacement ref. Only actual `playing` events
update active ownership. Stale pause events are ignored when the current element
is already playing again. Visibility changes cancel pending starts and pause
playback. Rejections keep a user-controlled Play/Resume action available.

The iframe API has no request token for `playVideo()`. When a commanded start is
cancelled before `PLAYING`, the adapter retires that iframe generation and creates
a paused replacement. Late events from the retired instance are ignored. Ordinary
pause/resume after playback has begun, callback updates, and mute changes preserve
the existing iframe. A cancelled API-loading/ready state cannot autoplay later.

## Surface behavior

| Surface | Native media | YouTube iframe |
| --- | --- | --- |
| Featured | Effects only attach to a real video node; media identity resets position, errors, markers and menus | No native node is required; current overlay intent is checked again at readiness |
| Shorts | Actual playback events coordinate ownership; consistent completion advances to the next Short | Same completion policy; official iframe controls and safe attribution links remain |
| Immersion | Captured play attempts, explicit blocked-autoplay recovery, bounded error skips | Per-queue-entry iframe lifecycle; stale events cannot navigate or control a new item |
| Pause/end/error | Release ownership and update controls | Release ownership and update callbacks/controls |
| Preferences | Automatic starts respect reduced motion and save-data | Automatic starts respect the same preferences |
| Hidden page | Pause; returning to the page does not restart automatically | Pause; late readiness/starts cannot override hidden state |
| Retry | Reload the current native source through existing controls | Explicit Retry playback recreates the failed adapter; Watch on YouTube remains available |

Shorts advance once on completion and stop at the last item. There is no implicit
loop or wraparound. Press Play to replay the last Short. Errors never cause an
unbounded automatic retry. Immersion preserves its existing continuous queue and
history behavior: unavailable media allows at most three skips (four failed
attempts), then offers Restart or Exit. Queue entries include their position in
the media lifecycle identity, so a single-item catalog can replay and still stop
bounded failure recovery. Successful playback resets consecutive failure count.

The featured player preserves native play/pause, mute, seeking, A–B loop,
fullscreen, picture-in-picture where supported, keyboard controls, and retry.
Native effects clean up observers, animation frames and listeners. Featured
playback is also paused for Help and mobile Navigation overlays.

## Accessibility and layout

Both viewers reserve their shortcuts, focus their dialog on entry, restore focus
on closure, and make background siblings inert while open. The focus trap includes
iframes and excludes hidden controls. Fullscreen exit finishes before focus is
restored. Cleanup restores scrolling and prior inert values.

Shorts includes a named Play/Pause button, live playback status, and visible
previous/next controls on mobile. Immersion respects native button Space/Enter
behavior instead of also firing its global shortcut. Small mobile layout changes
keep its control row and tag list within the viewport. Official cross-origin
YouTube controls retain their own keyboard behavior while focused; parent-page
shortcuts cannot intercept events inside that iframe.

## Reproducible verification

Dependencies use the unchanged `pnpm-lock.yaml`. Node component tests use the
existing React mounting shim, extracted to `tests/mounted-dom.mjs`; browser tests
exercise real DOM, React effects, actual local video decoding, and a controlled
YouTube API that replaces its target with an iframe. No test fixture is imported
by the application or emitted into the production catalog.

Run Node tests through the trusted entry point from the Stage 4 worktree:

```bash
/usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/rohan /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh --check-isolation
/usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/rohan /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh
/usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/rohan /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh tests/*.test.mjs
/usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/rohan /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh tests/stage4-playback.test.mjs tests/shorts.test.mjs tests/youtube-playback.test.mjs tests/immersion-queue.test.mjs
```

`RUNTIME_MODULES` points to the already installed browser tooling directory
containing Playwright, as with the existing verification scripts. On this WSL2
host it is `/home/rohan/.local/share/lolixco-codex/browser-tools`, using Linux Edge.
Run browser verification in a fresh network namespace, with the trusted preflight
inside the same namespace before the browser driver:

```bash
/usr/bin/env -i \
  PATH=/home/rohan/.nvm/versions/node/v24.22.1/bin:/usr/bin:/bin \
  HOME=/home/rohan \
  RUNTIME_MODULES=/home/rohan/.local/share/lolixco-codex/browser-tools \
  VERIFY_OUTPUT_DIR=/home/rohan/lolixco-review-handoff/stage4-playback/evidence/browser \
  /usr/bin/unshare -rn /bin/bash --noprofile --norc -c '
    /usr/sbin/ip link set lo up &&
    /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/rohan /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh --check-isolation &&
    node scripts/verify-playback.mjs
  '
```

The browser driver starts its own loopback-only Vite server with a fresh empty
`envDir`, blocks nonlocal requests, supplies an empty iframe API script and a
controlled fake API, and closes its browser/server in `finally`. It asserts that
application keyboard/visibility/fullscreen listeners, observers and animation
frames return to their initial counts after each lifecycle case. Seven viewports
are checked for the application, Shorts and Immersion, including control bounds,
focus wrapping and screenshots: 1672×941, 1440×900, 1280×800, 1024×768, 768×1024,
390×844 and 360×800.

## Evidence limits

These are offline lifecycle tests, not genuine in-app YouTube certification. The
fake API deliberately simulates readiness, state changes, cancelled starts,
autoplay blocks and errors 2/100/101/150. No actual YouTube restrictions, network
reliability, advertising behavior, or creator embedding permission was tested.
Native browser verification uses the existing synthetic silent WebM. It verifies
actual decoding, controls, media state and exclusive ownership, not an acoustic
measurement of simultaneous audible tracks. Browser evidence is Linux Edge /
Chromium, not a Safari, Firefox, iOS, or Android device certification.

The 17 frozen demos and canonical recommendation snapshot remain byte-for-byte
unchanged. No credentials, private audits, publication workflow, push, PR, merge,
or deployment are part of this stage. The external review handoff records exact
commits, complete file list, checksums, test counts and the review decision.
