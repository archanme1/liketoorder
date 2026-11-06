import { MAX_PINS, pinsResponseSchema, pinSchema } from '../schema';

const pin = { id: 'p1', name: "Joe's", cuisine_code: 'IT', lat: 43.5, lng: -79.4 };
const response = { pins: [pin], capped: false, too_large: false };

describe('map schema', () => {
  it('accepts a normal answer, an empty one and a too_large one', () => {
    expect(pinsResponseSchema.safeParse(response).success).toBe(true);
    expect(pinsResponseSchema.safeParse({ ...response, pins: [] }).success).toBe(true);
    expect(pinsResponseSchema.safeParse({ pins: [], capped: false, too_large: true }).success).toBe(
      true,
    );
  });

  it.each(['place_id', 'public_address', 'resolved_at', 'place_status', 'extra'])(
    'rejects a pin carrying an extra "%s" field',
    (field) => {
      expect(pinSchema.safeParse({ ...pin, [field]: 'x' }).success).toBe(false);
      expect(
        pinsResponseSchema.safeParse({ ...response, pins: [{ ...pin, [field]: 'x' }] }).success,
      ).toBe(false);
    },
  );

  it('rejects an extra top-level field', () => {
    expect(pinsResponseSchema.safeParse({ ...response, total: 3 }).success).toBe(false);
  });

  it.each([
    ['missing capped', { pins: [pin], too_large: false }],
    ['capped as a string', { ...response, capped: 'no' }],
    ['pins not an array', { ...response, pins: 'x' }],
    ['null', null],
  ])('rejects malformed answers: %s', (_label, value) => {
    expect(pinsResponseSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ['latitude past 90', { ...pin, lat: 91 }],
    ['longitude past 180', { ...pin, lng: 181 }],
    ['lat as a string', { ...pin, lat: '43' }],
    ['no name', { id: 'p1', cuisine_code: 'IT', lat: 1, lng: 1 }],
    ['empty id', { ...pin, id: '' }],
  ])('rejects a bad pin: %s', (_label, value) => {
    expect(pinSchema.safeParse(value).success).toBe(false);
  });

  it('never accepts more than the server cap', () => {
    const pins = Array.from({ length: MAX_PINS + 1 }, (_, i) => ({ ...pin, id: `p${i}` }));
    expect(pinsResponseSchema.safeParse({ ...response, pins }).success).toBe(false);
    expect(
      pinsResponseSchema.safeParse({ ...response, pins: pins.slice(0, MAX_PINS) }).success,
    ).toBe(true);
  });
});
