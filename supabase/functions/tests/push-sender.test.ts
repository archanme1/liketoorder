// push-sender, tested against the spec 12 Edge Function rules. Expo is always a fake fetch behind
// the real Expo client, the database is a fake RPC behind the real rpc.ts, global fetch throws, and
// the run has no --allow-net. Tokens are obviously fake (ExponentPushToken[test-0001]).
import assert from 'node:assert/strict';
import { createExpoClient } from '../_shared/expoPush.ts';
import { withLogging } from '../_shared/http.ts';
import { pushText } from '../_shared/pushText.ts';
import { BATCH_SIZE, createHandler, MAX_ROUNDS } from '../push-sender/handler.ts';
import { createDatabase } from '../push-sender/rpc.ts';
import { blockNetwork, fakeGoogleFetch, type RecordedRequest } from './helpers.ts';

const network = blockNetwork();

const CRON_SECRET = 'push-cron-secret-must-not-leak';
const ACCESS_TOKEN = 'expo-access-token-must-not-leak';
const TOKEN_A = 'ExponentPushToken[test-0001]';
const TOKEN_B = 'ExponentPushToken[test-0002]';
const TOKEN_ID_A = '0b5c1d0e-0000-4000-8000-00000000000a';
const TOKEN_ID_B = '0b5c1d0e-0000-4000-8000-00000000000b';
const REQ_1 = '5f0e0c1a-0000-4000-8000-000000000001';
const REQ_2 = '5f0e0c1a-0000-4000-8000-000000000002';
const USER_ID = '9a9a9a9a-0000-4000-8000-0000000000aa';

// Request fields that must never reach Expo, the database results or a log line.
const PRIVATE = {
  note: 'NOTE-MUST-NOT-LEAK please knock twice',
  order_text: 'ORDER-MUST-NOT-LEAK two dumplings',
  address: 'ADDRESS-MUST-NOT-LEAK 12 Hidden Lane',
  email: 'email-must-not-leak@example.test',
  phone: '+1 555 0100 PHONE',
  customer_name: 'CUSTOMER-NAME-MUST-NOT-LEAK',
  customer_id: USER_ID,
};

type DbMessage = Record<string, unknown>;

// A message as claim_push_batch returns it, plus private fields a wrong query might add.
function dbMessage(n: number, over: Partial<DbMessage> = {}): DbMessage {
  return {
    outbox_ids: [n],
    event: 'accepted',
    kind: 'pickup',
    request_id: REQ_1,
    side: 'sent',
    business_name: 'Pasta Place',
    count: 1,
    tokens: [{ id: TOKEN_ID_A, token: TOKEN_A }],
    ...PRIVATE,
    ...over,
  };
}

type Ticket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };

type SetupOptions = {
  // Each claim returns the next array; afterwards [].
  claims?: DbMessage[][];
  // Answers one send request (the parsed messages); default: every message gets an ok ticket.
  send?: (messages: Record<string, unknown>[], n: number) => Response | Promise<Response>;
  receiptIds?: string[];
  receipts?: (ids: string[]) => Response | Promise<Response>;
  cronSecret?: string | null; // null = not configured
  accessToken?: string;
  rpcError?: string; // an RPC that answers with an error
};

function okTickets(messages: unknown[], prefix = 'ticket'): Response {
  return Response.json({ data: messages.map((_, i) => ({ status: 'ok', id: `${prefix}-${i}` })) });
}

function setup({
  claims = [[dbMessage(1)]],
  send = (messages) => okTickets(messages),
  receiptIds = [],
  receipts = () => Response.json({ data: {} }),
  cronSecret = CRON_SECRET,
  accessToken,
  rpcError,
}: SetupOptions = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const sends: Record<string, unknown>[][] = [];
  let claimIndex = 0;
  const expoFetch = fakeGoogleFetch((req: RecordedRequest) => {
    const body = JSON.parse(req.body ?? 'null');
    if (req.url.pathname.endsWith('/push/send')) {
      sends.push(body);
      return send(body, sends.length);
    }
    return receipts(body.ids);
  });
  const database = createDatabase((fn, args) => {
    rpcCalls.push({ fn, args });
    if (rpcError === fn) return Promise.resolve({ data: null, error: { message: PRIVATE.note } });
    if (fn === 'claim_push_batch') return Promise.resolve({ data: claims[claimIndex++] ?? [], error: null });
    if (fn === 'claim_push_receipts') return Promise.resolve({ data: receiptIds, error: null });
    return Promise.resolve({ data: null, error: null });
  });
  const handler = createHandler({
    cronSecret: cronSecret ?? undefined,
    claimBatch: database.claimBatch,
    recordResults: database.recordResults,
    claimReceipts: database.claimReceipts,
    recordReceipts: database.recordReceipts,
    expo: createExpoClient({ fetch: expoFetch.fn, accessToken }),
  });
  const recorded = () => rpcCalls.filter((c) => c.fn === 'record_push_results').flatMap((c) => c.args.p_results as Record<string, unknown>[]);
  return { handler, rpcCalls, sends, requests: expoFetch.requests, recorded };
}

