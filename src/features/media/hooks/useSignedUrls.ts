import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';

import { signedUrls } from '../api';
import { SIGNED_URL_GC_MS, SIGNED_URL_STALE_MS, SIGNED_URL_TTL_SECONDS } from '../constants';
import type { MediaError } from '../errors';

/**
 * One batch of signed URLs per screen (Decision 15). URLs last 1 hour; the query goes stale at
 * 50 minutes so the next mount or app focus fetches fresh ones, and is dropped at 55 so an expired
 * set is never handed out. Images are cached by path (PhotoTile's cacheKey), so renewed URLs
 * don't reload photos already on the phone.
 */
export function useSignedUrls(bucket: string, paths: readonly string[]) {
  const queryClient = useQueryClient();
  const sorted = useMemo(() => [...new Set(paths)].sort(), [paths]);
  const queryKey = useMemo(() => ['media', 'signed', bucket, ...sorted], [bucket, sorted]);

  const query = useQuery<Record<string, string | null>, MediaError>({
    queryKey,
    queryFn: () => signedUrls(bucket, sorted, SIGNED_URL_TTL_SECONDS),
    enabled: sorted.length > 0,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_GC_MS,
  });

  // Paths already renewed during this mount: a second error on the same path doesn't refetch.
  const renewed = useRef(new Set<string>());

  /** The URL; undefined while loading, null when the server gave none (photo not readable). */
  const urlFor = useCallback(
    (path: string): string | null | undefined => {
      if (query.data === undefined) return query.isError ? null : undefined;
      return query.data[path] ?? null;
    },
    [query.data, query.isError],
  );

  /** Asks for new URLs once per path per mount. Returns false if this path was already renewed. */
  const renew = useCallback(
    (path: string): boolean => {
      if (renewed.current.has(path)) return false;
      renewed.current.add(path);
      void queryClient.invalidateQueries({ queryKey, exact: true });
      return true;
    },
    [queryClient, queryKey],
  );

  return { urlFor, renew, isLoading: query.isLoading };
}
