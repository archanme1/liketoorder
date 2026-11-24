// promotion-invoice (spec 16b PR 2, gate D3). Stripe is a stateful fake behind the real client that
// honours idempotency keys like Stripe does; the database is a fake RPC (one payment row) behind the
// real rpc.ts; global fetch throws. Every console line and response body is checked last.
import assert from 'node:assert/strict';
import { createStripeClient, STRIPE_VERSION } from '../_shared/stripe.ts';
import { createHandler, MIN_ADMIN_SECRET_LENGTH } from '../promotion-invoice/handler.ts';
import { createDatabase, type Rpc } from '../promotion-invoice/rpc.ts';
import { blockNetwork, fakeFetch, type RecordedRequest, USER_JWT } from './helpers.ts';
import {
  ADMIN_SECRET,
  captureConsole,
  OWNER_EMAIL,
  OWNER_ID,
  PAYMENT_ID,
  PROMOTION_ID,
  STRIPE_KEY,
} from './fixtures/stripeEvents.ts';

const network = blockNetwork();
const output = captureConsole();
const bodies: string[] = [];

const BUSINESS_NAME = 'Pasta Place Business Name';
const PAY_BY = '2026-11-30T12:00:00.123456+00:00';
const DUE_DATE = 1796040000;
const LEAK = { error: { code: 'api_error', message: `customer ${OWNER_EMAIL} key ${STRIPE_KEY}`, param: OWNER_EMAIL } };

// --- fake Stripe -----------------------------------------------------------------------------------

type StripeInvoice = { id: string; status: string; total: number; livemode: boolean };
type StripeOptions = {
  failOnce?: string[]; // "METHOD /path" routes that answer 500 once, before acting (with a leaky body)
  failAfter?: string[]; // routes that act, remember the key, then answer 500 once (the answer is lost)
  failAlways?: string[];
  livemode?: boolean;
  invoices?: StripeInvoice[]; // invoices that already exist at Stripe
};

