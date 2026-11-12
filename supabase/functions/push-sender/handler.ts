import {
  classifyTicketError,
  type ExpoClient,
  type ExpoMessage,
  ExpoRequestError,
  RECEIPTS_LIMIT,
  SEND_LIMIT,
} from '../_shared/expoPush.ts';
import { errorResponse, type Handler, json } from '../_shared/http.ts';
import { type PushEvent, pushText, type RequestKind } from '../_shared/pushText.ts';

// One claim takes at most this many messages (the database also caps a claim at 100), and one
// run makes at most MAX_ROUNDS claims, then reads one round of receipts and returns.
export const BATCH_SIZE = 100;
export const MAX_ROUNDS = 3;

// One message as claim_push_batch decided it (texts are built here, from fixed templates).
export type ClaimedMessage = {
  outboxIds: number[]; // the lead row first; the others were collapsed into it
  event: PushEvent;
  kind: RequestKind; // the newest request's kind for a collapsed push
  requestId: string; // the newest request's id for a collapsed push, so a tap opens it
  side: 'sent' | 'received';
  businessName: string | null; // null for owner events
  count: number;
  tokens: { id: string; token: string }[];
};

// Messages that parsed, and the outbox ids of any that did not (recorded as failed, never sent).
export type Claim = { messages: ClaimedMessage[]; invalid: number[][] };

export type PushResult = {
  outbox_ids: number[];
  outcome: 'sent' | 'retry' | 'failed';
  tickets: { ticket_id: string; token_id: string }[];
  dead_token_ids: string[];
};

export type ReceiptResult = { ticket_id: string; status: 'ok' | 'error'; error: string | null };

export type Deps = {
  // PUSH_SENDER_SECRET; undefined or empty means the function is not set up.
  cronSecret: string | undefined;
  claimBatch: (limit: number) => Promise<Claim>;
  recordResults: (results: PushResult[]) => Promise<void>;
  claimReceipts: (limit: number) => Promise<string[]>;
  recordReceipts: (results: ReceiptResult[]) => Promise<void>;
  expo: ExpoClient;
};

// Logs carry only outbox ids, event names, counts and Expo error codes (Decision 20): never a
// token, a title or body text, or anything from a request. Thrown errors are mapped to codes first.
function log(line: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'push-sender', ...line }));
}

// Same constant-time comparison as places-refresh: SHA-256 digests compared byte by byte without
// stopping early, so the time taken does not depend on how much of the secret matched.
async function secretMatches(provided: string | null, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided ?? '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0 && provided !== null;
}

export function buildMessage(m: ClaimedMessage, to: string): ExpoMessage {
  const { title, body } = pushText({ event: m.event, kind: m.kind, count: m.count, businessName: m.businessName });
  return {
    to,
    title,
    body,
    sound: 'default',
    channelId: 'requests',
    priority: 'high',
    data: { v: 1, kind: m.kind, id: m.requestId, side: m.side },
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type MessageState = { tickets: PushResult['tickets']; dead: string[]; retry: boolean };

// Sends every message to each of its tokens, at most SEND_LIMIT per request to Expo.
// A message is sent if any token got a ticket; else retried if any failure can pass; else failed.
async function sendAll(expo: ExpoClient, messages: ClaimedMessage[]): Promise<PushResult[]> {
  const states: MessageState[] = messages.map(() => ({ tickets: [], dead: [], retry: false }));
  const targets = messages.flatMap((m, mi) => m.tokens.map((token) => ({ mi, token })));

  for (const chunk of chunks(targets, SEND_LIMIT)) {
    let results;
    try {
      results = await expo.send(chunk.map((t) => buildMessage(messages[t.mi], t.token.token)));
    } catch (e) {
      const err = e instanceof ExpoRequestError ? e : new ExpoRequestError('unknown_error', true);
      for (const t of chunk) states[t.mi].retry ||= err.retry;
      log({ outbox_ids: [...new Set(chunk.flatMap((t) => messages[t.mi].outboxIds))], code: err.code });
      continue;
    }
    results.forEach((r, i) => {
      const t = chunk[i];
      const state = states[t.mi];
      if (r.status === 'ok') {
        state.tickets.push({ ticket_id: r.id, token_id: t.token.id });
        return;
      }
      const meaning = classifyTicketError(r.code);
      if (meaning === 'dead_token') state.dead.push(t.token.id);
      if (meaning === 'retry') state.retry = true;
      log({ outbox_ids: messages[t.mi].outboxIds, event: messages[t.mi].event, code: r.code });
    });
  }

  return messages.map((m, i) => ({
    outbox_ids: m.outboxIds,
    outcome: states[i].tickets.length > 0 ? 'sent' : states[i].retry ? 'retry' : 'failed',
    tickets: states[i].tickets,
    dead_token_ids: states[i].dead,
  }));
}

// POST with header x-cron-secret -> { sent, skipped, retried, failed, receipts } (counts only).
// skipped counts messages the database returned in a shape this function cannot send; they are
// recorded as failed so they never loop. Delivery is at least once: if recording fails after a
// send, the rows stay sending and are claimed again after 5 minutes.
export function createHandler(deps: Deps): Handler {
  return async (req) => {
    if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed');
    if (!deps.cronSecret) return errorResponse(500, 'not_configured');

    // 401 carries no body and touches neither the database nor Expo.
    if (!(await secretMatches(req.headers.get('x-cron-secret'), deps.cronSecret))) {
      return new Response(null, { status: 401 });
    }
    await req.body?.cancel();

    const counts = { sent: 0, skipped: 0, retried: 0, failed: 0, receipts: 0 };

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { messages, invalid } = await deps.claimBatch(BATCH_SIZE);
      if (messages.length === 0 && invalid.length === 0) break;

      const results = await sendAll(deps.expo, messages);
      for (const ids of invalid) {
        log({ outbox_ids: ids, code: 'invalid_message' });
        results.push({ outbox_ids: ids, outcome: 'failed', tickets: [], dead_token_ids: [] });
      }
      await deps.recordResults(results);

      counts.skipped += invalid.length;
      for (const r of results.slice(0, messages.length)) {
        if (r.outcome === 'sent') counts.sent++;
        else if (r.outcome === 'retry') counts.retried++;
        else counts.failed++;
      }
      if (messages.length + invalid.length < BATCH_SIZE) break;
    }

    const ids = await deps.claimReceipts(RECEIPTS_LIMIT);
    if (ids.length > 0) {
      try {
        const receipts = await deps.expo.getReceipts(ids);
        const results: ReceiptResult[] = [];
        for (const id of ids) {
          const r = receipts.get(id);
          if (!r) continue; // no receipt yet: asked again next run
          results.push({ ticket_id: id, status: r.status, error: r.status === 'error' ? r.code : null });
          if (r.status === 'error') log({ code: r.code, receipt: true });
        }
        if (results.length > 0) await deps.recordReceipts(results);
        counts.receipts = results.length;
      } catch (e) {
        if (!(e instanceof ExpoRequestError)) throw e;
        log({ code: e.code, receipt: true });
      }
    }

    log(counts);
    return json(200, counts);
  };
}
