// stripe-webhook (spec 16b PR 2, gate D2). Events are signed inside the test with an obviously fake
// secret; Stripe is a fake fetch behind the real client; the database is a fake RPC behind the real
// rpc.ts; global fetch throws. Every console line and response body is collected and checked last.
import assert from 'node:assert/strict';
import { createStripeClient, STRIPE_VERSION } from '../_shared/stripe.ts';
import { createHandler, MAX_BODY_BYTES, PAID_AT_FLOOR } from '../stripe-webhook/handler.ts';
import { createDatabase, type Rpc } from '../stripe-webhook/rpc.ts';
import { blockNetwork, fakeFetch, type RecordedRequest } from './helpers.ts';
import {
  captureConsole,
  event,
  guardedTest,
  EVENT_ID,
  INVOICE_ID,
  NOW_MS,
  NOW_SECONDS,
  OWNER_EMAIL,
  paidInvoice,
  PAYMENT_ID,
  PAYMENT_INTENT_ID,
  signedRequest,
  STRIPE_KEY,
  WEBHOOK_SECRET,
} from './fixtures/stripeEvents.ts';

const network = blockNetwork();
const output = captureConsole();
const bodies: string[] = [];
const headersSent: string[] = [];
// Every test is leak-checked on its own (log lines and response bodies), whatever order or filter it
// runs with.
const FORBIDDEN = [EVENT_ID, INVOICE_ID, PAYMENT_INTENT_ID, PAYMENT_ID, OWNER_EMAIL, WEBHOOK_SECRET, STRIPE_KEY, 'whsec_', 'rk_', 'evt_', 'in_Fake', 'pi_', 'cus_', 'v1=', 'duplicate key', 'Key (', 'customer.created'];
const test = guardedTest(output, FORBIDDEN, bodies);

type RpcAnswer = { data: unknown; error: unknown };
type Options = {
  webhookSecret?: string | undefined;
  expectLivemode?: string | undefined;
  noStripe?: boolean;
  record?: (args: Record<string, unknown>, n: number) => RpcAnswer;
  mark?: () => RpcAnswer;
  stripe?: (req: RecordedRequest) => Response;
};

const REFUND_TARGET = { payment_id: PAYMENT_ID, payment_intent_id: PAYMENT_INTENT_ID };

function stripeDefault(req: RecordedRequest): Response {
  if (req.url.pathname === '/v1/invoice_payments') {
    return Response.json({ data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: PAYMENT_INTENT_ID } }] });
  }
  if (req.url.pathname === '/v1/refunds') return Response.json({ id: 're_FakeTest0001' });
  return Response.json({ error: { code: 'resource_missing' } }, { status: 404 });
}

function setup(o: Options = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  let records = 0;
  const rpc: Rpc = (fn, args) => {
    rpcCalls.push({ fn, args });
    if (fn === 'record_stripe_event') {
      return Promise.resolve(o.record?.(args, records++) ?? { data: { outcome: 'applied' }, error: null });
    }
    if (fn === 'mark_refund_requested') return Promise.resolve(o.mark?.() ?? { data: true, error: null });
    throw new Error(`unexpected rpc ${fn}`);
  };
  const fake = fakeFetch(o.stripe ?? stripeDefault);
  const handler = createHandler({
    webhookSecret: 'webhookSecret' in o ? o.webhookSecret : WEBHOOK_SECRET,
    expectLivemode: 'expectLivemode' in o ? o.expectLivemode : 'false',
    stripe: o.noStripe ? undefined : createStripeClient({ fetch: fake.fn, key: STRIPE_KEY }),
    db: createDatabase(rpc),
    now: () => NOW_MS,
  });
  const send = async (req: Request): Promise<Response> => {
    const sig = req.headers.get('Stripe-Signature');
    if (sig) headersSent.push(sig);
    const res = await handler(req);
    const text = await res.clone().text();
    bodies.push(text);
    return res;
  };
  return { send, rpcCalls, stripe: fake.requests };
}

async function post(o: Options, ev: unknown, sign: Parameters<typeof signedRequest>[1] = {}) {
  const s = setup(o);
  const res = await s.send(await signedRequest(JSON.stringify(ev), sign));
  return { ...s, res };
}

function recordArgs(calls: { fn: string; args: Record<string, unknown> }[]) {
  return calls.filter((c) => c.fn === 'record_stripe_event').map((c) => c.args);
}