function post(secret: string | null = CRON_SECRET, method = 'POST'): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (secret !== null) headers.set('x-cron-secret', secret);
  return new Request('http://localhost/push-sender', { method, headers, body: method === 'GET' ? undefined : '{}' });
}

async function run(s: ReturnType<typeof setup>) {
  const res = await s.handler(post());
  return { res, body: await res.json() };
}

// -- Network guard -----------------------------------------------------------------
Deno.test('the real network is blocked in these tests', () => {
  assert.ok(network.isInstalled());
  assert.throws(() => network.probe());
});

// -- Secret --------------------------------------------------------------------------
Deno.test('no x-cron-secret: 401 with no body, nothing claimed or sent', async () => {
  const s = setup();
  const res = await s.handler(post(null));
  assert.equal(res.status, 401);
  assert.equal(await res.text(), '');
  assert.equal(s.rpcCalls.length, 0);
  assert.equal(s.requests.length, 0);
});

Deno.test('a wrong x-cron-secret: 401 with no body', async () => {
  const s = setup();
  const res = await s.handler(post('wrong-secret'));
  assert.equal(res.status, 401);
  assert.equal(await res.text(), '');
  assert.equal(s.rpcCalls.length, 0);
});

Deno.test('PUSH_SENDER_SECRET not set: 500 not_configured, nothing claimed', async () => {
  const s = setup({ cronSecret: null });
  const res = await s.handler(post());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: { code: 'not_configured' } });
  assert.equal(s.rpcCalls.length, 0);
});

Deno.test('a GET is 405', async () => {
  const res = await setup().handler(post(CRON_SECRET, 'GET'));
  assert.equal(res.status, 405);
  await res.body?.cancel();
});

// -- RPC names -------------------------------------------------------------------------
Deno.test('the database is called with the exact function and argument names', async () => {
  const s = setup({ receiptIds: ['ticket-a'] });
  await run(s);
  assert.deepEqual(s.rpcCalls.map((c) => [c.fn, Object.keys(c.args)]), [
    ['claim_push_batch', ['p_limit']],
    ['record_push_results', ['p_results']],
    ['claim_push_receipts', ['p_limit']],
  ]);
  assert.equal(s.rpcCalls[0].args.p_limit, BATCH_SIZE);
  assert.equal(s.rpcCalls[2].args.p_limit, 1000);
});

// -- Payload ---------------------------------------------------------------------------
Deno.test('payload: exactly to, title, body, sound, channelId, priority, data; no badge; data exactly v, kind, id, side', async () => {
  const s = setup({
    claims: [[
      dbMessage(1),
      dbMessage(2, { event: 'new_request', kind: 'table', request_id: REQ_2, side: 'received', business_name: null }),
    ]],
  });
  const { body } = await run(s);
  assert.deepEqual(body, { sent: 2, skipped: 0, retried: 0, failed: 0, receipts: 0 });
  const [customer, owner] = s.sends[0];
  for (const m of [customer, owner]) {
    assert.deepEqual(Object.keys(m).sort(), ['body', 'channelId', 'data', 'priority', 'sound', 'title', 'to']);
    assert.ok(!('badge' in m));
    assert.deepEqual(Object.keys(m.data as object).sort(), ['id', 'kind', 'side', 'v']);
    assert.equal(m.sound, 'default');
    assert.equal(m.channelId, 'requests');
    assert.equal(m.priority, 'high');
    assert.equal(m.to, TOKEN_A);
  }
  assert.deepEqual(customer.data, { v: 1, kind: 'pickup', id: REQ_1, side: 'sent' });
  assert.deepEqual([customer.title, customer.body], ['Request accepted', 'Pasta Place accepted your pickup request.']);
  assert.deepEqual(owner.data, { v: 1, kind: 'table', id: REQ_2, side: 'received' });
  assert.deepEqual([owner.title, owner.body], ['New table request', 'Open LikeToOrder to answer it.']);
});

Deno.test('payload: no user id anywhere in what is sent', async () => {
  const s = setup();
  await run(s);
  assert.ok(!JSON.stringify(s.sends).includes(USER_ID));
});

