// places-resolve, tested against the spec 05 Edge Functions Definition of done.
// Google is always a fake; global fetch throws and the run has no --allow-net.
import assert from 'node:assert/strict';
import { createGoogleClient } from '../_shared/google.ts';
import type { QuotaResult } from '../_shared/rateLimit.ts';
import { createHandler, NoBusinessError, type ResolvedPlace } from '../places-resolve/handler.ts';
import {
  ANON_KEY_JWT,
  blockNetwork,
  errorCode,
  fakeGetUser,
  fakeGoogleFetch,
  fakeQuota,
  hangUntilAborted,
  makeRequest,
  SESSION_TOKEN,
  TEST_API_KEY,
  UPSTREAM_SECRET_TEXT,
  upstreamError,
  USER_ID,
} from './helpers.ts';

const network = blockNetwork();

const PLACE_ID = 'ChIJpTvG15DL1IkRd8S0KlBVNTI';
const ATTACKER_ID = '99999999-9999-4999-8999-999999999999';
const OWNER_VIEW = { id: 'b1', type: 'restaurant', location: { formatted_address: '1 King St W, Toronto, ON' } };

function placeDetails(overrides: Record<string, unknown> = {}) {
  return {
    id: PLACE_ID,
    formattedAddress: '1 King St W, Toronto, ON M5H 1A1, Canada',
    location: { latitude: 43.6487, longitude: -79.3774 },
    ...overrides,
  };
}

type SetupOptions = {
  quotaResult?: QuotaResult;
  details?: () => Response | Promise<Response>;
  // Google never answers; the client gives up after `timeoutMs`.
  hang?: boolean;
  timeoutMs?: number;
  withoutKey?: boolean;
  noBusiness?: boolean;
};

function setup({
  quotaResult = 'ok',
  details = () => Response.json(placeDetails()),
  hang = false,
  timeoutMs = 5000,
  withoutKey = false,
  noBusiness = false,
}: SetupOptions = {}) {
  const apiKey = withoutKey ? undefined : TEST_API_KEY;
  const google = fakeGoogleFetch((_, signal) => (hang ? hangUntilAborted(signal) : details()));
  const quota = fakeQuota(quotaResult);
  const saved: [string, ResolvedPlace][] = [];
  const handler = createHandler({
    getUser: fakeGetUser().fn,
    consumeQuota: quota.fn,
    google: createGoogleClient({ apiKey, fetch: google.fn, timeoutMs }),
    setLocation: (ownerId, place) => {
      saved.push([ownerId, place]);
      return noBusiness ? Promise.reject(new NoBusinessError()) : Promise.resolve(OWNER_VIEW);
    },
  });
  return { handler, google, quota, saved };
}

const validBody = { placeId: PLACE_ID, sessionToken: SESSION_TOKEN };

// ── Auth: missing, anon-key or invalid token → 401, Google not called ─────────
for (const [name, token] of [
  ['a missing token', null],
  ['an anon-key token', ANON_KEY_JWT],
  ['an invalid token', 'not-a-real-jwt'],
] as const) {
  Deno.test(`resolve: ${name} gets 401 and neither Google nor the database is called`, async () => {
    const { handler, google, quota, saved } = setup();
    const res = await handler(makeRequest(validBody, { token }));
    assert.equal(res.status, 401);
    assert.equal(await errorCode(res), 'unauthorized');
    assert.equal(google.requests.length, 0);
    assert.equal(quota.calls.length, 0);
    assert.equal(saved.length, 0);
  });
}

