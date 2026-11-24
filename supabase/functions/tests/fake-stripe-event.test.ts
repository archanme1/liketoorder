// scripts/dev/fake-stripe-event.ts (spec 16b PR 2, gate D5): local hosts only, only event types
// that need no Stripe call, a signature the webhook accepts, and nothing printed but the status.
// The script talks to an injected fake fetch; global fetch throws.
import assert from 'node:assert/strict';
import { verifyStripeSignature } from '../_shared/stripe.ts';
import { ALLOWED_TYPES, localUrl, main, Refused } from '../../../scripts/dev/fake-stripe-event.ts';
import { blockNetwork, fakeGoogleFetch } from './helpers.ts';
import { captureConsole, NOW_SECONDS } from './fixtures/stripeEvents.ts';

const network = blockNetwork();
const output = captureConsole();
const SECRET = 'made-up-local-secret-for-tests';
const LOCAL = 'http://127.0.0.1:54321/functions/v1/stripe-webhook';

function run(argv: string[], status = 200) {
  const fake = fakeGoogleFetch(() => new Response('{"received":true}', { status }));
  const printed: string[] = [];
  return main(argv, { fetch: fake.fn, print: (l) => printed.push(l), nowSeconds: NOW_SECONDS })
    .then((code) => ({ code, printed, requests: fake.requests }));
}

Deno.test('fake event: non-local URLs are refused', () => {
  for (const url of [
    'https://x.supabase.co/functions/v1/stripe-webhook',
    'http://evil.com/stripe-webhook',
    'http://localhost.evil.com/stripe-webhook',
    'http://127.0.0.1.evil.com/stripe-webhook',
    'https://127.0.0.1:54321/functions/v1/stripe-webhook',
    'http://user:pw@127.0.0.1:54321/x',
    'http://0.0.0.0:54321/x',
    'not a url',
  ]) {
    assert.throws(() => localUrl(url), Refused, url);
  }
});

Deno.test('fake event: local URLs are accepted', () => {
  assert.equal(localUrl(LOCAL).href, LOCAL);
  assert.equal(localUrl('http://localhost:54321/functions/v1/stripe-webhook').hostname, 'localhost');
});

Deno.test('fake event: a refused URL makes no request and prints one fixed line', async () => {
  const r = await run(['--url', 'http://localhost.evil.com/x', '--secret', SECRET, '--type', 'fake.unknown']);
  assert.equal(r.code, 2);
  assert.equal(r.requests.length, 0);
  assert.deepEqual(r.printed, ['refused: only http://127.0.0.1 or http://localhost URLs']);
});

Deno.test('fake event: only types that need no Stripe call; invoice.paid is refused', async () => {
  assert.deepEqual([...ALLOWED_TYPES], ['invoice.voided', 'invoice.marked_uncollectible', 'charge.refunded', 'charge.dispute.created', 'fake.unknown']);
  for (const type of ['invoice.paid', 'checkout.session.completed', '']) {
    const r = await run(['--url', LOCAL, '--secret', SECRET, '--type', type, '--invoice', 'in_FakeSeed0001']);
    assert.equal(r.code, 2, type);
    assert.equal(r.requests.length, 0, type);
  }
});

Deno.test('fake event: missing or malformed ids and amounts are refused before any request', async () => {
  for (const argv of [
    ['--type', 'invoice.voided'],
    ['--type', 'invoice.voided', '--invoice', 'pi_Wrong'],
    ['--type', 'charge.refunded', '--payment-intent', 'pi_X1'],
    ['--type', 'charge.refunded', '--payment-intent', 'pi_X1', '--amount-refunded', '-5'],
    ['--type', 'charge.dispute.created', '--payment-intent', 'in_Wrong'],
  ]) {
    const r = await run(['--url', LOCAL, '--secret', SECRET, ...argv]);
    assert.equal(r.code, 2, argv.join(' '));
    assert.equal(r.requests.length, 0);
  }
  const noSecret = await run(['--url', LOCAL, '--type', 'fake.unknown']);
  assert.equal(noSecret.requests.length, 0);
});