Deno.test('a collapsed new-request push: the collapsed text, with the newest request kind and id in data', async () => {
  const s = setup({
    claims: [[dbMessage(7, {
      outbox_ids: [7, 5, 3], event: 'new_request', kind: 'table', request_id: REQ_2, side: 'received', business_name: null, count: 3,
    })]],
  });
  await run(s);
  const [m] = s.sends[0];
  assert.deepEqual([m.title, m.body], ['New requests', 'You have 3 new requests waiting.']);
  assert.deepEqual(m.data, { v: 1, kind: 'table', id: REQ_2, side: 'received' });
  assert.deepEqual(s.recorded()[0].outbox_ids, [7, 5, 3]);
});

Deno.test('a collapsed cancel push: "Requests cancelled", with the newest request kind and id in data', async () => {
  const s = setup({
    claims: [[dbMessage(9, {
      outbox_ids: [9, 8], event: 'cancelled', kind: 'pickup', request_id: REQ_1, side: 'received', business_name: null, count: 2,
    })]],
  });
  await run(s);
  const [m] = s.sends[0];
  assert.deepEqual([m.title, m.body], ['Requests cancelled', '2 requests were cancelled.']);
  assert.deepEqual(m.data, { v: 1, kind: 'pickup', id: REQ_1, side: 'received' });
});

Deno.test('a single cancel keeps the singular text', async () => {
  const s = setup({ claims: [[dbMessage(4, { event: 'cancelled', kind: 'table', side: 'received', business_name: null })]] });
  await run(s);
  assert.deepEqual([s.sends[0][0].title, s.sends[0][0].body], ['Request cancelled', 'A customer cancelled a table request.']);
});

Deno.test('the place name is trimmed and cut to 40 characters in the body', async () => {
  const s = setup({ claims: [[dbMessage(1, { event: 'declined', business_name: '   ' + 'L'.repeat(50) + '  ' })]] });
  await run(s);
  assert.equal(s.sends[0][0].body, `${'L'.repeat(40)} declined your pickup request.`);
});

Deno.test('privacy: note, order text, address, email, phone, customer name and id never reach Expo or the results', async () => {
  const events = ['new_request', 'cancelled', 'arrived', 'accepted', 'declined', 'expired'];
  const s = setup({
    claims: [events.flatMap((event, i) => [
      dbMessage(10 + i, { event, side: ['accepted', 'declined', 'expired'].includes(event) ? 'sent' : 'received' }),
      dbMessage(20 + i, { event, count: 4, kind: 'table' }),
    ])],
  });
  await run(s);
  const sent = JSON.stringify(s.sends);
  const results = JSON.stringify(s.rpcCalls);
  for (const secret of Object.values(PRIVATE)) {
    assert.ok(!sent.includes(secret), `Expo must not receive ${secret}`);
    assert.ok(!results.includes(secret), `the database must not be sent ${secret}`);
  }
});

// -- Chunking and the bounded run ---------------------------------------------------------
Deno.test('chunking: at most 100 messages per request to Expo', async () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    dbMessage(i + 1, { tokens: [{ id: TOKEN_ID_A, token: TOKEN_A }, { id: TOKEN_ID_B, token: TOKEN_B }] })
  );
  const s = setup({ claims: [many] });
  const { body } = await run(s);
  assert.deepEqual(s.sends.map((b) => b.length), [100, 20]);
  assert.equal(body.sent, 60);
});

Deno.test('the run is bounded: at most 3 claims of 100, then one receipts round', async () => {
  const full = (round: number) => Array.from({ length: BATCH_SIZE }, (_, i) => dbMessage(round * 1000 + i + 1));
  const s = setup({ claims: [full(1), full(2), full(3), full(4), full(5)] });
  const { body } = await run(s);
  assert.equal(s.rpcCalls.filter((c) => c.fn === 'claim_push_batch').length, MAX_ROUNDS);
  assert.equal(s.rpcCalls.filter((c) => c.fn === 'claim_push_receipts').length, 1);
  assert.equal(body.sent, MAX_ROUNDS * BATCH_SIZE);
});

Deno.test('a claim with fewer than 100 messages ends the sending rounds', async () => {
  const s = setup({ claims: [[dbMessage(1)], [dbMessage(2)]] });
  await run(s);
  assert.equal(s.rpcCalls.filter((c) => c.fn === 'claim_push_batch').length, 1);
});

