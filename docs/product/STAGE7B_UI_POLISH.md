# UI navigation and playback context

Deliberate category or fandom navigation replaces the current search query. Typing a query still combines with the selected category/fandom until the user navigates again. URL history restores the full previous combination, including genuine empty results.

Audio preference is shared in tab memory across native players, Shorts, Immersion and YouTube wrappers. A fresh page starts muted. Explicit mute/unmute updates all surfaces; playback ownership still belongs to the coordinator. Unmuted preference does not grant autoplay permission. A blocked player must retain the preference and offer Play; it must not manufacture a new user gesture or force autoplay.

The featured player and fullscreen-capable root remain mounted across Shuffle. Source changes clear timing, errors and A–B markers, while keeping audio preference and fullscreen context. Generation-safe playback cleanup distinguishes an old element from a stable element reused by a newer source.

Immersion explicitly resets inherited site header/main geometry. Native content uses contain-fit; provider-created iframes fill their own wrapper. Search grids keep empty tracks instead of growing a lone landscape card to page width. Shorts cards keep their duration badge and readable text; decorative full-picture overlays are removed. Source-encoded black bars remain part of the source presentation. Playback seek tracks remain intact.

Reduced-motion preferences disable the added layout transitions. Navigation, card transforms and video source replacement do not animate media dimensions.

Stage 8 intake and publication are independent. These UI contracts accept injected private reference catalogs for local browser tests without changing the canonical production catalog or recommendation snapshot.

The featured stage reserves a viewport-bounded height while its player follows native `videoWidth/videoHeight` after metadata loads. A source-keyed measurement avoids applying the old video's ratio to a new source; verified format is the initial/provider fallback. Portrait controls wrap within the capped player. Fullscreen still uses the stable viewport container with contain-fit rendering. Source changes keep the existing reset-to-start behavior; geometry measurement does not seek.

Shorts duration badges explicitly unset the generic landscape badge's bottom constraint. Setting both top and bottom had stretched the badge background into a vertical strip; the source fix keeps only the small top-right badge.
