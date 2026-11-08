import { useHomemadeDetails } from '@/features/map/hooks/useHomemadeDetails';
import { useRestaurantDetails } from '@/features/map/hooks/useRestaurantDetails';
import type { DetailsItem } from '@/features/map/schema';

export type RequestMenu = {
  id: string;
  name: string;
  type: 'restaurant' | 'homemade';
  currencyCode: string | null;
  items: readonly DetailsItem[];
};

export type RequestMenuState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void; retrying: boolean }
  | { status: 'unavailable' }
  | { status: 'ready'; menu: RequestMenu };

/**
 * The business behind a request form, from the same public details the map sheet reads (cached,
 * so a business opened from the sheet is already here). The form only knows the id, so the
 * restaurant lookup goes first and the homemade one only when that says "not a listed restaurant".
 * "Unavailable" is one answer for every cause, as on the sheet.
 */
export function useRequestMenu(businessId: string): RequestMenuState {
  const restaurant = useRestaurantDetails(businessId);
  const homemade = useHomemadeDetails(restaurant.data === null ? businessId : null);

  if (restaurant.isError) {
    return {
      status: 'error',
      retry: () => void restaurant.refetch(),
      retrying: restaurant.isFetching,
    };
  }
  if (restaurant.isPending) return { status: 'loading' };
  if (restaurant.data) {
    const { id, name, currency_code, items } = restaurant.data;
    return {
      status: 'ready',
      menu: { id, name, type: 'restaurant', currencyCode: currency_code, items },
    };
  }

  if (homemade.isError) {
    return { status: 'error', retry: () => void homemade.refetch(), retrying: homemade.isFetching };
  }
  if (homemade.isPending) return { status: 'loading' };
  if (homemade.data) {
    const { id, name, currency_code, items } = homemade.data;
    return {
      status: 'ready',
      menu: { id, name, type: 'homemade', currencyCode: currency_code, items },
    };
  }
  return { status: 'unavailable' };
}
