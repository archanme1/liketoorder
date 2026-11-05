// places-refresh, tested against the spec 07 Edge Function rules. Google is always a fake;
// global fetch throws and the run has no --allow-net.
import assert from 'node:assert/strict';
import { createGoogleClient, type PlaceLocation } from '../_shared/google.ts';
import { withLogging } from '../_shared/http.ts';
import { type ClaimedRow, createHandler, type Outcome } from '../places-refresh/handler.ts';
import {
  blockNetwork,
  fakeGoogleFetch,
  hangUntilAborted,
  TEST_API_KEY,
  UPSTREAM_SECRET_TEXT,
  upstreamError,
} from './helpers.ts';

const network = blockNetwork();

const CRON_SECRET = 'cron-secret-must-not-leak';

function row(n: number): ClaimedRow {
  return { businessId: `00000000-0000-4000-8000-00000000000${n}`, placeId: `ChIJplace${n}` };
}

function placeBody(placeId: string, latitude = 43.6487, longitude = -79.3774) {
  return { id: placeId, location: { latitude, longitude } };
}

function notFound(): Response {
  return Response.json({ error: { code: 404, status: 'NOT_FOUND', message: UPSTREAM_SECRET_TEXT } }, { status: 404 });
}

type Applied = { businessId: string; outcome: Outcome; location?: PlaceLocation };

type SetupOptions = {
  rows?: ClaimedRow[];
  // Answers a Google request for this place ID.
  respond?: (placeId: string, signal: AbortSignal | undefined) => Response | Promise<Response>;
  cronSecret?: string | null; // null = not configured
  withoutKey?: boolean;
  timeoutMs?: number;
  failApplyFor?: string[];
};

function setup({
  rows = [row(1)],
  respond = (placeId) => Response.json(placeBody(placeId)),
  cronSecret = CRON_SECRET,
  withoutKey = false,
  timeoutMs = 5000,
  failApplyFor = [],
}: SetupOptions = {}) {
  const events: string[] = [];
  const claims: number[] = [];
  const applied: Applied[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const google = fakeGoogleFetch(async (req, signal) => {
    const placeId = decodeURIComponent(req.url.pathname.split('/').pop() ?? '');
    events.push(`google:${placeId}`);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      return await respond(placeId, signal);
    } finally {
      inFlight--;
    }
  });
  const handler = createHandler({
    cronSecret: cronSecret ?? undefined,
    googleConfigured: !withoutKey,
    claimBatch: (size) => {
      claims.push(size);
      return Promise.resolve(rows);
    },
    applyOutcome: (businessId, outcome, location) => {
      events.push(`apply:${businessId}`);
      if (failApplyFor.includes(businessId)) return Promise.reject(new Error('db unavailable'));
      applied.push({ businessId, outcome, location });
      return Promise.resolve();
    },
    google: createGoogleClient({ apiKey: withoutKey ? undefined : TEST_API_KEY, fetch: google.fn, timeoutMs }),
  });
  return { handler, google, events, claims, applied, maxInFlight: () => maxInFlight };
}

function cronRequest(secret: string | null = CRON_SECRET, method = 'POST'): Request {
  const headers = new Headers();
  if (secret !== null) headers.set('x-cron-secret', secret);
  return new Request('http://localhost/function', { method, headers });
}

async function counts(res: Response) {
  return (await res.json()) as { claimed: number; ok: number; not_found: number; failed: number };
}

// Resolves to done=false when `promise` has not settled within `ms` (so a stuck run fails the
// test instead of hanging it).
async function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<{ done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ done: true as const, value })), guard]);
  } finally {
    clearTimeout(timer);
  }
}

async function captureLogs(run: () => Promise<void>): Promise<unknown[][]> {
  const lines: unknown[][] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args);
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

// ── Secret ────────────────────────────────────────────────────────────────────
for (const [name, secret] of [
  ['a missing secret header', null],
  ['a wrong secret', 'not-the-secret'],
  ['an empty secret', ''],
  ['a secret that is a prefix of the real one', CRON_SECRET.slice(0, 10)],
  ['a secret with extra characters', `${CRON_SECRET}x`],
] as const) {
  Deno.test(`refresh: ${name} gets 401 with no body, and neither the database nor Google is called`, async () => {
    const { handler, google, claims, events } = setup();
    const res = await handler(cronRequest(secret));
    assert.equal(res.status, 401);
    assert.equal(await res.text(), '');
    assert.equal(claims.length, 0);
    assert.equal(google.requests.length, 0);
    assert.deepEqual(events, []);
  });
}

Deno.test('refresh: the right secret is accepted', async () => {
  const { handler, claims } = setup({ rows: [] });
  const res = await handler(cronRequest());
  assert.equal(res.status, 200);
  assert.deepEqual(claims, [25]);
});

Deno.test('refresh: without REFRESH_CRON_SECRET the answer is 500 not_configured and no work is done', async () => {
  for (const cronSecret of ['', null]) {
    const { handler, claims, google } = setup({ cronSecret });
    // Even a request that sends a header (here: an empty one, matching an empty secret).
    const res = await handler(cronRequest(''));
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: { code: 'not_configured' } });
    assert.equal(claims.length, 0);
    assert.equal(google.requests.length, 0);
  }
});