// ── Input validation → 400, Google not called ────────────────────────────────
for (const [name, body] of [
  ['a placeId with a slash', { placeId: '../places/x', sessionToken: SESSION_TOKEN }],
  ['a placeId with a space', { placeId: 'ChIJ abc', sessionToken: SESSION_TOKEN }],
  ['a placeId with a query string', { placeId: 'ChIJabc?fields=*', sessionToken: SESSION_TOKEN }],
  ['an empty placeId', { placeId: '', sessionToken: SESSION_TOKEN }],
  ['a placeId over 300 chars', { placeId: 'a'.repeat(301), sessionToken: SESSION_TOKEN }],
  ['a non-uuid session token', { placeId: PLACE_ID, sessionToken: 'session-1' }],
  ['a missing placeId', { sessionToken: SESSION_TOKEN }],
] as const) {
  Deno.test(`resolve: ${name} gets 400 with no Google call`, async () => {
    const { handler, google, saved } = setup();
    const res = await handler(makeRequest(body));
    assert.equal(res.status, 400);
    assert.equal(await errorCode(res), 'invalid_input');
    assert.equal(google.requests.length, 0);
    assert.equal(saved.length, 0);
  });
}

// ── Rate limit → 429, Google not called ──────────────────────────────────────
Deno.test('resolve: when the quota is used up the response is 429 with no Google call', async () => {
  const { handler, google, quota, saved } = setup({ quotaResult: 'rate_limited' });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 429);
  assert.equal(await errorCode(res), 'rate_limited');
  assert.equal(google.requests.length, 0);
  assert.equal(saved.length, 0);
  assert.deepEqual(quota.calls, [[USER_ID, 'resolve']]);
});

// ── Eligibility (Decision 19) → 403 / 404, Google not called ─────────────────
for (const [name, quotaResult, status] of [
  ['a user without a username gets 403 profile_incomplete', 'profile_incomplete', 403],
  ['a user without a business gets 404 no_business', 'no_business', 404],
] as const) {
  Deno.test(`resolve: ${name} with no Google call and nothing saved`, async () => {
    const { handler, google, quota, saved } = setup({ quotaResult });
    const res = await handler(makeRequest(validBody));
    assert.equal(res.status, status);
    assert.equal(await errorCode(res), quotaResult);
    assert.equal(google.requests.length, 0);
    assert.equal(saved.length, 0);
    assert.deepEqual(quota.calls, [[USER_ID, 'resolve']]);
  });
}

// ── Request shape: method and body size ──────────────────────────────────────
Deno.test('resolve: a GET gets 405 with no quota or Google call', async () => {
  const { handler, google, quota } = setup();
  const res = await handler(makeRequest(null, { method: 'GET' }));
  assert.equal(res.status, 405);
  assert.equal(await errorCode(res), 'method_not_allowed');
  assert.equal(quota.calls.length, 0);
  assert.equal(google.requests.length, 0);
});

Deno.test('resolve: a body over 4 KB gets 400 with no quota or Google call', async () => {
  const { handler, google, quota } = setup();
  const rawBody = JSON.stringify({ ...validBody, padding: 'x'.repeat(5000) });
  const res = await handler(makeRequest(null, { rawBody }));
  assert.equal(res.status, 400);
  assert.equal(await errorCode(res), 'invalid_input');
  assert.equal(quota.calls.length, 0);
  assert.equal(google.requests.length, 0);
});

// ── Google request: field mask and session token ─────────────────────────────
Deno.test('resolve: sends the field mask id,formattedAddress,location and the session token', async () => {
  const { handler, google } = setup();
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 200);
  assert.equal(google.requests.length, 1);
  const [req] = google.requests;
  assert.equal(req.method, 'GET');
  assert.equal(req.url.origin + req.url.pathname, `https://places.googleapis.com/v1/places/${PLACE_ID}`);
  assert.equal(req.url.searchParams.get('sessionToken'), SESSION_TOKEN);
  assert.equal(req.url.searchParams.get('languageCode'), 'en');
  assert.equal(req.headers.get('X-Goog-FieldMask'), 'id,formattedAddress,location');
  assert.equal(req.headers.get('X-Goog-Api-Key'), TEST_API_KEY);
});

