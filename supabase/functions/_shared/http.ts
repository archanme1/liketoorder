// JSON responses, the error shape and request logging shared by the Edge Functions.

export type ErrorCode =
  | 'unauthorized'
  | 'invalid_input'
  | 'rate_limited'
  | 'upstream_error'
  | 'not_a_place'
  | 'no_business'
  | 'method_not_allowed'
  | 'internal_error';

export type Handler = (req: Request) => Promise<Response>;

const MAX_BODY_BYTES = 4096;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Errors carry only a code: never an upstream body, input text or key.
export function errorResponse(status: number, code: ErrorCode): Response {
  return json(status, { error: { code } });
}

// Parsed JSON body, or undefined when it is missing, too large or not JSON.
export async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length === 0 || new TextEncoder().encode(text).length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Logs status, function name and latency only. Never the input, place ID, coordinates or key.
export function withLogging(fn: string, handler: Handler): Handler {
  return async (req) => {
    const started = Date.now();
    let res: Response;
    try {
      res = await handler(req);
    } catch {
      res = errorResponse(500, 'internal_error');
    }
    console.log(JSON.stringify({ fn, status: res.status, ms: Date.now() - started }));
    return res;
  };
}
