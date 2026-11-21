import { snapPoint, type SnappedPoint } from '@/features/map/region';
import { supabase } from '@/lib/supabase';

import {
  createOffersServer,
  makeOffer,
  manyOffers,
  md5,
  OFFERS_NOW,
  offerId,
  type OffersServer,
} from '../__fixtures__/offers';
import { NETWORK_ERROR, pgError } from '../__fixtures__/promotion';
import { fetchOffersNear, mapOfferError, OfferAppError, type OfferErrorCode } from '../api';
import { offerErrorMessage } from '../messages';
import { DEFAULT_OFFER_FILTERS, type OfferFilters } from '../schema';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;
const OSHAWA = snapPoint(43.8971, -78.8658) as SnappedPoint;
let server: OffersServer;

async function codeOf(promise: Promise<unknown>): Promise<OfferErrorCode | 'none'> {
  try {
    await promise;
    return 'none';
  } catch (error) {
    return error instanceof OfferAppError ? error.code : 'none';
  }
}

beforeEach(() => {
  server = createOffersServer({ rows: [makeOffer()] });
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => server.rpc(name, args));
});

afterEach(() => {
  rpc.mockReset();
});

describe('fetchOffersNear', () => {
  it('sends the snapped point and the filters, All as null and tables false', async () => {
    await fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, null);
    expect(rpc).toHaveBeenCalledWith('list_offers_near', {
      p_lat: 43.9,
      p_lng: -78.85,
      p_distance_km: 15,
      p_category: null,
      p_type: null,
      p_tables: false,
      p_cursor: null,
    });
  });

  it('is a POST: exactly two arguments, never an options object such as { get: true }', async () => {
    await fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, null);
    expect(rpc.mock.calls).toHaveLength(1);
    expect(rpc.mock.calls[0]).toHaveLength(2);
  });

  it('sends every filter and the cursor untouched', async () => {
    const filters: OfferFilters = {
      distanceKm: 30,
      category: 'new_dish',
      type: 'homemade',
      tables: true,
    };
    const cursor = `2026-11-20|0|${md5(offerId(3) + '2026-11-20')}|${offerId(3)}`;
    await fetchOffersNear(OSHAWA, filters, cursor);
    expect(rpc).toHaveBeenCalledWith('list_offers_near', {
      p_lat: 43.9,
      p_lng: -78.85,
      p_distance_km: 30,
      p_category: 'new_dish',
      p_type: 'homemade',
      p_tables: true,
      p_cursor: cursor,
    });
  });

  it('sends only the two numbers of the point, whatever else the object carries', async () => {
    const extra = { ...OSHAWA, exact: { lat: 43.8971, lng: -78.8658 } } as unknown as SnappedPoint;
    await fetchOffersNear(extra, DEFAULT_OFFER_FILTERS, null);
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/8971|8658/);
  });

  it('answers the parsed page', async () => {
    const page = await fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, null);
    expect(page).toEqual({ offers: [makeOffer()], next_cursor: null });
  });

  it('refuses a page that breaks the contract (an extra key) as unknown', async () => {
    server.answerNext = { offers: [makeOffer({ owner_id: 'u1' })], next_cursor: null };
    expect(await codeOf(fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, null))).toBe('unknown');
    server.answerNext = null;
    expect(await codeOf(fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, null))).toBe('unknown');
  });

  it('gets each server refusal by name, from the faithful fake', async () => {
    const raw = { lat: 43.8971, lng: -78.8658 } as unknown as SnappedPoint;
    expect(await codeOf(fetchOffersNear(raw, DEFAULT_OFFER_FILTERS, null))).toBe('invalid_point');
    expect(
      await codeOf(
        fetchOffersNear(OSHAWA, { ...DEFAULT_OFFER_FILTERS, distanceKm: 10 as 15 }, null),
      ),
    ).toBe('invalid_distance');
    expect(
      await codeOf(
        fetchOffersNear(
          OSHAWA,
          { ...DEFAULT_OFFER_FILTERS, category: 'discount' as 'featured' },
          null,
        ),
      ),
    ).toBe('invalid_filter');
    expect(await codeOf(fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, 'page-2'))).toBe(
      'invalid_cursor',
    );
    server.quota = 0;
    expect(await codeOf(fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, null))).toBe('rate_limited');
  });
});

describe('mapOfferError', () => {
  it.each([
    'invalid_point',
    'invalid_distance',
    'invalid_filter',
    'invalid_cursor',
    'rate_limited',
  ] as const)('maps %s', (name) => {
    expect(mapOfferError(pgError(name)).code).toBe(name);
  });

  it('maps a lost connection to network', () => {
    expect(mapOfferError(NETWORK_ERROR).code).toBe('network');
    expect(mapOfferError({ message: 'Failed to fetch' }).code).toBe('network');
  });

  it('maps anything else to unknown, without carrying the server text', () => {
    const timeout = { code: '57014', message: 'canceling statement due to statement timeout' };
    expect(mapOfferError(timeout).code).toBe('unknown');
    expect(mapOfferError(timeout).message).toBe('unknown');
    expect(mapOfferError(pgError('constructor')).code).toBe('unknown');
    expect(mapOfferError(pgError('not_found')).code).toBe('unknown');
    expect(mapOfferError({ code: 'P0002', message: 'rate_limited' }).code).toBe('unknown');
    expect(mapOfferError(null).code).toBe('unknown');
    expect(mapOfferError('boom').code).toBe('unknown');
  });

  it('keeps an OfferAppError as it is', () => {
    const error = new OfferAppError('rate_limited');
    expect(mapOfferError(error)).toBe(error);
  });
});

describe('offerErrorMessage', () => {
  it.each([
    'invalid_point',
    'invalid_distance',
    'invalid_filter',
    'invalid_cursor',
    'rate_limited',
    'network',
    'unknown',
  ] as const)('has plain words for %s', (code) => {
    const text = offerErrorMessage(code);
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toMatch(/invalid|cursor|rate_limited|P0001/);
  });
});

describe('the fake server (the test double itself)', () => {
  it('computes md5 like Postgres (RFC 1321 vectors)', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(
      md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890'),
    ).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('pages 45 offers as 20, 20 and 5 with the SQL cursor text', async () => {
    server = createOffersServer({ rows: manyOffers(45) });
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const page = await fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, cursor);
      sizes.push(page.offers.length);
      seen.push(...page.offers.map((o) => o.business_id));
      cursor = page.next_cursor;
      if (cursor) expect(cursor.startsWith('2026-11-20|0|')).toBe(true);
    } while (cursor);
    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(seen).size).toBe(45);
  });

  it('accepts a cursor from yesterday and refuses one from two days ago', async () => {
    server = createOffersServer({ rows: manyOffers(25) });
    const first = await fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, null);
    server.now = new Date(OFFERS_NOW.getTime() + 86_400_000);
    expect(await codeOf(fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, first.next_cursor))).toBe(
      'none',
    );
    server.now = new Date(OFFERS_NOW.getTime() + 2 * 86_400_000);
    expect(await codeOf(fetchOffersNear(OSHAWA, DEFAULT_OFFER_FILTERS, first.next_cursor))).toBe(
      'invalid_cursor',
    );
  });
});
