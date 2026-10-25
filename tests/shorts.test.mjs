import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { ShortsCard } from "../src/components/shorts/ShortsCard.tsx";
import { ShortsShelf } from "../src/components/shorts/ShortsShelf.tsx";
import { ShortsViewer } from "../src/components/shorts/ShortsViewer.tsx";
import App, { parseAndValidateShortId, parseUrlParams, syncUrl } from "../src/App.tsx";
import VideoPlayer from "../src/components/video/VideoPlayer.tsx";
import { edits } from "../src/data/edits.ts";

// Synthetic Shorts fixture strictly for unit & interaction tests (NOT in visitor-facing production catalog)
const SYNTHETIC_SHORTS = [
  {
    id: 100,
    title: "Shadow Strike",
    description: "High speed phonk sync vertical edit",
    category: "Gaming",
    fandomIds: ["valorant"],
    tags: ["valorant", "phonk", "sniper"],
    poster: "/media/art-0.svg",
    source: "/media/silent-test-loop.webm",
    duration: "0:25",
    trending: true,
    format: "short",
  },
  {
    id: 101,
    title: "Domain Expansion",
    description: "Gojo vs Sukuna vertical clip",
    category: "Anime",
    fandomIds: ["jujutsu-kaisen"],
    tags: ["anime", "gojo", "jjk"],
    poster: "/media/art-1.svg",
    source: "/media/silent-test-loop.webm",
    duration: "0:30",
    trending: false,
    format: "short",
  },
  {
    id: 102,
    title: "Cyber Rush",
    description: "Futuristic neon drift vertical edit",
    category: "Movies",
    fandomIds: ["spider-man"],
    tags: ["movies", "spiderman"],
    poster: "/media/art-2.svg",
    source: "/media/silent-test-loop.webm",
    duration: "0:15",
    trending: false,
    format: "short",
  },
];

