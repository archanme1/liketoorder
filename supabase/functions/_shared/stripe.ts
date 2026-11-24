// Stripe over plain fetch (no SDK, spec 16b D7) and the webhook signature check with Web Crypto.
// Nothing here logs. Errors carry only Stripe's error code and the HTTP status: never a body, a URL,
// an id, an email or a key.

export const STRIPE_API = 'https://api.stripe.com';
export const STRIPE_VERSION = '2026-11-18.endive'; // D17: pinned; changing it is a reviewed code change
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const TIMEOUT_MS = 10_000;
const PATH = /^\/v1\/[A-Za-z0-9_/]+$/;
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;

export class StripeError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super('stripe_error');
    this.name = 'StripeError';
  }
}

// Flat params plus one level of `metadata[key]`. Numbers must be whole (amounts are cents).
export type FormValue = string | number | boolean | Record<string, string>;
export type FormParams = Record<string, FormValue>;

export function formEncode(params: FormParams): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) out.append(`${key}[${k}]`, v);
    } else {
      if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new StripeError(0, 'invalid_param');
      out.append(key, String(value));
    }
  }
  return out.toString();
}

export type StripeClient = {
  // The key is required by the type: every POST is idempotent (spec 16b, Rules for implementation).
  post(path: string, params: FormParams, idempotencyKey: string): Promise<unknown>;
  get(path: string, query?: Record<string, string>): Promise<unknown>;
  del(path: string): Promise<unknown>;
};

export function createStripeClient(opts: { fetch: typeof fetch; key: string; timeoutMs?: number }): StripeClient {
  async function call(method: string, path: string, body?: string, idempotencyKey?: string): Promise<unknown> {
    const pathOnly = path.split('?')[0];
    if (!PATH.test(pathOnly)) throw new StripeError(0, 'invalid_path');
    const headers = new Headers({
      Authorization: `Bearer ${opts.key}`,
      'Stripe-Version': STRIPE_VERSION,
    });
    if (body !== undefined) headers.set('Content-Type', 'application/x-www-form-urlencoded');
    if (idempotencyKey !== undefined) headers.set('Idempotency-Key', idempotencyKey);

    let res: Response;
    try {
      res = await opts.fetch(`${STRIPE_API}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      });
    } catch {
      throw new StripeError(0, 'network_error');
    }

    let parsed: unknown = undefined;
    try {
      parsed = await res.json();
    } catch {
      // handled below
    }
    if (!res.ok) {
      const code = (parsed as { error?: { code?: unknown } } | undefined)?.error?.code;
      throw new StripeError(res.status, typeof code === 'string' && ERROR_CODE.test(code) ? code : 'unknown');
    }
    if (parsed === undefined) throw new StripeError(res.status, 'invalid_response');
    return parsed;
  }

  return {
    post(path, params, idempotencyKey) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
        return Promise.reject(new StripeError(0, 'missing_idempotency_key'));
      }
      let body: string;
      try {
        body = formEncode(params);
      } catch (e) {
        return Promise.reject(e);
      }
      return call('POST', path, body, idempotencyKey);
    },
    get(path, query) {
      const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
      return call('GET', `${path}${qs}`);
    },
    del(path) {
      return call('DELETE', path);
    },
  };
}

// --- constant-time comparisons ------------------------------------------------------------------

// Byte compare without stopping early; different lengths are unequal (the loop still runs).
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// The push-sender pattern: SHA-256 digests compared byte by byte, so the time taken depends on
// neither the length of the secret nor how much of it matched.
export async function secretMatches(provided: string | null, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided ?? '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return constantTimeEqual(new Uint8Array(a), new Uint8Array(b)) && provided !== null;
}

// --- webhook signatures ---------------------------------------------------------------------------

// `t=<unix seconds>,v1=<hex>[,v1=<hex>...]`. Other schemes (v0 on test events) are ignored.
export function parseSignatureHeader(header: string | null): { t: number; v1: string[] } | null {
  if (!header || header.length > 2048) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 't' && /^[0-9]{1,12}$/.test(value)) t = Number(value);
    if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) v1.push(value);
  }
  return t === null || v1.length === 0 ? null : { t, v1 };
}

async function hmacHex(secret: string, t: number, body: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const prefix = encoder.encode(`${t}.`);
  const payload = new Uint8Array(prefix.length + body.length);
  payload.set(prefix, 0);
  payload.set(body, prefix.length);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

// True when `t` is within the tolerance of now (either side) and at least one v1 matches
// HMAC-SHA256(secret, t + "." + raw body). Every v1 is compared; none stops the loop early.
export async function verifyStripeSignature(
  rawBody: Uint8Array,
  header: string | null,
  secret: string,
  nowSeconds: number,
): Promise<boolean> {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowSeconds - parsed.t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const encoder = new TextEncoder();
  const expected = encoder.encode(await hmacHex(secret, parsed.t, rawBody));
  let ok = false;
  for (const candidate of parsed.v1) {
    if (constantTimeEqual(encoder.encode(candidate), expected)) ok = true;
  }
  return ok;
}

// The header Stripe would send for this body. Used by the tests and scripts/dev/fake-stripe-event.ts.
export async function signStripePayload(body: string, secret: string, t: number): Promise<string> {
  return `t=${t},v1=${await hmacHex(secret, t, new TextEncoder().encode(body))}`;
}
