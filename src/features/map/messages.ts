import type { MapErrorCode } from './api';

export const RATE_LIMITED_MESSAGE = 'Try again in a moment';

/** `things` is what the tab lists, e.g. "restaurants" (the default) or "homemade cooks". */
export function mapErrorMessage(code: MapErrorCode, things = 'restaurants'): string {
  switch (code) {
    case 'network':
      return 'No connection. Check your internet and try again.';
    case 'invalid_bounds':
      return "That part of the map couldn't be loaded. Try moving the map.";
    case 'rate_limited':
      return RATE_LIMITED_MESSAGE;
    default:
      return `We couldn't load ${things}. Try again.`;
  }
}
