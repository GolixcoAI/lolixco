import {sourceQueue,seededRandom} from "./sourceQueue";
import type { Edit } from "../data/edits";

export interface ImmersionContext {
  category?: string;
  fandomId?: string;
  currentEditId?: number;
  restrictToContext?: boolean;
}

export interface ImmersionQueueState {
  history: Edit[];
  currentIndex: number;
  openingQueue: Edit[];
  discoveryPool: Edit[];
  exhaustedPoolsCount: number;
  eligibleIds?: number[];
}

/**
 * Deterministic PRNG using Linear Congruential Generator.
 */
function createPrng(seed: number) {
  let s = Math.abs(seed) % 2147483647;
  if (s <= 0) s = 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Fisher-Yates array shuffle using optional seed or Math.random.
 */
export function shuffleArray<T>(array: readonly T[], seed?: number): T[] {
  const result = [...array];
  const rand = typeof seed === "number" ? createPrng(seed) : Math.random;

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/**
 * Matches items against immersion entry context:
 * - If fandomId provided: items must contain that fandomId.
 * - Else if category provided and !== "All": items must match category.
 * - Else if currentEditId provided: items matching currentEdit's category.
 */
export function getContextMatchingEdits(
  catalog: readonly Edit[],
  context: ImmersionContext = {}
): Edit[] {
  const fandom = context.fandomId?.trim();
  const category = context.category?.trim();
  const currentId = context.currentEditId;

  // 1. Fandom filter priority
  if (fandom) {
    const matched = catalog.filter((e) => e.fandomIds?.includes(fandom)
      && (!category || category === 'All' || e.category.toLowerCase() === category.toLowerCase()));
    return matched;
  }

  // 2. Specific category filter
  if (category && category !== "All") {
    const matched = catalog.filter((e) => e.category.toLowerCase() === category.toLowerCase());
    if (matched.length > 0) return matched;
  }

  // 3. Fall back to currentEdit's category if entered from All/Home
  if (typeof currentId === "number") {
    const current = catalog.find((e) => e.id === currentId);
    if (current) {
      const matched = catalog.filter(
        (e) => e.category.toLowerCase() === current.category.toLowerCase()
      );
      if (matched.length > 0) return matched;
    }
  }

  // 4. Default: all catalog items
  return [...catalog];
}

/**
 * Initializes a new Immersion Mode viewing session.
 *
 * Stage 1 (Opening Stage):
 * - Up to 3 distinct items matching entry context (3 if 3+, 2 if 2, 1 if 1; no duplicates).
 *
 * Stage 2 (Discovery Stage):
 * - Shuffled queue across all remaining eligible items.
 */
export function createImmersionSession(
  catalog: readonly Edit[],
  context: ImmersionContext = {},
  seed?: number
): { currentEdit: Edit | null; state: ImmersionQueueState } {
  if (!catalog || catalog.length === 0) {
    return {
      currentEdit: null,
      state: {
        history: [],
        currentIndex: -1,
        openingQueue: [],
        discoveryPool: [],
        exhaustedPoolsCount: 0,
      },
    };
  }

  // 1. Opening stage candidate selection
  const matchingCandidates = getContextMatchingEdits(catalog, context);

  // If currentEditId is in matching candidates, prioritize it as item 1
  let orderedCandidates = sourceQueue(matchingCandidates, typeof seed === "number" ? seededRandom(seed) : Math.random);
  if (typeof context.currentEditId === "number") {
    const current = orderedCandidates.find((e) => e.id === context.currentEditId);
    if (current) {
      orderedCandidates = [
        current,
        ...orderedCandidates.filter((e) => e.id !== context.currentEditId),
      ];
    }
  }

  // Deduplicate and take up to 3 distinct opening items
  const openingSeenIds = new Set<number>();
  const openingQueue: Edit[] = [];

  for (const edit of orderedCandidates) {
    if (!openingSeenIds.has(edit.id)) {
      openingSeenIds.add(edit.id);
      openingQueue.push(edit);
      if (openingQueue.length >= 3) break;
    }
  }

  // 2. Discovery pool candidates (all other eligible items not in opening queue)
  const eligible = context.restrictToContext && (context.fandomId || context.category && context.category!=='All') ? matchingCandidates : catalog;
  const remainingCandidates = eligible.filter((e) => !openingSeenIds.has(e.id));
  const discoveryPool = sourceQueue(remainingCandidates, typeof seed==='number'?seededRandom(seed):Math.random,openingQueue);

  // The first item is drawn from opening queue
  const firstEdit = openingQueue[0] || discoveryPool[0] || null;
  const remainingOpening = openingQueue.slice(1);

  return {
    currentEdit: firstEdit,
    state: {
      history: firstEdit ? [firstEdit] : [],
      currentIndex: firstEdit ? 0 : -1,
      openingQueue: remainingOpening,
      discoveryPool,
      exhaustedPoolsCount: 0,
      eligibleIds: eligible.map(e=>e.id),
    },
  };
}

/**
 * Advances playback to the next item in the Immersion session:
 * 1. If user previously navigated backward, moves forward along history.
 * 2. If at end of history:
 *    - Consumes next item from openingQueue if available.
 *    - Else consumes next item from discoveryPool.
 *    - When discoveryPool is exhausted, reshuffles the entire eligible catalog.
 */
export function advanceImmersionNext(
  catalog: readonly Edit[],
  state: ImmersionQueueState,
  seed?: number
): { nextEdit: Edit | null; nextState: ImmersionQueueState } {
  // 1. If browsing back in history, move forward in history
  if (state.currentIndex < state.history.length - 1) {
    const nextIndex = state.currentIndex + 1;
    return {
      nextEdit: state.history[nextIndex],
      nextState: {
        ...state,
        currentIndex: nextIndex,
      },
    };
  }

  // 2. Need a new item to append to history
  let nextEdit: Edit | null = null;
  let nextOpening = [...state.openingQueue];
  let nextDiscovery = [...state.discoveryPool];
  let exhaustedCount = state.exhaustedPoolsCount;

  if (nextOpening.length > 0) {
    nextEdit = nextOpening.shift()!;
  } else if (nextDiscovery.length > 0) {
    nextDiscovery = sourceQueue(nextDiscovery, typeof seed=== "number" ? seededRandom(seed+state.history.length):Math.random, state.history);
    nextEdit = nextDiscovery.shift()!;
  } else {
    // Discovery pool exhausted: reshuffle entire eligible catalog
    exhaustedCount++;
    const eligible = state.eligibleIds ? catalog.filter(e=>state.eligibleIds!.includes(e.id)) : catalog;
    const reshuffled = sourceQueue(eligible,typeof seed=== "number" ? seededRandom(seed+exhaustedCount):Math.random,state.history);

    // Avoid immediate repeat of the current edit if catalog has >= 2 items
    const lastEdit = state.history[state.history.length - 1];
    if (lastEdit && reshuffled.length >= 2 && reshuffled[0].id === lastEdit.id) {
      const first = reshuffled.shift()!;
      reshuffled.push(first);
    }

    if (reshuffled.length > 0) {
      nextEdit = reshuffled.shift()!;
      nextDiscovery = reshuffled;
    }
  }

  if (!nextEdit) {
    return { nextEdit: null, nextState: state };
  }

  const nextHistory = [...state.history, nextEdit];
  return {
    nextEdit,
    nextState: {
      ...state,
      history: nextHistory,
      currentIndex: nextHistory.length - 1,
      openingQueue: nextOpening,
      discoveryPool: nextDiscovery,
      exhaustedPoolsCount: exhaustedCount,
    },
  };
}

/**
 * Navigates backward to the previous item in the history.
 */
export function advanceImmersionPrevious(
  state: ImmersionQueueState
): { prevEdit: Edit | null; nextState: ImmersionQueueState } {
  if (state.currentIndex <= 0) {
    return {
      prevEdit: state.history[0] || null,
      nextState: state,
    };
  }

  const nextIndex = state.currentIndex - 1;
  return {
    prevEdit: state.history[nextIndex],
    nextState: {
      ...state,
      currentIndex: nextIndex,
    },
  };
}

/**
 * Skips an unplayable or errored item with bounded attempts (max 3 consecutive skips).
 */
export function skipUnavailableImmersionEdit(
  catalog: readonly Edit[],
  state: ImmersionQueueState,
  consecutiveSkips: number,
  maxSkips: number = 3
): { nextEdit: Edit | null; nextState: ImmersionQueueState; exhausted: boolean } {
  if (consecutiveSkips >= maxSkips) {
    return { nextEdit: null, nextState: state, exhausted: true };
  }

  const { nextEdit, nextState } = advanceImmersionNext(catalog, state);
  return {
    nextEdit,
    nextState,
    exhausted: nextEdit === null,
  };
}