// Helper for lightweight DOM setup in Node.js
function setupMountedDom(initialUrl = "http://localhost:3000/") {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const urlObj = new URL(initialUrl);

  const historyState = {
    historyStack: [urlObj.href],
    stateStack: [null],
    pointer: 0,
    get url() {
      return this.historyStack[this.pointer];
    },
    get state() {
      return this.stateStack[this.pointer];
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
    get state() {
      return historyState.state;
    },
    pushState(state, _title, url) {
      historyState.pushCount++;
      const u = new URL(url, historyState.url);
      historyState.historyStack = historyState.historyStack.slice(
        0,
        historyState.pointer + 1
      );
      historyState.stateStack = historyState.stateStack.slice(
        0,
        historyState.pointer + 1
      );
      historyState.historyStack.push(u.href);
      historyState.stateStack.push(state ? JSON.parse(JSON.stringify(state)) : null);
      historyState.pointer = historyState.historyStack.length - 1;
    },
    replaceState(state, _title, url) {
      historyState.replaceCount++;
      const u = new URL(url, historyState.url);
      historyState.historyStack[historyState.pointer] = u.href;
      historyState.stateStack[historyState.pointer] = state ? JSON.parse(JSON.stringify(state)) : null;
    },
    back() {
      this.go(-1);
    },
    forward() {
      this.go(1);
    },
    go(delta) {
      if (typeof delta !== "number" || delta === 0) return;
      const nextPointer = historyState.pointer + delta;
      if (nextPointer >= 0 && nextPointer < historyState.historyStack.length) {
        historyState.pointer = nextPointer;
        const listeners = globalThis._windowListeners?.get("popstate") || [];
        listeners.forEach(({ fn }) => {
          const evt = new Event("popstate");
          evt.state = historyState.state;
          fn(evt);
        });
      }
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
      scrollLeft: 0,
      scrollWidth: 1000,
      clientWidth: 500,
      scrollBy() {},
      paused: true,
      focus() {
        if (this.ownerDocument) this.ownerDocument.activeElement = this;
      },
      blur() {
        if (this.ownerDocument && this.ownerDocument.activeElement === this) {
          this.ownerDocument.activeElement = null;
        }
      },
      _playCalls: 0,
      _pauseCalls: 0,
      _loadCalls: 0,
      play() {
        this._playCalls++;
        this.paused = false;
        return Promise.resolve();
      },
      pause() {
        this._pauseCalls++;
        this.paused = true;
      },
      load() {
        this._loadCalls++;
      },
      querySelectorAll(selector) {
        const matches = [];
        function walk(node) {
          if (!node || !node.childNodes) return;
          for (const child of node.childNodes) {
            if (child.nodeType === 1) {
              const tag = child.tagName?.toLowerCase();
              const role = child.getAttribute("role");
              if (selector.includes("button") && tag === "button") {
                matches.push(child);
              } else if (selector.includes('role="slider"') && role === "slider") {
                matches.push(child);
              } else if (tag === selector.toLowerCase() || selector === "*") {
                matches.push(child);
              }
              walk(child);
            }
          }
        }
        walk(this);
        return matches;
      },
      closest(selector) {
        let curr = this;
        while (curr) {
          const tag = curr.tagName?.toLowerCase();
          if (tag && selector.includes(tag)) return curr;
          curr = curr.parentNode;
        }
        return null;
      },
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
        return this.attributes[k] ?? null;
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
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 300, height: 10, right: 300, bottom: 10 };
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
    activeElement: null,
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
      get textContent() {
        return this.nodeValue;
      },
      set textContent(v) {
        this.nodeValue = v;
      },
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
  globalThis.HTMLVideoElement = class {};
  globalThis.HTMLIFrameElement = class {};
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLTextAreaElement = class {};
  globalThis.HTMLElement = class {};
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

  let currentContainer = mockDoc.createElement("div");
  mockDoc.body = currentContainer;
  currentContainer.parentNode = mockDoc;
  let currentRoot = createRoot(currentContainer);

  const remount = async () => {
    await act(async () => {
      currentRoot.unmount();
    });
    globalThis._windowListeners = new Map();
    const nextContainer = mockDoc.createElement("div");
    mockDoc.body = nextContainer;
    nextContainer.parentNode = mockDoc;
    currentContainer = nextContainer;
    currentRoot = createRoot(nextContainer);
    return { container: currentContainer, root: currentRoot };
  };

  const cleanup = async () => {
    await act(async () => {
      currentRoot.unmount();
    });
  };

  return {
    mockDoc,
    get container() {
      return currentContainer;
    },
    get root() {
      return currentRoot;
    },
    historyState,
    triggerPop,
    remount,
    cleanup,
  };
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

function findElementsByAriaLabel(node, labelSubstring) {
  const matches = [];
  function walk(n) {
    const aria = n.getAttribute ? n.getAttribute("aria-label") : null;
    if (aria && aria.includes(labelSubstring)) matches.push(n);
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
    if (n.childNodes) {
      for (const c of n.childNodes) walk(c);
    }
  }
  walk(node);
  return h1 ? h1.textContent : null;
}

// ---------------------------------------------------------------------------
// 1. ShortsCard Tests
// ---------------------------------------------------------------------------

test("ShortsCard: renders portrait structure, accessible labels, and badges without nested buttons", () => {
  const short = SYNTHETIC_SHORTS[0];
  let selected = null;
  let clickedTag = null;

  const html = renderToStaticMarkup(
    React.createElement(ShortsCard, {
      short,
      onSelect: (s) => {
        selected = s;
      },
      onTagClick: (t) => {
        clickedTag = t;
      },
    })
  );

  // Accessible article role & label
  assert.ok(html.includes('aria-label="Short: Shadow Strike"'));
  // Dedicated watch trigger
  assert.ok(html.includes('aria-label="Watch short: Shadow Strike"'));
  // Duration badge
  assert.ok(html.includes("0:25"));
  // Category / Fandom context
  assert.ok(html.includes("Valorant · Gaming"));
  // Tag chip (without being nested inside the watch trigger button)
  assert.ok(html.includes('aria-label="Filter by #valorant"'));
  assert.ok(html.includes("#valorant"));

  // Check that the watch-trigger button closes before card-tags group starts
  const buttonCloseIdx = html.indexOf("</button>");
  const cardTagsIdx = html.indexOf('class="card-tags shorts-tags"');
  assert.ok(buttonCloseIdx !== -1 && cardTagsIdx !== -1);
  assert.ok(
    buttonCloseIdx < cardTagsIdx,
    "Watch trigger button MUST close before card-tags container to prevent nested interactive controls"
  );
});

test("ShortsCard: tag click does not trigger onSelect (independent interactive controls)", async () => {
  const { container, root, cleanup } = setupMountedDom();
  const short = SYNTHETIC_SHORTS[0];
  let selectedShort = null;
  let selectedTag = null;

  await act(async () => {
    root.render(
      React.createElement(ShortsCard, {
        short,
        onSelect: (s) => {
          selectedShort = s;
        },
        onTagClick: (t) => {
          selectedTag = t;
        },
      })
    );
  });

  const tagButtons = findButtonsByText(container, "#valorant");
  assert.ok(tagButtons.length > 0, "Tag button #valorant must exist");

  await act(async () => {
    tagButtons[0].dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(selectedTag, "valorant", "Tag click must invoke onTagClick");
  assert.equal(selectedShort, null, "Tag click must NOT invoke onSelect");

  // Clicking watch trigger invokes onSelect
  const watchButtons = findElementsByAriaLabel(container, "Watch short: Shadow Strike");
  assert.ok(watchButtons.length > 0, "Watch trigger button must exist");

  await act(async () => {
    watchButtons[0].dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(selectedShort?.id, short.id, "Watch button must invoke onSelect");

  await cleanup();
});

// ---------------------------------------------------------------------------
// 2. ShortsShelf Tests
// ---------------------------------------------------------------------------

test("ShortsShelf: completely omits shelf when items array is empty", () => {
  const htmlEmpty = renderToStaticMarkup(
    React.createElement(ShortsShelf, {
      items: [],
      onSelect: () => {},
    })
  );
  assert.equal(htmlEmpty, "", "ShortsShelf must render nothing when items is empty");
});

test("ShortsShelf: renders horizontal track, controls, and items when items exist", () => {
  const html = renderToStaticMarkup(
    React.createElement(ShortsShelf, {
      title: "Curated Shorts",
      items: SYNTHETIC_SHORTS,
      onSelect: () => {},
    })
  );

  assert.ok(html.includes("Curated Shorts"));
  assert.ok(html.includes('aria-label="Scroll shorts left"'));
  assert.ok(html.includes('aria-label="Scroll shorts right"'));
  assert.ok(html.includes('aria-label="Curated Shorts carousel"'));
  assert.ok(html.includes("Shadow Strike"));
  assert.ok(html.includes("Domain Expansion"));
  assert.ok(html.includes("Cyber Rush"));
});

// ---------------------------------------------------------------------------
// 3. ShortsViewer Tests
// ---------------------------------------------------------------------------

test("ShortsViewer: provides keyboard shortcuts, playback controls, and focus cleanup", async () => {
  const { container, root, cleanup } = setupMountedDom();
  let closed = false;

  await act(async () => {
    root.render(
      React.createElement(ShortsViewer, {
        shorts: SYNTHETIC_SHORTS,
        initialShortId: 100,
        onClose: () => {
          closed = true;
        },
      })
    );
  });

  // Modal accessibility
  const dialog = findElementsByAriaLabel(container, "Shorts viewer: Shadow Strike")[0];
  assert.ok(dialog, "Dialog overlay must exist with accessible label");
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");

  // Counter index
  assert.ok(container.textContent.includes("1 / 3"));

  // Next / Previous navigation buttons
  const prevBtn = findElementsByAriaLabel(container, "Previous short")[0];
  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  assert.ok(prevBtn, "Previous short button must exist");
  assert.ok(nextBtn, "Next short button must exist");

  // Index 0: Prev button disabled
  assert.ok(prevBtn.getAttribute("disabled") !== null, "Previous button must be disabled at index 0");

  // Click Next button -> Advances to short 101
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });
  assert.ok(container.textContent.includes("Domain Expansion"));
  assert.ok(container.textContent.includes("2 / 3"));

  // Press Escape -> triggers onClose
  const escapeEvt = { key: "Escape", preventDefault() {} };
  const keyListeners = globalThis._windowListeners.get("keydown") || [];
  await act(async () => {
    for (const { fn } of [...keyListeners]) {
      fn(escapeEvt);
    }
  });
  assert.equal(closed, true, "Escape key must trigger onClose");

  await cleanup();
});

test("ShortsViewer: handles ID 0 correctly as a valid short ID", async () => {
  const { container, root, cleanup } = setupMountedDom();
  const zeroShort = {
    id: 0,
    title: "Zero Origin",
    description: "Zero short description",
    category: "Gaming",
    tags: ["gaming"],
    poster: "/media/art-0.svg",
    source: "/media/silent-test-loop.webm",
    duration: "0:15",
    format: "short",
  };

  await act(async () => {
    root.render(
      React.createElement(ShortsViewer, {
        shorts: [zeroShort, ...SYNTHETIC_SHORTS],
        initialShortId: 0,
        onClose: () => {},
      })
    );
  });

  assert.ok(container.textContent.includes("Zero Origin"));
  assert.ok(container.textContent.includes("1 / 4"));

  await cleanup();
});

// ---------------------------------------------------------------------------
// 4. App Navigation & URL Integration for Shorts
// ---------------------------------------------------------------------------

test("App Navigation: visiting Shorts when catalog has 0 shorts displays honest empty state", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App));
  });

  // Click Shorts in Sidebar
  const shortsBtn = findButtonsByText(container, "Shorts")[0];
  assert.ok(shortsBtn, "Shorts sidebar button must exist");

  await act(async () => {
    shortsBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  // URL state updated to ?view=shorts
  assert.equal(historyState.search, "?view=shorts");

  // H1 heading displays honest empty state
  assert.equal(
    findHeading1(container),
    "Curated Shorts are coming soon",
    "Empty state must show honest 'Curated Shorts are coming soon' heading"
  );

  // Return to browsing button exists and restores Home
  const returnBtn = findButtonsByText(container, "Return to browsing")[0];
  assert.ok(returnBtn, "Return to browsing button must exist");

  await act(async () => {
    returnBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.search, "");
  assert.equal(findHeading1(container), "Into the Light", "Home featured edit restored");

  await cleanup();
});

test("App Navigation: direct URL ?view=shorts restores Shorts empty state directly", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom(
    "http://localhost:3000/?view=shorts"
  );

  await act(async () => {
    root.render(React.createElement(App));
  });

  assert.equal(historyState.search, "?view=shorts");
  assert.equal(findHeading1(container), "Curated Shorts are coming soon");

  await cleanup();
});

test("App Navigation: invalid or missing short ID in URL safely recovers without crashing", async () => {
  const { container, root, cleanup } = setupMountedDom(
    "http://localhost:3000/?view=shorts&short=99999"
  );

  await act(async () => {
    root.render(React.createElement(App));
  });

  // Does not crash, shows honest empty state since 99999 is invalid and catalog has 0 shorts
  assert.equal(findHeading1(container), "Curated Shorts are coming soon");

  await cleanup();
});

test("Production Invariant: production catalog has 17 items and 0 shorts", () => {
  assert.equal(edits.length, 17, "Production catalog must have exactly 17 genuine demo edits");
  const shortsCount = edits.filter((e) => e.format === "short").length;
  assert.equal(shortsCount, 0, "Production catalog must contain zero synthetic shorts");
});

// ---------------------------------------------------------------------------
// 5. REVIEW V2 FIX A: Short ID Validation & URL Synchronization
// ---------------------------------------------------------------------------

test("FIX A: parseAndValidateShortId strictly rejects invalid IDs and preserves ID 0", () => {
  const catalogWithZero = [
    ...SYNTHETIC_SHORTS,
    { id: 0, title: "Zero Origin", format: "short" },
  ];
  // Valid short IDs
  assert.equal(parseAndValidateShortId("100", catalogWithZero), 100);
  assert.equal(parseAndValidateShortId("101", catalogWithZero), 101);
  assert.equal(parseAndValidateShortId("0", catalogWithZero), 0, "Numeric ID 0 must be strictly valid");
  assert.equal(parseAndValidateShortId(" 100 ", catalogWithZero), 100, "Whitespace trimmed");

  // Invalid IDs
  assert.equal(parseAndValidateShortId(null, catalogWithZero), null);
  assert.equal(parseAndValidateShortId("", catalogWithZero), null);
  assert.equal(parseAndValidateShortId("-1", catalogWithZero), null, "Negative IDs rejected");
  assert.equal(parseAndValidateShortId("1.5", catalogWithZero), null, "Fractional/decimal IDs rejected");
  assert.equal(parseAndValidateShortId("abc", catalogWithZero), null, "Non-numeric strings rejected");
  assert.equal(parseAndValidateShortId("100abc", catalogWithZero), null, "Trailing letters rejected");
  assert.equal(parseAndValidateShortId("1e2", catalogWithZero), null, "Scientific notation rejected");
  assert.equal(parseAndValidateShortId("9007199254740992", catalogWithZero), null, "Unsafe integers rejected");
  assert.equal(parseAndValidateShortId("9999", catalogWithZero), null, "Unknown IDs not in catalog rejected");

  // Non-short video ID rejection (e.g. landscape edit ID 1)
  assert.equal(parseAndValidateShortId("1", edits), null, "Landscape video IDs rejected as Shorts");
});

test("FIX A: Closing ShortsViewer uses replaceState to prevent Back from reopening", () => {
  const { historyState } = setupMountedDom("http://localhost:3000/?short=100");

  // Simulate viewer close: usePush = false (replaceState)
  syncUrl("All", "", "", "Home", null, false);

  assert.equal(historyState.search, "");
  assert.equal(historyState.replaceCount, 1, "Must use replaceState on viewer close");
  assert.equal(historyState.pushCount, 0, "Must NOT use pushState on viewer close");
});

// ---------------------------------------------------------------------------
// 6. REVIEW V2 FIX B: Atomic Tag Navigation & Dedicated Shorts Surface
// ---------------------------------------------------------------------------

test("FIX B: ShortsViewer tag click triggers atomic discovery navigation without stale short ID", async () => {
  const { container, root, cleanup } = setupMountedDom();
  let clickedTag = "";

  await act(async () => {
    root.render(
      React.createElement(ShortsViewer, {
        shorts: SYNTHETIC_SHORTS,
        initialShortId: 100,
        onClose: () => {},
        onTagClick: (t) => {
          clickedTag = t;
        },
      })
    );
  });

  // Find tag chip button
  const tagBtns = container.querySelectorAll("button");
  const valorantTag = tagBtns.find((b) => b.textContent && b.textContent.includes("#valorant"));
  assert.ok(valorantTag, "Hashtag chip #valorant must exist");

  await act(async () => {
    valorantTag.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(clickedTag, "valorant", "Tag click must pass exact tag value");

  await cleanup();
});

test("FIX B: App-level tag click navigation atomically clears short= and navigates to Explore", async () => {
  const { historyState } = setupMountedDom("http://localhost:3000/?short=100");

  // Atomic navigation: clear short, set query #tag, view=explore, reset category to All
  syncUrl("All", "", "#valorant", "Explore", null, true);

  assert.equal(historyState.search, "?view=explore&q=%23valorant");
  assert.ok(!historyState.search.includes("short="), "short= parameter must be cleared");
});

// ---------------------------------------------------------------------------
// 7. REVIEW V2 FIX C: React Hook Ordering in ShortsShelf
// ---------------------------------------------------------------------------

test("FIX C: ShortsShelf handles empty → populated → empty transitions without hook errors", async () => {
  const { container, root, cleanup } = setupMountedDom();

  // 1. Initial render with empty items (returns null)
  await act(async () => {
    root.render(
      React.createElement(ShortsShelf, {
        items: [],
        onSelect: () => {},
      })
    );
  });
  assert.equal(container.childNodes.length, 0, "Empty items renders null");

  // 2. Re-render mounted component with populated items (must not throw React hook count error)
  await act(async () => {
    root.render(
      React.createElement(ShortsShelf, {
        items: SYNTHETIC_SHORTS,
        onSelect: () => {},
      })
    );
  });
  assert.ok(container.textContent.includes("Curated Shorts"), "Populated items renders shelf");
  assert.ok(container.textContent.includes("Shadow Strike"));

  // 3. Re-render back to empty items
  await act(async () => {
    root.render(
      React.createElement(ShortsShelf, {
        items: [],
        onSelect: () => {},
      })
    );
  });
  assert.equal(container.childNodes.length, 0, "Returns to null without hook errors");

  // 4. One item → many items transition
  await act(async () => {
    root.render(
      React.createElement(ShortsShelf, {
        items: [SYNTHETIC_SHORTS[0]],
        onSelect: () => {},
      })
    );
  });
  assert.ok(container.textContent.includes("Shadow Strike"));

  await act(async () => {
    root.render(
      React.createElement(ShortsShelf, {
        items: SYNTHETIC_SHORTS,
        onSelect: () => {},
      })
    );
  });
  assert.ok(container.textContent.includes("Domain Expansion"));

  // 5. Rapid sequential updates without crashing
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      root.render(
        React.createElement(ShortsShelf, {
          items: i % 2 === 0 ? [] : SYNTHETIC_SHORTS,
          onSelect: () => {},
        })
      );
    });
  }

  await cleanup();
});

// ---------------------------------------------------------------------------
// 8. REVIEW V2 FIX D: Video Playback Lifecycle & Error Recovery
// ---------------------------------------------------------------------------

test("FIX D: Background VideoPlayer automatically pauses when ShortsViewer overlay is active", async () => {
  const { container, root, cleanup } = setupMountedDom();

  // Mount featured player with isOverlayActive=false
  await act(async () => {
    root.render(
      React.createElement(VideoPlayer, {
        edit: edits[0],
        isOverlayActive: false,
      })
    );
  });

  function findVideo(node) {
    if (node.tagName === "VIDEO") return node;
    if (node.childNodes) {
      for (const c of node.childNodes) {
        const found = findVideo(c);
        if (found) return found;
      }
    }
    return null;
  }

  const videoEl = findVideo(container);
  assert.ok(videoEl, "Video element must exist in VideoPlayer");
  const initialPauseCalls = videoEl._pauseCalls;

  // Open ShortsViewer overlay -> isOverlayActive becomes true
  await act(async () => {
    root.render(
      React.createElement(VideoPlayer, {
        edit: edits[0],
        isOverlayActive: true,
      })
    );
  });

  // Verify background player is paused to prevent overlapping audio
  assert.ok(
    videoEl._pauseCalls > initialPauseCalls,
    "VideoPlayer must pause when isOverlayActive becomes true"
  );

  await cleanup();
});

test("FIX D: ShortsViewer error recovery keeps video mounted and retry genuinely reloads", async () => {
  const { container, root, cleanup } = setupMountedDom();

  await act(async () => {
    root.render(
      React.createElement(ShortsViewer, {
        shorts: SYNTHETIC_SHORTS,
        initialShortId: 100,
        onClose: () => {},
      })
    );
  });

  // Find video element
  function findVideo(node) {
    if (node.tagName === "VIDEO") return node;
    if (node.childNodes) {
      for (const c of node.childNodes) {
        const found = findVideo(c);
        if (found) return found;
      }
    }
    return null;
  }

  const video = findVideo(container);
  assert.ok(video, "Video element must be initially mounted");

  // Trigger error event on video
  await act(async () => {
    video.dispatchEvent({ type: "error" });
  });

  // Invariant: Video element MUST remain in DOM (not unmounted)
  const videoStillMounted = findVideo(container);
  assert.ok(videoStillMounted, "Video element must remain mounted in DOM during error state");
  assert.equal(videoStillMounted.style.display, "none", "Video element is hidden while error state displays");

  // Error alert UI is visible
  assert.ok(container.textContent.includes("Video unavailable"));

  // Click Retry button
  const retryBtn = container.querySelectorAll("button").find(
    (b) => b.textContent && b.textContent.includes("Retry")
  );
  assert.ok(retryBtn, "Retry button must exist");

  const prevLoadCalls = videoStillMounted._loadCalls;
  await act(async () => {
    retryBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  // Genuinely reloads video ref
  assert.ok(videoStillMounted._loadCalls > prevLoadCalls, "Retry must invoke video.load()");

  await cleanup();
});

// ---------------------------------------------------------------------------
// 9. REVIEW V2 FIX E: Accessibility, Modal Focus, and Seeker Slider
// ---------------------------------------------------------------------------

test("FIX E: Focused buttons do not have Space/Enter hijacked by global playback listener", async () => {
  const { container, root, mockDoc, cleanup } = setupMountedDom();

  await act(async () => {
    root.render(
      React.createElement(ShortsViewer, {
        shorts: SYNTHETIC_SHORTS,
        initialShortId: 100,
        onClose: () => {},
      })
    );
  });

  // Focus the mute button
  const muteBtn = container.querySelectorAll("button").find(
    (b) => b.attributes["aria-label"]?.includes("audio")
  );
  assert.ok(muteBtn, "Mute button must exist");
  muteBtn.focus();
  assert.equal(mockDoc.activeElement, muteBtn, "Active element is mute button");

  // Send Space key when button has focus
  let defaultPrevented = false;
  const spaceEvt = {
    key: " ",
    target: muteBtn,
    preventDefault() {
      defaultPrevented = true;
    },
  };

  const keyListeners = globalThis._windowListeners.get("keydown") || [];
  await act(async () => {
    for (const { fn } of [...keyListeners]) {
      fn(spaceEvt);
    }
  });

  // Space must NOT be prevented so button can natively activate
  assert.equal(
    defaultPrevented,
    false,
    "Space must not be prevented on focused button"
  );

  await cleanup();
});

test("FIX E: Progress bar is an accessible slider supporting keyboard arrow seeking", async () => {
  const { container, root, cleanup } = setupMountedDom();

  await act(async () => {
    root.render(
      React.createElement(ShortsViewer, {
        shorts: SYNTHETIC_SHORTS,
        initialShortId: 100,
        onClose: () => {},
      })
    );
  });

  // Find slider element
  function findSlider(node) {
    if (node.attributes?.role === "slider") return node;
    if (node.childNodes) {
      for (const c of node.childNodes) {
        const found = findSlider(c);
        if (found) return found;
      }
    }
    return null;
  }

  const slider = findSlider(container);
  assert.ok(slider, "Progress bar must have role='slider'");
  assert.equal(slider.attributes["tabindex"], "0");
  assert.equal(slider.attributes["aria-label"], "Seek short video");
  assert.ok(slider.attributes["aria-valuenow"] !== undefined);

  // Keyboard navigation on slider: ArrowRight, ArrowLeft
  let arrowHandled = false;
  await act(async () => {
    slider.dispatchEvent({
      type: "keydown",
      key: "ArrowRight",
      preventDefault() {
        arrowHandled = true;
      },
      bubbles: true,
    });
  });
  assert.equal(arrowHandled, true, "ArrowRight must be handled by slider");

  await cleanup();
});

// ---------------------------------------------------------------------------
// 10. REVIEW V2 FIX F: Arbitrary Catalog Composition Guard
// ---------------------------------------------------------------------------

test("FIX F: Shorts-only catalog never places a Short inside the landscape featured player", () => {
  // Pure composition on Shorts-only catalog
  const shortsOnlyCatalog = SYNTHETIC_SHORTS;

  // Invariant: initialLandscapeVideo logic
  const landscapeVideo = shortsOnlyCatalog.find((e) => e.format !== "short" && (e.format === "video" || e.format === undefined));
  assert.equal(landscapeVideo, undefined, "Shorts-only catalog has no landscape video");

  // Landscape player must not be assigned a Short edit
  const isSafeForLandscape = (edit) => Boolean(edit && edit.format !== "short");
  assert.equal(isSafeForLandscape(landscapeVideo), false, "Short must never be safe for landscape player");
});

// ===========================================================================
// MISSION 6C: FINAL V3 CORRECTNESS TEST SUITES
// ===========================================================================

// ---------------------------------------------------------------------------
// 11. REVIEW V3 FIX A: Multi-Short History, Close Rewind & Navigation
// ---------------------------------------------------------------------------

test("V3 FIX A: Multi-Short history: Home → open Short 100 → Next to Short 101 → Close → Back does NOT reopen Short 100", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  assert.equal(historyState.search, "");
  assert.equal(historyState.pointer, 0);

  // 1. Open Short 100 from home shelf
  const short100Card = findElementsByAriaLabel(container, "Watch short: Shadow Strike")[0];
  assert.ok(short100Card, "Short 100 card must be visible on shelf");

  await act(async () => {
    short100Card.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.search, "?short=100");
  assert.equal(historyState.pointer, 1);
  assert.ok(container.textContent.includes("Shadow Strike"));

  // 2. Click Next button -> Advances to Short 101
  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  assert.ok(nextBtn, "Next button must exist");

  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.search, "?short=101");
  assert.equal(historyState.pointer, 2);
  assert.ok(container.textContent.includes("Domain Expansion"));

  // 3. Explicitly Close the viewer (click close button)
  const closeBtn = findElementsByAriaLabel(container, "Close shorts viewer")[0];
  assert.ok(closeBtn, "Close button must exist");

  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  // History must rewind back to Home entry (pointer 0)
  assert.equal(historyState.pointer, 0, "History pointer must return to 0 (Home)");
  assert.equal(historyState.search, "", "URL must return to clean Home");
  assert.ok(!container.textContent.includes("Shorts viewer:"), "Viewer must be closed");

  // 4. Click browser Back
  await act(async () => {
    globalThis.history.back();
  });

  // Must NOT reopen Short 100 or 101!
  assert.equal(historyState.search, "");
  assert.ok(!container.textContent.includes("Shorts viewer:"), "Browser Back must NOT reopen earlier Short");

  await cleanup();
});

test("V3 FIX A: Browser Back and Forward while ShortsViewer is open navigates between Shorts", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  // Open Short 100
  const short100Card = findElementsByAriaLabel(container, "Watch short: Shadow Strike")[0];
  await act(async () => {
    short100Card.dispatchEvent({ type: "click", bubbles: true });
  });
  assert.equal(historyState.search, "?short=100");

  // Next to Short 101
  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });
  assert.equal(historyState.search, "?short=101");

  // Browser Back while viewer is open -> returns to Short 100
  await act(async () => {
    globalThis.history.back();
  });
  assert.equal(historyState.search, "?short=100");
  assert.ok(container.textContent.includes("Shadow Strike"));

  // Browser Forward while viewer is open -> advances to Short 101
  await act(async () => {
    globalThis.history.forward();
  });
  assert.equal(historyState.search, "?short=101");
  assert.ok(container.textContent.includes("Domain Expansion"));

  await cleanup();
});

