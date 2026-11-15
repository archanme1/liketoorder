import { UNKNOWN_CUISINE } from '@/features/cuisines/components/CuisineLabel';

export const FOOD_LOG_BUCKET = 'food-logs';

/** The country name for spoken labels; the same words CuisineLabel uses while loading. */
export function cuisineName(cuisine: { data?: { name: string }; isPending: boolean }): string {
  return cuisine.data?.name ?? (cuisine.isPending ? 'Loading cuisine' : UNKNOWN_CUISINE);
}
