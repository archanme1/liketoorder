import { makeRequest } from '../__fixtures__/requests';
import { makeTableRequest } from '../__fixtures__/tableRequests';
import {
  customerRequestSchema,
  requestDetailSchema,
  requestListSchema,
  tableFormSchema,
  tableRequestSchema,
  tableTimeProblem,
} from '../schema';

const NOW = new Date('2026-11-08T17:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('tableRequestSchema (strict)', () => {
  it('accepts the 15 customer keys', () => {
    const request = makeTableRequest();
    expect(Object.keys(request)).toHaveLength(15);
    expect(tableRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each([
    ['place_id', { place_id: 'abc' }],
    ['an address', { formatted_address: '1 King St' }],
    ['the customer id', { customer_id: 'u1' }],
    ['pickup fields', { pickup_at: '2026-11-08T18:00:00+00:00' }],
  ])('refuses a request that carries %s', (_label, extra) => {
    expect(tableRequestSchema.safeParse({ ...makeTableRequest(), ...extra }).success).toBe(false);
  });

  it('keeps the party between 1 and 20', () => {
    for (const size of [1, 20]) {
      expect(tableRequestSchema.safeParse(makeTableRequest({ party_size: size })).success).toBe(
        true,
      );
    }
    for (const size of [0, 21, 2.5]) {
      expect(tableRequestSchema.safeParse(makeTableRequest({ party_size: size })).success).toBe(
        false,
      );
    }
  });

  it('knows the table decline reasons and not the pickup-only ones', () => {
    for (const reason of [
      'fully_booked',
      'closed_then',
      'too_busy',
      'time_not_possible',
      'other',
    ]) {
      expect(
        tableRequestSchema.safeParse(makeTableRequest({ decline_reason: reason as never })).success,
      ).toBe(true);
    }
    for (const reason of ['sold_out', 'cannot_prepare']) {
      expect(
        tableRequestSchema.safeParse(makeTableRequest({ decline_reason: reason as never })).success,
      ).toBe(false);
    }
  });

  it('requires arrived_at, as a timestamp or null', () => {
    const { arrived_at: _gone, ...without } = makeTableRequest();
    expect(tableRequestSchema.safeParse(without).success).toBe(false);
    expect(
      tableRequestSchema.safeParse(makeTableRequest({ arrived_at: '2026-11-08T23:30:00+00:00' }))
        .success,
    ).toBe(true);
    expect(tableRequestSchema.safeParse(makeTableRequest({ arrived_at: 'soon' })).success).toBe(
      false,
    );
  });
});

describe('the customer list and detail are told apart by kind', () => {
  it('accepts a list that mixes both kinds', () => {
    const parsed = requestListSchema.safeParse({
      server_now: '2026-11-08T17:00:00Z',
      requests: [makeRequest(), makeTableRequest({ id: '55555555-5555-4555-8555-555555555555' })],
      next_cursor: null,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.requests.map((request) => request.kind)).toEqual(['pickup', 'table']);
  });

  it('refuses an unknown kind, and a row whose fields do not match its kind', () => {
    expect(
      customerRequestSchema.safeParse({ ...makeTableRequest(), kind: 'delivery' }).success,
    ).toBe(false);
    expect(customerRequestSchema.safeParse({ ...makeTableRequest(), kind: 'pickup' }).success).toBe(
      false,
    );
  });

  it('accepts a table detail, or null for not found', () => {
    expect(
      requestDetailSchema.safeParse({
        server_now: '2026-11-08T17:00:00Z',
        request: makeTableRequest(),
      }).success,
    ).toBe(true);
    expect(
      requestDetailSchema.safeParse({ server_now: '2026-11-08T17:00:00Z', request: null }).success,
    ).toBe(true);
  });
});

describe('tableTimeProblem (30 minutes to 30 days)', () => {
  it('says too_soon under 30 minutes and fine from 30', () => {
    expect(tableTimeProblem(minutes(29), NOW)).toBe('too_soon');
    expect(tableTimeProblem(minutes(30), NOW)).toBeNull();
  });

  it('says too_far past 30 days and fine at 30 days', () => {
    expect(tableTimeProblem(minutes(30 * 24 * 60), NOW)).toBeNull();
    expect(tableTimeProblem(minutes(30 * 24 * 60 + 1), NOW)).toBe('too_far');
  });
});

describe('tableFormSchema', () => {
  const ok = { tableAt: new Date('2026-11-09T00:00:00Z'), partySize: 4, note: '' };

  it('accepts a time, a party of 1 to 20 and an empty note', () => {
    for (const partySize of [1, 20]) {
      expect(tableFormSchema.safeParse({ ...ok, partySize }).success).toBe(true);
    }
  });

  it('refuses a party of 0 or 21, and no time', () => {
    for (const partySize of [0, 21]) {
      expect(tableFormSchema.safeParse({ ...ok, partySize }).success).toBe(false);
    }
    expect(tableFormSchema.safeParse({ ...ok, tableAt: undefined }).success).toBe(false);
  });

  it('cleans the note and keeps it to 300 characters', () => {
    const cleaned = tableFormSchema.parse({ ...ok, note: '  window\u200B seat  ' });
    expect(cleaned.note).toBe('window seat');
    expect(tableFormSchema.safeParse({ ...ok, note: 'x'.repeat(300) }).success).toBe(true);
    expect(tableFormSchema.safeParse({ ...ok, note: 'x'.repeat(301) }).success).toBe(false);
  });
});
