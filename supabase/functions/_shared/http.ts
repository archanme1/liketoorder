// JSON responses, the error shape and request logging shared by the Edge Functions.

export type ErrorCode =
  | 'unauthorized'
  | 'invalid_input'
  | 'rate_limited'
  | 'upstream_error'
  | 'not_a_place'
  | 'no_business'
  | 'profile_incomplete'
  | 'method_not_allowed'
  | 'not_configured'
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
// A declared Content-Length over the cap is rejected without reading; otherwise reading stops as
// soon as the bytes actually received pass the cap (the header can be absent or wrong).
export async function readJsonBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get('Content-Length')) > MAX_BODY_BYTES) {
    await req.body?.cancel();
    return undefined;
  }
  const bytes = await readAtMost(req.body, MAX_BODY_BYTES);
  if (!bytes || bytes.byteLength === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

// The whole stream, or undefined once it passes `limit` bytes.
async function readAtMost(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | undefined> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
