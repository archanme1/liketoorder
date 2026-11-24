// _shared/stripe.ts (spec 16b PR 2, gate D1): the webhook signature, the constant-time compares,
// form encoding and the REST client. Global fetch throws; the client only ever gets a fake fetch.
import assert from 'node:assert/strict';
import { readRawBody } from '../_shared/http.ts';
import {
  constantTimeEqual,
  createStripeClient,
  formEncode,
  parseSignatureHeader,
  secretMatches,
  signStripePayload,
  STRIPE_VERSION,
  StripeError,
  verifyStripeSignature,
} from '../_shared/stripe.ts';
import { blockNetwork, fakeFetch } from './helpers.ts';
import { captureConsole, guardedTest, NOW_SECONDS, OWNER_EMAIL, STRIPE_KEY, WEBHOOK_SECRET } from './fixtures/stripeEvents.ts';

const network = blockNetwork();
const output = captureConsole();
// Every test is leak-checked on its own (log lines), whatever order or filter it runs with.
const test = guardedTest(output, [STRIPE_KEY, OWNER_EMAIL, WEBHOOK_SECRET]);
const enc = (s: string) => new TextEncoder().encode(s);

// Known answer computed outside this code: printf '%s' '1700000000.<body>' | openssl dgst -sha256 -hmac whsec_test_fake_only
const KAT_BODY = '{"id":"evt_Fake0001","object":"event"}';
const KAT_T = 1700000000;
const KAT_V1 = 'b057670c037be0f24b44bc9eea76c9130d5c6f68df47d371931d0bdf536eb6d6';

