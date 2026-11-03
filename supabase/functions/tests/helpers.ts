// Fakes shared by the Edge Function tests. Nothing here talks to the network.
import type { GetUser } from '../_shared/auth.ts';
import type { ConsumeQuota, QuotaKind, QuotaResult } from '../_shared/rateLimit.ts';

export const USER_ID = '7d3b1c52-9a4e-4f6b-8c21-5e0a9d7f3b14';
export const USER_JWT = 'jwt-for-a-signed-in-user';
export const ANON_KEY_JWT = 'jwt-that-is-the-anon-key';
export const TEST_API_KEY = 'test-places-key-must-not-leak';
export const SESSION_TOKEN = '0b8f7c2e-5d1a-4e3b-9c6d-2a7f1e4b8c90';
export const UPSTREAM_SECRET_TEXT = 'upstream-internal-detail-must-not-leak';

// Replaces global fetch with a stub that throws, so any real network call fails loudly.
// `unexpectedCalls` counts every call except the deliberate one made through `probe`.
export function blockNetwork(): {
  isInstalled: () => boolean;
  probe: () => unknown;
  unexpectedCalls: () => number;
} {
  let unexpected = 0;
  let probing = false;
  const stub = (() => {
    if (!probing) unexpected++;
    throw new Error('network disabled in tests');
  }) as typeof fetch;
  globalThis.fetch = stub;
  return {
    isInstalled: () => globalThis.fetch === stub,
    probe: () => {
      probing = true;
      try {
        return stub('https://places.googleapis.com/');
      } finally {
        probing = false;
      }
    },
    unexpectedCalls: () => unexpected,
  };
}

export function fakeGetUser(): { fn: GetUser; calls: string[] } {
  const calls: string[] = [];
  const fn: GetUser = (jwt) => {
    calls.push(jwt);
    return Promise.resolve(jwt === USER_JWT ? { id: USER_ID } : null);
  };
  return { fn, calls };
}

export function fakeQuota(result: QuotaResult = 'ok'): {
  fn: ConsumeQuota;
  calls: [string, QuotaKind][];
} {
  const calls: [string, QuotaKind][] = [];
  return {
    fn: (userId, kind) => {
      calls.push([userId, kind]);
      return Promise.resolve(result);
    },
    calls,
  };
}

export type RecordedRequest = { url: URL; method: string; headers: Headers; body: string | null };

// Stands in for Google: records each request and answers with `respond`.
export function fakeGoogleFetch(
  respond: (req: RecordedRequest, signal: AbortSignal | undefined) => Response | Promise<Response>,
): { fn: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fn = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req: RecordedRequest = {
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    requests.push(req);
    return Promise.resolve(respond(req, init?.signal ?? undefined));
  }) as typeof fetch;
  return { fn, requests };
}

// A Google response that never arrives until the request is aborted.
export function hangUntilAborted(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

export function upstreamError(): Response {
  return new Response(
    JSON.stringify({ error: { message: UPSTREAM_SECRET_TEXT, key: TEST_API_KEY } }),
    { status: 500 },
  );
}

// The `code` from an `{ error: { code } }` response.
export async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

type RequestOptions ={ token?: string | null; method?: string; rawBody?: string };

export function makeRequest(body: unknown, { token = USER_JWT, method = 'POST', rawBody }: RequestOptions = {}): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  return new Request('http://localhost/function', {
    method,
    headers,
    body: method === 'GET' ? undefined : (rawBody ?? JSON.stringify(body)),
  });
}
