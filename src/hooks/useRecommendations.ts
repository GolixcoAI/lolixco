import { useEffect, useRef, useState } from "react";
import { edits as compiledEdits, type Edit } from "../data/edits";
import {
  computeLocalFallback,
  fetchRecommendations,
  type RecommendationParams,
  type RecommendationResult,
  type RecommendedItem,
} from "../api/recommendations";

export interface UseRecommendationsState {
  items: RecommendedItem[];
  edits: Edit[];
  loading: boolean;
  source: "api" | "fallback";
  diagnostics: RecommendationResult["diagnostics"];
  refetch: () => void;
}

export function useRecommendations(
  params: RecommendationParams,
  enabled: boolean = true,
  catalog: Edit[] = compiledEdits,
): UseRecommendationsState {
  const paramsKey = JSON.stringify({
    surface: params.surface,
    currentEditId: params.currentEditId,
    limit: params.limit,
    categoryFilter: params.categoryFilter,
    tagsAll: params.tagsAll,
    excludeEditIds: params.excludeEditIds,
    history: params.history,
  });

  const [state, setState] = useState(() => ({
    catalog,
    key: paramsKey,
    result: computeLocalFallback(params, catalog),
    loading: enabled,
  }));

  const [nonce, setNonce] = useState(0);
  const seqRef = useRef(0);

  // Synchronously compute the clean immediate fallback if params changed.
  // This guarantees that:
  // 1. No currently selected edit in Up Next, even during loading or in the first render frame.
  // 2. Old recommendations from a previous edit are not displayed for the new selection.
  // 3. Telemetry truthfully reflects source: "fallback" until the new API response arrives.
  const activeResult =
    state.key === paramsKey && state.catalog === catalog
      ? state.result
      : computeLocalFallback(params, catalog);
  const isLoading =
    state.key === paramsKey && state.catalog === catalog
      ? state.loading
      : enabled;

  const refetch = () => {
    setNonce((n) => n + 1);
  };

  useEffect(() => {
    if (!enabled) {
      setState({
        catalog,
        key: paramsKey,
        result: computeLocalFallback(params, catalog),
        loading: false,
      });
      return;
    }

    const currentSeq = ++seqRef.current;
    const controller = new AbortController();

    if (state.key !== paramsKey || state.catalog !== catalog) {
      setState({
        catalog,
        key: paramsKey,
        result: computeLocalFallback(params, catalog),
        loading: true,
      });
    }

    fetchRecommendations(params, controller.signal, catalog)
      .then((res) => {
        // Protect against out-of-order or superseded responses
        if (!controller.signal.aborted && currentSeq === seqRef.current) {
          setState({
            catalog,
            key: paramsKey,
            result: res,
            loading: false,
          });
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        if (!controller.signal.aborted && currentSeq === seqRef.current) {
          setState({
            catalog,
            key: paramsKey,
            result: computeLocalFallback(params, catalog),
            loading: false,
          });
        }
      });

    return () => {
      controller.abort();
    };
  }, [paramsKey, nonce, enabled, catalog]);

  return {
    items: activeResult.items,
    edits: activeResult.edits,
    loading: isLoading,
    source: activeResult.source,
    diagnostics: activeResult.diagnostics,
    refetch,
  };
}