Deno.test('fake event: posts a correctly signed event to the local URL and prints only the status', async () => {
  const r = await run(['--url', LOCAL, '--secret', SECRET, '--type', 'charge.refunded', '--payment-intent', 'pi_FakeSeed0002', '--amount-refunded', '2500', '--full']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.printed, ['200']);
  assert.equal(r.requests.length, 1);
  const req = r.requests[0];
  assert.equal(req.url.href, LOCAL);
  assert.equal(req.method, 'POST');
  const body = req.body ?? '';
  assert.equal(await verifyStripeSignature(new TextEncoder().encode(body), req.headers.get('Stripe-Signature'), SECRET, NOW_SECONDS), true);
  const event = JSON.parse(body);
  assert.match(event.id, /^evt_Local[0-9a-f]{16}$/);
  assert.equal(event.type, 'charge.refunded');
  assert.equal(event.livemode, false);
  assert.deepEqual({ ...event.data.object, id: undefined }, { id: undefined, object: 'charge', payment_intent: 'pi_FakeSeed0002', amount_refunded: 2500, refunded: true });
});

Deno.test('fake event: each allowed type has the shape the webhook reads', async () => {
  const cases: [string[], Record<string, unknown>][] = [
    [['--type', 'invoice.voided', '--invoice', 'in_FakeSeed0001'], { id: 'in_FakeSeed0001', object: 'invoice', status: 'void' }],
    [['--type', 'invoice.marked_uncollectible', '--invoice', 'in_FakeSeed0001'], { id: 'in_FakeSeed0001', object: 'invoice', status: 'uncollectible' }],
    [['--type', 'charge.dispute.created', '--payment-intent', 'pi_FakeSeed0002'], { object: 'dispute', payment_intent: 'pi_FakeSeed0002' }],
    [['--type', 'fake.unknown'], { object: 'unknown' }],
  ];
  for (const [argv, expected] of cases) {
    const r = await run(['--url', LOCAL, '--secret', SECRET, ...argv]);
    const object = JSON.parse(r.requests[0].body ?? '').data.object;
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(object[k], v, `${argv[1]} ${k}`);
  }
});

Deno.test('fake event: --livemode and --stale-timestamp make the refusal cases', async () => {
  const live = await run(['--url', LOCAL, '--secret', SECRET, '--type', 'fake.unknown', '--livemode']);
  assert.equal(JSON.parse(live.requests[0].body ?? '').livemode, true);
  const stale = await run(['--url', LOCAL, '--secret', SECRET, '--type', 'fake.unknown', '--stale-timestamp'], 400);
  assert.equal(stale.code, 1);
  assert.deepEqual(stale.printed, ['400']);
  const header = stale.requests[0].headers.get('Stripe-Signature') ?? '';
  assert.ok(header.startsWith(`t=${NOW_SECONDS - 600},`));
});

Deno.test('fake event: reads no environment variable and no file', async () => {
  const env = Deno.env as unknown as Record<string, unknown>;
  const fs = Deno as unknown as Record<string, unknown>;
  const names = ['readTextFile', 'readTextFileSync', 'readFile', 'readFileSync', 'open', 'openSync'];
  const saved = { get: env.get, toObject: env.toObject, has: env.has, fs: names.map((n) => fs[n]) };
  let touched = 0;
  const trap = () => {
    touched++;
    throw new Error('not allowed');
  };
  env.get = trap;
  env.toObject = trap;
  env.has = trap;
  names.forEach((n) => (fs[n] = trap));
  try {
    const r = await run(['--url', LOCAL, '--secret', SECRET, '--type', 'invoice.voided', '--invoice', 'in_FakeSeed0001']);
    assert.equal(r.code, 0);
  } finally {
    env.get = saved.get;
    env.toObject = saved.toObject;
    env.has = saved.has;
    names.forEach((n, i) => (fs[n] = saved.fs[i]));
  }
  assert.equal(touched, 0);
});

Deno.test('fake event: nothing reaches the console; the secret is never printed', () => {
  output.restore();
  assert.deepEqual(output.lines, []);
  assert.equal(network.unexpectedCalls(), 0);
});