function fakeStripe(o: StripeOptions = {}) {
  const invoices = new Map<string, StripeInvoice>((o.invoices ?? []).map((i) => [i.id, { ...i }]));
  const created = { customers: 0, invoices: 0, items: 0, finalized: 0, sent: 0, voided: 0, deleted: 0 };
  // Like Stripe: a replayed key returns the first answer as it was then; a replayed key with other
  // parameters is refused (idempotency_error).
  const seen = new Map<string, { params: string; body: unknown }>();
  const failOnce = new Set(o.failOnce ?? []);
  const failAfter = new Set(o.failAfter ?? []);

  function route(req: RecordedRequest): string {
    return `${req.method} ${req.url.pathname.replace(/in_[A-Za-z0-9]+/, ':id')}`;
  }
  function invoiceOf(req: RecordedRequest): StripeInvoice | undefined {
    const id = req.url.pathname.match(/in_[A-Za-z0-9]+/)?.[0];
    return id ? invoices.get(id) : undefined;
  }
  function refuse(code: string) {
    return { status: 400, body: { error: { code, message: `refused for ${OWNER_EMAIL}` } } };
  }

  const fake = fakeFetch((req) => {
    const r = route(req);
    if ((o.failAlways ?? []).includes(r) || failOnce.delete(r)) return Response.json(LEAK, { status: 500 });
    const key = req.headers.get('Idempotency-Key');
    const prior = key ? seen.get(key) : undefined;
    if (prior) {
      if (prior.params !== (req.body ?? '')) {
        return Response.json({ error: { type: 'idempotency_error', message: `key reused for ${OWNER_EMAIL}` } }, { status: 400 });
      }
      return Response.json(prior.body);
    }
    const params = new URLSearchParams(req.body ?? '');
    const inv = invoiceOf(req);
    let out: { status: number; body: unknown } = { status: 200, body: {} };
    switch (r) {
      case 'POST /v1/customers':
        out.body = { id: `cus_Fake${++created.customers}` };
        break;
      case 'POST /v1/invoices': {
        const id = `in_Fake${++created.invoices}`;
        invoices.set(id, { id, status: 'draft', total: 0, livemode: o.livemode ?? false });
        out.body = { ...invoices.get(id) }; // a snapshot: a replay returns the invoice as it was then
        break;
      }
      case 'POST /v1/invoiceitems': {
        const target = invoices.get(params.get('invoice') ?? '');
        if (!target || target.status !== 'draft') out = refuse('invoice_not_editable');
        else {
          target.total += Number(params.get('amount'));
          created.items++;
          out.body = { id: `ii_Fake${created.items}` };
        }
        break;
      }
      case 'POST /v1/invoices/:id/finalize':
        if (!inv || inv.status !== 'draft') out = refuse('invoice_not_editable');
        else {
          inv.status = 'open';
          created.finalized++;
          out.body = { ...inv };
        }
        break;
      case 'POST /v1/invoices/:id/send':
        if (!inv || inv.status !== 'open') out = refuse('invoice_not_open');
        else {
          created.sent++;
          out.body = { ...inv };
        }
        break;
      case 'POST /v1/invoices/:id/void':
        if (!inv || !['open', 'uncollectible'].includes(inv.status)) out = refuse('invoice_not_voidable');
        else {
          inv.status = 'void';
          created.voided++;
          out.body = { ...inv };
        }
        break;
      case 'GET /v1/invoices/:id':
        out = inv ? { status: 200, body: { ...inv } } : refuse('resource_missing');
        break;
      case 'DELETE /v1/invoices/:id':
        if (!inv || inv.status !== 'draft') out = refuse('invoice_not_deletable');
        else {
          invoices.delete(inv.id);
          created.deleted++;
          out.body = { id: inv.id, deleted: true };
        }
        break;
      default:
        out = refuse('unexpected_route');
    }
    if (key && out.status === 200) seen.set(key, { params: req.body ?? '', body: out.body });
    if (out.status === 200 && failAfter.delete(r)) return Response.json(LEAK, { status: 500 });
    return Response.json(out.body, { status: out.status });
  });
  return { fn: fake.fn, requests: fake.requests, created, invoices };
}

// --- fake database: one payment row, as the PR 1 functions keep it -------------------------------

type Row = { exists: boolean; customer_id: string | null; invoice_id: string | null; sent: boolean; livemode: boolean | null };
type DbOptions = {
  beginError?: { message: string; details?: string };
  attachRefused?: boolean;
  sendable?: boolean;
  toVoid?: { payment_id: string; invoice_id: string }[];
  fail?: Record<string, { message: string; details?: string } | undefined>; // fn -> error, once
  row?: Partial<Row>;
};

function fakeDb(o: DbOptions = {}) {
  const row: Row = { exists: false, customer_id: null, invoice_id: null, sent: false, livemode: null, ...o.row };
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const fail = { ...o.fail };
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const rpc: Rpc = (fn, args) => {
    calls.push({ fn, args });
    if (fail[fn]) {
      const error = fail[fn];
      delete fail[fn];
      return Promise.resolve({ data: null, error });
    }
    switch (fn) {
      case 'begin_promotion_invoice': {
        if (o.beginError) return Promise.resolve({ data: null, error: o.beginError });
        if (row.sent) return ok({ already_sent: true, invoice_status: 'sent' });
        const resume = row.exists;
        row.exists = true;
        return ok({
          resume,
          payment_id: PAYMENT_ID,
          owner_id: OWNER_ID,
          business_name: BUSINESS_NAME,
          amount_cents: 2500,
          currency: 'CAD',
          length_days: 7,
          pay_by: PAY_BY,
          customer_id: row.customer_id,
          invoice_id: row.invoice_id,
        });
      }
      case 'attach_invoice':
        // As the SQL: only a reserved row can be attached (one already attached is not_attachable).
        if (o.attachRefused || row.invoice_id !== null) {
          return Promise.resolve({ data: null, error: { message: 'not_attachable' } });
        }
        row.customer_id = args.p_customer_id as string;
        row.invoice_id = args.p_invoice_id as string;
        row.livemode = args.p_livemode as boolean;
        return ok({ ok: true });
      case 'check_invoice_sendable':
        return ok(o.sendable ?? true);
      case 'mark_invoice_sent':
        row.sent = true;
        return ok(true);
      case 'mark_invoice_void':
        return ok(true);
      case 'list_invoices_to_void':
        return ok(o.toVoid ?? []);
    }
    throw new Error(`unexpected rpc ${fn}`);
  };
  return { rpc, calls, row };
}

