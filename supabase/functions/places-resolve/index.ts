// Wires real dependencies into the pure handler. Tests use handler.ts with fakes instead.
import { createClient } from '@supabase/supabase-js';
import { createGetUser } from '../_shared/auth.ts';
import { createGoogleClient } from '../_shared/google.ts';
import { withLogging } from '../_shared/http.ts';
import { createConsumeQuota } from '../_shared/rateLimit.ts';
import { createHandler, NoBusinessError, type SetLocation } from './handler.ts';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const url = requireEnv('SUPABASE_URL');
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(url, requireEnv('SUPABASE_ANON_KEY'), clientOptions);
// Service role stays inside this function: set_business_location is not executable by app users.
const admin = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), clientOptions);

// ownerId is always the verified user's id (handler.ts), never a value from the request body.
const setLocation: SetLocation = async (ownerId, place) => {
  const { data, error } = await admin.rpc('set_business_location', {
    p_owner_id: ownerId,
    p_place_id: place.placeId,
    p_formatted_address: place.formattedAddress,
    p_lat: place.lat,
    p_lng: place.lng,
  });
  if (error) {
    if (error.message.includes('no_business')) throw new NoBusinessError();
    throw new Error('set_business_location failed');
  }
  return data;
};

Deno.serve(
  withLogging(
    'places-resolve',
    createHandler({
      getUser: createGetUser(anon),
      consumeQuota: createConsumeQuota(admin),
      // Optional at startup: a missing key gives 500 only when Google is actually called.
      google: createGoogleClient({ apiKey: Deno.env.get('PLACES_API_KEY'), fetch }),
      setLocation,
    }),
  ),
);
