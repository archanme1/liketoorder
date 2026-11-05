import { useQuery } from '@tanstack/react-query';
import { getLocales } from 'expo-localization';
import { useMemo } from 'react';

import { getCurrencies, type MenuAppError } from '../api';
import type { Currency } from '../schema';

export const currenciesKey = ['currencies'] as const;

/** The ISO 4217 list only changes with a migration, so it loads once per app launch. */
export function useCurrencies() {
  return useQuery<Currency[], MenuAppError>({
    queryKey: currenciesKey,
    queryFn: getCurrencies,
    staleTime: Infinity,
  });
}

/** The phone's language tag for formatting prices, e.g. "en-CA". */
export function deviceLocale(): string {
  return getLocales()[0]?.languageTag ?? 'en-US';
}

/**
 * The phone's currency when it's in the list, otherwise null (no pre-selection). The seller
 * always confirms it (Decision 12).
 */
export function useSuggestedCurrency(currencies: readonly Currency[] | undefined): string | null {
  return useMemo(() => {
    const code = getLocales()[0]?.currencyCode ?? null;
    if (!code || !currencies) return null;
    return currencies.some((currency) => currency.code === code) ? code : null;
  }, [currencies]);
}
