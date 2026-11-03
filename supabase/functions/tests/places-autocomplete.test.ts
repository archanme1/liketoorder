// places-autocomplete, tested against the spec 05 Edge Functions Definition of done.
// Google is always a fake; global fetch throws and the run has no --allow-net.
import assert from 'node:assert/strict';
import { createGoogleClient } from '../_shared/google.ts';
import { createHandler } from '../places-autocomplete/handler.ts';
import {
  ANON_KEY_JWT,
  blockNetwork,
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

function predictions(n: number) {
  return {
    suggestions: Array.from({ length: n }, (_, i) => ({
      placePrediction: {
        placeId: `place_${i}`,
        text: { text: `${i} King St W, Toronto, ON, Canada` },
        structuredFormat: {
          mainText: { text: `${i} King St W` },
          secondaryText: { text: 'Toronto, ON, Canada' },
        },
      },
    })),
  };
}

function setup({ allowQuota = true, withoutKey = false } = {}) {
  const google = fakeGoogleFetch(() => Response.json(predictions(3)));
  const getUser = fakeGetUser();
  const quota = fakeQuota(allowQuota);
  const handler = createHandler({
    getUser: getUser.fn,
    consumeQuota: quota.fn,
    google: createGoogleClient({ apiKey: withoutKey ? undefined : TEST_API_KEY, fetch: google.fn }),
  });
  return { handler, google, getUser, quota };
}

const validBody = { input: '123 King St', sessionToken: SESSION_TOKEN };

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

// ── Auth: missing, anon-key or invalid token → 401, Google not called ─────────
for (const [name, token] of [
  ['a missing token', null],
  ['an anon-key token', ANON_KEY_JWT],
  ['an invalid token', 'not-a-real-jwt'],
] as const) {
  Deno.test(`autocomplete: ${name} gets 401 and Google is not called`, async () => {
    const { handler, google, quota } = setup();
    const res = await handler(makeRequest(validBody, { token }));
    assert.equal(res.status, 401);
    assert.equal(await errorCode(res), 'unauthorized');
    assert.equal(google.requests.length, 0);
    assert.equal(quota.calls.length, 0);
  });
}

// ── Input validation → 400, Google not called ────────────────────────────────
for (const [name, body] of [
  ['input under 3 chars (after trimming)', { input: '  ab  ', sessionToken: SESSION_TOKEN }],
  ['input over 120 chars', { input: 'a'.repeat(121), sessionToken: SESSION_TOKEN }],
  ['input with a control character', { input: '123 King\u0007 St', sessionToken: SESSION_TOKEN }],
  ['input with a newline inside', { input: '123 King\nSt', sessionToken: SESSION_TOKEN }],
  ['a non-uuid session token', { input: '123 King St', sessionToken: 'session-1' }],
  ['a missing input', { sessionToken: SESSION_TOKEN }],
  ['a non-string input', { input: 12345, sessionToken: SESSION_TOKEN }],
] as const) {
  Deno.test(`autocomplete: ${name} gets 400 with no Google call`, async () => {
    const { handler, google } = setup();
    const res = await handler(makeRequest(body));
    assert.equal(res.status, 400);
    assert.equal(await errorCode(res), 'invalid_input');
    assert.equal(google.requests.length, 0);
  });
}

Deno.test('autocomplete: a body that is not JSON gets 400 with no Google call', async () => {
  const { handler, google } = setup();
  const res = await handler(makeRequest(null, { rawBody: '{not json' }));
  assert.equal(res.status, 400);
  assert.equal(google.requests.length, 0);
});

Deno.test('autocomplete: 3 and 120 character inputs are accepted', async () => {
  const { handler } = setup();
  for (const input of ['abc', 'a'.repeat(120)]) {
    const res = await handler(makeRequest({ input, sessionToken: SESSION_TOKEN }));
    assert.equal(res.status, 200, `length ${input.length}`);
  }
});

// ── Rate limit → 429, Google not called ──────────────────────────────────────
Deno.test('autocomplete: when the quota is used up the response is 429 with no Google call', async () => {
  const { handler, google, quota } = setup({ allowQuota: false });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 429);
  assert.equal(await errorCode(res), 'rate_limited');
  assert.equal(google.requests.length, 0);
  assert.deepEqual(quota.calls, [[USER_ID, 'autocomplete']]);
});

