import test from "node:test";
import assert from "node:assert/strict";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FANDOM_REGISTRY,
  PRIMARY_CATEGORIES,
  LEGACY_CATEGORIES,
  NAVIGATION_CATEGORIES,
  getFandomsForCategory,
  getFandomById,
  isFandomCompatibleWithCategory,
  isValidBrowsingCategory,
  normalizeCategoryCase,
} from "../src/data/fandoms.ts";

import {
  searchEdits,
  getRankedEdits,
  matchesCategoryFilter,
  matchesFandomFilter,
  HASHTAG_WEIGHTS,
  NON_HASHTAG_WEIGHTS,
} from "../src/data/searchEngine.ts";

import { edits } from "../src/data/edits.ts";
import { CategoryBar } from "../src/components/home/CategoryBar.tsx";
import { VideoCard } from "../src/components/home/Feed.tsx";
import Header from "../src/components/layout/Header.tsx";
import Sidebar from "../src/components/layout/Sidebar.tsx";
import VideoPlayer from "../src/components/video/VideoPlayer.tsx";
import App from "../src/App.tsx";

// ---------------------------------------------------------------------------
// 1. Fandom Registry & Category Relationships
// ---------------------------------------------------------------------------

test("Fandom Registry defines stable slugs and correct category relationships", () => {
  assert.ok(FANDOM_REGISTRY.length >= 5);

  const ids = FANDOM_REGISTRY.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "Fandom slugs must be unique");

  // Required future paths verified:
  // Anime -> Jujutsu Kaisen, Demon Slayer
  // Movies -> Spider-Man
  // Gaming -> Valorant, Doom
  const jjk = getFandomById("jujutsu-kaisen");
  assert.ok(jjk);
  assert.equal(jjk.title, "Jujutsu Kaisen");
  assert.deepEqual(jjk.categories, ["Anime"]);

  const ds = getFandomById("demon-slayer");
  assert.ok(ds);
  assert.equal(ds.title, "Demon Slayer");
  assert.deepEqual(ds.categories, ["Anime"]);

  const spidey = getFandomById("spider-man");
  assert.ok(spidey);
  assert.equal(spidey.title, "Spider-Man");
  assert.deepEqual(spidey.categories, ["Movies"]);

  const val = getFandomById("valorant");
  assert.ok(val);
  assert.equal(val.title, "Valorant");
  assert.deepEqual(val.categories, ["Gaming"]);

  const doom = getFandomById("doom");
  assert.ok(doom);
  assert.equal(doom.title, "Doom");
  assert.deepEqual(doom.categories, ["Gaming"]);
});

test("getFandomsForCategory returns only registered fandoms for the category", () => {
  const gamingFandoms = getFandomsForCategory("Gaming");
  assert.equal(gamingFandoms.length, 2);
  const gamingIds = gamingFandoms.map((f) => f.id);
  assert.ok(gamingIds.includes("valorant"));
  assert.ok(gamingIds.includes("doom"));

  const animeFandoms = getFandomsForCategory("Anime");
  assert.equal(animeFandoms.length, 2);
  const animeIds = animeFandoms.map((f) => f.id);
  assert.ok(animeIds.includes("jujutsu-kaisen"));
  assert.ok(animeIds.includes("demon-slayer"));

  const moviesFandoms = getFandomsForCategory("Movies");
  assert.equal(moviesFandoms.length, 1);
  assert.equal(moviesFandoms[0].id, "spider-man");

  // Categories without registered sub-fandoms or 'All' return empty array
  assert.deepEqual(getFandomsForCategory("Series"), []);
  assert.deepEqual(getFandomsForCategory("Multifandom"), []);
  assert.deepEqual(getFandomsForCategory("Phonk"), []);
  assert.deepEqual(getFandomsForCategory("Cinematic"), []);
  assert.deepEqual(getFandomsForCategory("All"), []);
});

test("isFandomCompatibleWithCategory validates category-fandom compatibility", () => {
  // Compatible pairings
  assert.equal(isFandomCompatibleWithCategory("valorant", "Gaming"), true);
  assert.equal(isFandomCompatibleWithCategory("doom", "Gaming"), true);
  assert.equal(isFandomCompatibleWithCategory("jujutsu-kaisen", "Anime"), true);
  assert.equal(isFandomCompatibleWithCategory("spider-man", "Movies"), true);

  // 'All' is a top-level category overview; fandom filters are not active under 'All' to avoid hidden filters
  assert.equal(isFandomCompatibleWithCategory("valorant", "All"), false);
  assert.equal(isFandomCompatibleWithCategory("jujutsu-kaisen", "All"), false);

  // Incompatible pairings
  assert.equal(isFandomCompatibleWithCategory("valorant", "Anime"), false);
  assert.equal(isFandomCompatibleWithCategory("doom", "Movies"), false);
  assert.equal(isFandomCompatibleWithCategory("jujutsu-kaisen", "Gaming"), false);
  assert.equal(isFandomCompatibleWithCategory("spider-man", "Series"), false);

  // Invalid or unknown fandom slug
  assert.equal(isFandomCompatibleWithCategory("unknown-franchise", "Gaming"), false);
  assert.equal(isFandomCompatibleWithCategory("", "Gaming"), false);
});

