"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `flush` exactly once, on unmount, using the latest closure rather than
 * the one captured at first render.
 *
 * Motivation: inline editors commit their draft on blur/Enter. A virtualized
 * table unmounts rows once they leave the overscan window, and React does not
 * reliably fire onBlur when a focused input is unmounted programmatically — so
 * a row scrolled out of view mid-edit would silently drop the typed value.
 * `flush` should commit the pending edit (guarded so it no-ops when nothing is
 * dirty), making unmount behave like a blur.
 */
export function useFlushOnUnmount(flush: () => void) {
  const flushRef = useRef(flush);
  // Keep the ref pointing at the latest closure — updated after each commit,
  // not during render — so the unmount flush sees the current draft.
  useEffect(() => {
    flushRef.current = flush;
  });
  // Run the latest flush exactly once, on unmount.
  useEffect(() => () => flushRef.current(), []);
}
