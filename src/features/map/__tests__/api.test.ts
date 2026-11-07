import { supabase } from '@/lib/supabase';

import { fetchPinsInBounds, fetchRestaurantDetails, MapAppError, mapMapError } from '../api';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const db = supabase as unknown as { rpc: jest.Mock; from: jest.Mock };
const box = { minLat: 43.1, maxLat: 43.9, minLng: -79.9, maxLng: -79.1 };
const pin = { id: 'p1', name: "Joe's", cuisine_code: 'IT', lat: 43.5, lng: -79.4 };

beforeEach(() => {
  db.rpc.mockReset();
  db.from.mockReset();
});

describe('fetchPinsInBounds', () => {
  it('sends the map box and nothing else', async () => {
    db.rpc.mockResolvedValue({ data: { pins: [], capped: false, too_large: false }, error: null });
    await fetchPinsInBounds(box);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith('map_restaurants_in_bounds', {
      p_min_lat: 43.1,
      p_max_lat: 43.9,
      p_min_lng: -79.9,
      p_max_lng: -79.1,
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('returns the parsed answer', async () => {
    const data = { pins: [pin], capped: true, too_large: false };
    db.rpc.mockResolvedValue({ data, error: null });
    await expect(fetchPinsInBounds(box)).resolves.toEqual(data);
  });

  it('refuses an answer with an unexpected field', async () => {
    db.rpc.mockResolvedValue({
      data: { pins: [{ ...pin, place_id: 'abc' }], capped: false, too_large: false },
      error: null,
    });
    await expect(fetchPinsInBounds(box)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('refuses a malformed answer', async () => {
    db.rpc.mockResolvedValue({ data: { pins: 'x' }, error: null });
    await expect(fetchPinsInBounds(box)).rejects.toBeInstanceOf(MapAppError);
    db.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchPinsInBounds(box)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('throws a coded error for a database error', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'rate_limited' } });
    await expect(fetchPinsInBounds(box)).rejects.toMatchObject({
      name: 'MapAppError',
      code: 'rate_limited',
    });
  });
});

describe('mapMapError', () => {
  it.each([
    [{ code: 'P0001', message: 'rate_limited' }, 'rate_limited'],
    [{ code: 'P0001', message: 'invalid_bounds' }, 'invalid_bounds'],
    [{ code: 'P0001', message: 'something_else' }, 'unknown'],
    [{ code: '42501', message: 'rate_limited' }, 'unknown'],
    [{ code: '', message: 'TypeError: Network request failed' }, 'network'],
    [{ code: '', message: 'fetch failed', details: null }, 'network'],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'unknown'],
    [null, 'unknown'],
    ['boom', 'unknown'],
  ])('maps %p to %s', (error, expected) => {
    expect(mapMapError(error).code).toBe(expected);
  });

  it('keeps an existing MapAppError as it is', () => {
    const error = new MapAppError('rate_limited');
    expect(mapMapError(error)).toBe(error);
  });

  it('carries only the code: no message from the server', () => {
    const mapped = mapMapError({ code: 'P0001', message: 'rate_limited', details: 'secret' });
    expect(mapped.message).toBe('rate_limited');
    expect(JSON.stringify(mapped)).not.toContain('secret');
  });
});

const detailsRow = {
  id: 'b1',
  name: "Joe's",
  cuisine_code: 'IT',
  accepts_table_requests: false,
  public_address: '1 King St',
  place_id: 'FAKE_PLACE_1',
  currency_code: 'CAD',
  photos: [],
  items: [],
};

describe('fetchRestaurantDetails', () => {
  it('sends the restaurant id and nothing else', async () => {
    db.rpc.mockResolvedValue({ data: detailsRow, error: null });
    await fetchRestaurantDetails('b1');
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith('get_restaurant_details', { p_business_id: 'b1' });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('returns the parsed details', async () => {
    db.rpc.mockResolvedValue({ data: detailsRow, error: null });
    await expect(fetchRestaurantDetails('b1')).resolves.toEqual(detailsRow);
  });

  it('returns null for "not available" (the same answer for every cause)', async () => {
    db.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchRestaurantDetails('b1')).resolves.toBeNull();
  });

  it('refuses details carrying an unexpected field', async () => {
    db.rpc.mockResolvedValue({ data: { ...detailsRow, resolved_at: '2026-01-01' }, error: null });
    await expect(fetchRestaurantDetails('b1')).rejects.toMatchObject({ code: 'unknown' });
  });

  it('refuses malformed details', async () => {
    db.rpc.mockResolvedValue({ data: 'oops', error: null });
    await expect(fetchRestaurantDetails('b1')).rejects.toMatchObject({ code: 'unknown' });
  });

  it('throws a coded error for a database error', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'rate_limited' } });
    await expect(fetchRestaurantDetails('b1')).rejects.toMatchObject({ code: 'rate_limited' });
  });
});