// ── Google request: key header and session token ─────────────────────────────
Deno.test('autocomplete: sends the API key header and the session token to Places autocomplete', async () => {
  const { handler, google } = setup();
  const res = await handler(makeRequest({ input: '  123 King St  ', sessionToken: SESSION_TOKEN }));
  assert.equal(res.status, 200);
  assert.equal(google.requests.length, 1);
  const [req] = google.requests;
  assert.equal(req.method, 'POST');
  assert.equal(req.url.href, 'https://places.googleapis.com/v1/places:autocomplete');
  assert.equal(req.headers.get('X-Goog-Api-Key'), TEST_API_KEY);
  const sent = JSON.parse(req.body ?? '{}');
  assert.equal(sent.sessionToken, SESSION_TOKEN);
  assert.equal(sent.input, '123 King St');
  assert.equal(sent.languageCode, 'en');
  assert.equal('includedRegionCodes' in sent, false, 'no region restriction (Decision 4)');
});

// ── Output: at most 5 suggestions, mapped ────────────────────────────────────
Deno.test('autocomplete: maps at most 5 suggestions to placeId, primaryText, secondaryText', async () => {
  const google = fakeGoogleFetch(() => Response.json(predictions(8)));
  const handler = createHandler({
    getUser: fakeGetUser().fn,
    consumeQuota: fakeQuota().fn,
    google: createGoogleClient({ apiKey: TEST_API_KEY, fetch: google.fn }),
  });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 200);
  const { suggestions } = (await res.json()) as { suggestions: unknown[] };
  assert.equal(suggestions.length, 5);
  assert.deepEqual(suggestions[0], {
    placeId: 'place_0',
    primaryText: '0 King St W',
    secondaryText: 'Toronto, ON, Canada',
  });
});

// ── Google errors and timeouts → 502, nothing upstream leaks ─────────────────
Deno.test('autocomplete: a Google error gets 502 with no upstream text and no key in the body', async () => {
  const google = fakeGoogleFetch(() => upstreamError());
  const handler = createHandler({
    getUser: fakeGetUser().fn,
    consumeQuota: fakeQuota().fn,
    google: createGoogleClient({ apiKey: TEST_API_KEY, fetch: google.fn }),
  });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: { code: 'upstream_error' } });
  assert.equal(text.includes(UPSTREAM_SECRET_TEXT), false);
  assert.equal(text.includes(TEST_API_KEY), false);
});

Deno.test('autocomplete: a Google timeout gets 502', async () => {
  const google = fakeGoogleFetch((_, signal) => hangUntilAborted(signal));
  const handler = createHandler({
    getUser: fakeGetUser().fn,
    consumeQuota: fakeQuota().fn,
    google: createGoogleClient({ apiKey: TEST_API_KEY, fetch: google.fn, timeoutMs: 20 }),
  });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 502);
  assert.equal(await errorCode(res), 'upstream_error');
});

// ── Missing PLACES_API_KEY: no crash, 500 only when Google is needed ─────────
Deno.test('autocomplete: without PLACES_API_KEY, unauthenticated calls still get 401', async () => {
  const { handler } = setup({ withoutKey: true });
  const res = await handler(makeRequest(validBody, { token: null }));
  assert.equal(res.status, 401);
});

Deno.test('autocomplete: without PLACES_API_KEY, a valid call gets 500 and Google is not called', async () => {
  const { handler, google } = setup({ withoutKey: true });
  const res = await handler(makeRequest(validBody));
  assert.equal(res.status, 500);
  assert.equal(await errorCode(res), 'internal_error');
  assert.equal(google.requests.length, 0);
});

// ── No network ───────────────────────────────────────────────────────────────
Deno.test('autocomplete: global fetch is stubbed to throw', () => {
  assert.throws(() => fetch('https://places.googleapis.com/v1/places:autocomplete'));
});

Deno.test('autocomplete: no test reached the real fetch (only the fake Google fetch was used)', () => {
  // The previous test calls the stub on purpose; nothing else may have.
  assert.equal(network.calls(), 1);
});