test("Taxonomy preservation: Production categories distinguish from legacy demo Cinematic", () => {
  assert.deepEqual(
    [...PRIMARY_CATEGORIES],
    ["Anime", "Movies", "Series", "Multifandom", "Gaming", "Phonk"]
  );
  assert.deepEqual([...LEGACY_CATEGORIES], ["Cinematic"]);

  // 'All' is browsing mode, while Cinematic is legacy demo
  assert.ok(NAVIGATION_CATEGORIES.includes("All"));
  assert.ok(NAVIGATION_CATEGORIES.includes("Cinematic"));

  // Normalization
  assert.equal(normalizeCategoryCase("gaming"), "Gaming");
  assert.equal(normalizeCategoryCase("cinematic"), "Cinematic");
  assert.equal(normalizeCategoryCase("all"), "All");
  assert.equal(normalizeCategoryCase("unknown-cat"), undefined);
});

// ---------------------------------------------------------------------------
// 2. Structured Fandom Filtering in Search & Catalog
// ---------------------------------------------------------------------------

const mockCatalog = [
  {
    id: 0,
    title: "Into the Light",
    category: "Cinematic",
    tags: ["cinematic", "original", "demo"],
    description: "Original motion study.",
    creator: "Internal demo",
    poster: "/p0.webp",
    source: "/v.mp4",
    duration: "0:12",
    trending: false,
  },
  {
    id: 1,
    title: "Viper Pit",
    category: "Gaming",
    fandomIds: ["valorant"],
    tags: ["gaming", "tactical", "neon"],
    description: "High tier clutch moments.",
    creator: "Internal demo",
    poster: "/p1.webp",
    source: "/v.mp4",
    duration: "0:15",
    trending: true,
  },
  {
    id: 2,
    title: "Infinite Void",
    category: "Anime",
    fandomIds: ["jujutsu-kaisen"],
    tags: ["anime", "domain", "purple"],
    description: "Domain expansion sequence.",
    creator: "Internal demo",
    poster: "/p2.webp",
    source: "/v.mp4",
    duration: "0:14",
    trending: false,
  },
  {
    id: 3,
    title: "Crossover Rift",
    category: "Anime",
    fandomIds: ["jujutsu-kaisen", "demon-slayer"], // Multi-fandom
    tags: ["anime", "crossover", "blades"],
    description: "Dual sorcerer breathing combat.",
    creator: "Internal demo",
    poster: "/p3.webp",
    source: "/v.mp4",
    duration: "0:18",
    trending: false,
  },
];

test("Structured fandom filter isolates edits by canonical slug ID", () => {
  // Fandom: valorant
  const valResults = searchEdits(mockCatalog, "", "All", "valorant");
  assert.equal(valResults.length, 1);
  assert.equal(valResults[0].edit.id, 1);

  // Fandom: jujutsu-kaisen
  const jjkResults = searchEdits(mockCatalog, "", "All", "jujutsu-kaisen");
  assert.equal(jjkResults.length, 2);
  const jjkIds = jjkResults.map((r) => r.edit.id);
  assert.ok(jjkIds.includes(2));
  assert.ok(jjkIds.includes(3)); // multi-fandom edit satisfies jujutsu-kaisen

  // Fandom: demon-slayer
  const dsResults = searchEdits(mockCatalog, "", "All", "demon-slayer");
  assert.equal(dsResults.length, 1);
  assert.equal(dsResults[0].edit.id, 3); // multi-fandom edit satisfies demon-slayer
});

test("Empty fandom returns 0 results for honest empty state without fabrication", () => {
  // Fandom: doom has no items in mockCatalog
  const doomResults = searchEdits(mockCatalog, "", "Gaming", "doom");
  assert.equal(doomResults.length, 0);

  // Real production demo catalog has no fabricated Valorant or JJK items
  const prodVal = searchEdits(edits, "", "Gaming", "valorant");
  assert.equal(prodVal.length, 0);

  const prodJJK = searchEdits(edits, "", "Anime", "jujutsu-kaisen");
  assert.equal(prodJJK.length, 0);
});