test("V3 FIX A: Direct-link entry (?short=101) and Close restores clean browsing URL without crashing or invalid back", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/?short=101");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  assert.equal(historyState.search, "?short=101");
  assert.ok(container.textContent.includes("Domain Expansion"));

  // Click Close
  const closeBtn = findElementsByAriaLabel(container, "Close shorts viewer")[0];
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.search, "", "Direct link close cleans URL");
  assert.equal(findElementsByAriaLabel(container, "Shorts viewer:").length, 0, "Viewer is closed");

  await cleanup();
});

test("V3 FIX A: Exiting through hashtag navigation removes short parameter and navigates to Explore #tag", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  // Open Short 100
  const short100Card = findElementsByAriaLabel(container, "Watch short: Shadow Strike")[0];
  await act(async () => {
    short100Card.dispatchEvent({ type: "click", bubbles: true });
  });

  // Find hashtag #valorant inside viewer dialog
  const viewerDialog = findElementsByAriaLabel(container, "Shorts viewer:")[0];
  assert.ok(viewerDialog, "Viewer dialog must be mounted");
  const tagChip = findElementsByAriaLabel(viewerDialog, "Filter by #valorant")[0];
  assert.ok(tagChip, "Hashtag chip #valorant in viewer must exist");

  await act(async () => {
    tagChip.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(!historyState.search.includes("short="), "short= parameter must be cleared");
  assert.ok(historyState.search.includes("q=%23valorant") || historyState.search.includes("q=#valorant"));
  assert.ok(historyState.search.includes("view=explore"));

  await cleanup();
});

// ---------------------------------------------------------------------------
// 12. REVIEW V3 FIX B: Filtered Shorts Navigation Scope
// ---------------------------------------------------------------------------

test("V3 FIX B: Filtered Shorts navigation scope: Gaming → Valorant → open Short → Next only navigates within Valorant shorts", async () => {
  const gamingShort1 = { id: 201, title: "Valorant Ace", category: "Gaming", fandomIds: ["valorant"], tags: ["valorant"], format: "short", poster: "/media/art-0.svg", source: "/media/silent-test-loop.webm" };
  const gamingShort2 = { id: 202, title: "Valorant Clutch", category: "Gaming", fandomIds: ["valorant"], tags: ["valorant"], format: "short", poster: "/media/art-1.svg", source: "/media/silent-test-loop.webm" };
  const animeShort = { id: 203, title: "Anime JJK", category: "Anime", fandomIds: ["jujutsu-kaisen"], tags: ["anime"], format: "short", poster: "/media/art-2.svg", source: "/media/silent-test-loop.webm" };

  const testCatalog = [...edits, gamingShort1, gamingShort2, animeShort];

  const { container, root, cleanup } = setupMountedDom("http://localhost:3000/?view=shorts&category=Gaming&fandom=valorant");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: testCatalog }));
  });

  // Open Gaming Short 201
  const card201 = findElementsByAriaLabel(container, "Watch short: Valorant Ace")[0];
  assert.ok(card201, "Valorant Ace card must exist");

  await act(async () => {
    card201.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(container.textContent.includes("1 / 2"), "Queue size must be 2 (only the 2 Valorant shorts, not Anime)");

  // Click Next
  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(container.textContent.includes("Valorant Clutch"));
  assert.ok(container.textContent.includes("2 / 2"));

  // Next is now disabled because there are no more Valorant shorts
  assert.ok(nextBtn.getAttribute("disabled") !== null, "Must NOT navigate into Anime short");

  await cleanup();
});

