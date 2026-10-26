import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import Dialog from "./components/ui/Dialog";
import {
  CategoryBar,
  ContentSection,
  VideoCard,
  DiscoveryGridSkeleton,
} from "./components/home/Feed";
import ImmersionBanner from "./components/home/ImmersionBanner";
import VideoPlayer from "./components/video/VideoPlayer";
import { edits, type Edit } from "./data/edits";
import {
  normalizeCategoryCase,
  isFandomCompatibleWithCategory,
  getFandomById,
} from "./data/fandoms";
import {
  composeHomeFeed,
  rankCatalogVideos,
  splitMixedResults,
  isShort,
  isVideo,
} from "./data/feedComposition";
import { ShortsShelf } from "./components/shorts/ShortsShelf";
import { ShortsViewer } from "./components/shorts/ShortsViewer";
import ImmersionViewer from "./components/immersion/ImmersionViewer";
import { selectEditOfTheMoment } from "./utils/editOfTheMoment";
import { useDiscoveryFeed } from "./hooks/useDiscoveryFeed";
import { useRecommendations } from "./hooks/useRecommendations";
import { Clapperboard } from "lucide-react";

/**
 * Validates and safely parses short ID from URL query parameters.
 * Rejects negative, fractional, unsafe, unknown, or non-short IDs.
 * Preserves ID 0 as valid.
 */
export function parseAndValidateShortId(
  rawShort: string | null,
  catalog: Edit[]
): number | null {
  if (rawShort === null) return null;
  const trimmed = rawShort.trim();
  // Strictly reject negative, fractional, hex/scientific strings, or non-digits
  if (!/^\d+$/.test(trimmed)) return null;

  const num = Number(trimmed);
  if (!Number.isSafeInteger(num)) return null;

  // Must exist in catalog and be a Short format
  const found = catalog.find((e) => e.id === num && isShort(e));
  return found ? num : null;
}

export function parseUrlParams(catalog: Edit[] = edits): {
  category: string;
  fandom: string;
  query: string;
  view: string;
  shortId: number | null;
} {
  if (typeof window === "undefined") {
    return { category: "All", fandom: "", query: "", view: "Home", shortId: null };
  }
  const params = new URLSearchParams(window.location.search);
  const rawCat = params.get("category") || params.get("cat") || "";
  const rawFandom = params.get("fandom") || "";
  const rawQ = params.get("q") || params.get("query") || "";
  const rawView = params.get("view") || "";
  const rawShort = params.get("short");

  let normCat = normalizeCategoryCase(rawCat);
  const fandomMeta = rawFandom ? getFandomById(rawFandom.trim()) : undefined;

  let normFandom = "";
  if (fandomMeta) {
    if (!normCat) {
      // Direct URL ?fandom=valorant without category: resolve to primary category
      normCat = fandomMeta.categories[0] || "All";
      normFandom = fandomMeta.id;
    } else if (normCat === "All") {
      // Top-level 'All' does not allow active fandom filter (avoids hidden filter states)
      normFandom = "";
    } else if (isFandomCompatibleWithCategory(fandomMeta.id, normCat)) {
      normFandom = fandomMeta.id;
    } else {
      // Incompatible fandom with specified category: clear fandom
      normFandom = "";
    }
  }

  if (!normCat) {
    normCat = "All";
  }

  let normView = "Home";
  if (rawView.toLowerCase() === "explore") {
    normView = "Explore";
  } else if (rawView.toLowerCase() === "shorts") {
    normView = "Shorts";
  }

  const shortId = parseAndValidateShortId(rawShort, catalog);

  return {
    category: normCat,
    fandom: normFandom,
    query: rawQ.trim(),
    view: normView,
    shortId,
  };
}