Deno.test('an empty claim sends nothing and records nothing', async () => {
  const s = setup({ claims: [] });
  const { body } = await run(s);
  assert.equal(s.sends.length, 0);
  assert.equal(s.rpcCalls.filter((c) => c.fn === 'record_push_results').length, 0);
  assert.deepEqual(body, { sent: 0, skipped: 0, retried: 0, failed: 0, receipts: 0 });
});

// -- Retry classification ------------------------------------------------------------------
async function outcomeFor(send: SetupOptions['send']) {
  const s = setup({ send });
  const { body } = await run(s);
  return { result: s.recorded()[0], body };
}

const ticketError = (code: string): Ticket => ({ status: 'error', message: `${TOKEN_A} failed`, details: { error: code } });

Deno.test('a network error is retried', async () => {
  const { result, body } = await outcomeFor(() => {
    throw new TypeError(`connect failed for ${TOKEN_A}`);
  });
  assert.equal(result.outcome, 'retry');
  assert.equal(body.retried, 1);
});

Deno.test('an Expo 5xx and a 429 are retried', async () => {
  for (const status of [500, 502, 503, 429]) {
    const { result } = await outcomeFor(() => new Response(`internal ${TOKEN_A}`, { status }));
    assert.equal(result.outcome, 'retry', `HTTP ${status}`);
  }
});

Deno.test('an Expo 4xx (other than 429) fails with no retry', async () => {
  const { result } = await outcomeFor(() => Response.json({ errors: [{ code: 'VALIDATION_ERROR' }] }, { status: 400 }));
  assert.equal(result.outcome, 'failed');
});

Deno.test('MessageRateExceeded is retried', async () => {
  const { result } = await outcomeFor(() => Response.json({ data: [ticketError('MessageRateExceeded')] }));
  assert.equal(result.outcome, 'retry');
});

Deno.test('MessageTooBig and InvalidCredentials fail with no retry', async () => {
  for (const code of ['MessageTooBig', 'InvalidCredentials']) {
    const { result, body } = await outcomeFor(() => Response.json({ data: [ticketError(code)] }));
    assert.equal(result.outcome, 'failed', code);
    assert.equal(body.failed, 1);
  }
});

Deno.test('DeviceNotRegistered drops that token', async () => {
  const { result } = await outcomeFor(() => Response.json({ data: [ticketError('DeviceNotRegistered')] }));
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(result.dead_token_ids, [TOKEN_ID_A]);
});

Deno.test('one good token is enough: sent, with its ticket, and the dead token still dropped', async () => {
  const s = setup({
    claims: [[dbMessage(1, { tokens: [{ id: TOKEN_ID_A, token: TOKEN_A }, { id: TOKEN_ID_B, token: TOKEN_B }] })]],
    send: () => Response.json({ data: [{ status: 'ok', id: 'ticket-ok' }, ticketError('DeviceNotRegistered')] }),
  });
  await run(s);
  assert.deepEqual(s.recorded()[0], {
    outbox_ids: [1],
    outcome: 'sent',
    tickets: [{ ticket_id: 'ticket-ok', token_id: TOKEN_ID_A }],
    dead_token_ids: [TOKEN_ID_B],
  });
});

Deno.test('an answer with the wrong number of tickets is retried', async () => {
  const { result } = await outcomeFor(() => Response.json({ data: [] }));
  assert.equal(result.outcome, 'retry');
});

Deno.test('a message the database returned in an unknown shape is recorded as failed and counted as skipped', async () => {
  const s = setup({ claims: [[dbMessage(1), { outbox_ids: [2], event: 'party', note: PRIVATE.note }]] });
  const { body } = await run(s);
  assert.deepEqual(body, { sent: 1, skipped: 1, retried: 0, failed: 0, receipts: 0 });
  assert.equal(s.sends[0].length, 1);
  assert.deepEqual(s.recorded()[1], { outbox_ids: [2], outcome: 'failed', tickets: [], dead_token_ids: [] });
});

Deno.test('the Expo access token is sent as a bearer header only when it is set', async () => {
  const withToken = setup({ accessToken: ACCESS_TOKEN });
  await run(withToken);
  assert.equal(withToken.requests[0].headers.get('Authorization'), `Bearer ${ACCESS_TOKEN}`);
  const without = setup();
  await run(without);
  assert.equal(without.requests[0].headers.get('Authorization'), null);
});

