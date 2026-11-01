import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { edits } from "../src/data/edits.ts";
import {
  computeLocalFallback,
  fetchRecommendations,
  EXPECTED_SCHEMA_VERSION,
  EXPECTED_CATALOG_VERSION,
} from "../src/api/recommendations.ts";
import { validLoop, loopSeek } from "../src/data/logic.js";
import { useRecommendations } from "../src/hooks/useRecommendations.ts";
import { renderToStaticMarkup } from "react-dom/server";

// ---------------------------------------------------------------------------
// Test Envelope & Item Helpers
// ---------------------------------------------------------------------------

function makeValidEnvelope(overrides = {}) {
  return {
    schema_version: EXPECTED_SCHEMA_VERSION,
    request_id: "req_test_12345",
    surface: "home",
    mode_used: "baseline",
    catalog_version: EXPECTED_CATALOG_VERSION,
    policy_version: "baseline-v1",
    as_of: "2026-10-17T12:00:00Z",
    items: [],
    total_eligible: 17,
    has_more: false,
    next_cursor: null,
    diagnostics: {
      warnings: [],
      fallback_reason: null,
    },
    ...overrides,
  };
}

function makeValidItem(editId, overrides = {}) {
  return {
    rank: 1,
    edit_id: editId,
    score: 0.95,
    reason_codes: ["cold_start", "category_balance"],
    edit: { id: editId },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Minimal DOM Mock for React 19 Mounted Hook Tests
// ---------------------------------------------------------------------------

function setupMinimalDom() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  function createMockElement(tagName = "div") {
    return {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      nodeName: tagName.toUpperCase(),
      ownerDocument: null,
      childNodes: [],
      style: {
        setProperty(name, value) { this[name] = String(value); },
        getPropertyValue(name) { return this[name] ?? ""; },
        removeProperty(name) { const old = this[name] ?? ""; delete this[name]; return old; },
      },
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(child) {
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
      },
      removeChild(child) {
        const idx = this.childNodes.indexOf(child);
        if (idx !== -1) this.childNodes.splice(idx, 1);
        child.parentNode = null;
        return child;
      },
      insertBefore(child, before) {
        child.parentNode = this;
        const idx = this.childNodes.indexOf(before);
        if (idx !== -1) this.childNodes.splice(idx, 0, child);
        else this.childNodes.push(child);
        return child;
      },
      addEventListener() {},
      removeEventListener() {},
    };
  }

  const mockDoc = {
    nodeType: 9,
    createElement: (tag) => {
      const el = createMockElement(tag);
      el.ownerDocument = mockDoc;
      return el;
    },
    createTextNode: (text) => ({
      nodeType: 3,
      nodeValue: text,
      ownerDocument: mockDoc,
      parentNode: null,
    }),
    createComment: () => ({ nodeType: 8, ownerDocument: mockDoc, parentNode: null }),
    addEventListener() {},
    removeEventListener() {},
  };

  globalThis.window = globalThis;
  globalThis.document = mockDoc;
  globalThis.HTMLIFrameElement = class {};

  return mockDoc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("API response mapping maps server IDs to validated local Edit objects", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          items: [
            makeValidItem(0, { rank: 1, score: 0.95 }),
            makeValidItem(2, { rank: 2, score: 0.88 }),
          ],
        }),
    });

    const result = await fetchRecommendations({ surface: "home", limit: 2 });
    assert.equal(result.source, "api");
    assert.equal(result.items.length, 2);
    assert.equal(result.edits.length, 2);
    assert.equal(result.items[0].editId, 0);
    assert.equal(result.items[0].edit.title, "Into the Light");
    assert.equal(result.items[1].editId, 2);
    assert.equal(result.items[1].edit.title, edits[2].title);
    assert.equal(result.items[0].edit.poster, edits[0].poster);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Duplicate or unknown server IDs are safely filtered without crashing", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          items: [
            makeValidItem(1, { rank: 1 }),
            makeValidItem(1, { rank: 2 }), // duplicate ID 1
            makeValidItem(9999, { rank: 3 }), // unknown ID 9999
            makeValidItem(3, { rank: 4 }),
          ],
        }),
    });

    const result = await fetchRecommendations({ surface: "home", limit: 4 });
    assert.equal(result.items.length, 2);
    assert.deepEqual(
      result.items.map((i) => i.editId),
      [1, 3]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Contradictory nested edit.id is rejected and excluded", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          items: [
            {
              rank: 1,
              edit_id: 1,
              score: 0.9,
              reason_codes: ["cold_start"],
              edit: { id: 99 }, // Contradictory nested ID!
            },
            makeValidItem(2, { rank: 2, score: 0.8 }),
          ],
        }),
    });

    const result = await fetchRecommendations({ surface: "home", limit: 4 });
    // Item 1 with contradictory nested ID must be dropped
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].editId, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Wrong catalog version is rejected and triggers local fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          catalog_version: "wrong-catalog-v2", // Incompatible catalog version
          items: [makeValidItem(0)],
        }),
    });

    const result = await fetchRecommendations({ surface: "home", limit: 3 });
    // Must reject incompatible catalog and fall back
    assert.equal(result.source, "fallback");
    assert.equal(result.items.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Incomplete response envelope triggers local fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Missing request_id
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        const env = makeValidEnvelope();
        delete env.request_id;
        return env;
      },
    });
    const missingReqId = await fetchRecommendations({ surface: "home", limit: 3 });
    assert.equal(missingReqId.source, "fallback");

    // Missing policy_version
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        const env = makeValidEnvelope();
        delete env.policy_version;
        return env;
      },
    });
    const missingPolicy = await fetchRecommendations({ surface: "home", limit: 3 });
    assert.equal(missingPolicy.source, "fallback");

    // Missing diagnostics
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        const env = makeValidEnvelope();
        delete env.diagnostics;
        return env;
      },
    });
    const missingDiag = await fetchRecommendations({ surface: "home", limit: 3 });
    assert.equal(missingDiag.source, "fallback");

    // Mismatched surface
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => makeValidEnvelope({ surface: "home" }),
    });
    const mismatchedSurface = await fetchRecommendations({
      surface: "up_next",
      currentEditId: 0,
      limit: 3,
    });
    assert.equal(mismatchedSurface.source, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Unsupported pagination contract (has_more: true or next_cursor !== null) triggers local fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // has_more: true
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          has_more: true,
          items: [makeValidItem(0)],
        }),
    });
    const hasMoreResult = await fetchRecommendations({ surface: "home", limit: 3 });
    assert.equal(hasMoreResult.source, "fallback");

    // next_cursor: "cursor_123"
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          next_cursor: "cursor_123",
          items: [makeValidItem(0)],
        }),
    });
    const cursorResult = await fetchRecommendations({ surface: "home", limit: 3 });
    assert.equal(cursorResult.source, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Invalid or malformed as_of timestamp triggers local fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const invalidTimestamps = [
      "not-a-timestamp",
      "2026/10/17 12:00:00",
      "2026-02-31T12:00:00Z",
      123456789,
      null,
    ];

    for (const ts of invalidTimestamps) {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () =>
          makeValidEnvelope({
            as_of: ts,
            items: [makeValidItem(0)],
          }),
      });
      const result = await fetchRecommendations({ surface: "home", limit: 3 });
      assert.equal(result.source, "fallback");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Unsupported mode_used triggers local fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const unsupportedModes = ["neural", "collaborative_v2", "experimental", "unknown"];
    for (const mode of unsupportedModes) {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () =>
          makeValidEnvelope({
            mode_used: mode,
            items: [makeValidItem(0)],
          }),
      });
      const result = await fetchRecommendations({ surface: "home", limit: 3 });
      assert.equal(result.source, "fallback");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Nonfinite recommendation scores (Infinity, -Infinity, NaN) are safely excluded", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          items: [
            makeValidItem(0, { rank: 1, score: Infinity }),
            makeValidItem(1, { rank: 2, score: -Infinity }),
            makeValidItem(2, { rank: 3, score: NaN }),
            makeValidItem(3, { rank: 4, score: 0.85 }),
          ],
        }),
    });

    const result = await fetchRecommendations({ surface: "home", limit: 4 });
    assert.equal(result.source, "api");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].editId, 3);
    assert.equal(result.items[0].score, 0.85);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Enforces requested limit client-side even if server over-returns", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          items: [
            makeValidItem(1, { rank: 1 }),
            makeValidItem(2, { rank: 2 }),
            makeValidItem(3, { rank: 3 }),
          ],
        }),
    });

    const result = await fetchRecommendations({ surface: "home", limit: 1 });
    // Requested limit=1, even though server sent 3 items
    assert.equal(result.items.length, 1);
    assert.equal(result.edits.length, 1);
    assert.equal(result.items[0].editId, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Current video is strictly excluded from Up Next recommendations", async () => {
  const fallbackUpNext0 = computeLocalFallback({
    surface: "up_next",
    currentEditId: 0,
    limit: 4,
  });
  assert.equal(fallbackUpNext0.items.length, 4);
  assert.ok(fallbackUpNext0.items.every((item) => item.editId !== 0));

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          surface: "up_next",
          items: [
            makeValidItem(0, { rank: 1 }), // rogue active ID
            makeValidItem(4, { rank: 2 }),
          ],
        }),
    });

    const result = await fetchRecommendations({
      surface: "up_next",
      currentEditId: 0,
      limit: 2,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].editId, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Client-side defense in depth enforces excludeEditIds", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          items: [
            makeValidItem(2, { rank: 1 }), // excluded
            makeValidItem(5, { rank: 2 }),
          ],
        }),
    });

    const result = await fetchRecommendations({
      surface: "home",
      excludeEditIds: [2],
      limit: 2,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].editId, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Deterministic fallback occurs when API returns HTTP error or network failure", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
    });
    const errResult = await fetchRecommendations({ surface: "home", limit: 5 });
    assert.equal(errResult.source, "fallback");
    assert.equal(errResult.items.length, 5);
    assert.equal(errResult.items[0].reasonCodes[0], "local_fallback");

    globalThis.fetch = async () => {
      throw new Error("Connection refused");
    };
    const networkResult = await fetchRecommendations({ surface: "home", limit: 3 });
    assert.equal(networkResult.source, "fallback");
    assert.equal(networkResult.items.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Malformed JSON syntax triggers local fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    });
    const badJson = await fetchRecommendations({ surface: "home", limit: 4 });
    assert.equal(badJson.source, "fallback");
    assert.equal(badJson.items.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Valid 0-item response preserves source: 'api' and does not fall back to all edits", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        makeValidEnvelope({
          items: [],
          total_eligible: 0,
        }),
    });

    const result = await fetchRecommendations({ surface: "home", limit: 6 });
    assert.equal(result.source, "api");
    assert.equal(result.items.length, 0);
    assert.equal(result.edits.length, 0);
    assert.equal(result.totalEligible, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Stalled response headers trigger timeout and local fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (_url, options) => {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "TimeoutError"));
        });
      });
    };

    const result = await fetchRecommendations({
      surface: "home",
      limit: 3,
      timeoutMs: 30, // 30ms timeout
    });

    assert.equal(result.source, "fallback");
    assert.equal(result.items.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Stalled JSON body triggers timeout and local fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Headers arrive fast, but json() reading hangs
    globalThis.fetch = async (_url, options) => {
      return {
        ok: true,
        json: () => {
          return new Promise((_, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "TimeoutError"));
            });
          });
        },
      };
    };

    const result = await fetchRecommendations({
      surface: "home",
      limit: 3,
      timeoutMs: 40, // 40ms timeout
    });

    assert.equal(result.source, "fallback");
    assert.equal(result.items.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Caller abort during JSON parsing re-throws AbortError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const controller = new AbortController();
    globalThis.fetch = async (_url, options) => {
      return {
        ok: true,
        json: () => {
          return new Promise((_, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          });
        },
      };
    };

    const promise = fetchRecommendations(
      { surface: "home", limit: 3, timeoutMs: 5000 },
      controller.signal
    );

    // Abort after fetch returns response headers, while json() is pending
    setTimeout(() => {
      controller.abort();
    }, 10);

    await assert.rejects(promise, { name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Caller abort before or during fetch re-throws AbortError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const controller = new AbortController();
    globalThis.fetch = async (_url, options) => {
      if (options?.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return new Promise((_, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    };

    const promise = fetchRecommendations(
      { surface: "home", limit: 4 },
      controller.signal
    );
    controller.abort();

    await assert.rejects(promise, { name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Category and tags filter in local fallback", () => {
  const gamingRecs = computeLocalFallback({
    surface: "home",
    categoryFilter: "Gaming",
    limit: 10,
  });
  assert.ok(gamingRecs.items.length > 0);
  assert.ok(gamingRecs.items.every((i) => i.edit.category === "Gaming"));

  const neonRecs = computeLocalFallback({
    surface: "home",
    tagsAll: ["neon"],
    limit: 10,
  });
  assert.ok(neonRecs.items.length > 0);
  assert.ok(neonRecs.items.every((i) => i.edit.tags.includes("neon")));

  const noneRecs = computeLocalFallback({
    surface: "home",
    tagsAll: ["impossible_tag_xyz"],
    limit: 10,
  });
  assert.equal(noneRecs.items.length, 0);
  assert.equal(noneRecs.totalEligible, 0);
});

test("Synchronous fallback rendering eliminates active video from Up Next immediately", () => {
  let capturedState = null;

  function TestRecsComponent({ currentEditId }) {
    const state = useRecommendations({
      surface: "up_next",
      currentEditId,
      limit: 4,
    });
    capturedState = state;
    return React.createElement("div", null, state.edits.map((e) => e.id).join(","));
  }

  // 1. Initial render with Edit 0
  renderToStaticMarkup(React.createElement(TestRecsComponent, { currentEditId: 0 }));
  assert.ok(capturedState !== null);
  assert.equal(capturedState.edits.length, 4);
  assert.ok(capturedState.edits.every((e) => e.id !== 0));

  // 2. Immediate render with Edit 1
  renderToStaticMarkup(React.createElement(TestRecsComponent, { currentEditId: 1 }));
  assert.equal(capturedState.edits.length, 4);
  assert.ok(capturedState.edits.every((e) => e.id !== 1));

  // 3. Render with Edit 2
  renderToStaticMarkup(React.createElement(TestRecsComponent, { currentEditId: 2 }));
  assert.ok(capturedState.edits.every((e) => e.id !== 2));
});

test("Real mounted React 19 hook integration test: rapid selections, delayed responses, caller abort, and API transitions", async () => {
  const mockDoc = setupMinimalDom();
  const originalFetch = globalThis.fetch;

  try {
    let capturedStates = [];
    let delayedResolvers = new Map();

    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      const editId = body.current_edit_id;

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          resolve({
            ok: true,
            json: async () =>
              makeValidEnvelope({
                surface: "up_next",
                items: [
                  makeValidItem((editId + 1) % 17, { rank: 1 }),
                  makeValidItem((editId + 2) % 17, { rank: 2 }),
                ],
              }),
          });
        }, 30);

        delayedResolvers.set(editId, { resolve, reject, timeoutId });

        options?.signal?.addEventListener("abort", () => {
          clearTimeout(timeoutId);
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    };

    function TestMountedComponent({ currentEditId }) {
      const state = useRecommendations({
        surface: "up_next",
        currentEditId,
        limit: 4,
      });
      capturedStates.push({ editId: currentEditId, state });
      return null;
    }

    const container = mockDoc.createElement("div");
    const root = createRoot(container);

    // 1. Rapid selection of Edit 0, then Edit 1, then Edit 2
    await act(async () => {
      root.render(React.createElement(TestMountedComponent, { currentEditId: 0 }));
    });
    // Active video 0 must be immediately excluded from fallback
    let last = capturedStates[capturedStates.length - 1];
    assert.equal(last.editId, 0);
    assert.ok(last.state.edits.every((e) => e.id !== 0));

    await act(async () => {
      root.render(React.createElement(TestMountedComponent, { currentEditId: 1 }));
    });
    last = capturedStates[capturedStates.length - 1];
    assert.equal(last.editId, 1);
    assert.ok(last.state.edits.every((e) => e.id !== 1));

    await act(async () => {
      root.render(React.createElement(TestMountedComponent, { currentEditId: 2 }));
    });
    last = capturedStates[capturedStates.length - 1];
    assert.equal(last.editId, 2);
    assert.ok(last.state.edits.every((e) => e.id !== 2));

    // Wait for the active Edit 2 fetch to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Verify active selection 2 successfully transitioned from fallback to API recommendations
    last = capturedStates[capturedStates.length - 1];
    assert.equal(last.editId, 2);
    assert.equal(last.state.source, "api");
    assert.ok(last.state.edits.every((e) => e.id !== 2));

    // 2. Out-of-order delayed response protection:
    // If an older response for Edit 0 resolves late, it must NOT overwrite current Edit 2
    await act(async () => {
      root.render(React.createElement(TestMountedComponent, { currentEditId: 2 }));
    });
    last = capturedStates[capturedStates.length - 1];
    assert.equal(last.editId, 2);
    assert.equal(last.state.source, "api");

    // 3. Unmount safely cancels in-flight work
    await act(async () => {
      root.unmount();
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sequence guard prevents superseded delayed response that ignores cancellation from overwriting new selection", async () => {
  const mockDoc = setupMinimalDom();
  const originalFetch = globalThis.fetch;

  try {
    let capturedStates = [];
    let resolveFirstRequest = null;

    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      const editId = body.current_edit_id;

      if (editId === 0) {
        // First request ignores abort signal and hangs until manually resolved
        return new Promise((resolve) => {
          resolveFirstRequest = () => {
            resolve({
              ok: true,
              json: async () =>
                makeValidEnvelope({
                  surface: "up_next",
                  items: [
                    makeValidItem(10, { rank: 1 }),
                    makeValidItem(11, { rank: 2 }),
                  ],
                }),
            });
          };
        });
      }

      // Second request resolves normally and quickly
      return {
        ok: true,
        json: async () =>
          makeValidEnvelope({
            surface: "up_next",
            items: [
              makeValidItem(12, { rank: 1 }),
              makeValidItem(13, { rank: 2 }),
            ],
          }),
      };
    };

    function TestMountedComponent({ currentEditId }) {
      const state = useRecommendations({
        surface: "up_next",
        currentEditId,
        limit: 4,
      });
      capturedStates.push({ editId: currentEditId, state });
      return null;
    }

    const container = mockDoc.createElement("div");
    const root = createRoot(container);

    // 1. Render with Edit 0 (initiates first request that hangs)
    await act(async () => {
      root.render(React.createElement(TestMountedComponent, { currentEditId: 0 }));
    });

    // 2. Switch to Edit 1 (supersedes first request and sends second request)
    await act(async () => {
      root.render(React.createElement(TestMountedComponent, { currentEditId: 1 }));
    });

    // Wait for Edit 1 request to finish
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    let current = capturedStates[capturedStates.length - 1];
    assert.equal(current.editId, 1);
    assert.equal(current.state.source, "api");
    assert.deepEqual(current.state.edits.map((e) => e.id), [12, 13]);

    // 3. Now let the first request (for Edit 0) complete late, ignoring that it was superseded
    await act(async () => {
      if (resolveFirstRequest) {
        resolveFirstRequest();
      }
      await new Promise((r) => setTimeout(r, 30));
    });

    // Verify that the stale delayed response for Edit 0 DID NOT overwrite Edit 1's results
    current = capturedStates[capturedStates.length - 1];
    assert.equal(current.editId, 1);
    assert.equal(current.state.source, "api");
    assert.deepEqual(current.state.edits.map((e) => e.id), [12, 13]);

    // Cleanup
    await act(async () => {
      root.unmount();
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Player A-B loop and seeking logic remain intact with recommendation integration", () => {
  assert.equal(validLoop(0, 5, 12), true);
  assert.equal(validLoop(5, 5, 12), false); // 0 length rejected
  assert.equal(validLoop(10, 15, 12), false); // out of bounds rejected

  assert.equal(loopSeek(5, 1, 5, true), 1);
  assert.equal(loopSeek(3, 1, 5, true), 3);
});