export function syncUrl(
  cat: string,
  fan: string,
  q: string,
  view: string,
  shortId: number | null | undefined,
  usePush: boolean,
  stateUpdate?: Record<string, unknown> | null
) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  if (view && view.toLowerCase() === "explore") {
    params.set("view", "explore");
  } else if (view && view.toLowerCase() === "shorts") {
    params.set("view", "shorts");
  }
  if (typeof shortId === "number") {
    params.set("short", String(shortId));
  }
  if (cat && cat !== "All" && cat !== "Featured") {
    params.set("category", cat);
  }
  if (fan && fan !== "all") {
    params.set("fandom", fan);
  }
  if (q && q.trim()) {
    params.set("q", q.trim());
  }

  const newSearch = params.toString() ? `?${params.toString()}` : "";
  const currentSearch = window.location.search;

  const existingState: Record<string, unknown> =
    window.history?.state && typeof window.history.state === "object"
      ? { ...window.history.state }
      : {};

  let nextState: Record<string, unknown> | null = null;
  if (stateUpdate === null || (shortId === null && stateUpdate === undefined)) {
    const cleaned = { ...existingState };
    delete cleaned.viewerSessionId;
    delete cleaned.viewerDepth;
    delete cleaned.hasInAppOrigin;
    nextState = Object.keys(cleaned).length > 0 ? cleaned : null;
  } else if (stateUpdate !== undefined) {
    nextState = { ...existingState, ...stateUpdate };
  } else {
    nextState = Object.keys(existingState).length > 0 ? existingState : null;
  }

  if (newSearch === currentSearch) {
    if (!usePush && stateUpdate !== undefined && window.history?.replaceState) {
      window.history.replaceState(
        nextState,
        "",
        window.location.pathname + newSearch + window.location.hash
      );
    }
    return;
  }

  const targetUrl = window.location.pathname + newSearch + window.location.hash;
  if (usePush) {
    window.history.pushState(nextState, "", targetUrl);
  } else {
    window.history.replaceState(nextState, "", targetUrl);
  }
}