test("Category + Fandom + Search query intersections operate predictably", () => {
  // Intersection of Category: Anime + Fandom: jujutsu-kaisen + Query: #purple
  const results = searchEdits(mockCatalog, "#purple", "Anime", "jujutsu-kaisen");
  assert.equal(results.length, 1);
  assert.equal(results[0].edit.id, 2);

  // Incompatible intersection: Category: Gaming + Fandom: jujutsu-kaisen -> 0 results
  const incompatible = searchEdits(mockCatalog, "", "Gaming", "jujutsu-kaisen");
  assert.equal(incompatible.length, 0);
});

test("Edit ID 0 is preserved across filtering and category defaults", () => {
  const allResults = searchEdits(mockCatalog, "", "All");
  assert.ok(allResults.some((r) => r.edit.id === 0));

  const cinematicResults = searchEdits(mockCatalog, "", "Cinematic");
  assert.equal(cinematicResults.length, 1);
  assert.equal(cinematicResults[0].edit.id, 0);
});

// ---------------------------------------------------------------------------
// 3. UI Component Structure & Accessibility
// ---------------------------------------------------------------------------

test("CategoryBar renders semantic navigation with accessible pressed states", () => {
  let selectedCategory = "Gaming";
  let selectedFandom = "valorant";

  const html = renderToStaticMarkup(
    React.createElement(CategoryBar, {
      category: selectedCategory,
      onSelectCategory: (c) => { selectedCategory = c; },
      fandomId: selectedFandom,
      onSelectFandom: (f) => { selectedFandom = f; },
    })
  );

  // Level 1: Categories nav
  assert.ok(html.includes('<nav class="categories" aria-label="Content categories">'));
  assert.ok(html.includes('aria-pressed="true"')); // Gaming is selected

  // Level 2: Fandoms nav rendered because Gaming has registered fandoms
  assert.ok(html.includes('<nav class="fandoms-bar" aria-label="Gaming fandoms">'));
  assert.ok(html.includes('All Gaming'));
  assert.ok(html.includes('Valorant'));
  assert.ok(html.includes('Doom'));

  // Valorant button has aria-pressed="true"
  assert.ok(html.includes('class="fandom-chip primary" aria-pressed="true"><span>Valorant</span>'));
});

test("CategoryBar omits Level 2 bar when selected category has no fandoms", () => {
  const html = renderToStaticMarkup(
    React.createElement(CategoryBar, {
      category: "Cinematic",
      onSelectCategory: () => {},
      onSelectFandom: () => {},
    })
  );

  assert.ok(html.includes('aria-label="Content categories"'));
  assert.ok(!html.includes('class="fandoms-bar"'), "Level 2 fandom bar should not render for Cinematic");
});

test("VideoCard has separate interactive controls and NO nested buttons", () => {
  let selectCalled = false;
  let tagClicked = "";

  const edit = {
    id: 1,
    title: "Viper Pit",
    category: "Gaming",
    tags: ["gaming", "neon"],
    description: "Clutch motion.",
    creator: "Hidden Creator Name",
    poster: "/p1.webp",
    source: "/v.mp4",
    duration: "0:15",
    trending: false,
  };

  const html = renderToStaticMarkup(
    React.createElement(VideoCard, {
      edit,
      onSelect: () => { selectCalled = true; },
      onTagClick: (tag) => { tagClicked = tag; },
    })
  );

  // Semantic container: <article class="video-card">
  assert.ok(html.startsWith('<article class="video-card"'));

  // Separate watch trigger button
  assert.ok(html.includes('<button type="button" class="card-watch-trigger"'));

  // Separate tag chips
  assert.ok(html.includes('<div class="card-tags" role="group"'));
  assert.ok(html.includes('<button type="button" class="tag-chip"'));
  assert.ok(html.includes('#gaming'));
  assert.ok(html.includes('#neon'));

  // CRITICAL: Verify NO button is nested inside another button
  // A regex checking for `<button[^>]*>.*?<button`
  const nestedButtonRegex = /<button[^>]*>(?:(?!<\/button>)[\s\S])*?<button/i;
  assert.equal(
    nestedButtonRegex.test(html),
    false,
    "VideoCard must NOT contain nested button elements"
  );

  // CRITICAL: Creator name must NOT be rendered in public markup
  assert.equal(
    html.includes("Hidden Creator Name"),
    false,
    "Public video card must never display creator name"
  );
});