// --- harness ---------------------------------------------------------------------------------------

type Setup = {
  adminSecret?: string | undefined;
  noStripe?: boolean;
  email?: string | null | Error;
  stripe?: StripeOptions;
  db?: DbOptions;
};

function setup(o: Setup = {}) {
  const stripe = fakeStripe(o.stripe);
  const db = fakeDb(o.db);
  const emailLookups: string[] = [];
  let email = o.email === undefined ? OWNER_EMAIL : o.email;
  const handler = createHandler({
    adminSecret: 'adminSecret' in o ? o.adminSecret : ADMIN_SECRET,
    stripe: o.noStripe ? undefined : createStripeClient({ fetch: stripe.fn, key: STRIPE_KEY }),
    db: createDatabase(db.rpc),
    getOwnerEmail: (id) => {
      emailLookups.push(id);
      return email instanceof Error ? Promise.reject(email) : Promise.resolve(email);
    },
  });
  const setEmail = (next: string) => (email = next);
  const send = async (body: unknown, headers: Record<string, string> = { 'x-admin-secret': ADMIN_SECRET }, method = 'POST') => {
    const res = await handler(new Request('http://localhost/promotion-invoice', {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }));
    bodies.push(await res.clone().text());
    return res;
  };
  const invoice = () => send({ action: 'invoice', promotion_id: PROMOTION_ID });
  return { send, invoice, stripe, db, emailLookups, setEmail };
}

const routes = (reqs: RecordedRequest[]) => reqs.map((r) => `${r.method} ${r.url.pathname}`);

// --- the admin secret ------------------------------------------------------------------------------

Deno.test('admin: an unset or short PROMOTION_ADMIN_SECRET is 503 not_configured with no calls', async () => {
  for (const adminSecret of [undefined, '', ADMIN_SECRET.slice(0, MIN_ADMIN_SECRET_LENGTH - 1)]) {
    const s = setup({ adminSecret });
    const res = await s.send({ action: 'invoice', promotion_id: PROMOTION_ID }, { 'x-admin-secret': adminSecret ?? '' });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, error: 'not_configured' });
    assert.equal(s.db.calls.length, 0);
    assert.equal(s.stripe.requests.length, 0);
  }
});

Deno.test('admin: a secret of exactly 32 characters works', async () => {
  const secret = 'x'.repeat(MIN_ADMIN_SECRET_LENGTH);
  const s = setup({ adminSecret: secret });
  const res = await s.send({ action: 'void_pending' }, { 'x-admin-secret': secret });
  assert.equal(res.status, 200);
});

Deno.test('admin: missing, wrong (equal or other length) or JWT-only is 401 with no body and no calls', async () => {
  const wrongSameLength = ADMIN_SECRET.slice(0, -1) + (ADMIN_SECRET.endsWith('f') ? 'e' : 'f');
  assert.equal(wrongSameLength.length, ADMIN_SECRET.length);
  const cases: Record<string, string>[] = [
    {},
    { 'x-admin-secret': '' },
    { 'x-admin-secret': wrongSameLength },
    { 'x-admin-secret': ADMIN_SECRET.slice(0, 20) },
    { 'x-admin-secret': ADMIN_SECRET + 'x' },
    { Authorization: `Bearer ${USER_JWT}` },
    { Authorization: `Bearer ${ADMIN_SECRET}` },
  ];
  for (const headers of cases) {
    const s = setup();
    const res = await s.send({ action: 'invoice', promotion_id: PROMOTION_ID }, headers);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.equal(await res.text(), '');
    assert.equal(s.db.calls.length, 0);
    assert.equal(s.stripe.requests.length, 0);
    assert.equal(s.emailLookups.length, 0);
  }
});

