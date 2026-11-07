import { MAX_PINS, pinsResponseSchema, pinSchema, restaurantDetailsSchema } from '../schema';

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

const details = {
  id: 'b1',
  name: "Joe's",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  public_address: '1 King St, Oshawa',
  place_id: 'FAKE_PLACE_1',
  currency_code: 'CAD',
  photos: [{ id: 'ph1', kind: 'cover', path: 'b1/cover.jpg', position: null, menu_item_id: null }],
  items: [
    {
      id: 'i1',
      name: 'Pizza',
      description: null,
      price_minor: 1695,
      is_available: true,
      position: 1,
    },
  ],
};

describe('restaurant details schema', () => {
  it('accepts the details answer, including no address, currency or items', () => {
    expect(restaurantDetailsSchema.safeParse(details).success).toBe(true);
    expect(
      restaurantDetailsSchema.safeParse({
        ...details,
        public_address: null,
        currency_code: null,
        photos: [],
        items: [],
      }).success,
    ).toBe(true);
  });

  it.each(['lat', 'lng', 'map_lat', 'map_lng', 'resolved_at', 'place_status', 'owner_id', 'extra'])(
    'rejects an extra top-level "%s" field',
    (field) => {
      expect(restaurantDetailsSchema.safeParse({ ...details, [field]: 1 }).success).toBe(false);
    },
  );

  it('rejects extra fields on photos and items', () => {
    expect(
      restaurantDetailsSchema.safeParse({
        ...details,
        photos: [{ ...details.photos[0], status: 'ready' }],
      }).success,
    ).toBe(false);
    expect(
      restaurantDetailsSchema.safeParse({
        ...details,
        items: [{ ...details.items[0], business_id: 'b1' }],
      }).success,
    ).toBe(false);
  });

  it.each([
    ['no place_id', { ...details, place_id: undefined }],
    ['empty place_id', { ...details, place_id: '' }],
    ['unknown photo kind', { ...details, photos: [{ ...details.photos[0], kind: 'logo' }] }],
    ['price as a string', { ...details, items: [{ ...details.items[0], price_minor: '1695' }] }],
    ['fractional price', { ...details, items: [{ ...details.items[0], price_minor: 16.95 }] }],
    ['not an object', 'x'],
  ])('rejects malformed details: %s', (_label, value) => {
    expect(restaurantDetailsSchema.safeParse(value).success).toBe(false);
  });
});