// -- Receipts --------------------------------------------------------------------------
Deno.test('receipts: ok and errors recorded, missing ones left for later', async () => {
  const s = setup({
    claims: [],
    receiptIds: ['ticket-1', 'ticket-2', 'ticket-3'],
    receipts: () => Response.json({ data: {
      'ticket-1': { status: 'ok' },
      'ticket-2': { status: 'error', message: `${TOKEN_A} is gone`, details: { error: 'DeviceNotRegistered' } },
    } }),
  });
  const { body } = await run(s);
  assert.deepEqual(JSON.parse(s.requests[0].body ?? ''), { ids: ['ticket-1', 'ticket-2', 'ticket-3'] });
  assert.deepEqual(s.rpcCalls.find((c) => c.fn === 'record_push_receipts')?.args.p_results, [
    { ticket_id: 'ticket-1', status: 'ok', error: null },
    { ticket_id: 'ticket-2', status: 'error', error: 'DeviceNotRegistered' },
  ]);
  assert.equal(body.receipts, 2);
});

Deno.test('a failed receipts request records nothing and the run still answers 200', async () => {
  const s = setup({ claims: [], receiptIds: ['ticket-1'], receipts: () => new Response('down', { status: 503 }) });
  const { res, body } = await run(s);
  assert.equal(res.status, 200);
  assert.equal(body.receipts, 0);
  assert.equal(s.rpcCalls.filter((c) => c.fn === 'record_push_receipts').length, 0);
});

// -- Thrown errors -------------------------------------------------------------------------
Deno.test('a database error is a 500 internal_error with no detail', async () => {
  const s = setup({ rpcError: 'claim_push_batch' });
  const res = await withLogging('push-sender', s.handler)(post());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: { code: 'internal_error' } });
});

// -- Logs (Decision 20) ---------------------------------------------------------------------
Deno.test('logs and errors never contain a token, a title or body, a note or any request text', async () => {
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      lines.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message} ${a.stack}` : String(a))).join(' '));
    };
  }
  const titles = new Set<string>();
  try {
    const twoTokens = { tokens: [{ id: TOKEN_ID_A, token: TOKEN_A }, { id: TOKEN_ID_B, token: TOKEN_B }] };
    const claims = [[
      dbMessage(1, twoTokens),
      dbMessage(2, { ...twoTokens, event: 'new_request', side: 'received', business_name: null, count: 3 }),
      dbMessage(3, { ...twoTokens, event: 'cancelled', side: 'received', business_name: null, count: 2 }),
      { outbox_ids: [4], event: 'party', note: PRIVATE.note, tokens: [{ id: TOKEN_ID_A, token: TOKEN_A }] },
    ]];
    for (const m of claims[0]) {
      if (typeof m.event === 'string' && m.event !== 'party') {
        const t = pushText({ event: m.event as 'accepted', kind: 'pickup', count: Number(m.count), businessName: 'Pasta Place' });
        titles.add(t.title).add(t.body);
      }
    }
    const scenarios: SetupOptions[] = [
      // Per-token errors, each echoing the token in Expo's message.
      { claims, send: (ms) => Response.json({ data: ms.map((_, i) => ticketError(['DeviceNotRegistered', 'MessageTooBig', 'InvalidCredentials', 'MessageRateExceeded'][i % 4])) }) },
      // A network error whose message holds the token and the title.
      { claims, send: () => { throw new Error(`socket closed ${TOKEN_A} Request accepted ${PRIVATE.note}`); } },
      // A 5xx whose body holds the token.
      { claims, send: () => new Response(`upstream ${TOKEN_A} ${TOKEN_B}`, { status: 500 }) },
      // Receipt errors.
      { claims: [], receiptIds: ['ticket-1'], receipts: () => Response.json({ data: { 'ticket-1': ticketError('DeviceNotRegistered') } }) },
      // A database error thrown through the logging wrapper.
      { rpcError: 'claim_push_batch' },
      { claims, rpcError: 'record_push_results' },
      // The access token is configured.
      { claims, accessToken: ACCESS_TOKEN },
    ];
    for (const opts of scenarios) {
      const s = setup(opts);
      const res = await withLogging('push-sender', s.handler)(post());
      await res.body?.cancel();
    }
  } finally {
    methods.forEach((m, i) => (console[m] = saved[i]));
  }
  // The capture worked and the codes are there.
  assert.ok(lines.some((l) => l.includes('DeviceNotRegistered')), 'an Expo error code is logged');
  assert.ok(lines.some((l) => l.includes('network_error')), 'the network error is logged as a code');
  assert.ok(lines.some((l) => l.includes('"status":500')), 'the thrown database error is logged as a status');
  const forbidden = [TOKEN_A, TOKEN_B, 'test-0001', 'test-0002', ACCESS_TOKEN, CRON_SECRET, ...titles, ...Object.values(PRIVATE)];
  for (const line of lines) {
    for (const f of forbidden) assert.ok(!line.includes(f), `a log line contains ${f}: ${line}`);
  }
});
