// Thin client for Places API (New). `fetch` is injected so tests never reach Google.
import { z } from 'zod';

const BASE_URL = 'https://places.googleapis.com/v1';
// Keeps Place Details in the Essentials SKU and ends the autocomplete billing session.
const DETAILS_FIELD_MASK = 'id,formattedAddress,location';
// The refresh job (spec 07) needs only the point; the same Essentials SKU.
const LOCATION_FIELD_MASK = 'id,location';
const MAX_SUGGESTIONS = 5;

// Google failed, timed out or returned something unexpected. Its body is never surfaced.
export class UpstreamError extends Error {}
// PLACES_API_KEY is not set. Raised only when a Google call is actually needed.
export class MissingApiKeyError extends Error {}
// Google answered 404 with status NOT_FOUND: the place ID is obsolete. A bare 404 is not enough,
// so a wrong URL or a proxy error can never hide a restaurant.
export class NotFoundError extends Error {}

export type PlaceSuggestion = { placeId: string; primaryText: string; secondaryText: string };
export type PlaceDetails = {
  id: string;
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
};

export type PlaceLocation = { latitude: number; longitude: number };

export interface GoogleClient {
  autocomplete(input: string, sessionToken: string): Promise<PlaceSuggestion[]>;
  getPlace(placeId: string, sessionToken: string): Promise<PlaceDetails>;
  // Throws NotFoundError for an obsolete place ID; every other failure, or an answer without a
  // usable point, is an UpstreamError.
  getPlaceLocation(placeId: string): Promise<PlaceLocation>;
}

const TextValue = z.object({ text: z.string() });
const AutocompleteResponse = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string(),
            text: TextValue.optional(),
            structuredFormat: z
              .object({ mainText: TextValue, secondaryText: TextValue.optional() })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
const DetailsResponse = z.object({
  id: z.string(),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
});

const NotFoundBody = z.object({ error: z.object({ status: z.literal('NOT_FOUND') }) });
const LocationResponse = z.object({
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional(),
});

type Options = {
  apiKey: string | undefined;
  fetch: typeof fetch;
  timeoutMs?: number;
};

export function createGoogleClient({ apiKey, fetch: fetchImpl, timeoutMs = 5000 }: Options): GoogleClient {
  async function call(
    url: string,
    init: RequestInit,
    { detectNotFound = false }: { detectNotFound?: boolean } = {},
  ): Promise<unknown> {
    if (!apiKey) throw new MissingApiKeyError();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new UpstreamError());
      }, timeoutMs);
    });
    try {
      const request = (async () => {
        const res = await fetchImpl(url, {
          ...init,
          headers: { ...init.headers, 'X-Goog-Api-Key': apiKey },
          signal: controller.signal,
        });
        if (!res.ok) {
          if (detectNotFound && res.status === 404) {
            const body = NotFoundBody.safeParse(await res.json().catch(() => undefined));
            if (body.success) throw new NotFoundError();
          }
          await res.body?.cancel();
          throw new UpstreamError();
        }
        return await res.json();
      })();
      request.catch(() => {}); // after a timeout the aborted fetch rejects with nobody listening
      return await Promise.race([request, timeout]);
    } catch (e) {
      if (e instanceof NotFoundError) throw e;
      throw new UpstreamError();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async autocomplete(input, sessionToken) {
      const body = await call(`${BASE_URL}/places:autocomplete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, sessionToken, languageCode: 'en' }),
      });
      const parsed = AutocompleteResponse.safeParse(body);
      if (!parsed.success) throw new UpstreamError();
      const suggestions: PlaceSuggestion[] = [];
      for (const { placePrediction: p } of parsed.data.suggestions ?? []) {
        if (!p) continue; // query predictions are not places
        const primaryText = p.structuredFormat?.mainText.text ?? p.text?.text ?? '';
        if (!primaryText) continue;
        suggestions.push({
          placeId: p.placeId,
          primaryText,
          secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
        });
        if (suggestions.length === MAX_SUGGESTIONS) break;
      }
      return suggestions;
    },

    async getPlace(placeId, sessionToken) {
      const query = new URLSearchParams({ sessionToken, languageCode: 'en' });
      const body = await call(`${BASE_URL}/places/${encodeURIComponent(placeId)}?${query}`, {
        method: 'GET',
        headers: { 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
      });
      const parsed = DetailsResponse.safeParse(body);
      if (!parsed.success) throw new UpstreamError();
      return parsed.data;
    },

    async getPlaceLocation(placeId) {
      const body = await call(
        `${BASE_URL}/places/${encodeURIComponent(placeId)}`,
        { method: 'GET', headers: { 'X-Goog-FieldMask': LOCATION_FIELD_MASK } },
        { detectNotFound: true },
      );
      const parsed = LocationResponse.safeParse(body);
      if (!parsed.success || !parsed.data.location) throw new UpstreamError();
      return parsed.data.location;
    },
  };
}
