import { z } from 'zod';
import { type GetUser, requireUser } from '../_shared/auth.ts';
import { type GoogleClient, MissingApiKeyError, UpstreamError } from '../_shared/google.ts';
import { errorResponse, type Handler, json, readJsonBody } from '../_shared/http.ts';
import type { ConsumeQuota } from '../_shared/rateLimit.ts';

const PLACE_ID = /^[A-Za-z0-9_-]{1,300}$/;
const MAX_ADDRESS_LENGTH = 200; // business_locations.formatted_address check

// Extra keys (owner_id, userId, lat, …) are stripped: the owner is always the verified user.
const Body = z.object({
  placeId: z.string().regex(PLACE_ID),
  sessionToken: z.uuid(),
});

export type ResolvedPlace = { placeId: string; formattedAddress: string; lat: number; lng: number };

// The business owner has no business yet (set_business_location raised no_business).
export class NoBusinessError extends Error {}

// Saves the location for this owner and returns the owner view. Throws NoBusinessError.
export type SetLocation = (ownerId: string, place: ResolvedPlace) => Promise<unknown>;

export type Deps = {
  getUser: GetUser;
  consumeQuota: ConsumeQuota;
  google: Pick<GoogleClient, 'getPlace'>;
  setLocation: SetLocation;
};

// POST { placeId, sessionToken } → the owner view from set_business_location.
export function createHandler(deps: Deps): Handler {
  return async (req) => {
    if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed');

    const user = await requireUser(req, deps.getUser);
    if (!user) return errorResponse(401, 'unauthorized');

    const body = Body.safeParse(await readJsonBody(req));
    if (!body.success) return errorResponse(400, 'invalid_input');

    if (!(await deps.consumeQuota(user.id, 'resolve'))) {
      return errorResponse(429, 'rate_limited');
    }

    let place;
    try {
      place = await deps.google.getPlace(body.data.placeId, body.data.sessionToken);
    } catch (e) {
      if (e instanceof UpstreamError) return errorResponse(502, 'upstream_error');
      if (e instanceof MissingApiKeyError) return errorResponse(500, 'internal_error');
      throw e;
    }

    const formattedAddress = place.formattedAddress?.trim() ?? '';
    if (
      !place.location ||
      !formattedAddress ||
      formattedAddress.length > MAX_ADDRESS_LENGTH ||
      !PLACE_ID.test(place.id)
    ) {
      return errorResponse(422, 'not_a_place');
    }

    try {
      const ownerView = await deps.setLocation(user.id, {
        placeId: place.id,
        formattedAddress,
        lat: place.location.latitude,
        lng: place.location.longitude,
      });
      return json(200, ownerView);
    } catch (e) {
      if (e instanceof NoBusinessError) return errorResponse(404, 'no_business');
      throw e;
    }
  };
}