Deno.test('admin: not POST is 405; a bad body is 400 invalid_input with no calls', async () => {
  const s = setup();
  assert.equal((await s.send(null, { 'x-admin-secret': ADMIN_SECRET }, 'GET')).status, 405);
  for (const body of ['not json', {}, { action: 'refund' }, { action: 'invoice' }, { action: 'invoice', promotion_id: 'abc' }]) {
    const res = await s.send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(await res.json(), { ok: false, error: 'invalid_input' });
  }
  assert.equal(s.db.calls.length, 0);
  assert.equal(s.stripe.requests.length, 0);
});

Deno.test('admin: no Stripe key is 503 payments_unavailable with no calls', async () => {
  const s = setup({ noStripe: true });
  const res = await s.invoice();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, error: 'payments_unavailable' });
  assert.equal(s.db.calls.length, 0);
});

// --- invoice: answers from begin_promotion_invoice ------------------------------------------------

Deno.test('invoice: begin errors map to codes and statuses; raw database text never leaves', async () => {
  const cases: [{ message: string; details?: string }, number, string][] = [
    [{ message: 'not_found' }, 404, 'not_found'],
    [{ message: 'not_payable' }, 409, 'not_payable'],
    [{ message: 'payment_window_closed' }, 409, 'payment_window_closed'],
    [{ message: 'not_configured' }, 503, 'not_configured'],
    [{ message: 'rate_limited' }, 429, 'rate_limited'],
    [{ message: 'duplicate key value violates unique constraint', details: `Key (invoice_id)=(in_Secret1) ${OWNER_EMAIL}` }, 500, 'internal_error'],
  ];
  for (const [beginError, status, code] of cases) {
    const s = setup({ db: { beginError } });
    const res = await s.invoice();
    assert.equal(res.status, status, code);
    assert.deepEqual(await res.json(), { ok: false, error: code });
    assert.equal(s.stripe.requests.length, 0);
  }
});

Deno.test('invoice: begin is called with the promotion id only', async () => {
  const s = setup();
  await s.invoice();
  assert.deepEqual(s.db.calls[0], { fn: 'begin_promotion_invoice', args: { p_promotion_id: PROMOTION_ID } });
  assert.deepEqual(s.emailLookups, [OWNER_ID]);
});

Deno.test('invoice: an owner with no email is 409 no_email and nothing at Stripe', async () => {
  for (const email of [null, '', 'not-an-email']) {
    const s = setup({ email });
    const res = await s.invoice();
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { ok: false, error: 'no_email' });
    assert.equal(s.stripe.requests.length, 0);
  }
  const broken = setup({ email: new Error(`lookup failed for ${OWNER_EMAIL}`) });
  const res = await broken.invoice();
  assert.equal(res.status, 500);
  assert.equal(broken.stripe.requests.length, 0);
});

// --- invoice: the happy path ----------------------------------------------------------------------

