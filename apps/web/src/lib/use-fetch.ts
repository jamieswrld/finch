"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FetchState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export interface FetchOptions {
  /** Poll interval in ms. Polling pauses while the tab is hidden. */
  refreshMs?: number;
}

/**
 * Minimal data hook with real loading / error / ready states, retry and
 * optional polling. Every data surface in the app renders all three states
 * deliberately — a stale poll never silently overwrites an error.
 */
export function useFetch<T>(url: string, options: FetchOptions = {}): FetchState<T> & { retry: () => void } {
  const { refreshMs } = options;
  const [state, setState] = useState<FetchState<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setState({ status: "loading" });
      try {
        const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
        if (!response.ok) throw new Error(`request failed (${response.status})`);
        const data = (await response.json()) as T;
        if (mounted.current) setState({ status: "ready", data });
      } catch (error) {
        if (mounted.current) {
          setState({ status: "error", message: error instanceof Error ? error.message : "request failed" });
        }
      }
    },
    [url],
  );

  useEffect(() => {
    void load(false);
  }, [load, tick]);

  useEffect(() => {
    if (!refreshMs) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load(true);
    }, refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);

  const retry = useCallback(() => setTick((value) => value + 1), []);

  return { ...state, retry };
}
