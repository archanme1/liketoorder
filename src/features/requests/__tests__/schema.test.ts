import {
  cleanText,
  mergeLines,
  pickupAddressSchema,
  pickupRequestSchema,
  pickupTimeProblem,
  prepareOrder,
  requestDetailSchema,
  requestListSchema,
  stripHidden,
} from '../schema';

import { makeRequest } from '../__fixtures__/requests';

describe('response schemas (strict)', () => {
  it('accepts the server shape', () => {
    expect(pickupRequestSchema.safeParse(makeRequest()).success).toBe(true);
    expect(
      requestListSchema.safeParse({
        server_now: '2026-11-08T17:00:00Z',
        requests: [makeRequest()],
        next_cursor: null,
      }).success,
    ).toBe(true);
    expect(
      requestDetailSchema.safeParse({ server_now: '2026-11-08T17:00:00Z', request: null }).success,
    ).toBe(true);
  });

  it.each([
    ['place_id', { place_id: 'abc' }],
    ['an address', { formatted_address: '1 King St' }],
    ['map coordinates', { map_lat: 1, map_lng: 2 }],
  ])('refuses a request that carries %s', (_label, extra) => {
    expect(pickupRequestSchema.safeParse({ ...makeRequest(), ...extra }).success).toBe(false);
  });

  it('requires kind, and only knows pickup here', () => {
    const { kind: _kind, ...withoutKind } = makeRequest();
    expect(pickupRequestSchema.safeParse(withoutKind).success).toBe(false);
    expect(pickupRequestSchema.safeParse({ ...makeRequest(), kind: 'delivery' }).success).toBe(
      false,
    );
  });

  it('refuses an unknown status and a bad timestamp', () => {
    expect(
      pickupRequestSchema.safeParse(makeRequest({ display_status: 'confirmed' as never })).success,
    ).toBe(false);
    expect(pickupRequestSchema.safeParse(makeRequest({ pickup_at: 'soon' })).success).toBe(false);
  });

  it('knows no_show', () => {
    expect(pickupRequestSchema.safeParse(makeRequest({ status: 'no_show' })).success).toBe(true);
  });

  it('address: only formatted_address', () => {
    expect(pickupAddressSchema.safeParse({ formatted_address: '1 King St' }).success).toBe(true);
    expect(pickupAddressSchema.safeParse({ formatted_address: '1 King St', lat: 1 }).success).toBe(
      false,
    );
  });
});

const ch = (code: number) => String.fromCodePoint(code);

describe('hidden characters', () => {
  it.each([
    ['NUL', '\u0000'],
    ['tab', '\u0009'],
    ['carriage return', '\u000D'],
    ['escape', '\u001B'],
    ['DEL', '\u007F'],
    ['C1 control', '\u0085'],
    ['zero-width space', ch(0x200b)],
    ['zero-width joiner', ch(0x200d)],
    ['BOM', ch(0xfeff)],
    ['bidi override', ch(0x202e)],
    ['bidi isolate', ch(0x2067)],
  ])('strips %s', (_name, char) => {
    expect(stripHidden(`a${char}b`)).toBe('ab');
  });

  it('keeps newlines, accents and ordinary emoji', () => {
    expect(stripHidden('crème\nbrûlée 🍕')).toBe('crème\nbrûlée 🍕');
  });

  it('cleanText trims and turns empty into undefined', () => {
    expect(cleanText('  ' + ch(0x200b) + ' ')).toBeUndefined();
    expect(cleanText(undefined)).toBeUndefined();
    expect(cleanText(' no onions' + ch(0x202e) + ' ')).toBe('no onions');
  });
});

describe('mergeLines', () => {
  it('sums quantities of the same item, ids compared case-insensitively', () => {
    const merged = mergeLines([
      { itemId: 'AAAAAAAA-0000-4000-8000-000000000001', quantity: 2 },
      { itemId: 'bbbbbbbb-0000-4000-8000-000000000002', quantity: 1 },
      { itemId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 3 },
    ]);
    expect(merged).toEqual([
      { itemId: 'AAAAAAAA-0000-4000-8000-000000000001', quantity: 5 },
      { itemId: 'bbbbbbbb-0000-4000-8000-000000000002', quantity: 1 },
    ]);
  });

  it('drops zero and negative quantities', () => {
    expect(mergeLines([{ itemId: 'a', quantity: 0 }])).toEqual([]);
  });
});

describe('pickupTimeProblem', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it('needs 15 minutes of lead', () => {
    expect(pickupTimeProblem(at(14), now)).toBe('too_soon');
    expect(pickupTimeProblem(at(15), now)).toBeNull();
  });

  it('allows at most 7 days', () => {
    expect(pickupTimeProblem(at(7 * 24 * 60), now)).toBeNull();
    expect(pickupTimeProblem(at(7 * 24 * 60 + 1), now)).toBe('too_far');
  });
});

describe('prepareOrder', () => {
  it('needs items or text', () => {
    expect(prepareOrder({ lines: [] })).toEqual({ ok: false, problem: 'empty_order' });
    expect(prepareOrder({ lines: [], orderText: ' ' + ch(0x200b) + ' ' })).toEqual({
      ok: false,
      problem: 'empty_order',
    });
  });

  it('accepts text only, items only, or both, merging duplicate lines', () => {
    expect(prepareOrder({ lines: [], orderText: 'two pizzas' })).toEqual({
      ok: true,
      args: { items: undefined, orderText: 'two pizzas', note: undefined },
    });
    expect(
      prepareOrder({
        lines: [
          { itemId: 'a', quantity: 1 },
          { itemId: 'A', quantity: 2 },
        ],
        orderText: 'extra napkins',
        note: 'ring the bell',
      }),
    ).toEqual({
      ok: true,
      args: {
        items: [{ itemId: 'a', quantity: 3 }],
        orderText: 'extra napkins',
        note: 'ring the bell',
      },
    });
  });

  it('limits text to 500 and the note to 300 after cleaning', () => {
    expect(prepareOrder({ lines: [], orderText: 'x'.repeat(501) })).toEqual({
      ok: false,
      problem: 'text_too_long',
    });
    expect(prepareOrder({ lines: [], orderText: 'x'.repeat(500) }).ok).toBe(true);
    expect(prepareOrder({ lines: [{ itemId: 'a', quantity: 1 }], note: 'x'.repeat(301) })).toEqual({
      ok: false,
      problem: 'note_too_long',
    });
  });

  it('refuses more than 30 lines and caps a merged quantity at 20', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ itemId: `i${i}`, quantity: 1 }));
    expect(prepareOrder({ lines: many })).toEqual({ ok: false, problem: 'too_many_lines' });
    const result = prepareOrder({
      lines: [
        { itemId: 'a', quantity: 15 },
        { itemId: 'a', quantity: 15 },
      ],
    });
    expect(result.ok && result.args.items).toEqual([{ itemId: 'a', quantity: 20 }]);
  });
});
