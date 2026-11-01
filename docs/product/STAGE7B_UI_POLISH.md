# UI navigation and playback context

Deliberate category or fandom navigation replaces the current search query. Typing a query still combines with the selected category/fandom until the user navigates again. URL history restores the full previous combination, including genuine empty results.

Audio preference is shared in tab memory across native players, Shorts, Immersion and YouTube wrappers. A fresh page starts muted. Explicit mute/unmute updates all surfaces; playback ownership still belongs to the coordinator. Unmuted preference does not grant autoplay permission. A blocked player must retain the preference and offer Play; it must not manufacture a new user gesture or force autoplay.

The featured player and fullscreen-capable root remain mounted across Shuffle. Source changes clear timing, errors and A–B markers, while keeping audio preference and fullscreen context. Generation-safe playback cleanup distinguishes an old element from a stable element reused by a newer source.

Immersion explicitly resets inherited site header/main geometry. Native content uses contain-fit; provider-created iframes fill their own wrapper. Search grids keep empty tracks instead of growing a lone landscape card to page width. Shorts cards keep their duration badge and readable text; decorative full-picture overlays are removed. Source-encoded black bars remain part of the source presentation. Playback seek tracks remain intact.

Reduced-motion preferences disable the added layout transitions. Navigation, card transforms and video source replacement do not animate media dimensions.

Stage 8 intake and publication are independent. These UI contracts accept injected private reference catalogs for local browser tests without changing the canonical production catalog or recommendation snapshot.

The featured stage reserves a viewport-bounded height while its player follows native `videoWidth/videoHeight` after metadata loads. A source-keyed measurement avoids applying the old video's ratio to a new source; verified format is the initial/provider fallback. Portrait controls wrap within the capped player. Fullscreen still uses the stable viewport container with contain-fit rendering. Source changes keep the existing reset-to-start behavior; geometry measurement does not seek.

Shorts duration badges explicitly unset the generic landscape badge's bottom constraint. Setting both top and bottom had stretched the badge background into a vertical strip; the source fix keeps only the small top-right badge.

## Cinematic title timing

Featured title, metadata, and the moment label remain visible for approximately three seconds after PLAYING, a source change, or user interaction. They then fade over 240ms. Pointer entry/movement, touch, focus and keyboard interaction renew that window; pause reveals information immediately. Shuffle, primary playback/mute/fullscreen controls and the seek timeline remain available. Reduced-motion mode removes the opacity animation while retaining the information window. Both native events and official YouTube API play/pause callbacks drive the same hook. Cross-origin iframe internals retain their provider's own controls and captions; parent pointer handlers apply to the surrounding Lolixco player chrome.

## Background-tab playback investigation

Tab switching currently pauses playback by explicit Stage 4 policy, not by unmounting the player:

- `useNativePlayback` pauses on `visibilitychange` when `document.hidden` is true, and rejects hidden-document starts or delayed PLAYING events.
- The featured native player's animation/visibility lifecycle also pauses its native element when hidden.
- `YouTubePlayer` pauses through the official API when hidden and guards hidden-document starts and recovery.
- The playback coordinator does not itself subscribe to visibility. Pause events/callbacks release playback ownership; the visible page does not automatically resume a previously paused player.

A cancelled pending YouTube start can also retire its iframe under the existing race protection; that is distinct from an ordinary running-video visibility pause. These app-level guards explain native and YouTube behavior even before any browser/provider suspension. Browser throttling, OS lifecycle suspension and provider restrictions may apply independently. Background continuation is a separate, nonblocking follow-up: define an explicit user policy and reconcile native/iframe ownership, manual pause and lifecycle events across every surface. This PR retains the established policy rather than selectively removing guards or attempting to bypass browser/YouTube restrictions.
