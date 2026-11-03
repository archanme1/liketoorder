// Thin client for Places API (New). `fetch` is injected so tests never reach Google.
import { z } from 'zod';

const BASE_URL = 'https://places.googleapis.com/v1';
// Keeps Place Details in the Essentials SKU and ends the autocomplete billing session.
const DETAILS_FIELD_MASK = 'id,formattedAddress,location';
const MAX_SUGGESTIONS = 5;

// Google failed, timed out or returned something unexpected. Its body is never surfaced.
export class UpstreamError extends Error {}
// PLACES_API_KEY is not set. Raised only when a Google call is actually needed.
export class MissingApiKeyError extends Error {}

export type PlaceSuggestion = { placeId: string; primaryText: string; secondaryText: string };
export type PlaceDetails = {
  id: string;
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
};

export interface GoogleClient {
  autocomplete(input: string, sessionToken: string): Promise<PlaceSuggestion[]>;
  getPlace(placeId: string, sessionToken: string): Promise<PlaceDetails>;
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

type Options = {
  apiKey: string | undefined;
  fetch: typeof fetch;
  timeoutMs?: number;
};

export function createGoogleClient({ apiKey, fetch: fetchImpl, timeoutMs = 5000 }: Options): GoogleClient {
  async function call(url: string, init: RequestInit): Promise<unknown> {
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
          await res.body?.cancel();
          throw new UpstreamError();
        }
        return await res.json();
      })();
      request.catch(() => {}); // after a timeout the aborted fetch rejects with nobody listening
      return await Promise.race([request, timeout]);
    } catch {
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
  };
}
