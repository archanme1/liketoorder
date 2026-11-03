import type { BusinessType, MyBusiness } from './schema';

export const TABLE_REQUESTS_LABEL = 'Accept table requests';
export const TABLE_REQUESTS_DESCRIPTION = 'Customers can ask to reserve a table.';

export function typeLabel(type: BusinessType): string {
  return type === 'restaurant' ? 'Restaurant' : 'Homemade';
}

export type ListingStatus = 'live' | 'hidden' | 'no_location';

/** Hidden wins over a missing address: seller mode off keeps the listing off the map either way. */
export function getListingStatus(
  business: Pick<MyBusiness, 'is_listed' | 'location'>,
): ListingStatus {
  if (!business.is_listed) return 'hidden';
  if (!business.location) return 'no_location';
  return 'live';
}

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  live: 'Live',
  hidden: 'Hidden — seller mode is off',
  no_location: 'Add your address to go live',
};