test("Header is account-free: no sign-in, member preview, or user profile controls", () => {
  const html = renderToStaticMarkup(
    React.createElement(Header, {
      expanded: true,
      toggle: () => {},
      query: "",
      setQuery: () => {},
      onHome: () => {},
    })
  );

  // Must NOT include Sign In, Sign Up, Member preview, avatar
  assert.equal(html.includes("Sign In"), false);
  assert.equal(html.includes("Sign Up"), false);
  assert.equal(html.includes("Member preview"), false);
  assert.equal(html.includes('class="avatar"'), false);

  // Must maintain search input and brand toggle
  assert.ok(html.includes('role="search"'));
  assert.ok(html.includes('placeholder="Search"'));
  assert.ok(html.includes('id="nav-toggle"'));
});

test("Sidebar contains no account-dependent Following or Library links", () => {
  const html = renderToStaticMarkup(
    React.createElement(Sidebar, {
      active: "Home",
      onSelect: () => {},
    })
  );

  assert.equal(html.includes("Following"), false);
  assert.equal(html.includes("Library"), false);

  // Retains honest placeholders
  assert.ok(html.includes("Creator Studio"));
  assert.ok(html.includes("Immersion"));
  assert.ok(html.includes("Settings"));
  assert.ok(html.includes("Help"));
});

// ---------------------------------------------------------------------------
// 4. Production Catalog Validation
// ---------------------------------------------------------------------------

test("Production edits preserve stable IDs (0..16) and honest legacy categories", () => {
  assert.equal(edits.length, 17);
  for (let i = 0; i < edits.length; i++) {
    assert.equal(edits[i].id, i);
  }

  // Cinematic edits remain discoverable under Cinematic
  const cinematicEdits = edits.filter((e) => e.category === "Cinematic");
  assert.equal(cinematicEdits.length, 3);
  assert.deepEqual(cinematicEdits.map((e) => e.id), [0, 6, 12]);

  // All edits discoverable under 'All'
  const allEdits = searchEdits(edits, "", "All");
  assert.equal(allEdits.length, 17);
});

// ---------------------------------------------------------------------------
// 5. Genuine Mounted React 19 Interaction & History Tests
// ---------------------------------------------------------------------------

