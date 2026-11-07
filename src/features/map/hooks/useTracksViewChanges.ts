import { useEffect, useState } from 'react';

// How long a marker keeps re-rasterising after it changes, so a late icon font still lands.
export const TRACK_VIEW_MS = 300;

/**
 * `tracksViewChanges` for a map marker: true while the marker is new or its look (`key`) just
 * changed, false once it has been drawn. Stops Android re-rasterising every marker every frame.
 */
export function useTracksViewChanges(key: string): boolean {
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(key), TRACK_VIEW_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return settledKey !== key;
}