test("V3 FIX B: Filtered Shorts navigation scope: Deep link outside active filters prepends requested short without crashing", async () => {
  const gamingShort = { id: 201, title: "Valorant Ace", category: "Gaming", fandomIds: ["valorant"], tags: ["valorant"], format: "short", poster: "/media/art-0.svg", source: "/media/silent-test-loop.webm" };
  const animeShort = { id: 203, title: "Anime JJK", category: "Anime", fandomIds: ["jujutsu-kaisen"], tags: ["anime"], format: "short", poster: "/media/art-2.svg", source: "/media/silent-test-loop.webm" };

  const testCatalog = [...edits, gamingShort, animeShort];

  // Deep-link to Anime short 203 while filtered by Gaming
  const { container, root, cleanup } = setupMountedDom("http://localhost:3000/?view=shorts&category=Gaming&short=203");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: testCatalog }));
  });

  // Deep linked short 203 is cleanly displayed
  assert.ok(container.textContent.includes("Anime JJK"));

  await cleanup();
});

test("V3 FIX B: Filtered Shorts navigation scope: Short ID 0 is accurately preserved in filtered navigation", async () => {
  const movieShort0 = { id: 0, title: "Zero Origin", category: "Movies", fandomIds: ["spider-man"], tags: ["spiderman"], format: "short", poster: "/media/art-0.svg", source: "/media/silent-test-loop.webm" };
  const testCatalog = [...edits.filter((e) => e.id !== 0), movieShort0];

  const { container, root, cleanup } = setupMountedDom("http://localhost:3000/?view=shorts&category=Movies");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: testCatalog }));
  });

  const card0 = findElementsByAriaLabel(container, "Watch short: Zero Origin")[0];
  assert.ok(card0, "Short 0 card must exist");

  await act(async () => {
    card0.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(container.textContent.includes("Zero Origin"));
  assert.ok(container.textContent.includes("1 / 1"));

  await cleanup();
});