const PAID = event('invoice.paid', paidInvoice());

// --- refusals before anything else --------------------------------------------------------------

test('webhook: a missing Stripe-Signature header is 400 with no database or Stripe call', async () => {
  const r = await post({}, PAID, { header: null });
  assert.equal(r.res.status, 400);
  assert.equal(await r.res.text(), '');
  assert.equal(r.rpcCalls.length, 0);
  assert.equal(r.stripe.length, 0);
});

test('webhook: a bad signature (other secret) is 400 with no database or Stripe call', async () => {
  const r = await post({}, PAID, { secret: 'whsec_test_fake_other' });
  assert.equal(r.res.status, 400);
  assert.equal(r.rpcCalls.length, 0);
  assert.equal(r.stripe.length, 0);
});

test('webhook: a timestamp 301 s old is 400 with no database or Stripe call', async () => {
  const r = await post({}, PAID, { t: NOW_SECONDS - 301 });
  assert.equal(r.res.status, 400);
  assert.equal(r.rpcCalls.length, 0);
  assert.equal(r.stripe.length, 0);
});

test('webhook: a timestamp 301 s in the future is 400 with no database or Stripe call', async () => {
  const r = await post({}, PAID, { t: NOW_SECONDS + 301 });
  assert.equal(r.res.status, 400);
  assert.equal(r.rpcCalls.length, 0);
  assert.equal(r.stripe.length, 0);
});

test('webhook: a body over 256 KB is 413 with no database or Stripe call', async () => {
  const s = setup();
  const big = 'x'.repeat(MAX_BODY_BYTES + 1);
  const res = await s.send(await signedRequest(big));
  assert.equal(res.status, 413);
  const declared = new Request('http://localhost/stripe-webhook', {
    method: 'POST',
    headers: { 'Content-Length': String(MAX_BODY_BYTES + 1), 'Stripe-Signature': 't=1,v1=' + 'a'.repeat(64) },
    body: '{}',
  });
  assert.equal((await s.send(declared)).status, 413);
  assert.equal(s.rpcCalls.length, 0);
  assert.equal(s.stripe.length, 0);
});

test('webhook: a signed body of exactly 256 KB is read and handled', async () => {
  const shell = JSON.stringify(event('customer.updated', { pad: '' }));
  const ev = JSON.stringify(event('customer.updated', { pad: 'p'.repeat(MAX_BODY_BYTES - shell.length) }));
  assert.equal(new TextEncoder().encode(ev).length, MAX_BODY_BYTES);
  const s = setup({ record: () => ({ data: { outcome: 'ignored' }, error: null }) });
  const res = await s.send(await signedRequest(ev));
  assert.equal(res.status, 200);
  assert.deepEqual(recordArgs(s.rpcCalls)[0].p_data, {});
});

test('webhook: not POST is 405; secret or livemode setting missing or invalid is 503; no calls', async () => {
  const s = setup();
  assert.equal((await s.send(new Request('http://localhost/x', { method: 'GET' }))).status, 405);
  for (const o of [{ webhookSecret: undefined }, { webhookSecret: '' }, { expectLivemode: undefined }, { expectLivemode: 'yes' }, { expectLivemode: 'FALSE' }]) {
    const r = await post(o, PAID);
    assert.equal(r.res.status, 503, JSON.stringify(o));
    assert.equal(r.rpcCalls.length, 0);
    assert.equal(r.stripe.length, 0);
  }
  assert.equal(s.rpcCalls.length, 0);
});

test('webhook: valid signature but not JSON, or not an event, is 400 with no calls', async () => {
  for (const body of ['not json', '{}', JSON.stringify({ ...PAID, id: 'nope' }), JSON.stringify({ ...PAID, livemode: 'false' })]) {
    const s = setup();
    const res = await s.send(await signedRequest(body));
    assert.equal(res.status, 400, body);
    assert.equal(s.rpcCalls.length, 0);
    assert.equal(s.stripe.length, 0);
  }
});