Deno.test('invoice: the calls in order, each body, key and version; answer is { ok, invoice_status }', async () => {
  const s = setup();
  const res = await s.invoice();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, invoice_status: 'sent' });
  const reqs = s.stripe.requests;
  assert.deepEqual(routes(reqs), [
    'POST /v1/customers',
    'POST /v1/invoices',
    'POST /v1/invoiceitems',
    'POST /v1/invoices/in_Fake1/finalize',
    'POST /v1/invoices/in_Fake1/send',
  ]);
  assert.deepEqual(reqs.map((r) => r.headers.get('Idempotency-Key')), [
    `customer-${PAYMENT_ID}`,
    `invoice-${PAYMENT_ID}`,
    `invoiceitem-${PAYMENT_ID}`,
    `finalize-${PAYMENT_ID}`,
    `send-${PAYMENT_ID}`,
  ]);
  for (const r of reqs) {
    assert.equal(r.headers.get('Stripe-Version'), STRIPE_VERSION);
    assert.equal(r.headers.get('Authorization'), `Bearer ${STRIPE_KEY}`);
  }
  const form = (i: number) => Object.fromEntries(new URLSearchParams(reqs[i].body ?? ''));
  assert.deepEqual(form(0), { email: OWNER_EMAIL, name: BUSINESS_NAME, 'metadata[payment_id]': PAYMENT_ID });
  assert.deepEqual(form(1), {
    customer: 'cus_Fake1',
    collection_method: 'send_invoice',
    due_date: String(DUE_DATE),
    auto_advance: 'false',
    currency: 'cad',
    description: 'LikeToOrder promotion, 7 days',
    pending_invoice_items_behavior: 'exclude',
    'metadata[promotion_id]': PROMOTION_ID,
    'metadata[payment_id]': PAYMENT_ID,
  });
  assert.deepEqual(form(2), {
    customer: 'cus_Fake1',
    invoice: 'in_Fake1',
    amount: '2500',
    currency: 'cad',
    description: 'LikeToOrder promotion, 7 days',
    'metadata[payment_id]': PAYMENT_ID,
  });
  assert.equal(reqs[3].body, '');
  assert.equal(reqs[4].body, '');
  assert.deepEqual(s.db.calls.map((c) => c.fn), [
    'begin_promotion_invoice',
    'attach_invoice',
    'check_invoice_sendable',
    'mark_invoice_sent',
  ]);
  assert.deepEqual(s.db.calls[1].args, { p_payment_id: PAYMENT_ID, p_customer_id: 'cus_Fake1', p_invoice_id: 'in_Fake1', p_livemode: false });
});

Deno.test('invoice: the livemode recorded by attach_invoice is the one Stripe answered', async () => {
  const s = setup({ stripe: { livemode: true } });
  await s.invoice();
  assert.equal(s.db.row.livemode, true);
});

Deno.test('invoice: the email goes only to the customer call, never to another request or the answer', async () => {
  const s = setup();
  const res = await s.invoice();
  const text = await res.text();
  assert.ok(!text.includes(OWNER_EMAIL));
  const withEmail = s.stripe.requests.filter((r) => (r.body ?? '').includes(encodeURIComponent(OWNER_EMAIL)) || r.url.href.includes(OWNER_EMAIL));
  assert.deepEqual(routes(withEmail), ['POST /v1/customers']);
  assert.ok(!JSON.stringify(s.db.calls).includes(OWNER_EMAIL));
});

// --- invoice: failures, resume and no double invoice ----------------------------------------------

Deno.test('invoice: a failure at each step resumes on the next run with one of each object', async () => {
  for (const step of [
    'POST /v1/customers',
    'POST /v1/invoices',
    'POST /v1/invoiceitems',
    'POST /v1/invoices/:id/finalize',
    'POST /v1/invoices/:id/send',
  ]) {
    const s = setup({ stripe: { failOnce: [step] } });
    const first = await s.invoice();
    assert.equal(first.status, 502, step);
    assert.deepEqual(await first.json(), { ok: false, error: 'stripe_error' });
    const second = await s.invoice();
    assert.equal(second.status, 200, step);
    assert.deepEqual(s.stripe.created, { customers: 1, invoices: 1, items: 1, finalized: 1, sent: 1, voided: 0, deleted: 0 }, step);
    assert.equal([...s.stripe.invoices.values()][0].total, 2500, step);
    const third = await s.invoice();
    assert.equal(third.status, 409, step);
    assert.deepEqual(await third.json(), { ok: false, error: 'already_sent' });
    assert.equal(s.db.calls.filter((c) => c.fn === 'attach_invoice').length, 1, step);
  }
});