Deno.test('refresh: without a Google key the answer is 500 not_configured and nothing is claimed', async () => {
  const { handler, claims, google } = setup({ withoutKey: true });
  const res = await handler(cronRequest());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: { code: 'not_configured' } });
  assert.equal(claims.length, 0);
  assert.equal(google.requests.length, 0);
});

Deno.test('refresh: a GET gets 405 with no work', async () => {
  const { handler, claims } = setup();
  const res = await handler(cronRequest(CRON_SECRET, 'GET'));
  assert.equal(res.status, 405);
  assert.equal(claims.length, 0);
});

// ── Normal run ────────────────────────────────────────────────────────────────
Deno.test('refresh: a normal place is applied with its new coordinates and counted ok', async () => {
  const { handler, applied } = setup({
    rows: [row(1)],
    respond: (placeId) => Response.json(placeBody(placeId, 10.5, 20.25)),
  });
  const res = await handler(cronRequest());
  assert.equal(res.status, 200);
  assert.deepEqual(await counts(res), { claimed: 1, ok: 1, not_found: 0, failed: 0 });
  assert.deepEqual(applied, [
    { businessId: row(1).businessId, outcome: 'ok', location: { latitude: 10.5, longitude: 20.25 } },
  ]);
});

Deno.test('refresh: asks Google for id,location only, with the key, one GET per row and no session token', async () => {
  const { handler, google } = setup({ rows: [row(1), row(2)] });
  await handler(cronRequest());
  assert.equal(google.requests.length, 2);
  for (const [i, req] of google.requests.entries()) {
    assert.equal(req.method, 'GET');
    assert.equal(req.url.origin + req.url.pathname, `https://places.googleapis.com/v1/places/${row(i + 1).placeId}`);
    assert.equal(req.headers.get('X-Goog-FieldMask'), 'id,location');
    assert.equal(req.headers.get('X-Goog-Api-Key'), TEST_API_KEY);
    assert.equal(req.url.search, '');
  }
});

Deno.test('refresh: with nothing due (or the daily quota used up) the claim is empty, so Google is not called', async () => {
  const { handler, google, applied } = setup({ rows: [] });
  const res = await handler(cronRequest());
  assert.equal(res.status, 200);
  assert.deepEqual(await counts(res), { claimed: 0, ok: 0, not_found: 0, failed: 0 });
  assert.equal(google.requests.length, 0);
  assert.deepEqual(applied, []);
});

// ── Google outcomes ───────────────────────────────────────────────────────────
Deno.test('refresh: NOT_FOUND (404 with status NOT_FOUND) is applied as not_found, with no coordinates', async () => {
  const { handler, applied } = setup({ respond: () => notFound() });
  const res = await handler(cronRequest());
  assert.deepEqual(await counts(res), { claimed: 1, ok: 0, not_found: 1, failed: 0 });
  assert.deepEqual(applied, [{ businessId: row(1).businessId, outcome: 'not_found', location: undefined }]);
});

for (const [name, response] of [
  ['a 404 with an empty body', () => new Response(null, { status: 404 })],
  ['a 404 with an HTML body', () => new Response('<html>Not Found</html>', { status: 404 })],
  ['a 404 with another status', () => Response.json({ error: { status: 'INVALID_ARGUMENT' } }, { status: 404 })],
  ['a 400 whose body says NOT_FOUND', () => Response.json({ error: { status: 'NOT_FOUND' } }, { status: 400 })],
  ['a 500', () => upstreamError()],
  ['a 403', () => Response.json({ error: { status: 'PERMISSION_DENIED' } }, { status: 403 })],
  ['an answer with no location', () => Response.json({ id: 'ChIJplace1' })],
  ['an answer with a latitude out of range', () => Response.json(placeBody('ChIJplace1', 123, 10))],
  ['an answer that is not JSON', () => new Response('nope', { status: 200 })],
] as const) {
  Deno.test(`refresh: ${name} is counted failed, changes nothing, and is not treated as not found`, async () => {
    const { handler, applied } = setup({ respond: response });
    const res = await handler(cronRequest());
    assert.equal(res.status, 200);
    assert.deepEqual(await counts(res), { claimed: 1, ok: 0, not_found: 0, failed: 1 });
    assert.deepEqual(applied, []);
  });
}

Deno.test('refresh: a Google call that never answers is cut off, counted failed, and the next rows still run', async () => {
  const { handler, applied } = setup({
    rows: [row(1), row(2), row(3)],
    timeoutMs: 30,
    respond: (placeId, signal) => (placeId === row(1).placeId ? hangUntilAborted(signal) : Response.json(placeBody(placeId))),
  });
  const run = await settlesWithin(handler(cronRequest()), 2000);
  assert.equal(run.done, true, 'the run did not finish: the per-call timeout is missing');
  if (!run.done) return;
  assert.deepEqual(await counts(run.value), { claimed: 3, ok: 2, not_found: 0, failed: 1 });
  assert.deepEqual(applied.map((a) => a.businessId), [row(2).businessId, row(3).businessId]);
});

