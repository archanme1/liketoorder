// _shared modules, tested against the spec 05 Edge Functions rules: only a token that resolves to
// a real user passes, the quota fails closed and refuses ineligible users (Decision 19), logging is
// status, function name and latency only, and bodies are capped at 4 KB.
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGetUser, requireUser } from '../_shared/auth.ts';
import { readJsonBody, withLogging } from '../_shared/http.ts';
import { createConsumeQuota } from '../_shared/rateLimit.ts';
import { blockNetwork, fakeGetUser, USER_ID, USER_JWT } from './helpers.ts';

const network = blockNetwork();

function requestWithAuth(authorization: string | null): Request {
  const headers = new Headers();
  if (authorization !== null) headers.set('Authorization', authorization);
  return new Request('http://localhost/function', { method: 'POST', headers });
}

// ── requireUser: Bearer parsing ──────────────────────────────────────────────
Deno.test('requireUser: a Bearer token for a real user passes, and the scheme is case-insensitive', async () => {
  for (const scheme of ['Bearer', 'bearer']) {
    const user = await requireUser(requestWithAuth(`${scheme} ${USER_JWT}`), fakeGetUser().fn);
    assert.deepEqual(user, { id: USER_ID }, scheme);
  }
});

for (const [name, header] of [
  ['no Authorization header', null],
  ['an empty Bearer token', 'Bearer '],
  ['a Bearer header with two tokens', `Bearer ${USER_JWT} extra`],
  ['a Basic scheme', `Basic ${USER_JWT}`],
  ['a bare token without a scheme', USER_JWT],
] as const) {
  Deno.test(`requireUser: ${name} is rejected without asking auth for a user`, async () => {
    const getUser = fakeGetUser();
    assert.equal(await requireUser(requestWithAuth(header), getUser.fn), null);
    assert.deepEqual(getUser.calls, []);
  });
}

Deno.test('requireUser: a user without an id is rejected', async () => {
  const user = await requireUser(requestWithAuth(`Bearer ${USER_JWT}`), () => Promise.resolve({ id: '' }));
  assert.equal(user, null);
});

// ── createGetUser: the anon key (no user) is rejected ────────────────────────
function fakeAuthClient(result: { data: { user: { id: string } | null }; error: unknown }) {
  const jwts: string[] = [];
  const client = {
    auth: {
      getUser: (jwt: string) => {
        jwts.push(jwt);
        return Promise.resolve(result);
      },
    },
  } as unknown as SupabaseClient;
  return { client, jwts };
}

Deno.test('createGetUser: a token for a real user resolves to that user id', async () => {
  const { client, jwts } = fakeAuthClient({ data: { user: { id: USER_ID } }, error: null });
  assert.deepEqual(await createGetUser(client)(USER_JWT), { id: USER_ID });
  assert.deepEqual(jwts, [USER_JWT]);
});

for (const [name, result] of [
  ['an auth error (invalid or expired token)', { data: { user: null }, error: { message: 'invalid JWT' } }],
  ['no user (the anon key)', { data: { user: null }, error: null }],
] as const) {
  Deno.test(`createGetUser: ${name} resolves to null`, async () => {
    const { client } = fakeAuthClient(result);
    assert.equal(await createGetUser(client)('some-jwt'), null);
  });
}

// ── createConsumeQuota: eligibility and fail closed ──────────────────────────
function fakeRpcClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: [string, unknown][] = [];
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push([fn, args]);
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test('createConsumeQuota: calls consume_places_quota with the user id and kind', async () => {
  const { client, calls } = fakeRpcClient({ data: true, error: null });
  assert.equal(await createConsumeQuota(client)(USER_ID, 'resolve'), 'ok');
  assert.deepEqual(calls, [['consume_places_quota', { p_user_id: USER_ID, p_kind: 'resolve' }]]);
});

for (const [name, data] of [['false', false], ['null', null], ['a non-boolean', 'true']] as const) {
  Deno.test(`createConsumeQuota: ${name} from the database is rate_limited`, async () => {
    const { client } = fakeRpcClient({ data, error: null });
    assert.equal(await createConsumeQuota(client)(USER_ID, 'autocomplete'), 'rate_limited');
  });
}

for (const code of ['profile_incomplete', 'no_business'] as const) {
  Deno.test(`createConsumeQuota: the database refusal ${code} is returned as ${code}`, async () => {
    const { client } = fakeRpcClient({ data: null, error: { message: code } });
    assert.equal(await createConsumeQuota(client)(USER_ID, 'resolve'), code);
  });
}