// ── Owner is the verified user, never the body ───────────────────────────────
Deno.test('resolve: saves the location for the verified user even when the body names another owner', async () => {
  const { handler, saved } = setup();
  const res = await handler(
    makeRequest({
      ...validBody,
      owner_id: ATTACKER_ID,
      userId: ATTACKER_ID,
      p_owner_id: ATTACKER_ID,
      lat: 0,
      lng: 0,
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(saved.length, 1);
  const [ownerId, place] = saved[0];
  assert.equal(ownerId, USER_ID);
  assert.deepEqual(place, {
    placeId: PLACE_ID,
    formattedAddress: '1 King St W, Toronto, ON M5H 1A1, Canada',
    lat: 43.6487,
    lng: -79.3774,
  });
});

Deno.test('resolve: returns the owner view from set_business_location', async () => {
  const { handler } = setup();
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), OWNER_VIEW);
});

// ── Not a place → 422 ────────────────────────────────────────────────────────
for (const [name, details] of [
  ['a missing location', placeDetails({ location: undefined })],
  ['a missing formattedAddress', placeDetails({ formattedAddress: undefined })],
  ['a formattedAddress over 200 chars', placeDetails({ formattedAddress: 'a'.repeat(201) })],
  ['a returned place id with a slash', placeDetails({ id: 'ChIJ/../x' })],
] as const) {
  Deno.test(`resolve: ${name} gets 422 and nothing is saved`, async () => {
    const { handler, saved } = setup({ details: () => Response.json(details) });
    const res = await handler(makeRequest(validBody));
    assert.equal(res.status, 422);
    assert.equal(await errorCode(res), 'not_a_place');
    assert.equal(saved.length, 0);
  });
}

// ── No business → 404 ────────────────────────────────────────────────────────
Deno.test('resolve: a user without a business gets 404 no_business', async () => {
  const { handler } = setup({ noBusiness: true });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 404);
  assert.equal(await errorCode(res), 'no_business');
});

// ── Google errors and timeouts → 502, nothing upstream leaks ─────────────────
Deno.test('resolve: a Google error gets 502 with no upstream text and no key in the body', async () => {
  const { handler, saved } = setup({ details: () => upstreamError() });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: { code: 'upstream_error' } });
  assert.equal(text.includes(UPSTREAM_SECRET_TEXT), false);
  assert.equal(text.includes(TEST_API_KEY), false);
  assert.equal(saved.length, 0);
});

Deno.test('resolve: a Google response of an unexpected shape gets 502 and nothing is saved', async () => {
  const { handler, saved } = setup({ details: () => Response.json({ id: 12345 }) });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 502);
  assert.equal(await errorCode(res), 'upstream_error');
  assert.equal(saved.length, 0);
});

Deno.test('resolve: a Google timeout gets 502', async () => {
  const { handler, saved } = setup({ hang: true, timeoutMs: 20 });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 502);
  assert.equal(await errorCode(res), 'upstream_error');
  assert.equal(saved.length, 0);
});

// ── Missing PLACES_API_KEY: no crash, 500 only when Google is needed ─────────
Deno.test('resolve: without PLACES_API_KEY, unauthenticated calls still get 401', async () => {
  const { handler } = setup({ withoutKey: true });
  const res = await handler(makeRequest(validBody, { token: null }));
  assert.equal(res.status, 401);
});

Deno.test('resolve: without PLACES_API_KEY, a valid call gets 500 and nothing is saved', async () => {
  const { handler, google, saved } = setup({ withoutKey: true });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 500);
  assert.equal(google.requests.length, 0);
  assert.equal(saved.length, 0);
});

// ── No network ───────────────────────────────────────────────────────────────
Deno.test('resolve: global fetch is stubbed to throw', () => {
  assert.equal(network.isInstalled(), true);
  assert.throws(() => network.probe());
});

// Kept last in the file so it sees every test above.
Deno.test('resolve: no test reached the real fetch (only the fake Google fetch was used)', () => {
  assert.equal(network.unexpectedCalls(), 0);
});
