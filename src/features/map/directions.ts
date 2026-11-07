/**
 * The Google Maps link for a restaurant: the documented "Maps URLs" search format, aimed at the
 * place by its Place ID. It opens the Google Maps app if installed, otherwise Google Maps in the
 * browser. By design it carries no coordinates, and it is never an Apple Maps or geo: link.
 * Built with encodeURIComponent (not URLSearchParams) so it is identical on every JS engine.
 */
export function buildDirectionsUrl(name: string, placeId: string): string {
  return (
    'https://www.google.com/maps/search/?api=1' +
    `&query=${encodeURIComponent(name)}` +
    `&query_place_id=${encodeURIComponent(placeId)}`
  );
}

export function directionsLabel(name: string): string {
  return `Directions to ${name} in Google Maps`;
}