// The same HMAC computed directly with Web Crypto in the test, independent of the module.
async function referenceV1(secret: string, t: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc(`${t}.${body}`)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

test('signature: the openssl known-answer vector verifies', async () => {
  assert.equal(await verifyStripeSignature(enc(KAT_BODY), `t=${KAT_T},v1=${KAT_V1}`, WEBHOOK_SECRET, KAT_T), true);
  assert.equal(await referenceV1(WEBHOOK_SECRET, KAT_T, KAT_BODY), KAT_V1);
});

test('signature: signStripePayload matches the reference HMAC', async () => {
  const body = '{"id":"evt_Fake0002","note":"caf\u00e9"}';
  const header = await signStripePayload(body, WEBHOOK_SECRET, NOW_SECONDS);
  assert.equal(header, `t=${NOW_SECONDS},v1=${await referenceV1(WEBHOOK_SECRET, NOW_SECONDS, body)}`);
  assert.equal(await verifyStripeSignature(enc(body), header, WEBHOOK_SECRET, NOW_SECONDS), true);
});

test('signature: a wrong secret is refused', async () => {
  const header = await signStripePayload(KAT_BODY, 'whsec_test_fake_other', KAT_T);
  assert.equal(await verifyStripeSignature(enc(KAT_BODY), header, WEBHOOK_SECRET, KAT_T), false);
});

test('signature: a changed body is refused', async () => {
  assert.equal(await verifyStripeSignature(enc(KAT_BODY + ' '), `t=${KAT_T},v1=${KAT_V1}`, WEBHOOK_SECRET, KAT_T), false);
});

test('signature: 300 s either side is accepted, 301 s is refused', async () => {
  const h = `t=${KAT_T},v1=${KAT_V1}`;
  assert.equal(await verifyStripeSignature(enc(KAT_BODY), h, WEBHOOK_SECRET, KAT_T + 300), true);
  assert.equal(await verifyStripeSignature(enc(KAT_BODY), h, WEBHOOK_SECRET, KAT_T - 300), true);
  assert.equal(await verifyStripeSignature(enc(KAT_BODY), h, WEBHOOK_SECRET, KAT_T + 301), false);
  assert.equal(await verifyStripeSignature(enc(KAT_BODY), h, WEBHOOK_SECRET, KAT_T - 301), false);
});

test('signature: any one matching v1 among several is enough; v0 is ignored', async () => {
  const bad = 'a'.repeat(64);
  assert.equal(await verifyStripeSignature(enc(KAT_BODY), `t=${KAT_T},v1=${bad},v1=${KAT_V1}`, WEBHOOK_SECRET, KAT_T), true);
  assert.equal(await verifyStripeSignature(enc(KAT_BODY), `t=${KAT_T},v0=${KAT_V1}`, WEBHOOK_SECRET, KAT_T), false);
  assert.equal(await verifyStripeSignature(enc(KAT_BODY), `t=${KAT_T},v1=${bad},v0=${KAT_V1}`, WEBHOOK_SECRET, KAT_T), false);
});

test('signature: missing and malformed headers are refused', async () => {
  for (const h of [null, '', 'garbage', `v1=${KAT_V1}`, `t=${KAT_T}`, `t=abc,v1=${KAT_V1}`, `t=${KAT_T},v1=${KAT_V1.toUpperCase()}`, `t=${KAT_T},v1=${KAT_V1.slice(1)}`]) {
    assert.equal(await verifyStripeSignature(enc(KAT_BODY), h, WEBHOOK_SECRET, KAT_T), false, String(h));
  }
});

test('parseSignatureHeader: keeps t and the valid v1 entries only', () => {
  assert.deepEqual(parseSignatureHeader(`t=5, v1=${KAT_V1}, v0=${KAT_V1}, x=1`), { t: 5, v1: [KAT_V1] });
  assert.equal(parseSignatureHeader('x'.repeat(3000)), null);
});

test('constantTimeEqual: equal, different content, different lengths', () => {
  assert.equal(constantTimeEqual(enc('abc'), enc('abc')), true);
  assert.equal(constantTimeEqual(enc('abc'), enc('abd')), false);
  assert.equal(constantTimeEqual(enc('abc'), enc('abcd')), false);
  assert.equal(constantTimeEqual(enc(''), enc('a')), false);
  assert.equal(constantTimeEqual(enc(''), enc('')), true);
});

test('secretMatches: equal, wrong of equal length, wrong of other lengths, missing', async () => {
  const secret = 'admin-secret-fake-only-0123456789abcdef';
  assert.equal(await secretMatches(secret, secret), true);
  assert.equal(await secretMatches(secret.slice(0, -1) + 'X', secret), false);
  assert.equal(await secretMatches(secret.slice(0, 10), secret), false);
  assert.equal(await secretMatches(secret + 'extra', secret), false);
  assert.equal(await secretMatches('', secret), false);
  assert.equal(await secretMatches(null, secret), false);
});

test('formEncode: nested metadata, booleans, whole numbers; fractions refused', () => {
  const body = formEncode({ amount: 2500, auto_advance: false, currency: 'cad', metadata: { payment_id: 'p-1', promotion_id: 'q 2' } });
  assert.equal(body, 'amount=2500&auto_advance=false&currency=cad&metadata%5Bpayment_id%5D=p-1&metadata%5Bpromotion_id%5D=q+2');
  assert.throws(() => formEncode({ amount: 25.5 }), StripeError);
});

test('client POST: version, key, form type and idempotency headers, body, URL', async () => {
  const fake = fakeFetch(() => Response.json({ id: 'cus_FakeTest0001' }));
  const stripe = createStripeClient({ fetch: fake.fn, key: STRIPE_KEY });
  const out = await stripe.post('/v1/customers', { email: OWNER_EMAIL, metadata: { payment_id: 'p1' } }, 'customer-p1');
  assert.deepEqual(out, { id: 'cus_FakeTest0001' });
  const [req] = fake.requests;
  assert.equal(req.url.href, 'https://api.stripe.com/v1/customers');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.get('Stripe-Version'), STRIPE_VERSION);
  assert.equal(STRIPE_VERSION, '2026-11-18.endive');
  assert.equal(req.headers.get('Authorization'), `Bearer ${STRIPE_KEY}`);
  assert.equal(req.headers.get('Content-Type'), 'application/x-www-form-urlencoded');
  assert.equal(req.headers.get('Idempotency-Key'), 'customer-p1');
  assert.equal(req.body, 'email=owner%40example.test&metadata%5Bpayment_id%5D=p1');
});

test('client POST without an idempotency key is refused before any request', async () => {
  const fake = fakeFetch(() => Response.json({}));
  const stripe = createStripeClient({ fetch: fake.fn, key: STRIPE_KEY });
  await assert.rejects(stripe.post('/v1/refunds', {}, ''), (e) => e instanceof StripeError && e.code === 'missing_idempotency_key');
  // @ts-expect-error: the key is required by the type
  await assert.rejects(stripe.post('/v1/refunds', {}), (e) => e instanceof StripeError && e.code === 'missing_idempotency_key');
  assert.equal(fake.requests.length, 0);
});