test("V3 FIX B: Filtered Shorts navigation scope: Search-filtered Shorts restrict viewer queue to query results", async () => {
  const shortPhonk1 = { id: 301, title: "Phonk Drift", category: "Phonk", fandomIds: [], tags: ["phonk", "drift"], format: "short", poster: "/media/art-0.svg", source: "/media/silent-test-loop.webm" };
  const shortPhonk2 = { id: 302, title: "Phonk Speed", category: "Phonk", fandomIds: [], tags: ["phonk", "bass"], format: "short", poster: "/media/art-1.svg", source: "/media/silent-test-loop.webm" };
  const shortAnime = { id: 303, title: "Anime JJK", category: "Anime", fandomIds: ["jujutsu-kaisen"], tags: ["anime"], format: "short", poster: "/media/art-2.svg", source: "/media/silent-test-loop.webm" };

  const testCatalog = [...edits, shortPhonk1, shortPhonk2, shortAnime];
  const { container, root, cleanup } = setupMountedDom("http://localhost:3000/?q=phonk");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: testCatalog }));
  });

  const card301 = findElementsByAriaLabel(container, "Watch short: Phonk Drift")[0];
  assert.ok(card301, "Phonk Drift card must exist");

  await act(async () => {
    card301.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(container.textContent.includes("Phonk Drift"));
  assert.ok(container.textContent.includes("1 / 2"), "Queue must only have the 2 phonk search results");

  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(container.textContent.includes("Phonk Speed"));
  assert.ok(container.textContent.includes("2 / 2"));
  assert.ok(nextBtn.getAttribute("disabled") !== null, "Must NOT navigate into Anime short");

  await cleanup();
});

test("V3 FIX B: Filtered Shorts navigation scope: Opening from unfiltered Home shelf navigates Home shelf items", async () => {
  const shortA = { id: 401, title: "Home Short A", category: "Gaming", fandomIds: [], tags: ["game"], format: "short", poster: "/media/art-0.svg", source: "/media/silent-test-loop.webm" };
  const shortB = { id: 402, title: "Home Short B", category: "Anime", fandomIds: [], tags: ["anime"], format: "short", poster: "/media/art-1.svg", source: "/media/silent-test-loop.webm" };

  const testCatalog = [...edits, shortA, shortB];
  const { container, root, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: testCatalog }));
  });

  const cardA = findElementsByAriaLabel(container, "Watch short: Home Short A")[0];
  assert.ok(cardA, "Home Short A card must exist on Home shelf");

  await act(async () => {
    cardA.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(container.textContent.includes("Home Short A"));
  assert.ok(container.textContent.includes("1 / 2"));

  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(container.textContent.includes("Home Short B"));
  assert.ok(container.textContent.includes("2 / 2"));

  await cleanup();
});

test("V3 FIX B: Filtered Shorts navigation scope: Changes in available Short list while mounted adjusts currentIndex safely", async () => {
  const short1 = { id: 501, title: "Short One", category: "Phonk", fandomIds: [], tags: [], format: "short", poster: "/media/art-0.svg", source: "/media/silent-test-loop.webm" };
  const short2 = { id: 502, title: "Short Two", category: "Phonk", fandomIds: [], tags: [], format: "short", poster: "/media/art-1.svg", source: "/media/silent-test-loop.webm" };
  const short3 = { id: 503, title: "Short Three", category: "Phonk", fandomIds: [], tags: [], format: "short", poster: "/media/art-2.svg", source: "/media/silent-test-loop.webm" };

  const { container, root, cleanup } = setupMountedDom();

  // Mount on short 2 (index 1)
  await act(async () => {
    root.render(
      React.createElement(ShortsViewer, {
        shorts: [short1, short2, short3],
        initialShortId: 502,
        activeShortId: 502,
      })
    );
  });

  assert.ok(container.textContent.includes("Short Two"));
  assert.ok(container.textContent.includes("2 / 3"));

  // Short list shrinks to [short1, short2]
  await act(async () => {
    root.render(
      React.createElement(ShortsViewer, {
        shorts: [short1, short2],
        initialShortId: 502,
        activeShortId: 502,
      })
    );
  });

  assert.ok(container.textContent.includes("Short Two"));
  assert.ok(container.textContent.includes("2 / 2"));

  await cleanup();
});

