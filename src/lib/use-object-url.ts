"use client";

import { useEffect, useState } from "react";

/**
 * An object URL whose lifetime is bound to the blob it came from.
 *
 * The URL is created inside the effect and revoked in the SAME cleanup, which
 * is the only shape that survives React Strict Mode's setup → cleanup → setup
 * in development: the teardown revokes the first URL and the immediate re-setup
 * mints a live replacement. Creating one during render (or in an event handler
 * and revoking it from an unrelated cleanup) is what left the cropper pointed
 * at a dead blob in UAT-003 — the same trap, one level up.
 *
 * Returns null on the first render and whenever `blob` is null, so callers must
 * handle "no preview yet" rather than assuming a URL exists.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing an external Object URL resource to state
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}