Deno.test('invoice: Stripe acts but the answer is lost at each step; the rerun makes no second object', async () => {
  for (const step of [
    'POST /v1/customers',
    'POST /v1/invoices',
    'POST /v1/invoiceitems',
    'POST /v1/invoices/:id/finalize',
    'POST /v1/invoices/:id/send',
  ]) {
    const s = setup({ stripe: { failAfter: [step] } });
    const first = await s.invoice();
    assert.equal(first.status, 502, step);
    const second = await s.invoice();
    assert.equal(second.status, 200, step);
    assert.deepEqual(await second.json(), { ok: true, invoice_status: 'sent' });
    assert.deepEqual(s.stripe.created, { customers: 1, invoices: 1, items: 1, finalized: 1, sent: 1, voided: 0, deleted: 0 }, step);
    assert.equal(s.stripe.invoices.size, 1, step);
    assert.equal([...s.stripe.invoices.values()][0].total, 2500, step);
    assert.equal(s.db.row.invoice_id, 'in_Fake1', step);
    assert.equal(s.db.row.sent, true, step);
  }
});

Deno.test('invoice: a resumed run whose owner email changed is refused by Stripe (key reuse), nothing new made', async () => {
  const s = setup({ stripe: { failAfter: ['POST /v1/customers'] } });
  assert.equal((await s.invoice()).status, 502);
  s.setEmail('owner-new@example.test');
  const second = await s.invoice();
  assert.equal(second.status, 502);
  assert.deepEqual(await second.json(), { ok: false, error: 'stripe_error' });
  assert.equal(s.stripe.created.customers, 1);
  assert.equal(s.stripe.created.invoices, 0);
});

Deno.test('invoice: a resumed run with an attached invoice reads its state and never posts a second item', async () => {
  const s = setup({ stripe: { failOnce: ['POST /v1/invoices/:id/finalize'] } });
  await s.invoice();
  const before = s.stripe.requests.length;
  await s.invoice();
  const resumed = routes(s.stripe.requests.slice(before));
  assert.deepEqual(resumed, ['GET /v1/invoices/in_Fake1', 'POST /v1/invoices/in_Fake1/finalize', 'POST /v1/invoices/in_Fake1/send']);
});

Deno.test('invoice: resume after the idempotency window still adds no second item (state from Stripe)', async () => {
  // The row is attached and the draft already has its item, as after a run that stopped before
  // finalize more than 24 h ago (no remembered keys at the fake).
  const s = setup({
    db: { row: { exists: true, customer_id: 'cus_Old1', invoice_id: 'in_Old1' } },
    stripe: { invoices: [{ id: 'in_Old1', status: 'draft', total: 2500, livemode: false }] },
  });
  const res = await s.invoice();
  assert.equal(res.status, 200);
  assert.equal(s.stripe.created.items, 0);
  assert.deepEqual(routes(s.stripe.requests), ['GET /v1/invoices/in_Old1', 'POST /v1/invoices/in_Old1/finalize', 'POST /v1/invoices/in_Old1/send']);
});

Deno.test('invoice: a resumed draft with another total, or a void or paid invoice, is stripe_error with no send', async () => {
  for (const inv of [
    { id: 'in_Old1', status: 'draft', total: 1000, livemode: false },
    { id: 'in_Old1', status: 'void', total: 2500, livemode: false },
    { id: 'in_Old1', status: 'paid', total: 2500, livemode: false },
  ]) {
    const s = setup({ db: { row: { exists: true, customer_id: 'cus_Old1', invoice_id: 'in_Old1' } }, stripe: { invoices: [inv] } });
    const res = await s.invoice();
    assert.equal(res.status, 502, inv.status);
    assert.deepEqual(routes(s.stripe.requests), ['GET /v1/invoices/in_Old1']);
    assert.equal(s.db.calls.filter((c) => c.fn === 'mark_invoice_sent').length, 0);
  }
});

