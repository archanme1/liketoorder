import { supabase } from '@/lib/supabase';

import { fetchHomemadeDetails, fetchHomemadeInBounds } from '../api';
import { homemadeDetailsSchema } from '../schema';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const db = supabase as unknown as { rpc: jest.Mock; from: jest.Mock };
const box = { minLat: 43.1, maxLat: 43.9, minLng: -79.9, maxLng: -79.1 };
const pin = { id: 'h1', name: "Nonna Rosa's Table", cuisine_code: 'IT', lat: 43.5, lng: -79.4 };
const details = {
  id: 'h1',
  name: "Nonna Rosa's Table",
  cuisine_code: 'IT',
  currency_code: 'CAD',
  photos: [],
  items: [],
};

beforeEach(() => {
  db.rpc.mockReset();
  db.from.mockReset();
});

describe('fetchHomemadeInBounds', () => {
  it('calls map_homemade_in_bounds with the map box and nothing else', async () => {
    db.rpc.mockResolvedValue({ data: { pins: [], capped: false, too_large: false }, error: null });
    await fetchHomemadeInBounds(box);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith('map_homemade_in_bounds', {
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
    await expect(fetchHomemadeInBounds(box)).resolves.toEqual(data);
  });

  it.each([
    ['place_id', { place_id: 'abc' }],
    ['an address', { public_address: '1 King St' }],
    ['exact coordinates', { exact_lat: 43.5, exact_lng: -79.4 }],
    ['an extra key', { anything: 1 }],
  ])('refuses a pin that carries %s', async (_label, extra) => {
    db.rpc.mockResolvedValue({
      data: { pins: [{ ...pin, ...extra }], capped: false, too_large: false },
      error: null,
    });
    await expect(fetchHomemadeInBounds(box)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('maps a rate limit to a coded error', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'rate_limited' } });
    await expect(fetchHomemadeInBounds(box)).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('maps invalid_bounds to a coded error', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_bounds' } });
    await expect(fetchHomemadeInBounds(box)).rejects.toMatchObject({ code: 'invalid_bounds' });
  });
});

describe('fetchHomemadeDetails', () => {
  it('calls get_homemade_details with the id and nothing else', async () => {
    db.rpc.mockResolvedValue({ data: details, error: null });
    await fetchHomemadeDetails('h1');
    expect(db.rpc).toHaveBeenCalledWith('get_homemade_details', { p_business_id: 'h1' });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('returns null for "not available"', async () => {
    db.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchHomemadeDetails('h1')).resolves.toBeNull();
  });

  it('returns the parsed details', async () => {
    db.rpc.mockResolvedValue({ data: details, error: null });
    await expect(fetchHomemadeDetails('h1')).resolves.toEqual(details);
  });

  it.each([
    ['place_id', { place_id: 'FAKE_PLACE_1' }],
    ['an address', { public_address: '1 King St' }],
    ['a nested location', { location: { formatted_address: '1 King St', lat: 1, lng: 2 } }],
    ['map coordinates', { map_lat: 43.5, map_lng: -79.4 }],
    ['table requests', { accepts_table_requests: true }],
    ['resolved_at', { resolved_at: '2026-11-01T00:00:00Z' }],
    ['place_status', { place_status: 'ok' }],
  ])('refuses details that carry %s', async (_label, extra) => {
    db.rpc.mockResolvedValue({ data: { ...details, ...extra }, error: null });
    await expect(fetchHomemadeDetails('h1')).rejects.toMatchObject({ code: 'unknown' });
  });

  it('the schema itself is strict', () => {
    expect(homemadeDetailsSchema.safeParse(details).success).toBe(true);
    expect(homemadeDetailsSchema.safeParse({ ...details, place_id: 'x' }).success).toBe(false);
  });
});