export default function App({
  initialEdits = edits,
}: {
  initialEdits?: Edit[];
} = {}) {
  const [expanded, setExpanded] = useState(() => innerWidth >= 1440);
  const [mobile, setMobile] = useState(() => innerWidth < 768);
  const [drawer, setDrawer] = useState(false);

  // Curated Shorts in the catalog
  const catalogShorts = useMemo(
    () => initialEdits.filter((e) => isShort(e)),
    [initialEdits]
  );

  // Production always uses the compiled module. initialEdits is a test-only
  // public-catalog injection point, never an intake/publication API.
  const shuffleOffset = useRef(0);
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(now);
      timer = setTimeout(refresh, 86400000 - (now.getTime() % 86400000) + 10);
    };
    refresh();
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  const initialLandscapeVideo = useMemo(
    () => selectEditOfTheMoment(initialEdits, today), [initialEdits, today],
  );

  // Initialize navigation state from URL query parameters
  const initialParams = parseUrlParams(initialEdits);
  const [query, setQuery] = useState(initialParams.query);
  const [category, setCategory] = useState(initialParams.category);
  const [fandom, setFandom] = useState(initialParams.fandom);
  const [selection, setSelection] = useState<{ catalog: Edit[]; id: number } | null>(null);
  const selected = selection?.catalog === initialEdits
    ? initialEdits.find((e) => e.id === selection.id && isVideo(e)) ?? initialLandscapeVideo
    : initialLandscapeVideo;
  const setSelected = (edit: Edit) => setSelection({ catalog: initialEdits, id: edit.id });
  useEffect(() => { shuffleOffset.current = 0; }, [initialEdits]);
  const [active, setActive] = useState(initialParams.view);
  const [shortSelection, setActiveShort] = useState<Edit | null>(() => {
    if (typeof initialParams.shortId === "number") {
      return (
        initialEdits.find(
          (e) => e.id === initialParams.shortId && isShort(e)
        ) || null
      );
    }
    return null;
  });
  const activeShort = initialEdits.find((e) => e.id === shortSelection?.id && isShort(e)) ?? null;
  const [modal, setModal] = useState("");
  const [immersionOpen, setImmersionOpen] = useState(false);

  // Active viewer session identifier and monotonic session counter.
  // Restore existing application-owned viewer session on refresh if URL has a valid Short
  // and history.state has a recognized session identifier and positive safe integer depth.
  const initialViewerSessionId = (() => {
    if (typeof window === "undefined") return null;
    if (typeof initialParams.shortId !== "number") return null;
    const isInitialShortValid = initialEdits.some(
      (e) => e.id === initialParams.shortId && isShort(e)
    );
    if (!isInitialShortValid) return null;

    const navState = window.history?.state;
    if (
      navState &&
      typeof navState.viewerSessionId === "string" &&
      navState.viewerSessionId.trim() &&
      typeof navState.viewerDepth === "number" &&
      Number.isSafeInteger(navState.viewerDepth) &&
      navState.viewerDepth > 0
    ) {
      return navState.viewerSessionId;
    }
    return null;
  })();

  const viewerSessionIdRef = useRef<string | null>(initialViewerSessionId);
  const sessionCounterRef = useRef<number>(0);

  useEffect(() => {
    const mq = matchMedia("(max-width:767px)");
    const change = () => {
      setMobile(mq.matches);
      setDrawer(false);
    };
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);

  // Normalize initial URL if it contains direct fandom without category or invalid short IDs
  useEffect(() => {
    const current = parseUrlParams(initialEdits);
    syncUrl(
      current.category,
      current.fandom,
      current.query,
      current.view,
      current.shortId,
      false
    );
  }, [initialEdits]);

  // Synchronize browser history navigation (Back / Forward)
  useEffect(() => {
    function handlePopState(e: PopStateEvent) {
      const {
        category: c,
        fandom: f,
        query: q,
        view: v,
        shortId: sId,
      } = parseUrlParams(initialEdits);
      setCategory(c);
      setFandom(f);
      setQuery(q);
      setActive(v);

      const navState =
        (e && e.state) ||
        (typeof window !== "undefined" ? window.history?.state : null);
      const destSessionId =
        navState && typeof navState.viewerSessionId === "string"
          ? navState.viewerSessionId
          : null;

      if (typeof sId === "number") {
        const matchingShort =
          initialEdits.find((e) => e.id === sId && isShort(e)) || null;
        setActiveShort(matchingShort);
        // Track the destination entry's viewer session if tagged
        viewerSessionIdRef.current = destSessionId;
      } else {
        // Destination entry is not a short (viewer closed via popstate)
        setActiveShort(null);
        viewerSessionIdRef.current = null;
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [initialEdits]);

  const handleCategoryChange = useCallback(
    (newCat: string) => {
      const normCat = normalizeCategoryCase(newCat) || "All";
      const newFandom = isFandomCompatibleWithCategory(fandom, normCat)
        ? fandom
        : "";
      setCategory(normCat);
      setFandom(newFandom);

      // On dedicated Shorts page with 0 shorts, user action navigates to Explore
      const nextView =
        active === "Shorts" && catalogShorts.length === 0 ? "Explore" : active;
      if (nextView !== active) {
        setActive(nextView);
      }

      syncUrl(normCat, newFandom, query, nextView, activeShort?.id, true);
    },
    [active, activeShort?.id, catalogShorts.length, fandom, query]
  );

  const handleFandomChange = useCallback(
    (newFandomId: string) => {
      const cleanFandom =
        newFandomId === "all" ? "" : newFandomId.trim().toLowerCase();
      setFandom(cleanFandom);

      // On dedicated Shorts page with 0 shorts, user action navigates to Explore
      const nextView =
        active === "Shorts" && catalogShorts.length === 0 ? "Explore" : active;
      if (nextView !== active) {
        setActive(nextView);
      }

      syncUrl(category, cleanFandom, query, nextView, activeShort?.id, true);
    },
    [active, activeShort?.id, category, catalogShorts.length, query]
  );

  const handleQueryChange = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);

      // On dedicated Shorts page with 0 shorts, searching navigates to Explore
      const nextView =
        active === "Shorts" && catalogShorts.length === 0 && newQuery.trim()
          ? "Explore"
          : active;
      if (nextView !== active) {
        setActive(nextView);
      }

      syncUrl(category, fandom, newQuery, nextView, activeShort?.id, false);
    },
    [active, activeShort?.id, category, catalogShorts.length, fandom]
  );

  const handleTagClick = useCallback(
    (tag: string) => {
      const tagQuery = "#" + tag.toLowerCase().trim();
      setQuery(tagQuery);
      syncUrl(category, fandom, tagQuery, active, activeShort?.id, true);
    },
    [active, activeShort?.id, category, fandom]
  );

  // Atomic hashtag navigation from within Shorts viewer
  const handleShortsViewerTagClick = useCallback(
    (tag: string) => {
      // 1. Close the viewer and clear session tracking
      viewerSessionIdRef.current = null;
      setActiveShort(null);
      // 2. Prepare exact hashtag query: #tag
      const tagQuery = "#" + tag.toLowerCase().trim();
      setQuery(tagQuery);
      // 3. Reset filters to avoid incompatible category/fandom
      setCategory("All");
      setFandom("");
      // 4. Navigate to Explore surface
      setActive("Explore");
      // 5. Update URL clearing short= and syncing discovery query with cleared session state
      syncUrl("All", "", tagQuery, "Explore", null, true, null);
    },
    []
  );

  const handleClearFilters = useCallback(() => {
    setCategory("All");
    setFandom("");
    setQuery("");
    syncUrl("All", "", "", active, null, true);
  }, [active]);

  const handleClearFandom = useCallback(() => {
    setFandom("");
    syncUrl(category, "", query, active, activeShort?.id, true);
  }, [active, activeShort?.id, category, query]);

  const handleSelectShort = useCallback(
    (short: Edit) => {
      const newSessionId = `vs-${Date.now()}-${++sessionCounterRef.current}`;
      viewerSessionIdRef.current = newSessionId;
      setActiveShort(short);
      syncUrl(category, fandom, query, active, short.id, true, {
        viewerSessionId: newSessionId,
        viewerDepth: 1,
        hasInAppOrigin: true,
      });
    },
    [active, category, fandom, query]
  );

  // Synchronize Next / Previous inside ShortsViewer with URL and activeShort
  const handleShortChange = useCallback(
    (newShort: Edit) => {
      const curState =
        typeof window !== "undefined" ? window.history?.state : null;
      const hasInAppOrigin = Boolean(
        curState && curState.hasInAppOrigin === true
      );

      let sessionId = viewerSessionIdRef.current;
      const isExistingSession = Boolean(
        sessionId &&
        curState &&
        curState.viewerSessionId === sessionId &&
        typeof curState.viewerDepth === "number"
      );

      if (!sessionId || !isExistingSession) {
        sessionId = `vs-${Date.now()}-${++sessionCounterRef.current}`;
        viewerSessionIdRef.current = sessionId;
      }

      const curDepth = isExistingSession
        ? (curState!.viewerDepth as number)
        : (hasInAppOrigin ? 1 : 0);
      const nextDepth = curDepth + 1;

      setActiveShort(newShort);
      syncUrl(category, fandom, query, active, newShort.id, true, {
        viewerSessionId: sessionId,
        viewerDepth: nextDepth,
        hasInAppOrigin,
      });
    },
    [active, category, fandom, query]
  );

  const handleCloseShort = useCallback(() => {
    setActiveShort(null);
    const nextView =
      active === "Shorts" && catalogShorts.length === 0 ? "Home" : active;
    if (active === "Shorts" && catalogShorts.length === 0) {
      setActive("Home");
    }

    const curState =
      typeof window !== "undefined" ? window.history?.state : null;
    const hasInAppOrigin = Boolean(
      curState && curState.hasInAppOrigin === true
    );
    const isAppSession =
      viewerSessionIdRef.current &&
      curState &&
      curState.viewerSessionId === viewerSessionIdRef.current &&
      typeof curState.viewerDepth === "number" &&
      curState.viewerDepth > 0;

    if (isAppSession && hasInAppOrigin) {
      const depthToGo = curState.viewerDepth;
      viewerSessionIdRef.current = null;
      if (
        typeof window !== "undefined" &&
        typeof window.history?.go === "function"
      ) {
        window.history.go(-depthToGo);
      } else {
        syncUrl(category, fandom, query, nextView, null, false, null);
      }
    } else {
      viewerSessionIdRef.current = null;
      syncUrl(category, fandom, query, nextView, null, false, null);
    }
  }, [active, category, catalogShorts.length, fandom, query]);

  function choose(edit: Edit) {
    if (!isVideo(edit)) return;
    setSelected(edit);
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  const handleShuffleFeatured = useCallback(() => {
    const nextFeatured = selectEditOfTheMoment(initialEdits, new Date(), ++shuffleOffset.current);
    if (nextFeatured) setSelection({ catalog: initialEdits, id: nextFeatured.id });
  }, [initialEdits]);

  function navigate(name: string) {
    setDrawer(false);
    if (name === "Home") {
      setActive("Home");
      setActiveShort(null);
      viewerSessionIdRef.current = null;
      setQuery("");
      setCategory("All");
      setFandom("");
      syncUrl("All", "", "", "Home", null, true);
    } else if (name === "Explore") {
      setActive("Explore");
      setActiveShort(null);
      viewerSessionIdRef.current = null;
      setQuery("");
      setCategory("All");
      setFandom("");
      syncUrl("All", "", "", "Explore", null, true);
    } else if (name === "Shorts") {
      setActive("Shorts");
      setQuery("");
      setCategory("All");
      setFandom("");
      if (catalogShorts.length > 0) {
        const firstShort = catalogShorts[0];
        const newSessionId = `vs-${Date.now()}-${++sessionCounterRef.current}`;
        viewerSessionIdRef.current = newSessionId;
        setActiveShort(firstShort);
        syncUrl("All", "", "", "Shorts", firstShort.id, true, {
          viewerSessionId: newSessionId,
          viewerDepth: 1,
          hasInAppOrigin: true,
        });
      } else {
        setActiveShort(null);
        viewerSessionIdRef.current = null;
        syncUrl("All", "", "", "Shorts", null, true, null);
      }
    } else if (name === "Immersion") {
      setImmersionOpen(true);
    } else {
      setModal(name);
    }
  }

  const { edits: filtered, loading } = useDiscoveryFeed(
    initialEdits,
    query,
    category,
    fandom
  );

  const isUpNextEnabled = selected !== null && isVideo(selected);

  const { edits: upNextEdits } = useRecommendations(
    {
      surface: "up_next",
      currentEditId: selected ? selected.id : undefined,
      limit: 4,
    },
    isUpNextEnabled,
    initialEdits
  );

  const { edits: homeRecommendedEdits } = useRecommendations({
    surface: "home",
    limit: 50,
  }, true, initialEdits);

  const homeSections = useMemo(
    () =>
      composeHomeFeed({
        recommendedVideos: homeRecommendedEdits,
        catalog: initialEdits,
        currentEditId: selected?.id ?? null,
      }),
    [homeRecommendedEdits, initialEdits, selected?.id]
  );

  const { videos: searchVideos, shorts: searchShorts } = useMemo(
    () => splitMixedResults(filtered),
    [filtered]
  );

  const browsing =
    !!query ||
    (category !== "All" && category !== "Featured") ||
    !!fandom ||
    active === "Explore";

  const homeShelfShorts = useMemo(() => {
    const shelf = homeSections.find((s) => s.type === "shorts_shelf");
    return shelf ? shelf.items : [];
  }, [homeSections]);

  // Compute eligible Shorts queue reflecting current view, category, fandom, and search filters
  const eligibleShorts = useMemo(() => {
    let baseQueue: Edit[];
    if (active === "Shorts" || browsing || active === "Explore") {
      baseQueue = searchShorts;
    } else {
      baseQueue =
        homeShelfShorts.length > 0 ? homeShelfShorts : catalogShorts;
    }

    if (activeShort && !baseQueue.some((s) => s.id === activeShort.id)) {
      return [activeShort, ...baseQueue];
    }
    return baseQueue.length > 0 ? baseQueue : activeShort ? [activeShort] : [];
  }, [
    active,
    activeShort,
    browsing,
    catalogShorts,
    homeShelfShorts,
    searchShorts,
  ]);

  const messages: Record<string, string> = {
    Immersion:
      "Immersion Mode is planned. Adaptive ambience, continuous playback, and personal playback queue are not implemented in this homepage preview.",
    Shorts:
      "Curated Shorts is planned as a dedicated portrait-video experience with a vertical player. This preview currently supports standard landscape edits.",
    "Creator Studio":
      "Creator Studio is planned for temporary in-browser AI video analysis. No uploads, login, or public analytics are active in this demo.",
    Settings:
      "This preview follows your device's reduced-motion and reduced-data preferences. Player controls and A–B loop settings are available inside the video.",
    Help:
      "Browse and watch freely without creating an account. Select a card to play. Focus the player and use K or Space to play/pause, M to mute, F for fullscreen, and arrow keys to seek. Use A–B Loop to isolate and repeat any segment.",
  };

  return (
    <div className={`app ${expanded ? "expanded" : "collapsed"}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header
        expanded={mobile ? drawer : expanded}
        toggle={() => (mobile ? setDrawer(!drawer) : setExpanded(!expanded))}
        query={query}
        setQuery={handleQueryChange}
        open={setModal}
        onHome={() => navigate("Home")}
      />
      {!mobile && (
        <aside id="sidebar">
          <Sidebar active={active} onSelect={navigate} />
        </aside>
      )}
      {mobile && drawer && (
        <Dialog title="Navigation" onClose={() => setDrawer(false)}>
          <div id="sidebar" className="mobile-nav">
            <Sidebar active={active} onSelect={navigate} />
          </div>
        </Dialog>
      )}
      <main id="main">
        <CategoryBar
          category={category}
          onSelectCategory={handleCategoryChange}
          fandomId={fandom}
          onSelectFandom={handleFandomChange}
        />
        {active === "Shorts" ? (
          catalogShorts.length === 0 ? (
            <div
              className="shorts-empty-state"
              role="region"
              aria-label="Curated Shorts"
            >
              <div className="shorts-empty-icon-wrap">
                <Clapperboard
                  size={44}
                  className="shorts-empty-icon"
                  aria-hidden="true"
                />
              </div>
              <h1>Curated Shorts are coming soon</h1>
              <p>
                We are currently curating genuine vertical edits across our
                fandoms. In the meantime, explore our cinematic landscape
                edits.
              </p>
              <button
                type="button"
                className="return-browsing-btn"
                onClick={() => navigate("Home")}
              >
                Return to browsing
              </button>
            </div>
          ) : (
            <div className="shorts-catalog-view">
              <div className="results-title">
                <h1>
                  {query
                    ? `Shorts matching “${query}”`
                    : fandom
                      ? `${getFandomById(fandom)?.title || fandom} Shorts`
                      : category !== "All"
                        ? `${category} Shorts`
                        : "Curated Shorts"}
                </h1>
                <span>{searchShorts.length} curated shorts</span>
              </div>
              {searchShorts.length > 0 ? (
                <ShortsShelf
                  title={category !== "All" ? `${category} Shorts` : "Curated Shorts"}
                  items={searchShorts}
                  onSelect={handleSelectShort}
                  onTagClick={handleTagClick}
                />
              ) : (
                <div className="empty">
                  <h2>No matching shorts</h2>
                  <p>
                    No shorts match your current category, fandom, or search
                    filters.
                  </p>
                  <button type="button" onClick={handleClearFilters}>
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          )
        ) : !browsing ? (
          <>
            {selected && isVideo(selected) && (
              <div className="featured-row">
                <VideoPlayer
                  key={selected.id}
                  edit={selected}
                  isOverlayActive={!!activeShort || immersionOpen || !!modal || (mobile && drawer)}
                  onShuffle={handleShuffleFeatured}
                />
                <section className="up-next">
                  <h2>Up Next</h2>
                  {rankCatalogVideos(initialEdits, upNextEdits).filter((e) => e.id !== selected.id).slice(0, 4).map((e) => (
                    <VideoCard
                      key={e.id}
                      compact
                      edit={e}
                      onSelect={choose}
                      onSelectShort={handleSelectShort}
                      onTagClick={handleTagClick}
                    />
                  ))}
                </section>
              </div>
            )}

            <ImmersionBanner onOpen={() => setImmersionOpen(true)} />
            {homeSections.map((section) => {
              if (section.type === "video_row") {
                return (
                  <div key={section.id}>
                    <ContentSection
                      title={section.title}
                      items={section.items}
                      groups={section.groups}
                      onSelect={choose}
                      onSelectShort={handleSelectShort}
                      onTagClick={handleTagClick}
                    />
                  </div>
                );
              }
              if (section.type === "shorts_shelf") {
                return (
                  <ShortsShelf
                    key={section.id}
                    title={section.title}
                    items={section.items}
                    onSelect={handleSelectShort}
                    onTagClick={handleTagClick}
                  />
                );
              }
              return null;
            })}
          </>
        ) : (
          <>
            <div className="results-title">
              <h1>
                {query
                  ? `Search results for “${query}”`
                  : fandom
                    ? `${getFandomById(fandom)?.title || fandom} edits`
                    : active === "Explore" && category === "All"
                      ? "Explore edits"
                      : `${category} edits`}
              </h1>
              <span>{filtered.length} edits</span>
            </div>
            {loading ? (
              <DiscoveryGridSkeleton
                count={8}
                label="Loading discovery edits..."
              />
            ) : filtered.length ? (
              <>
                {searchShorts.length > 0 && (
                  <ShortsShelf
                    title={query ? "Matching Shorts" : "Curated Shorts"}
                    items={searchShorts}
                    onSelect={handleSelectShort}
                    onTagClick={handleTagClick}
                  />
                )}
                {searchVideos.length > 0 && (
                  <ContentSection
                    title={
                      searchShorts.length > 0 ? "Landscape Edits" : "Discover"
                    }
                    items={searchVideos}
                    onSelect={(e) => {
                      choose(e);
                      setQuery("");
                      setCategory("All");
                      setFandom("");
                      setActive("Home");
                      syncUrl("All", "", "", "Home", null, true);
                    }}
                    onSelectShort={handleSelectShort}
                    onTagClick={handleTagClick}
                  />
                )}
              </>
            ) : (
              <div className="empty">
                {fandom ? (
                  <>
                    <h2>
                      No edits found for{" "}
                      {getFandomById(fandom)?.title || fandom}
                    </h2>
                    <p>
                      The catalog does not yet include edits for this
                      fandom. You can browse other {category} edits or clear
                      the fandom filter.
                    </p>
                    <button type="button" onClick={handleClearFandom}>
                      Clear fandom filter
                    </button>
                  </>
                ) : category === "Multifandom" ? (
                  <>
                    <h2>No multifandom edits yet</h2>
                    <p>
                      Multifandom crossover edits are planned for our curated
                      library.
                    </p>
                    <button type="button" onClick={handleClearFilters}>
                      Browse all edits
                    </button>
                  </>
                ) : (
                  <>
                    <h2>No matching edits</h2>
                    <p>Try another title, category, or tag.</p>
                    <button type="button" onClick={handleClearFilters}>
                      Clear filters
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
        <footer>
          LOCAL FRONTEND PREVIEW{" "}
          <span>
            Account-free discovery. Demos use original artwork and silent test footage.
            No personal data or platform statistics.
          </span>
        </footer>
      </main>
      {modal && (
        <Dialog title={modal} onClose={() => setModal("")}>
          <p>
            {messages[modal] || "This feature is planned for a future release."}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => setModal("")}
          >
            Back to browsing
          </button>
        </Dialog>
      )}
      {activeShort && !immersionOpen && (
        <ShortsViewer
          shorts={eligibleShorts}
          initialShortId={activeShort.id}
          activeShortId={activeShort.id}
          onShortChange={handleShortChange}
          onClose={handleCloseShort}
          onTagClick={handleShortsViewerTagClick}
        />
      )}
      {immersionOpen && (
        <ImmersionViewer
          catalog={initialEdits}
          initialContext={{
            category: category !== "All" ? category : undefined,
            fandomId: fandom || undefined,
            currentEditId: selected?.id,
          }}
          onClose={() => setImmersionOpen(false)}
          onTagClick={handleTagClick}
        />
      )}
    </div>
  );
}
