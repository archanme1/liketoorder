// Fake Stripe values and events for the spec 16b tests. Every secret, key and id here is obviously
// fake and exists only in tests; nothing here talks to the network.
import { signStripePayload } from '../../_shared/stripe.ts';

export const WEBHOOK_SECRET = 'whsec_test_fake_only';
export const STRIPE_KEY = 'rk_test_fake_only';
export const ADMIN_SECRET = 'admin-secret-fake-only-0123456789abcdef';
export const OWNER_EMAIL = 'owner@example.test';

export const PAYMENT_ID = '3c1d7e52-0000-4000-8000-0000000000a1';
export const PROMOTION_ID = '3c1d7e52-0000-4000-8000-0000000000b1';
export const OWNER_ID = '3c1d7e52-0000-4000-8000-0000000000c1';
export const CUSTOMER_ID = 'cus_FakeTest0001';
export const INVOICE_ID = 'in_FakeTest0001';
export const PAYMENT_INTENT_ID = 'pi_FakeTest0001';
export const EVENT_ID = 'evt_FakeTest0001';

// 2026-11-23T12:00:00Z
export const NOW_SECONDS = 1795435200;
export const NOW_MS = NOW_SECONDS * 1000;

// Every console method writes here instead, so a test file can prove what was (not) logged.
export function captureConsole(): { lines: string[]; restore: () => void } {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  const lines: string[] = [];
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' '));
    };
  }
  return { lines, restore: () => methods.forEach((m, i) => (console[m] = saved[i])) };
}

export type FakeEvent = { id: string; type: string; livemode: boolean; data: { object: Record<string, unknown> } };

export function event(type: string, object: Record<string, unknown>, over: Partial<FakeEvent> = {}): FakeEvent {
  return { id: EVENT_ID, type, livemode: false, data: { object }, ...over };
}

export function paidInvoice(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INVOICE_ID,
    object: 'invoice',
    amount_paid: 2500,
    currency: 'cad',
    customer_email: OWNER_EMAIL,
    livemode: false,
    status_transitions: { paid_at: NOW_SECONDS - 60, finalized_at: NOW_SECONDS - 3600 },
    ...over,
  };
}

// A POST to the webhook signed with `secret` at time `t` (defaults: the fake secret, now).
export async function signedRequest(
  body: string,
  opts: { secret?: string; t?: number; header?: string | null } = {},
): Promise<Request> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const header = opts.header !== undefined
    ? opts.header
    : await signStripePayload(body, opts.secret ?? WEBHOOK_SECRET, opts.t ?? NOW_SECONDS);
  if (header !== null) headers.set('Stripe-Signature', header);
  return new Request('http://localhost/stripe-webhook', { method: 'POST', headers, body });
}
