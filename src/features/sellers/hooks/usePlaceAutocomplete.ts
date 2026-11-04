import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import { autocompletePlaces, type SellerAppError } from '../api';
import { PLACES_INPUT_MAX, PLACES_INPUT_MIN, type PlaceSuggestion } from '../schema';

export const AUTOCOMPLETE_DEBOUNCE_MS = 300;

type Search = { input: string; seq: number };

/**
 * Debounced address suggestions. One Places session token covers every keystroke until a place is
 * resolved (renewSession), which groups them into one billed session. A new mount starts a new session.
 *
 * The typed text never goes into the query key, so it doesn't show up in cache or devtools
 * output; each debounced search gets a sequence number instead, and a stale search's result is
 * never shown because its key is no longer the current one.
 */
export function usePlaceAutocomplete(text: string) {
  const [sessionToken, setSessionToken] = useState(() => randomUUID());
  const [lastSearch, setSearch] = useState<Search | null>(null);
  const seq = useRef(0);
  const trimmed = text.trim();
  const searchable = trimmed.length >= PLACES_INPUT_MIN && trimmed.length <= PLACES_INPUT_MAX;
  // Text cut below 3 chars hides the last search; typing again starts a new one after the debounce.
  const search = searchable ? lastSearch : null;

  useEffect(() => {
    if (!searchable) return;
    const timer = setTimeout(() => {
      seq.current += 1;
      setSearch({ input: trimmed, seq: seq.current });
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, searchable]);

  const query = useQuery<PlaceSuggestion[], SellerAppError>({
    queryKey: ['places', 'autocomplete', sessionToken, search?.seq ?? 0],
    queryFn: ({ signal }) => autocompletePlaces(search?.input ?? '', sessionToken, signal),
    enabled: search !== null,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });

  /**
   * Starts a new billed session. By default the current suggestions are cleared (the address was
   * saved and the screen moves on). With keepSearch, the current search re-runs under the new
   * token, so the user still has a list to pick from (e.g. after a failed save).
   */
  const renewSession = useCallback(({ keepSearch = false }: { keepSearch?: boolean } = {}) => {
    if (!keepSearch) setSearch(null);
    setSessionToken(randomUUID());
  }, []);

  return {
    suggestions: search ? query.data : undefined,
    isSearching: search !== null && query.isFetching,
    /** True while the user is typing and the debounce hasn't fired yet. */
    isDebouncing: searchable && search?.input !== trimmed,
    error: search ? query.error : null,
    retry: () => void query.refetch(),
    sessionToken,
    renewSession,
    searchable,
  };
}