Deno.test('invoice: an open invoice with another total is never sent (stripe_error)', async () => {
  const s = setup({
    db: { row: { exists: true, customer_id: 'cus_Old1', invoice_id: 'in_Old1' } },
    stripe: { invoices: [{ id: 'in_Old1', status: 'open', total: 1000, livemode: false }] },
  });
  const res = await s.invoice();
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { ok: false, error: 'stripe_error' });
  assert.deepEqual(routes(s.stripe.requests), ['GET /v1/invoices/in_Old1']);
  assert.equal(s.stripe.created.sent, 0);
  assert.equal(s.db.calls.filter((c) => c.fn === 'check_invoice_sendable' || c.fn === 'mark_invoice_sent').length, 0);
});

Deno.test('invoice: a failed mark_invoice_sent is 500; the rerun sends with the same key and succeeds', async () => {
  const s = setup({ db: { fail: { mark_invoice_sent: { message: 'connection lost' } } } });
  const first = await s.invoice();
  assert.equal(first.status, 500);
  const second = await s.invoice();
  assert.equal(second.status, 200);
  assert.equal(s.stripe.created.sent, 1);
  const sendKeys = s.stripe.requests.filter((r) => r.url.pathname.endsWith('/send')).map((r) => r.headers.get('Idempotency-Key'));
  assert.deepEqual(sendKeys, [`send-${PAYMENT_ID}`, `send-${PAYMENT_ID}`]);
});

Deno.test('invoice: attach_invoice refused deletes the draft; nothing is finalized or sent', async () => {
  const s = setup({ db: { attachRefused: true } });
  const res = await s.invoice();
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { ok: false, error: 'not_payable' });
  assert.deepEqual(routes(s.stripe.requests), ['POST /v1/customers', 'POST /v1/invoices', 'DELETE /v1/invoices/in_Fake1']);
  assert.equal(s.stripe.created.deleted, 1);
  assert.equal(s.stripe.requests[2].headers.get('Stripe-Version'), STRIPE_VERSION);
});

Deno.test('invoice: attach refused and the delete fails is still not_payable, never finalized', async () => {
  const s = setup({ db: { attachRefused: true }, stripe: { failAlways: ['DELETE /v1/invoices/:id'] } });
  const res = await s.invoice();
  assert.equal(res.status, 409);
  assert.equal(s.stripe.created.finalized, 0);
  assert.equal(s.stripe.created.sent, 0);
});

Deno.test('invoice: check_invoice_sendable false voids the finalized invoice and does not send', async () => {
  const s = setup({ db: { sendable: false } });
  const res = await s.invoice();
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { ok: false, error: 'not_payable' });
  assert.equal(s.stripe.created.sent, 0);
  assert.equal(s.stripe.created.voided, 1);
  const voidReq = s.stripe.requests.find((r) => r.url.pathname.endsWith('/void'));
  assert.equal(voidReq?.headers.get('Idempotency-Key'), `void-${PAYMENT_ID}`);
  assert.deepEqual(s.db.calls.map((c) => c.fn), ['begin_promotion_invoice', 'attach_invoice', 'check_invoice_sendable', 'mark_invoice_void']);
  assert.deepEqual(s.db.calls[3].args, { p_payment_id: PAYMENT_ID });
});

Deno.test('invoice: sendable false and the void fails is still not_payable, not marked void, not sent', async () => {
  const s = setup({ db: { sendable: false }, stripe: { failAlways: ['POST /v1/invoices/:id/void'] } });
  const res = await s.invoice();
  assert.equal(res.status, 409);
  assert.equal(s.stripe.created.sent, 0);
  assert.equal(s.db.calls.filter((c) => c.fn === 'mark_invoice_void').length, 0);
});