test('client GET and DELETE: version header, no idempotency key, query string', async () => {
  const fake = fakeFetch(() => Response.json({ data: [] }));
  const stripe = createStripeClient({ fetch: fake.fn, key: STRIPE_KEY });
  await stripe.get('/v1/invoice_payments', { invoice: 'in_FakeTest0001', status: 'paid' });
  await stripe.del('/v1/invoices/in_FakeTest0001');
  assert.equal(fake.requests[0].url.href, 'https://api.stripe.com/v1/invoice_payments?invoice=in_FakeTest0001&status=paid');
  assert.equal(fake.requests[1].method, 'DELETE');
  for (const r of fake.requests) {
    assert.equal(r.headers.get('Stripe-Version'), STRIPE_VERSION);
    assert.equal(r.headers.get('Idempotency-Key'), null);
    assert.equal(r.body, null);
  }
});

test('client: a path that is not /v1/... is refused before any request', async () => {
  const fake = fakeFetch(() => Response.json({}));
  const stripe = createStripeClient({ fetch: fake.fn, key: STRIPE_KEY });
  for (const p of ['https://evil.test/v1/x', '//evil.test/v1/x', '/v1/../x', '/v2/x', '/v1/x y']) {
    await assert.rejects(stripe.get(p), (e) => e instanceof StripeError && e.code === 'invalid_path', p);
  }
  assert.equal(fake.requests.length, 0);
});

test('client errors carry only the Stripe code and status, never the body', async () => {
  const leaky = { error: { code: 'charge_already_refunded', message: `refund for ${OWNER_EMAIL} with ${STRIPE_KEY}`, param: OWNER_EMAIL } };
  const stripe = createStripeClient({ fetch: fakeFetch(() => Response.json(leaky, { status: 400 })).fn, key: STRIPE_KEY });
  const err = await stripe.post('/v1/refunds', { payment_intent: 'pi_X' }, 'refund-1').catch((e) => e);
  assert.ok(err instanceof StripeError);
  assert.equal(err.code, 'charge_already_refunded');
  assert.equal(err.status, 400);
  const shown = `${err.message} ${String(err)} ${JSON.stringify(err)} ${err.stack ?? ''}`;
  assert.ok(!shown.includes(OWNER_EMAIL) && !shown.includes(STRIPE_KEY) && !shown.includes('refund for'));
});

test('client errors: an odd code becomes unknown; no JSON; network failure', async () => {
  const odd = createStripeClient({ fetch: fakeFetch(() => Response.json({ error: { code: `x ${OWNER_EMAIL}` } }, { status: 402 })).fn, key: STRIPE_KEY });
  await assert.rejects(odd.get('/v1/invoices/in_1'), (e) => e instanceof StripeError && e.code === 'unknown' && e.status === 402);
  const html = createStripeClient({ fetch: fakeFetch(() => new Response('<html>', { status: 502 })).fn, key: STRIPE_KEY });
  await assert.rejects(html.get('/v1/invoices/in_1'), (e) => e instanceof StripeError && e.code === 'unknown' && e.status === 502);
  const ok = createStripeClient({ fetch: fakeFetch(() => new Response('not json', { status: 200 })).fn, key: STRIPE_KEY });
  await assert.rejects(ok.get('/v1/invoices/in_1'), (e) => e instanceof StripeError && e.code === 'invalid_response');
  const down = createStripeClient({ fetch: (() => Promise.reject(new Error(`boom ${STRIPE_KEY}`))) as typeof fetch, key: STRIPE_KEY });
  await assert.rejects(down.get('/v1/invoices/in_1'), (e) => e instanceof StripeError && e.code === 'network_error' && !e.message.includes(STRIPE_KEY));
});

test('readRawBody: exact bytes, empty, and over the limit (declared or streamed)', async () => {
  const body = '{"a":"caf\u00e9"}';
  assert.deepEqual(await readRawBody(new Request('http://x', { method: 'POST', body }), 100), enc(body));
  assert.deepEqual(await readRawBody(new Request('http://x', { method: 'POST' }), 100), new Uint8Array());
  assert.equal(await readRawBody(new Request('http://x', { method: 'POST', body: 'x'.repeat(101) }), 100), undefined);
  const declared = new Request('http://x', { method: 'POST', body: 'x', headers: { 'Content-Length': '101' } });
  assert.equal(await readRawBody(declared, 100), undefined);
});

// Must stay last in this file, so that it sees the whole run. It is order-safe all the same: it does not
// restore the console (that happens on unload), and each test is also leak-checked on its own.
test('stripe shared: no console output and no real network call', () => {
  assert.deepEqual(output.lines, []);
  assert.equal(network.unexpectedCalls(), 0);
});
