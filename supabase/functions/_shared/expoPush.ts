// Thin client for Expo's push service. `fetch` is injected so tests never reach Expo.
// Errors carry a code only: never a response body, a token or a message text.
import { z } from 'zod';
import type { RequestKind } from './pushText.ts';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
// Expo's limits per request.
export const SEND_LIMIT = 100;
export const RECEIPTS_LIMIT = 1000;

export type PushData = { v: 1; kind: RequestKind; id: string; side: 'sent' | 'received' };

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  channelId: 'requests';
  priority: 'high';
  data: PushData;
};

// One result per message (ticket) or per ticket id (receipt). `code` is Expo's details.error.
export type ExpoResult = { status: 'ok'; id: string } | { status: 'error'; code: string };
export type ExpoReceipt = { status: 'ok' } | { status: 'error'; code: string };

// The whole request failed. `retry` says whether a later attempt can help (network, timeout, 429, 5xx).
export class ExpoRequestError extends Error {
  constructor(readonly code: string, readonly retry: boolean) {
    super(code);
  }
}

// Expo's documented ticket and receipt error codes. Anything else becomes unknown_error, so a changed
// or surprising response can never carry text into a log line or the database.
export const EXPO_ERROR_CODES = [
  'DeviceNotRegistered',
  'MessageTooBig',
  'MessageRateExceeded',
  'MismatchSenderId',
  'InvalidCredentials',
] as const;

export function knownCode(code: string | undefined): string {
  return (EXPO_ERROR_CODES as readonly string[]).includes(code ?? '') ? (code as string) : 'unknown_error';
}

// What a per-message error means for that token: drop it, try again later, or give up.
export function classifyTicketError(code: string): 'dead_token' | 'retry' | 'fail' {
  if (code === 'DeviceNotRegistered') return 'dead_token';
  if (code === 'MessageRateExceeded') return 'retry';
  return 'fail'; // MessageTooBig, InvalidCredentials and anything unknown
}

export interface ExpoClient {
  // At most SEND_LIMIT messages; the results are in the same order.
  send(messages: ExpoMessage[]): Promise<ExpoResult[]>;
  // At most RECEIPTS_LIMIT ids; ids Expo has no receipt for yet are left out.
  getReceipts(ids: string[]): Promise<Map<string, ExpoReceipt>>;
}

const Details = z.object({ error: z.string().optional() }).optional();
const Ticket = z.union([
  z.object({ status: z.literal('ok'), id: z.string() }),
  z.object({ status: z.literal('error'), details: Details }),
]);
const SendResponse = z.object({ data: z.array(Ticket) });
const Receipt = z.union([
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('error'), details: Details }),
]);
const ReceiptsResponse = z.object({ data: z.record(z.string(), Receipt) });

type Options = {
  fetch: typeof fetch;
  // EXPO_ACCESS_TOKEN (Expo's enhanced push security), optional.
  accessToken?: string;
  timeoutMs?: number;
};

export function createExpoClient({ fetch: fetchImpl, accessToken, timeoutMs = 10000 }: Options): ExpoClient {
  async function post(url: string, body: unknown): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ExpoRequestError('timeout', true));
      }, timeoutMs);
    });
    try {
      const request = (async () => {
        let res: Response;
        try {
          res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        } catch {
          throw new ExpoRequestError('network_error', true);
        }
        if (!res.ok) {
          await res.body?.cancel();
          throw new ExpoRequestError(`http_${res.status}`, res.status === 429 || res.status >= 500);
        }
        try {
          return await res.json();
        } catch {
          throw new ExpoRequestError('bad_response', true);
        }
      })();
      request.catch(() => {}); // after a timeout the aborted fetch rejects with nobody listening
      return await Promise.race([request, timeout]);
    } catch (e) {
      if (e instanceof ExpoRequestError) throw e;
      throw new ExpoRequestError('network_error', true);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async send(messages) {
      if (messages.length === 0) return [];
      if (messages.length > SEND_LIMIT) throw new ExpoRequestError('too_many_messages', false);
      const parsed = SendResponse.safeParse(await post(SEND_URL, messages));
      if (!parsed.success || parsed.data.data.length !== messages.length) {
        throw new ExpoRequestError('bad_response', true);
      }
      return parsed.data.data.map((t): ExpoResult =>
        t.status === 'ok' ? { status: 'ok', id: t.id } : { status: 'error', code: knownCode(t.details?.error) }
      );
    },

    async getReceipts(ids) {
      const receipts = new Map<string, ExpoReceipt>();
      if (ids.length === 0) return receipts;
      if (ids.length > RECEIPTS_LIMIT) throw new ExpoRequestError('too_many_ids', false);
      const parsed = ReceiptsResponse.safeParse(await post(RECEIPTS_URL, { ids }));
      if (!parsed.success) throw new ExpoRequestError('bad_response', true);
      for (const [id, r] of Object.entries(parsed.data.data)) {
        receipts.set(id, r.status === 'ok' ? { status: 'ok' } : { status: 'error', code: knownCode(r.details?.error) });
      }
      return receipts;
    },
  };
}