function setupMountedDom(initialUrl = "http://localhost:3000/") {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const urlObj = new URL(initialUrl);

  const historyState = {
    historyStack: [urlObj.href],
    pointer: 0,
    get url() {
      return this.historyStack[this.pointer];
    },
    get search() {
      return new URL(this.url).search;
    },
    get pathname() {
      return new URL(this.url).pathname;
    },
    get hash() {
      return new URL(this.url).hash;
    },
    pushCount: 0,
    replaceCount: 0,
  };

  const history = {
    pushState(_state, _title, url) {
      historyState.pushCount++;
      const u = new URL(url, historyState.url);
      historyState.historyStack = historyState.historyStack.slice(
        0,
        historyState.pointer + 1
      );
      historyState.historyStack.push(u.href);
      historyState.pointer = historyState.historyStack.length - 1;
    },
    replaceState(_state, _title, url) {
      historyState.replaceCount++;
      const u = new URL(url, historyState.url);
      historyState.historyStack[historyState.pointer] = u.href;
    },
  };

  const location = {
    get href() {
      return historyState.url;
    },
    get search() {
      return historyState.search;
    },
    get pathname() {
      return historyState.pathname;
    },
    get hash() {
      return historyState.hash;
    },
  };

  globalThis._windowListeners = new Map();
  globalThis.addEventListener = (type, fn, opts) => {
    if (!globalThis._windowListeners.has(type)) {
      globalThis._windowListeners.set(type, []);
    }
    globalThis._windowListeners.get(type).push({
      fn,
      capture: !!(opts && opts.capture),
    });
  };
  globalThis.removeEventListener = (type, fn) => {
    if (!globalThis._windowListeners.has(type)) return;
    const list = globalThis._windowListeners.get(type);
    const i = list.findIndex((l) => l.fn === fn);
    if (i !== -1) list.splice(i, 1);
  };
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  function createElement(tag = "div") {
    return {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      ownerDocument: null,
      parentNode: null,
      childNodes: [],
      style: {},
      attributes: {},
      _listeners: new Map(),
      _textContent: "",
      paused: true,
      pause() { this.paused = true; },
      play() { this.paused = false; return Promise.resolve(); },
      get textContent() {
        if (this._textContent) return this._textContent;
        return this.childNodes
          .map((c) => c.textContent || c.nodeValue || "")
          .join("");
      },
      set textContent(v) {
        this._textContent = v;
        this.childNodes = [];
      },
      setAttribute(k, v) {
        this.attributes[k] = String(v);
      },
      removeAttribute(k) {
        delete this.attributes[k];
      },
      getAttribute(k) {
        return this.attributes[k];
      },
      appendChild(c) {
        c.parentNode = this;
        this.childNodes.push(c);
        return c;
      },
      removeChild(c) {
        const i = this.childNodes.indexOf(c);
        if (i !== -1) this.childNodes.splice(i, 1);
        c.parentNode = null;
        return c;
      },
      insertBefore(c, b) {
        c.parentNode = this;
        const i = this.childNodes.indexOf(b);
        if (i !== -1) this.childNodes.splice(i, 0, c);
        else this.childNodes.push(c);
        return c;
      },
      addEventListener(type, fn, opts) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push({ fn, capture: !!(opts && opts.capture) });
      },
      removeEventListener(type, fn) {
        if (!this._listeners.has(type)) return;
        const list = this._listeners.get(type);
        const i = list.findIndex((l) => l.fn === fn);
        if (i !== -1) list.splice(i, 1);
      },
      dispatchEvent(evt) {
        evt.target = this;
        let curr = this;
        let stopped = false;
        evt.stopPropagation = () => {
          stopped = true;
        };
        while (curr) {
          const list = curr._listeners.get(evt.type);
          if (list) {
            for (const { fn } of [...list]) {
              fn.call(curr, evt);
            }
          }
          if (stopped || !evt.bubbles) break;
          curr = curr.parentNode;
        }
        return true;
      },
    };
  }

  const mockDoc = {
    nodeType: 9,
    ownerDocument: null,
    parentNode: null,
    _listeners: new Map(),
    createElement: (tag) => {
      const el = createElement(tag);
      el.ownerDocument = mockDoc;
      return el;
    },
    createElementNS: (_ns, tag) => {
      const el = createElement(tag);
      el.ownerDocument = mockDoc;
      return el;
    },
    createTextNode: (t) => ({
      nodeType: 3,
      nodeValue: t,
      textContent: t,
      ownerDocument: mockDoc,
      parentNode: null,
    }),
    createComment: () => ({
      nodeType: 8,
      ownerDocument: mockDoc,
      parentNode: null,
    }),
    addEventListener(type, fn, opts) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push({ fn, capture: !!(opts && opts.capture) });
    },
    removeEventListener(type, fn) {
      if (!this._listeners.has(type)) return;
      const list = this._listeners.get(type);
      const i = list.findIndex((l) => l.fn === fn);
      if (i !== -1) list.splice(i, 1);
    },
  };

  globalThis.window = globalThis;
  globalThis.document = mockDoc;
  globalThis.location = location;
  globalThis.history = history;
  globalThis.innerWidth = 1200;
  globalThis.scrollTo = () => {};
  globalThis.HTMLIFrameElement = class {};
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  const triggerPop = (direction = -1) => {
    historyState.pointer = Math.max(
      0,
      Math.min(historyState.historyStack.length - 1, historyState.pointer + direction)
    );
    const evt = { type: "popstate", bubbles: false };
    const list = globalThis._windowListeners.get("popstate") || [];
    for (const { fn } of [...list]) {
      fn.call(globalThis, evt);
    }
  };

  const container = mockDoc.createElement("div");
  mockDoc.body = container;
  container.parentNode = mockDoc;
  const root = createRoot(container);

  const cleanup = async () => {
    await act(async () => {
      root.unmount();
    });
  };

  return { mockDoc, container, root, historyState, triggerPop, cleanup };
}

function findButtonsByText(node, text) {
  const matches = [];
  function walk(n) {
    if (n.tagName === "BUTTON") {
      if (n.textContent && n.textContent.includes(text)) matches.push(n);
    }
    if (n.childNodes) {
      for (const c of n.childNodes) walk(c);
    }
  }
  walk(node);
  return matches;
}

function findHeading1(node) {
  let h1 = null;
  function walk(n) {
    if (n.tagName === "H1" && !h1) h1 = n;
    if (n.childNodes) for (const c of n.childNodes) walk(c);
  }
  walk(node);
  return h1?.textContent || "";
}

function collectAllText(node) {
  let text = "";
  if (node.nodeType === 3) text += (node.nodeValue || "") + " ";
  if (node.nodeType === 1 && node._textContent) text += node._textContent + " ";
  if (node.childNodes) {
    for (const child of node.childNodes) {
      text += collectAllText(child);
    }
  }
  return text;
}