// ── Sequential, saved as they finish ──────────────────────────────────────────
Deno.test('refresh: rows run one at a time and each result is saved before the next Google call', async () => {
  const { handler, events, maxInFlight } = setup({
    rows: [row(1), row(2), row(3)],
    respond: async (placeId) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json(placeBody(placeId));
    },
  });
  await handler(cronRequest());
  assert.equal(maxInFlight(), 1);
  assert.deepEqual(events, [
    `google:${row(1).placeId}`,
    `apply:${row(1).businessId}`,
    `google:${row(2).placeId}`,
    `apply:${row(2).businessId}`,
    `google:${row(3).placeId}`,
    `apply:${row(3).businessId}`,
  ]);
});

Deno.test('refresh: when a run is cut off partway, the rows finished so far are already saved', async () => {
  let release: (() => void) | undefined;
  const { handler, applied } = setup({
    rows: [row(1), row(2), row(3)],
    // The third row never answers (until the test lets go).
    respond: (placeId) =>
      placeId === row(3).placeId
        ? new Promise<Response>((resolve) => {
          release = () => resolve(Response.json(placeBody(placeId)));
        })
        : Response.json(placeBody(placeId)),
  });
  const run = handler(cronRequest());
  const deadline = Date.now() + 2000;
  while (release === undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(applied.map((a) => a.businessId), [row(1).businessId, row(2).businessId]);
  release?.();
  await run;
});

Deno.test('refresh: a failed save counts one row failed and the others are still refreshed', async () => {
  const { handler, applied } = setup({ rows: [row(1), row(2), row(3)], failApplyFor: [row(1).businessId] });
  const res = await handler(cronRequest());
  assert.deepEqual(await counts(res), { claimed: 3, ok: 2, not_found: 0, failed: 1 });
  assert.deepEqual(applied.map((a) => a.businessId), [row(2).businessId, row(3).businessId]);
});

Deno.test('refresh: a mix of outcomes is counted per outcome', async () => {
  const { handler } = setup({
    rows: [row(1), row(2), row(3), row(4)],
    respond: (placeId) =>
      placeId === row(2).placeId ? notFound() : placeId === row(3).placeId ? upstreamError() : Response.json(placeBody(placeId)),
  });
  const res = await handler(cronRequest());
  assert.deepEqual(await counts(res), { claimed: 4, ok: 2, not_found: 1, failed: 1 });
});

// ── Nothing sensitive in the response or the logs ─────────────────────────────
Deno.test('refresh: the response is counts only and the logs hold only fn, status and ms', async () => {
  const { handler } = setup({
    rows: [row(1), row(2)],
    respond: (placeId) => (placeId === row(1).placeId ? upstreamError() : notFound()),
  });
  let res: Response | undefined;
  const lines = await captureLogs(async () => {
    res = await withLogging('places-refresh', handler)(cronRequest());
  });
  const text = await res?.text();
  assert.deepEqual(Object.keys(JSON.parse(text ?? '{}')).sort(), ['claimed', 'failed', 'not_found', 'ok']);
  const everything = `${text}${JSON.stringify(lines)}`;
  for (const secret of [TEST_API_KEY, CRON_SECRET, UPSTREAM_SECRET_TEXT, row(1).placeId, row(1).businessId]) {
    assert.equal(everything.includes(secret), false, `leaked: ${secret}`);
  }
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(String(lines[0][0]))).sort(), ['fn', 'ms', 'status']);
});

Deno.test('refresh: a 401 is logged without the secret that was sent', async () => {
  const { handler } = setup();
  const lines = await captureLogs(async () => {
    await withLogging('places-refresh', handler)(cronRequest('wrong-secret-must-not-leak'));
  });
  assert.equal(JSON.stringify(lines).includes('wrong-secret-must-not-leak'), false);
  assert.equal(JSON.parse(String(lines[0][0])).status, 401);
});

Deno.test('refresh: if the claim itself fails the answer is 500 internal_error with no detail', async () => {
  const handler = createHandler({
    cronSecret: CRON_SECRET,
    googleConfigured: true,
    claimBatch: () => Promise.reject(new Error('connection to db.example password=hunter2 failed')),
    applyOutcome: () => Promise.resolve(),
    google: createGoogleClient({ apiKey: TEST_API_KEY, fetch: fakeGoogleFetch(() => Response.json({})).fn }),
  });
  let res: Response | undefined;
  const lines = await captureLogs(async () => {
    res = await withLogging('places-refresh', handler)(cronRequest());
  });
  assert.equal(res?.status, 500);
  assert.deepEqual(await res?.json(), { error: { code: 'internal_error' } });
  assert.equal(JSON.stringify(lines).includes('hunter2'), false);
});

// ── No network ────────────────────────────────────────────────────────────────
// Kept last in the file so it sees every test above.
Deno.test('refresh: no test reached the real fetch (only the fake Google fetch was used)', () => {
  assert.equal(network.isInstalled(), true);
  assert.equal(network.unexpectedCalls(), 0);
});