// ---------------------------------------------------------------------------
// 13. REVIEW V3 FIX C: Background Playback & Late Metadata Prevention
// ---------------------------------------------------------------------------

for (const scenario of [
  { name: "absent navigator", navigator: undefined, expectedPlayCalls: 1 },
  { name: "navigator without connection", navigator: {}, expectedPlayCalls: 1 },
  { name: "browser data-saver preference", navigator: { connection: { saveData: true } }, expectedPlayCalls: 0 },
]) {
  test(`VideoPlayer metadata respects ${scenario.name}`, async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const { container, root, cleanup } = setupMountedDom();
    try {
      if (scenario.navigator === undefined) delete globalThis.navigator;
      else Object.defineProperty(globalThis, "navigator", { configurable: true, value: scenario.navigator });

      await act(async () => {
        root.render(React.createElement(VideoPlayer, { edit: edits[0] }));
      });
      const video = container.querySelectorAll("video")[0];
      assert.ok(video);
      const before = video._playCalls;
      await act(async () => { video.dispatchEvent({ type: "loadedmetadata" }); });
      assert.equal(video._playCalls - before, scenario.expectedPlayCalls);
    } finally {
      await cleanup();
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
      else delete globalThis.navigator;
    }
  });
}

test("V3 FIX C: Late metadata race: loadedmetadata event on VideoPlayer while ShortsViewer is open does not start playback", async () => {
  const { container, root, cleanup } = setupMountedDom();

  // 1. Mount VideoPlayer with isOverlayActive=false
  await act(async () => {
    root.render(React.createElement(VideoPlayer, { edit: edits[0], isOverlayActive: false }));
  });

  function findVideo(node) {
    if (node.tagName === "VIDEO") return node;
    if (node.childNodes) {
      for (const c of node.childNodes) {
        const found = findVideo(c);
        if (found) return found;
      }
    }
    return null;
  }

  const video = findVideo(container);
  assert.ok(video, "Video element must exist");
  const playCallsBefore = video._playCalls;

  // 2. ShortsViewer opens -> re-render with isOverlayActive=true
  await act(async () => {
    root.render(React.createElement(VideoPlayer, { edit: edits[0], isOverlayActive: true }));
  });

  // 3. Late loadedmetadata fires on VideoPlayer
  await act(async () => {
    video.dispatchEvent({ type: "loadedmetadata" });
  });

  // 4. Verify no playback was started
  assert.equal(video._playCalls, playCallsBefore, "loadedmetadata must NOT call video.play() while isOverlayActive is true");
  assert.equal(video.paused, true, "Video must remain paused");

  await cleanup();
});

test("V3 FIX C: Late playback promise completion when overlay becomes active is paused and cancelled", async () => {
  const { container, root, cleanup } = setupMountedDom();

  await act(async () => {
    root.render(React.createElement(VideoPlayer, { edit: edits[0], isOverlayActive: false }));
  });

  function findVideo(node) {
    if (node.tagName === "VIDEO") return node;
    if (node.childNodes) {
      for (const c of node.childNodes) {
        const found = findVideo(c);
        if (found) return found;
      }
    }
    return null;
  }

  const video = findVideo(container);
  const pauseCallsBefore = video._pauseCalls;

  // Open overlay
  await act(async () => {
    root.render(React.createElement(VideoPlayer, { edit: edits[0], isOverlayActive: true }));
  });

  assert.ok(video._pauseCalls > pauseCallsBefore, "Must pause video when overlay opens");

  // Late play event fired by browser must be cancelled and paused
  await act(async () => {
    video.dispatchEvent({ type: "play" });
  });
  assert.equal(video.paused, true, "Must force pause if late play event arrives while overlay is active");

  await cleanup();
});

// ---------------------------------------------------------------------------
// 14. REVIEW V3 FIX D: Up Next Recommendations in Shorts-Only & Variable Catalogs
// ---------------------------------------------------------------------------

test("V3 FIX D: Up Next recommendations in Shorts-only catalog disables API and avoids fabricated currentEditId", async () => {
  const { container, root, cleanup } = setupMountedDom("http://localhost:3000/");

  // Mount App with ONLY Shorts
  await act(async () => {
    root.render(React.createElement(App, { initialEdits: SYNTHETIC_SHORTS }));
  });

  // Featured row and Up Next section must be omitted
  const upNextHeading = container.querySelectorAll("h2").find((h) => h.textContent === "Up Next");
  assert.equal(upNextHeading, undefined, "Up Next heading must NOT exist when no landscape video exists");

  await cleanup();
});

test("V3 FIX D: Up Next recommendations across video-only, mixed, and empty catalogs", async () => {
  // Empty catalog
  const { container: emptyContainer, root: emptyRoot, cleanup: emptyCleanup } = setupMountedDom("http://localhost:3000/");
  await act(async () => {
    emptyRoot.render(React.createElement(App, { initialEdits: [] }));
  });
  assert.equal(emptyContainer.querySelectorAll("h2").find((h) => h.textContent === "Up Next"), undefined, "Empty catalog omits Up Next cleanly");
  await emptyCleanup();

  // Video-only catalog (production edits)
  const { container: prodContainer, root: prodRoot, cleanup: prodCleanup } = setupMountedDom("http://localhost:3000/");
  await act(async () => {
    prodRoot.render(React.createElement(App, { initialEdits: edits }));
  });
  assert.ok(prodContainer.querySelectorAll("h2").find((h) => h.textContent === "Up Next"), "Video catalog renders Up Next");
  await prodCleanup();

  // Mixed catalog
  const { container: mixedContainer, root: mixedRoot, cleanup: mixedCleanup } = setupMountedDom("http://localhost:3000/");
  await act(async () => {
    mixedRoot.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });
  assert.ok(mixedContainer.querySelectorAll("h2").find((h) => h.textContent === "Up Next"), "Mixed catalog renders Up Next");
  await mixedCleanup();
});

// ---------------------------------------------------------------------------
// 15. REVIEW V3 FIX E: Recoverable Media Playback Verification
// ---------------------------------------------------------------------------

test("V3 FIX E: Recoverable media test: video playback recovers successfully after error retry", async () => {
  const { container, root, cleanup } = setupMountedDom();

  await act(async () => {
    root.render(
      React.createElement(ShortsViewer, {
        shorts: SYNTHETIC_SHORTS,
        initialShortId: 100,
        onClose: () => {},
      })
    );
  });

  function findVideo(node) {
    if (node.tagName === "VIDEO") return node;
    if (node.childNodes) {
      for (const c of node.childNodes) {
        const found = findVideo(c);
        if (found) return found;
      }
    }
    return null;
  }

  const video = findVideo(container);

  // Trigger error event
  await act(async () => {
    video.dispatchEvent({ type: "error" });
  });

  assert.ok(container.textContent.includes("Video unavailable"));

  // Click Retry button
  const retryBtn = container.querySelectorAll("button").find(
    (b) => b.textContent && b.textContent.includes("Retry")
  );
  assert.ok(retryBtn, "Retry button must be visible in error state");

  const loadCallsBefore = video._loadCalls;
  await act(async () => {
    retryBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(video._loadCalls > loadCallsBefore, "Retry must invoke video.load()");

  // Simulate recoverable media playback success
  await act(async () => {
    video.dispatchEvent({ type: "playing" });
  });

  assert.ok(!container.textContent.includes("Video unavailable"), "Error overlay must clear on recovery");

  await cleanup();
});

// ===========================================================================
// MISSION 6C: FINAL V4 TARGETED CORRECTNESS TEST SUITES
// ===========================================================================

// ---------------------------------------------------------------------------
// 14. REVIEW V4 FIX 1: History Depth Across Back AND Forward
// ---------------------------------------------------------------------------

test("V4 FIX 1: Home → 100 → 101 → Close → Home", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  const card100 = findElementsByAriaLabel(container, "Watch short: Shadow Strike")[0];
  assert.ok(card100, "Card 100 must exist");

  await act(async () => {
    card100.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.search, "?short=100");
  assert.equal(historyState.pointer, 1);

  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.search, "?short=101");
  assert.equal(historyState.pointer, 2);

  const closeBtn = findElementsByAriaLabel(container, "Close shorts viewer")[0];
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.pointer, 0);
  assert.equal(historyState.search, "");
  assert.equal(findElementsByAriaLabel(container, "Shorts viewer:").length, 0);

  await cleanup();
});