test('webhook: livemode different from STRIPE_EXPECT_LIVEMODE is 200 before any database or Stripe call', async () => {
  const live = await post({ expectLivemode: 'false' }, { ...PAID, livemode: true });
  assert.equal(live.res.status, 200);
  assert.equal(live.rpcCalls.length, 0);
  assert.equal(live.stripe.length, 0);
  const testMode = await post({ expectLivemode: 'true' }, PAID);
  assert.equal(testMode.res.status, 200);
  assert.equal(testMode.rpcCalls.length, 0);
  assert.equal(testMode.stripe.length, 0);
  const match = await post({ expectLivemode: 'true' }, { ...PAID, livemode: true });
  assert.equal(match.rpcCalls.length, 1);
  assert.equal(recordArgs(match.rpcCalls)[0].p_livemode, true);
});

// --- invoice.paid -------------------------------------------------------------------------------

test('webhook: a valid invoice.paid looks up the PaymentIntent and records the event', async () => {
  const r = await post({}, PAID);
  assert.equal(r.res.status, 200);
  assert.deepEqual(await r.res.json(), { received: true });
  assert.equal(r.stripe.length, 1);
  assert.equal(r.stripe[0].method, 'GET');
  assert.equal(r.stripe[0].url.href, `https://api.stripe.com/v1/invoice_payments?invoice=${INVOICE_ID}&status=paid`);
  assert.equal(r.stripe[0].headers.get('Stripe-Version'), STRIPE_VERSION);
  assert.deepEqual(r.rpcCalls, [{
    fn: 'record_stripe_event',
    args: {
      p_event_id: EVENT_ID,
      p_type: 'invoice.paid',
      p_livemode: false,
      p_data: {
        invoice_id: INVOICE_ID,
        payment_intent_id: PAYMENT_INTENT_ID,
        amount_paid: 2500,
        currency: 'cad',
        paid_at: NOW_SECONDS - 60,
      },
    },
  }]);
});

test('webhook: the amount and currency are passed exactly as Stripe sent them', async () => {
  const r = await post({}, event('invoice.paid', paidInvoice({ amount_paid: 1999, currency: 'usd' })));
  const data = recordArgs(r.rpcCalls)[0].p_data as Record<string, unknown>;
  assert.equal(data.amount_paid, 1999);
  assert.equal(data.currency, 'usd');
});

test('webhook: paid_at bounds (after 2020-01-01, at most now + 300 s, whole seconds)', async () => {
  const cases: [unknown, number][] = [
    [PAID_AT_FLOOR, 500],
    [PAID_AT_FLOOR + 1, 200],
    [NOW_SECONDS + 300, 200],
    [NOW_SECONDS + 301, 500],
    [NOW_MS, 500], // a milliseconds-sized value
    [NOW_SECONDS + 0.5, 500],
    [String(NOW_SECONDS), 500],
    [null, 500],
  ];
  for (const [paidAt, status] of cases) {
    const r = await post({}, event('invoice.paid', paidInvoice({ status_transitions: { paid_at: paidAt } })));
    assert.equal(r.res.status, status, String(paidAt));
    if (status === 500) {
      assert.equal(r.rpcCalls.length, 0, String(paidAt));
      assert.equal(r.stripe.length, 0, String(paidAt));
    } else {
      assert.equal(recordArgs(r.rpcCalls).length, 1, String(paidAt));
      assert.equal((recordArgs(r.rpcCalls)[0].p_data as Record<string, unknown>).paid_at, paidAt);
    }
  }
});

test('webhook: invoice.paid missing paid_at, currency or amount_paid is 500 with no calls', async () => {
  const noTransitions = paidInvoice();
  delete noTransitions.status_transitions;
  for (const inv of [noTransitions, paidInvoice({ currency: undefined }), paidInvoice({ amount_paid: undefined }), paidInvoice({ amount_paid: -1 }), paidInvoice({ currency: 'ca' }), paidInvoice({ id: 'x' })]) {
    const r = await post({}, event('invoice.paid', inv));
    assert.equal(r.res.status, 500);
    assert.equal(r.rpcCalls.length, 0);
    assert.equal(r.stripe.length, 0);
  }
});

test('webhook: a failed invoice-payments lookup is 500 with no database call', async () => {
  for (const respond of [
    () => Response.json({ error: { code: 'api_error' } }, { status: 500 }),
    () => Response.json({ unexpected: true }),
    () => new Response('<html>', { status: 200 }),
  ]) {
    const r = await post({ stripe: respond }, PAID);
    assert.equal(r.res.status, 500);
    assert.equal(r.rpcCalls.length, 0);
  }
});