Deno.test('invoice: rate limited is 429 with no Stripe call', async () => {
  const s = setup({ db: { beginError: { message: 'rate_limited' } } });
  const res = await s.invoice();
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { ok: false, error: 'rate_limited' });
  assert.equal(s.stripe.requests.length, 0);
});

// --- void_pending -----------------------------------------------------------------------------------

const P = (n: number) => `3c1d7e52-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

Deno.test('void_pending: voids, deletes drafts, marks already void, skips paid, counts failures, goes on', async () => {
  const s = setup({
    db: {
      toVoid: [
        { payment_id: P(1), invoice_id: 'in_Open1' },
        { payment_id: P(2), invoice_id: 'in_Draft2' },
        { payment_id: P(3), invoice_id: 'in_Void3' },
        { payment_id: P(4), invoice_id: 'in_Paid4' },
        { payment_id: P(5), invoice_id: 'in_Gone5' },
        { payment_id: P(6), invoice_id: 'in_Unco6' },
      ],
    },
    stripe: {
      invoices: [
        { id: 'in_Open1', status: 'open', total: 2500, livemode: false },
        { id: 'in_Draft2', status: 'draft', total: 0, livemode: false },
        { id: 'in_Void3', status: 'void', total: 2500, livemode: false },
        { id: 'in_Paid4', status: 'paid', total: 2500, livemode: false },
        { id: 'in_Unco6', status: 'uncollectible', total: 2500, livemode: false },
      ],
    },
  });
  const res = await s.send({ action: 'void_pending' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, voided: 4, failed: 1, skipped: 1 });
  const marked = s.db.calls.filter((c) => c.fn === 'mark_invoice_void').map((c) => c.args.p_payment_id);
  assert.deepEqual(marked, [P(1), P(2), P(3), P(6)]);
  assert.equal(s.stripe.created.deleted, 1);
  const voidKeys = s.stripe.requests.filter((r) => r.url.pathname.endsWith('/void')).map((r) => r.headers.get('Idempotency-Key'));
  assert.deepEqual(voidKeys, [1, 2, 3, 4, 5, 6].map((n) => `void-${P(n)}`));
  assert.ok(s.stripe.requests.every((r) => r.headers.get('Stripe-Version') === STRIPE_VERSION));
});

Deno.test('void_pending: an empty list is { ok, 0, 0, 0 }; a database error is 500', async () => {
  const empty = setup();
  assert.deepEqual(await (await empty.send({ action: 'void_pending' })).json(), { ok: true, voided: 0, failed: 0, skipped: 0 });
  const broken = setup({ db: { fail: { list_invoices_to_void: { message: 'boom', details: OWNER_EMAIL } } } });
  const res = await broken.send({ action: 'void_pending' });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, error: 'internal_error' });
});

// --- what leaves the function -------------------------------------------------------------------

Deno.test('admin: logs and answers never carry the email, a secret, a name or an id', () => {
  output.restore();
  assert.ok(output.lines.some((l) => l.includes('"outcome":"sent"')));
  assert.ok(output.lines.some((l) => l.includes('"code":"unauthorized"')));
  const forbidden = [OWNER_EMAIL, ADMIN_SECRET, STRIPE_KEY, BUSINESS_NAME, PAYMENT_ID, PROMOTION_ID, OWNER_ID, 'cus_', 'in_', 'ii_', 'rk_', 'Key (', 'duplicate key', 'refused for', 'example.test'];
  for (const text of [...output.lines, ...bodies]) {
    for (const f of forbidden) assert.ok(!text.includes(f), `leaked ${f} in ${text}`);
  }
  const allowed = /^(|\{"ok":true,"invoice_status":"sent"\}|\{"ok":false,"error":"[a-z_]+"\}|\{"ok":true,"voided":\d+,"failed":\d+,"skipped":\d+\})$/;
  for (const b of bodies) assert.match(b, allowed);
  assert.equal(network.unexpectedCalls(), 0);
});
