import { act } from "react";
import { createRoot } from "react-dom/client";

// Helper for lightweight DOM setup in Node.js
export function setupMountedDom(initialUrl = "http://localhost:3000/") {
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
        historyState.pointer + 1,
      );
      historyState.stateStack = historyState.stateStack.slice(
        0,
        historyState.pointer + 1,
      );
      historyState.historyStack.push(u.href);
      historyState.stateStack.push(
        state ? JSON.parse(JSON.stringify(state)) : null,
      );
      historyState.pointer = historyState.historyStack.length - 1;
    },
    replaceState(state, _title, url) {
      historyState.replaceCount++;
      const u = new URL(url, historyState.url);
      historyState.historyStack[historyState.pointer] = u.href;
      historyState.stateStack[historyState.pointer] = state
        ? JSON.parse(JSON.stringify(state))
        : null;
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
              } else if (
                selector.includes('role="slider"') &&
                role === "slider"
              ) {
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
      replaceChildren(...children) {
        this.childNodes = [];
        for (const child of children) this.appendChild(child);
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
        this._listeners
          .get(type)
          .push({ fn, capture: !!(opts && opts.capture) });
      },
      removeEventListener(type, fn) {
        if (!this._listeners.has(type)) return;
        const list = this._listeners.get(type);
        const i = list.findIndex((l) => l.fn === fn);
        if (i !== -1) list.splice(i, 1);
      },
      getBoundingClientRect() {
        return {
          left: 0,
          top: 0,
          width: 300,
          height: 10,
          right: 300,
          bottom: 10,
        };
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

  mockDoc.head = mockDoc.createElement("head");
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
      Math.min(
        historyState.historyStack.length - 1,
        historyState.pointer + direction,
      ),
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