Deno.test('createConsumeQuota: any other database error throws (fails closed)', async () => {
  const { client } = fakeRpcClient({ data: null, error: { message: 'connection refused' } });
  await assert.rejects(() => createConsumeQuota(client)(USER_ID, 'autocomplete'));
});

// ── withLogging: status, function name and latency only ──────────────────────
async function captureLogs(run: () => Promise<void>): Promise<unknown[][]> {
  const lines: unknown[][] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args);
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

const SECRET_INPUT = '42 Secret Lane, my home';

Deno.test('withLogging: logs exactly fn, status and ms, and never the request body', async () => {
  let res: Response | undefined;
  const lines = await captureLogs(async () => {
    const handler = withLogging('places-test', () => Promise.resolve(new Response(null, { status: 201 })));
    res = await handler(new Request('http://localhost/function', { method: 'POST', body: SECRET_INPUT }));
  });
  assert.equal(res?.status, 201);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 1);
  const logged = JSON.parse(String(lines[0][0]));
  assert.deepEqual(Object.keys(logged).sort(), ['fn', 'ms', 'status']);
  assert.equal(logged.fn, 'places-test');
  assert.equal(logged.status, 201);
  assert.equal(typeof logged.ms, 'number');
  assert.equal(String(lines[0][0]).includes(SECRET_INPUT), false);
});

Deno.test('withLogging: a thrown error becomes 500 internal_error, and the error text is not logged', async () => {
  let res: Response | undefined;
  const lines = await captureLogs(async () => {
    const handler = withLogging('places-test', () => Promise.reject(new Error(SECRET_INPUT)));
    res = await handler(new Request('http://localhost/function', { method: 'POST' }));
  });
  assert.equal(res?.status, 500);
  assert.deepEqual(await res?.json(), { error: { code: 'internal_error' } });
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(String(lines[0][0]))).sort(), ['fn', 'ms', 'status']);
  assert.equal(JSON.stringify(lines).includes(SECRET_INPUT), false);
});

// ── readJsonBody: 4 KB cap ───────────────────────────────────────────────────
function postBody(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/function', { method: 'POST', body, headers });
}

Deno.test('readJsonBody: a body of exactly 4096 bytes is accepted', async () => {
  const filler = 'x'.repeat(4096 - JSON.stringify({ a: '' }).length);
  const body = JSON.stringify({ a: filler });
  assert.equal(new TextEncoder().encode(body).byteLength, 4096);
  assert.deepEqual(await readJsonBody(postBody(body)), { a: filler });
});

Deno.test('readJsonBody: a body over 4096 bytes is rejected', async () => {
  assert.equal(await readJsonBody(postBody(JSON.stringify({ a: 'x'.repeat(4096) }))), undefined);
});

Deno.test('readJsonBody: multi-byte characters count as bytes, not characters', async () => {
  // 1500 × "é" is 1500 characters but 3000 bytes; 2100 of them is over the cap.
  assert.notEqual(await readJsonBody(postBody(JSON.stringify({ a: 'é'.repeat(1500) }))), undefined);
  assert.equal(await readJsonBody(postBody(JSON.stringify({ a: 'é'.repeat(2100) }))), undefined);
});

Deno.test('readJsonBody: a declared Content-Length over 4096 is rejected without reading the body', async () => {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new TextEncoder().encode('{}'));
      controller.close();
    },
  });
  const req = postBody(stream, { 'Content-Length': '100000' });
  assert.equal(await readJsonBody(req), undefined);
  assert.equal(pulled, 0);
});

Deno.test('readJsonBody: a stream that passes 4096 bytes is rejected even with a small Content-Length', async () => {
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(1024).fill(0x20)); // spaces: still valid JSON whitespace
      if (chunks === 100) controller.close();
    },
  });
  const req = postBody(stream, { 'Content-Length': '2' });
  assert.equal(await readJsonBody(req), undefined);
  assert.ok(chunks < 100, `stopped reading early (read ${chunks} chunks)`);
});

Deno.test('readJsonBody: an empty body or non-JSON is rejected', async () => {
  assert.equal(await readJsonBody(postBody('')), undefined);
  assert.equal(await readJsonBody(postBody('{not json')), undefined);
});

// ── No network ───────────────────────────────────────────────────────────────
// Kept last in the file so it sees every test above.
Deno.test('shared: no test reached the real fetch', () => {
  assert.equal(network.isInstalled(), true);
  assert.equal(network.unexpectedCalls(), 0);
});
