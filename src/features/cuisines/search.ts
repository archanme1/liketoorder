import type { Cuisine } from './schema';

/** Lower-cased with accents removed, so "cote" matches "Côte d'Ivoire". */
export function foldForSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Cuisines whose name contains the query, ignoring case and accents. An empty query keeps all. */
export function filterCuisines(cuisines: readonly Cuisine[], query: string): Cuisine[] {
  const folded = foldForSearch(query);
  if (!folded) return [...cuisines];
  return cuisines.filter((cuisine) => foldForSearch(cuisine.name).includes(folded));
}