test('webhook: no paid payment found passes payment_intent_id null (the database decides)', async () => {
  const r = await post({ stripe: () => Response.json({ data: [] }), record: () => ({ data: { outcome: 'mismatch' }, error: null }) }, PAID);
  assert.equal(r.res.status, 200);
  assert.equal((recordArgs(r.rpcCalls)[0].p_data as Record<string, unknown>).payment_intent_id, null);
});

test('webhook: invoice.paid with no Stripe key is 503 with no database call', async () => {
  const r = await post({ noStripe: true }, PAID);
  assert.equal(r.res.status, 503);
  assert.equal(r.rpcCalls.length, 0);
});

test('webhook: a database error or invalid_event_data is 500; a bad answer shape is 500', async () => {
  const leaky = { message: 'duplicate key value', details: `Key (invoice_id)=(${INVOICE_ID}) ${OWNER_EMAIL}` };
  for (const record of [
    () => ({ data: null, error: leaky }),
    () => ({ data: null, error: { message: 'invalid_event_data' } }),
    () => ({ data: { outcome: 'surprise' }, error: null }),
  ]) {
    const r = await post({ record }, PAID);
    assert.equal(r.res.status, 500);
    assert.equal(await r.res.text(), '');
  }
});

test('webhook: applied, duplicate without a target, ignored and mismatch are 200 with no refund', async () => {
  for (const outcome of ['applied', 'duplicate', 'ignored', 'mismatch']) {
    const r = await post({ record: () => ({ data: { outcome }, error: null }) }, PAID);
    assert.equal(r.res.status, 200, outcome);
    assert.equal(r.stripe.filter((q) => q.url.pathname === '/v1/refunds').length, 0);
    assert.equal(r.rpcCalls.filter((c) => c.fn === 'mark_refund_requested').length, 0);
  }
});

// --- refunds (D5, D12) ----------------------------------------------------------------------------

test('webhook: a refund target makes one refund call, then mark_refund_requested', async () => {
  const r = await post({ record: () => ({ data: { outcome: 'refund_requested', refund: REFUND_TARGET }, error: null }) }, PAID);
  assert.equal(r.res.status, 200);
  const refunds = r.stripe.filter((q) => q.url.pathname === '/v1/refunds');
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].method, 'POST');
  assert.equal(refunds[0].body, `payment_intent=${PAYMENT_INTENT_ID}&reason=duplicate`);
  assert.equal(refunds[0].headers.get('Idempotency-Key'), `refund-${PAYMENT_ID}`);
  assert.equal(refunds[0].headers.get('Stripe-Version'), STRIPE_VERSION);
  assert.deepEqual(r.rpcCalls.map((c) => c.fn), ['record_stripe_event', 'mark_refund_requested']);
  assert.deepEqual(r.rpcCalls[1].args, { p_payment_id: PAYMENT_ID });
});

test('webhook: a failed refund call is 500 and does not call mark_refund_requested', async () => {
  const r = await post({
    record: () => ({ data: { outcome: 'refund_requested', refund: REFUND_TARGET }, error: null }),
    stripe: (q) => q.url.pathname === '/v1/refunds'
      ? Response.json({ error: { code: 'api_error', message: `card of ${OWNER_EMAIL}`, key: STRIPE_KEY } }, { status: 500 })
      : stripeDefault(q),
  }, PAID);
  assert.equal(r.res.status, 500);
  assert.equal(await r.res.text(), '');
  assert.equal(r.rpcCalls.filter((c) => c.fn === 'mark_refund_requested').length, 0);
});

test('webhook: a retried duplicate with a refund target repeats the refund with the same key', async () => {
  let refundCalls = 0;
  const s = setup({
    record: (_args, n) => ({ data: { outcome: n === 0 ? 'refund_requested' : 'duplicate', refund: REFUND_TARGET }, error: null }),
    stripe: (q) => {
      if (q.url.pathname !== '/v1/refunds') return stripeDefault(q);
      refundCalls++;
      return refundCalls === 1 ? Response.json({ error: { code: 'api_error' } }, { status: 503 }) : Response.json({ id: 're_FakeTest0001' });
    },
  });
  const first = await s.send(await signedRequest(JSON.stringify(PAID)));
  const retry = await s.send(await signedRequest(JSON.stringify(PAID)));
  assert.equal(first.status, 500);
  assert.equal(retry.status, 200);
  const keys = s.stripe.filter((q) => q.url.pathname === '/v1/refunds').map((q) => q.headers.get('Idempotency-Key'));
  assert.deepEqual(keys, [`refund-${PAYMENT_ID}`, `refund-${PAYMENT_ID}`]);
  assert.equal(s.rpcCalls.filter((c) => c.fn === 'mark_refund_requested').length, 1);
});