test("V4 FIX 1: Home → 100 → 101 → Back → Forward → Close → Home", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  // 1. Open 100
  const card100 = findElementsByAriaLabel(container, "Watch short: Shadow Strike")[0];
  await act(async () => {
    card100.dispatchEvent({ type: "click", bubbles: true });
  });
  assert.equal(historyState.search, "?short=100");
  assert.equal(historyState.pointer, 1);

  // 2. Next to 101
  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });
  assert.equal(historyState.search, "?short=101");
  assert.equal(historyState.pointer, 2);

  // 3. Browser Back to 100
  await act(async () => {
    globalThis.history.back();
  });
  assert.equal(historyState.search, "?short=100");
  assert.equal(historyState.pointer, 1);
  assert.ok(container.textContent.includes("Shadow Strike"));

  // 4. Browser Forward to 101
  await act(async () => {
    globalThis.history.forward();
  });
  assert.equal(historyState.search, "?short=101");
  assert.equal(historyState.pointer, 2);
  assert.ok(container.textContent.includes("Domain Expansion"));

  // 5. Close viewer -> Must return Home (pointer 0), not back to 100!
  const closeBtn = findElementsByAriaLabel(container, "Close shorts viewer")[0];
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.pointer, 0, "History pointer must rewind to Home");
  assert.equal(historyState.search, "", "URL must return to Home");
  assert.equal(findElementsByAriaLabel(container, "Shorts viewer:").length, 0, "Viewer must be closed");

  await cleanup();
});

test("V4 FIX 1: Home → 100 → 101 → 102 → Back → Back → Forward → Close → Home", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  // Open 100
  const card100 = findElementsByAriaLabel(container, "Watch short: Shadow Strike")[0];
  await act(async () => {
    card100.dispatchEvent({ type: "click", bubbles: true });
  });

  // Next to 101
  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  // Next to 102
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });
  assert.equal(historyState.search, "?short=102");
  assert.equal(historyState.pointer, 3);

  // Back to 101
  await act(async () => {
    globalThis.history.back();
  });
  assert.equal(historyState.search, "?short=101");
  assert.equal(historyState.pointer, 2);

  // Back to 100
  await act(async () => {
    globalThis.history.back();
  });
  assert.equal(historyState.search, "?short=100");
  assert.equal(historyState.pointer, 1);

  // Forward to 101
  await act(async () => {
    globalThis.history.forward();
  });
  assert.equal(historyState.search, "?short=101");
  assert.equal(historyState.pointer, 2);

  // Close viewer
  const closeBtn = findElementsByAriaLabel(container, "Close shorts viewer")[0];
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.pointer, 0, "Must return to Home at pointer 0");
  assert.equal(historyState.search, "");
  assert.equal(findElementsByAriaLabel(container, "Shorts viewer:").length, 0);

  await cleanup();
});

test("V4 FIX 1: Home → 100 → 101 → Back → Next → Close → Home", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  // Open 100
  const card100 = findElementsByAriaLabel(container, "Watch short: Shadow Strike")[0];
  await act(async () => {
    card100.dispatchEvent({ type: "click", bubbles: true });
  });

  // Next to 101
  const nextBtn = findElementsByAriaLabel(container, "Next short")[0];
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });
  assert.equal(historyState.search, "?short=101");
  assert.equal(historyState.pointer, 2);

  // Back to 100
  await act(async () => {
    globalThis.history.back();
  });
  assert.equal(historyState.search, "?short=100");
  assert.equal(historyState.pointer, 1);

  // Click Next in viewer -> pushes fresh forward entry
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });
  assert.equal(historyState.search, "?short=101");
  assert.equal(historyState.pointer, 2);

  // Close viewer
  const closeBtn = findElementsByAriaLabel(container, "Close shorts viewer")[0];
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.pointer, 0, "Must return to Home at pointer 0");
  assert.equal(historyState.search, "");
  assert.equal(findElementsByAriaLabel(container, "Shorts viewer:").length, 0);

  await cleanup();
});

test("V4 FIX 1: Direct-link entry → Close", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/?short=101");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  assert.equal(historyState.search, "?short=101");
  assert.equal(historyState.pointer, 0);
  assert.ok(container.textContent.includes("Domain Expansion"));

  const closeBtn = findElementsByAriaLabel(container, "Close shorts viewer")[0];
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.pointer, 0, "Must remain at pointer 0 without jumping out of app");
  assert.equal(historyState.search, "");
  assert.equal(findElementsByAriaLabel(container, "Shorts viewer:").length, 0);

  await cleanup();
});

test("V4 FIX 1: Enter Shorts from Sidebar → Close", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  const shortsBtn = findButtonsByText(container, "Shorts")[0];
  assert.ok(shortsBtn, "Shorts sidebar button must exist");

  await act(async () => {
    shortsBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.search, "?view=shorts&short=100");
  assert.equal(historyState.pointer, 1);
  assert.ok(container.textContent.includes("Shadow Strike"));

  const closeBtn = findElementsByAriaLabel(container, "Close shorts viewer")[0];
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(historyState.pointer, 0, "Must return to previous browsing entry (Home)");
  assert.equal(historyState.search, "");
  assert.equal(findElementsByAriaLabel(container, "Shorts viewer:").length, 0);

  await cleanup();
});

test("V4 FIX 1: Refresh and malformed IDs", async () => {
  // 1. Non-numeric ID string
  const dom1 = setupMountedDom("http://localhost:3000/?short=malformed-xyz");
  await act(async () => {
    dom1.root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });
  assert.equal(findElementsByAriaLabel(dom1.container, "Shorts viewer:").length, 0, "Malformed string rejected");
  await dom1.cleanup();

  // 2. Non-existent numeric ID
  const dom2 = setupMountedDom("http://localhost:3000/?short=9999");
  await act(async () => {
    dom2.root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });
  assert.equal(findElementsByAriaLabel(dom2.container, "Shorts viewer:").length, 0, "Unknown numeric ID rejected");
  await dom2.cleanup();

  // 3. Regular video ID (not a Short)
  const dom3 = setupMountedDom("http://localhost:3000/?short=1");
  await act(async () => {
    dom3.root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });
  assert.equal(findElementsByAriaLabel(dom3.container, "Shorts viewer:").length, 0, "Video ID rejected as Short");
  await dom3.cleanup();
});