test("Mounted Interaction: Gaming → Valorant → All clears fandom and prevents invisible active filters", async () => {
  const { container, root, cleanup } = setupMountedDom();

  let stateCategory = "All";
  let stateFandom = "";

  function CategoryHarness() {
    const [cat, setCat] = useState("All");
    const [fan, setFan] = useState("");
    stateCategory = cat;
    stateFandom = fan;

    return React.createElement(CategoryBar, {
      category: cat,
      onSelectCategory: (newCat) => {
        setCat(newCat);
        // Requirement: Clicking top-level All clears active fandom
        if (newCat === "All" || !isFandomCompatibleWithCategory(fan, newCat)) {
          setFan("");
        }
      },
      fandomId: fan,
      onSelectFandom: (newFan) => {
        setFan(newFan === "all" ? "" : newFan);
      },
    });
  }

  await act(async () => {
    root.render(React.createElement(CategoryHarness));
  });

  // Level 1: Select Gaming
  const gamingBtn = findButtonsByText(container, "Gaming")[0];
  assert.ok(gamingBtn, "Gaming category button must exist");
  await act(async () => {
    gamingBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(stateCategory, "Gaming");
  assert.equal(stateFandom, "");
  assert.equal(gamingBtn.getAttribute("aria-pressed"), "true");

  // Level 2: Select Valorant
  const valorantBtn = findButtonsByText(container, "Valorant")[0];
  assert.ok(valorantBtn, "Valorant fandom button must be visible under Gaming");
  assert.equal(valorantBtn.getAttribute("aria-pressed"), "false");

  await act(async () => {
    valorantBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(stateCategory, "Gaming");
  assert.equal(stateFandom, "valorant");
  const valorantBtnAfter = findButtonsByText(container, "Valorant")[0];
  assert.equal(valorantBtnAfter.getAttribute("aria-pressed"), "true");

  // Step 3: Select All -> Must clear fandom completely and remove fandom bar
  const allBtn = findButtonsByText(container, "All")[0];
  assert.ok(allBtn, "All category button must exist");

  await act(async () => {
    allBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(stateCategory, "All");
  assert.equal(stateFandom, "", "Active fandom selection must be cleared when All is selected");
  assert.equal(allBtn.getAttribute("aria-pressed"), "true");

  // Level 2 bar must be omitted, with no invisible active fandom
  const valorantBtnStep3 = findButtonsByText(container, "Valorant")[0];
  assert.equal(valorantBtnStep3, undefined, "Valorant fandom chip must NOT exist under All");

  // Regression check: compatibility helper must return false for All
  assert.equal(isFandomCompatibleWithCategory("valorant", "All"), false);

  await cleanup();
});

test("Mounted Interaction: Direct fandom URL normalization and parameter protection", async () => {
  // 1. Direct ?fandom=valorant without category resolves to Gaming
  const { container: c1, root: r1, historyState: h1, cleanup: cl1 } =
    setupMountedDom("http://localhost:3000/?fandom=valorant");

  await act(async () => {
    r1.render(React.createElement(App));
  });

  assert.equal(
    h1.search,
    "?category=Gaming&fandom=valorant",
    "Direct ?fandom=valorant must be normalized to ?category=Gaming&fandom=valorant"
  );

  const gamingBtn = findButtonsByText(c1, "Gaming")[0];
  assert.ok(gamingBtn);
  assert.equal(gamingBtn.getAttribute("aria-pressed"), "true");

  const valorantBtn = findButtonsByText(c1, "Valorant")[0];
  assert.ok(valorantBtn);
  assert.equal(valorantBtn.getAttribute("aria-pressed"), "true");

  await cl1();

  // 2. Direct ?fandom=unknownxyz rejects invalid fandom cleanly to /
  const { root: r2, historyState: h2, cleanup: cl2 } =
    setupMountedDom("http://localhost:3000/?fandom=unknownxyz");

  await act(async () => {
    r2.render(React.createElement(App));
  });

  assert.equal(h2.search, "", "Unknown fandom param must be cleanly rejected");
  await cl2();

  // 3. Direct ?category=All&fandom=valorant cleans hidden fandom
  const { root: r3, historyState: h3, cleanup: cl3 } =
    setupMountedDom("http://localhost:3000/?category=All&fandom=valorant");

  await act(async () => {
    r3.render(React.createElement(App));
  });

  assert.equal(
    h3.search,
    "",
    "Fandom under Category=All must be stripped to prevent hidden filter state"
  );
  await cl3();
});

test("Mounted Interaction: Category change clears incompatible fandom but preserves multi-fandom compatibility", async () => {
  const { container, root, cleanup } = setupMountedDom();

  let stateCat = "Gaming";
  let stateFan = "valorant";

  function CategorySwitchHarness() {
    const [cat, setCat] = useState("Gaming");
    const [fan, setFan] = useState("valorant");
    stateCat = cat;
    stateFan = fan;

    return React.createElement(CategoryBar, {
      category: cat,
      onSelectCategory: (newCat) => {
        setCat(newCat);
        if (!isFandomCompatibleWithCategory(fan, newCat)) {
          setFan("");
        }
      },
      fandomId: fan,
      onSelectFandom: (newFan) => {
        setFan(newFan === "all" ? "" : newFan);
      },
    });
  }

  await act(async () => {
    root.render(React.createElement(CategorySwitchHarness));
  });

  assert.equal(stateCat, "Gaming");
  assert.equal(stateFan, "valorant");

  // Incompatible switch: Gaming + Valorant -> Anime (Valorant not in Anime)
  const animeBtn = findButtonsByText(container, "Anime")[0];
  await act(async () => {
    animeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(stateCat, "Anime");
  assert.equal(stateFan, "", "Incompatible fandom must be cleared upon category switch");

  await cleanup();

  // Multi-fandom edit metadata: An edit with multiple fandomIds satisfies both filters
  const jjkResults = searchEdits(mockCatalog, "", "All", "jujutsu-kaisen");
  const dsResults = searchEdits(mockCatalog, "", "All", "demon-slayer");
  assert.ok(jjkResults.some((r) => r.edit.id === 3));
  assert.ok(dsResults.some((r) => r.edit.id === 3));
});

test("Mounted Interaction: Clicking tag triggers tag search filter without selecting video", async () => {
  const { container, root, cleanup } = setupMountedDom();

  let selectCount = 0;
  let clickedTag = "";

  const edit = {
    id: 1,
    title: "Viper Pit",
    category: "Gaming",
    tags: ["gaming", "neon"],
    description: "Clutch edit",
    creator: "Internal demo",
    poster: "/p1.webp",
    source: "/v.mp4",
    duration: "0:15",
    trending: false,
  };

  await act(async () => {
    root.render(
      React.createElement(VideoCard, {
        edit,
        onSelect: () => {
          selectCount++;
        },
        onTagClick: (tag) => {
          clickedTag = tag;
        },
      })
    );
  });

  // 1. Click tag chip
  const tagBtn = findButtonsByText(container, "#neon")[0];
  assert.ok(tagBtn, "Tag button must exist");

  await act(async () => {
    tagBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(clickedTag, "neon", "onTagClick must receive clicked tag");
  assert.equal(selectCount, 0, "Clicking a tag must NOT trigger onSelect (watch video)");

  // 2. Click main watch trigger
  const watchTrigger = findButtonsByText(container, "Viper Pit")[0];
  assert.ok(watchTrigger, "Watch trigger button must exist");

  await act(async () => {
    watchTrigger.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(selectCount, 1, "Clicking the watch trigger must call onSelect");

  // 3. Confirm NO nested interactive elements (<button> inside <button>)
  function checkNoNestedButtons(node, insideButton = false) {
    if (node.tagName === "BUTTON") {
      assert.equal(insideButton, false, "Cannot have a button nested inside another button");
      insideButton = true;
    }
    if (node.childNodes) {
      for (const child of node.childNodes) {
        checkNoNestedButtons(child, insideButton);
      }
    }
  }
  checkNoNestedButtons(container);

  await cleanup();
});

test("Mounted Interaction: Full browser history navigation Home → Explore → Gaming → Back / Forward", async () => {
  const { container, root, historyState, triggerPop, cleanup } =
    setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App));
  });

  assert.equal(historyState.search, "", "Initial search should be empty");
  assert.equal(findHeading1(container), "Into the Light", "Initial H1 should be featured edit");

  // 1. Click Explore in Sidebar
  const exploreBtn = findButtonsByText(container, "Explore")[0];
  assert.ok(exploreBtn, "Explore nav button must exist");

  await act(async () => {
    exploreBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.search, "?view=explore");
  assert.equal(findHeading1(container), "Explore edits");

  // 2. Click Gaming in CategoryBar
  const gamingBtn = findButtonsByText(container, "Gaming")[0];
  assert.ok(gamingBtn, "Gaming category button must exist");

  await act(async () => {
    gamingBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.search, "?view=explore&category=Gaming");
  assert.equal(findHeading1(container), "Gaming edits");

  // 3. Browser Back 1 -> Pops to Explore
  await act(async () => {
    triggerPop(-1);
  });

  assert.equal(historyState.search, "?view=explore");
  assert.equal(findHeading1(container), "Explore edits", "Back 1 must restore Explore edits");

  // 4. Browser Back 2 -> Pops to Home
  await act(async () => {
    triggerPop(-1);
  });

  assert.equal(historyState.search, "");
  assert.equal(findHeading1(container), "Into the Light", "Back 2 must restore Home featured edit");

  // 5. Browser Forward 1 -> Restores Explore
  await act(async () => {
    triggerPop(1);
  });

  assert.equal(historyState.search, "?view=explore");
  assert.equal(findHeading1(container), "Explore edits");

  // 6. Browser Forward 2 -> Restores Gaming
  await act(async () => {
    triggerPop(1);
  });

  assert.equal(historyState.search, "?view=explore&category=Gaming");
  assert.equal(findHeading1(container), "Gaming edits");

  await cleanup();
});

test("Mounted Interaction: Search typing updates query without browser history pollution", async () => {
  const { container, root, historyState, cleanup } =
    setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App));
  });

  const pushCountBefore = historyState.pushCount;

  // Find search input
  let searchInput = null;
  function findInput(n) {
    if (n.tagName === "INPUT" && n.getAttribute("aria-label") === "Search") searchInput = n;
    if (n.childNodes) for (const c of n.childNodes) findInput(c);
  }
  findInput(container);
  assert.ok(searchInput, "Search input must be present in Header");

  // Find React props key
  const propsKey = Object.keys(searchInput).find((k) => k.startsWith("__reactProps$"));
  assert.ok(propsKey, "React internal props must be accessible on search input");

  // Simulate multiple keystrokes in search input
  const keystrokes = ["v", "va", "val", "valo"];
  for (const val of keystrokes) {
    await act(async () => {
      if (searchInput[propsKey]?.onChange) {
        searchInput[propsKey].onChange({ target: { value: val } });
      } else {
        searchInput.dispatchEvent({
          type: "change",
          target: { value: val },
          bubbles: true,
        });
      }
    });
  }

  // 1. Confirm typing actually updates the search input's controlled value
  assert.equal(
    searchInput[propsKey]?.value,
    "valo",
    "Typing in search input must update the input's controlled value"
  );

  // 2. Confirm the URL query updates with replaceState (?q=valo)
  assert.equal(
    historyState.search,
    "?q=valo",
    "URL query parameter must update to reflect current search text"
  );

  // 3. Confirm displayed search results update
  assert.equal(
    findHeading1(container),
    "Search results for “valo”",
    "Search results heading must update to reflect active query"
  );

  // 4. Confirm keystrokes do NOT create additional history entries (replaceState used)
  assert.equal(
    historyState.pushCount,
    pushCountBefore,
    "Keystrokes in search bar must NOT push history entries (avoid history pollution)"
  );
  assert.ok(
    historyState.replaceCount >= keystrokes.length,
    "Each search keystroke must update history via replaceState"
  );

  await cleanup();
});

test("Creator Privacy: Secret creator marker is strictly absent from featured VideoPlayer and VideoCards", async () => {
  const { container: cPlayer, root: rPlayer, cleanup: clPlayer } = setupMountedDom();

  const secretCreator = "__SECRET_CREATOR_TEST_MARKER__";
  const privateEdit = {
    ...edits[0],
    creator: secretCreator,
  };

  // 1. Mount VideoPlayer
  await act(async () => {
    rPlayer.render(React.createElement(VideoPlayer, { edit: privateEdit }));
  });

  const playerText = collectAllText(cPlayer);
  assert.equal(
    playerText.includes(secretCreator),
    false,
    "Private creator marker must NEVER be rendered in VideoPlayer text"
  );

  // Assert .creator and .creator-avatar elements are not rendered
  let hasCreatorClass = false;
  let hasCreatorAvatarClass = false;
  function inspectClasses(node) {
    const cls = node.getAttribute ? node.getAttribute("class") || "" : "";
    if (cls.includes("creator-avatar")) hasCreatorAvatarClass = true;
    else if (/\bcreator\b/.test(cls)) hasCreatorClass = true;
    if (node.childNodes) {
      for (const child of node.childNodes) inspectClasses(child);
    }
  }
  inspectClasses(cPlayer);

  assert.equal(hasCreatorClass, false, ".creator element must not exist in VideoPlayer");
  assert.equal(hasCreatorAvatarClass, false, ".creator-avatar element must not exist in VideoPlayer");

  await clPlayer();

  // 2. Mount VideoCard
  const { container: cCard, root: rCard, cleanup: clCard } = setupMountedDom();

  await act(async () => {
    rCard.render(
      React.createElement(VideoCard, {
        edit: privateEdit,
        onSelect: () => {},
      })
    );
  });

  const cardText = collectAllText(cCard);
  assert.equal(
    cardText.includes(secretCreator),
    false,
    "Private creator marker must NEVER be rendered in VideoCard text"
  );

  await clCard();
});