test('webhook: charge_already_refunded counts as done and marks the refund requested', async () => {
  const r = await post({
    record: () => ({ data: { outcome: 'duplicate', refund: REFUND_TARGET }, error: null }),
    stripe: (q) => q.url.pathname === '/v1/refunds' ? Response.json({ error: { code: 'charge_already_refunded' } }, { status: 400 }) : stripeDefault(q),
  }, PAID);
  assert.equal(r.res.status, 200);
  assert.equal(r.rpcCalls.filter((c) => c.fn === 'mark_refund_requested').length, 1);
});

test('webhook: a failed mark_refund_requested is 500 (Stripe retries; the key keeps one refund)', async () => {
  const r = await post({
    record: () => ({ data: { outcome: 'refund_requested', refund: REFUND_TARGET }, error: null }),
    mark: () => ({ data: null, error: { message: 'connection lost' } }),
  }, PAID);
  assert.equal(r.res.status, 500);
});

test('webhook: a refund target with no Stripe key is 503 (retried later)', async () => {
  const r = await post({ noStripe: true, record: () => ({ data: { outcome: 'duplicate', refund: REFUND_TARGET }, error: null }) }, event('invoice.voided', { id: INVOICE_ID }));
  assert.equal(r.res.status, 503);
  assert.equal(r.rpcCalls.filter((c) => c.fn === 'mark_refund_requested').length, 0);
});

// --- the other event types ----------------------------------------------------------------------

test('webhook: p_data for voided, uncollectible, refunded, dispute and other types; no Stripe call', async () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['invoice.voided', { id: INVOICE_ID, customer_email: OWNER_EMAIL }, { invoice_id: INVOICE_ID }],
    ['invoice.marked_uncollectible', { id: INVOICE_ID }, { invoice_id: INVOICE_ID }],
    ['invoice.voided', { id: 'bad id' }, {}],
    ['charge.refunded', { id: 'ch_Fake', payment_intent: PAYMENT_INTENT_ID, amount_refunded: 2500, refunded: true, billing_details: { email: OWNER_EMAIL } }, { payment_intent_id: PAYMENT_INTENT_ID, amount_refunded: 2500, refunded: true }],
    ['charge.refunded', { payment_intent: null, amount_refunded: '25', refunded: 'yes' }, { payment_intent_id: null, amount_refunded: null, refunded: null }],
    ['charge.dispute.created', { id: 'dp_Fake', payment_intent: PAYMENT_INTENT_ID, amount: 2500 }, { payment_intent_id: PAYMENT_INTENT_ID }],
    ['customer.created', { email: OWNER_EMAIL }, {}],
  ];
  for (const [type, object, expected] of cases) {
    const r = await post({ record: () => ({ data: { outcome: 'applied' }, error: null }) }, event(type, object));
    assert.equal(r.res.status, 200, type);
    assert.equal(r.stripe.length, 0, type);
    const args = recordArgs(r.rpcCalls)[0];
    assert.equal(args.p_type, type);
    assert.deepEqual(args.p_data, expected, type);
  }
});

// --- what leaves the function -------------------------------------------------------------------

test('webhook: a rejected and an applied event each log their code, and nothing private', async () => {
  const start = output.lines.length;
  await post({}, PAID, { secret: 'whsec_test_fake_other' });
  await post({}, PAID);
  const lines = output.lines.slice(start);
  assert.ok(lines.some((l) => l.includes('"code":"bad_signature"')));
  assert.ok(lines.some((l) => l.includes('"outcome":"applied"')));
});

// Must stay last in this file, so that it sees every response body and signature of the whole run. It is
// order-safe all the same: it does not restore the console (that happens on unload), and each test is
// also leak-checked on its own.
test('webhook: responses are only empty or { received }, and no signature value was ever echoed', () => {
  for (const text of [...output.lines, ...bodies]) {
    for (const h of headersSent) assert.ok(!text.includes(h.slice(-64)));
  }
  for (const b of bodies) assert.ok(b === '' || b === '{"received":true}', b);
  assert.equal(network.unexpectedCalls(), 0);
});