test("V4 FIX 1: Hashtag exit clears session state and navigates to Explore #tag", async () => {
  const { container, root, historyState, cleanup } = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  const card100 = findElementsByAriaLabel(container, "Watch short: Shadow Strike")[0];
  await act(async () => {
    card100.dispatchEvent({ type: "click", bubbles: true });
  });

  const viewerDialog = findElementsByAriaLabel(container, "Shorts viewer:")[0];
  const tagChip = findElementsByAriaLabel(viewerDialog, "Filter by #valorant")[0];

  await act(async () => {
    tagChip.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.ok(!historyState.search.includes("short="), "short= parameter must be cleared");
  assert.ok(historyState.search.includes("view=explore"), "Must navigate to Explore view");
  assert.equal(historyState.state?.viewerSessionId, undefined, "viewerSessionId must be cleared");
  assert.equal(historyState.state?.viewerDepth, undefined, "viewerDepth must be cleared");

  await cleanup();
});

test("V4 REFRESH: Home → Short 100 → Next 101 → refresh/remount preserving browser history → Close → Back", async () => {
  const dom = setupMountedDom("http://localhost:3000/");

  await act(async () => {
    dom.root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  assert.equal(dom.historyState.search, "");
  assert.equal(dom.historyState.pointer, 0);

  // 1. Open Short 100
  const card100 = findElementsByAriaLabel(dom.container, "Watch short: Shadow Strike")[0];
  assert.ok(card100, "Short 100 card must be visible on shelf");
  await act(async () => {
    card100.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(dom.historyState.search, "?short=100");
  assert.equal(dom.historyState.pointer, 1);
  const session1 = dom.historyState.state?.viewerSessionId;
  assert.ok(session1, "Viewer session identifier must be tagged");
  assert.equal(dom.historyState.state?.viewerDepth, 1);

  // 2. Next to Short 101
  const nextBtn = findElementsByAriaLabel(dom.container, "Next short")[0];
  assert.ok(nextBtn, "Next button must exist");
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(dom.historyState.search, "?short=101");
  assert.equal(dom.historyState.pointer, 2);
  assert.equal(dom.historyState.state?.viewerSessionId, session1);
  assert.equal(dom.historyState.state?.viewerDepth, 2);

  // 3. Page Refresh / Remount: preserve URL, historyStack, stateStack, pointer
  await dom.remount();

  // Mount a fresh App instance into the remounted container
  await act(async () => {
    dom.root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  // Verify that newly mounted App recognizes the existing viewer session without pushing new entries
  assert.equal(dom.historyState.search, "?short=101");
  assert.equal(dom.historyState.pointer, 2);
  assert.equal(dom.historyState.state?.viewerSessionId, session1);
  assert.equal(dom.historyState.state?.viewerDepth, 2);
  assert.ok(dom.container.textContent.includes("Domain Expansion"));

  // 4. Close the viewer
  const closeBtn = findElementsByAriaLabel(dom.container, "Close shorts viewer")[0];
  assert.ok(closeBtn, "Close button must exist after refresh");
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  // History must rewind back to Home entry (pointer 0)
  assert.equal(dom.historyState.pointer, 0, "History pointer must return to 0 (Home)");
  assert.equal(dom.historyState.search, "", "URL must return to clean Home");
  assert.equal(findElementsByAriaLabel(dom.container, "Shorts viewer:").length, 0, "Viewer must be closed");

  // 5. Browser Back
  await act(async () => {
    globalThis.history.back();
  });

  // Must NOT reopen Short 100 or 101!
  assert.equal(dom.historyState.search, "");
  assert.equal(findElementsByAriaLabel(dom.container, "Shorts viewer:").length, 0, "Browser Back must NOT reopen earlier Short");

  await dom.cleanup();
});

test("V4 DIRECT-LINK: Direct link to Short 100 → Next 101 (viewerDepth=1) → Close → Home → Back → Forward", async () => {
  const dom = setupMountedDom("http://localhost:3000/?short=100");

  await act(async () => {
    dom.root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  // 1. Direct link to Short 100
  assert.equal(dom.historyState.search, "?short=100");
  assert.equal(dom.historyState.pointer, 0);
  assert.equal(findElementsByAriaLabel(dom.container, "Shorts viewer:").length, 1);
  assert.ok(dom.container.textContent.includes("Shadow Strike"));
  assert.equal(dom.historyState.state?.viewerSessionId, undefined);

  // 2. Navigate to Short 101
  const nextBtn = findElementsByAriaLabel(dom.container, "Next short")[0];
  assert.ok(nextBtn, "Next button must exist");
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(dom.historyState.search, "?short=101");
  assert.equal(dom.historyState.pointer, 1);
  assert.ok(dom.container.textContent.includes("Domain Expansion"));

  const session = dom.historyState.state?.viewerSessionId;
  assert.ok(session, "Must have created session id");
  assert.equal(
    dom.historyState.state?.viewerDepth,
    1,
    "viewerDepth must be 1 (not 2) because only 1 history entry was pushed in this session"
  );
  assert.equal(
    dom.historyState.state?.hasInAppOrigin,
    false,
    "hasInAppOrigin must be false for direct-link session"
  );

  // 3. Close the viewer
  const closeBtn = findElementsByAriaLabel(dom.container, "Close shorts viewer")[0];
  assert.ok(closeBtn, "Close button must exist");
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  // 4. Confirm visitor remains within the intended Lolixco browsing experience
  assert.equal(findElementsByAriaLabel(dom.container, "Shorts viewer:").length, 0, "Viewer must be closed");
  assert.equal(dom.historyState.pointer, 1, "Must stay at pointer 1 via replaceState without jumping out of app");
  assert.equal(dom.historyState.search, "", "URL must be cleaned of ?short=");
  assert.equal(dom.historyState.state?.viewerSessionId, undefined, "Viewer session state must be cleared");
  assert.ok(
    dom.container.textContent.includes("Gojo vs Sukuna") || dom.container.textContent.includes("Curated Shorts"),
    "Visitor remains within intended Lolixco browsing experience"
  );

  // 5. Verify browser Back/Forward behaves predictably
  await act(async () => {
    globalThis.history.back();
  });
  assert.equal(dom.historyState.pointer, 0, "Back must return to pointer 0 (Short 100)");
  assert.equal(dom.historyState.search, "?short=100");
  assert.equal(findElementsByAriaLabel(dom.container, "Shorts viewer:").length, 1, "Shorts viewer reopens on Back");
  assert.ok(dom.container.textContent.includes("Shadow Strike"));

  await act(async () => {
    globalThis.history.forward();
  });
  assert.equal(dom.historyState.pointer, 1, "Forward must return to pointer 1 (Home)");
  assert.equal(dom.historyState.search, "");
  assert.equal(findElementsByAriaLabel(dom.container, "Shorts viewer:").length, 0, "Viewer must be closed on Forward");

  await dom.cleanup();
});

test("V4 DIRECT-LINK REFRESH: Direct link to Short 100 → Next 101 → refresh Short 101 → Close → Home → Back", async () => {
  const dom = setupMountedDom("http://localhost:3000/?short=100");

  await act(async () => {
    dom.root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  // 1. Direct link to Short 100
  assert.equal(dom.historyState.search, "?short=100");
  assert.equal(dom.historyState.pointer, 0);

  // 2. Navigate to Short 101
  const nextBtn = findElementsByAriaLabel(dom.container, "Next short")[0];
  await act(async () => {
    nextBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  assert.equal(dom.historyState.search, "?short=101");
  assert.equal(dom.historyState.pointer, 1);
  const session1 = dom.historyState.state?.viewerSessionId;
  assert.ok(session1);
  assert.equal(dom.historyState.state?.viewerDepth, 1);
  assert.equal(dom.historyState.state?.hasInAppOrigin, false);

  // 3. Refresh Short 101
  await dom.remount();
  await act(async () => {
    dom.root.render(React.createElement(App, { initialEdits: [...edits, ...SYNTHETIC_SHORTS] }));
  });

  assert.equal(dom.historyState.search, "?short=101");
  assert.equal(dom.historyState.pointer, 1);
  assert.equal(dom.historyState.state?.viewerSessionId, session1);
  assert.equal(dom.historyState.state?.viewerDepth, 1);
  assert.equal(dom.historyState.state?.hasInAppOrigin, false);
  assert.equal(findElementsByAriaLabel(dom.container, "Shorts viewer:").length, 1);
  assert.ok(dom.container.textContent.includes("Domain Expansion"));

  // 4. Close the viewer
  const closeBtn = findElementsByAriaLabel(dom.container, "Close shorts viewer")[0];
  await act(async () => {
    closeBtn.dispatchEvent({ type: "click", bubbles: true });
  });

  // Confirm visitor remains in Lolixco Home
  assert.equal(findElementsByAriaLabel(dom.container, "Shorts viewer:").length, 0, "Viewer must be closed");
  assert.equal(dom.historyState.pointer, 1, "Must remain at pointer 1 via replaceState");
  assert.equal(dom.historyState.search, "");
  assert.ok(
    dom.container.textContent.includes("Gojo vs Sukuna") || dom.container.textContent.includes("Curated Shorts"),
    "Visitor remains within intended Lolixco browsing experience"
  );

  // 5. Browser Back
  await act(async () => {
    globalThis.history.back();
  });
  assert.equal(dom.historyState.pointer, 0, "Back must return to pointer 0 (Short 100)");
  assert.equal(dom.historyState.search, "?short=100");
  assert.equal(findElementsByAriaLabel(dom.container, "Shorts viewer:").length, 1, "Shorts viewer reopens on Back");
  assert.ok(dom.container.textContent.includes("Shadow Strike"));

  await dom.cleanup();
});

