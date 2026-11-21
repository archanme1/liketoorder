import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { snapPoint, type SnappedPoint } from '@/features/map/region';
import { supabase } from '@/lib/supabase';

import {
  createOffersServer,
  makeOffer,
  manyOffers,
  OFFERS_NOW,
  offerId,
  type OffersCall,
  type OffersServer,
} from '../__fixtures__/offers';
import { NETWORK_ERROR, pgError } from '../__fixtures__/promotion';
import { flattenOffers, offersKey, offersKeyRoot, useOffers } from '../hooks/useOffers';
import { DEFAULT_OFFER_FILTERS, type OfferFilters, type OffersPage } from '../schema';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;
const DAY_MS = 86_400_000;
// The real position stays in the test; only its snapped form reaches the hook.
const RAW = { lat: 43.8971, lng: -78.8658 };
const POINT = snapPoint(RAW.lat, RAW.lng) as SnappedPoint;

let client: QueryClient;
let server: OffersServer;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type Props = { point: SnappedPoint | null; filters: OfferFilters };

async function renderOffers(initial: Props = { point: POINT, filters: DEFAULT_OFFER_FILTERS }) {
  return renderHook(({ point, filters }: Props) => useOffers(point, filters), {
    wrapper,
    initialProps: initial,
  });
}

const calls = (): OffersCall[] => server.calls;
const ids = (offers: { business_id: string }[]) => offers.map((o) => o.business_id);

beforeEach(() => {
  client = new QueryClient(testClientOptions());
  server = createOffersServer({ rows: manyOffers(45) });
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => server.rpc(name, args));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('@/lib/supabase');
});

describe('useOffers', () => {
  it('loads page 1 under a key holding the snapped point, never the raw position', async () => {
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.offers).toHaveLength(20);
    expect(result.current.hasNextPage).toBe(true);

    const keys = client
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toEqual([offersKey(POINT, DEFAULT_OFFER_FILTERS)]);
    expect(keys[0]).toEqual(['offers', 'list', 43.9, -78.85, 15, 'all', 'all', false]);
    expect(JSON.stringify(keys)).not.toMatch(/8971|8658/);
    expect(calls()[0]).toMatchObject({ p_lat: 43.9, p_lng: -78.85, p_cursor: null });
  });

  it('asks for nothing until there is a point', async () => {
    const { result } = await renderOffers({ point: null, filters: DEFAULT_OFFER_FILTERS });
    await act(async () => {});
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.offers).toEqual([]);
  });

  it('pages 45 offers as 20, 20 and 5, each once, in the server order', async () => {
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.offers).toHaveLength(20));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.offers).toHaveLength(40));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.offers).toHaveLength(45));
    expect(result.current.hasNextPage).toBe(false);
    expect(new Set(ids(result.current.offers)).size).toBe(45);
    expect(calls().map((c) => c.p_cursor === null)).toEqual([true, false, false]);

    // Nothing more to load: no extra call.
    await act(async () => {
      await result.current.loadMore();
    });
    expect(calls()).toHaveLength(3);
  });

  it('starts a new list for a new filter, with the new arguments', async () => {
    const { result, rerender } = await renderOffers();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const filters: OfferFilters = {
      distanceKm: 5,
      category: 'featured',
      type: 'restaurant',
      tables: true,
    };
    server.rows = manyOffers(3, { category: 'featured', accepts_table_requests: true });
    await rerender({ point: POINT, filters });
    await waitFor(() => expect(result.current.offers).toHaveLength(3));
    expect(calls().at(-1)).toEqual({
      p_lat: 43.9,
      p_lng: -78.85,
      p_distance_km: 5,
      p_category: 'featured',
      p_type: 'restaurant',
      p_tables: true,
      p_cursor: null,
    });
    expect(client.getQueryCache().find({ queryKey: offersKey(POINT, filters) })).toBeDefined();
  });

  it("keeps paging in yesterday's order after UTC midnight (the cursor carries its day)", async () => {
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.offers).toHaveLength(20));
    const before = ids(result.current.offers);
    server.now = new Date(OFFERS_NOW.getTime() + DAY_MS);
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.offers).toHaveLength(40));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.offers).toHaveLength(45));
    expect(ids(result.current.offers).slice(0, 20)).toEqual(before);
    expect(new Set(ids(result.current.offers)).size).toBe(45);
    expect(calls()[1].p_cursor?.startsWith('2026-11-20|')).toBe(true);
  });

  it('starts again at page 1, once, when the server refuses a cursor more than a day old', async () => {
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.offers).toHaveLength(20));
    server.now = new Date(OFFERS_NOW.getTime() + 2 * DAY_MS);
    await act(async () => {
      await result.current.loadMore();
    });
    // Back on page 1, in today's order, with today's cursor.
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.offers).toHaveLength(20);
    expect(calls().map((c) => c.p_cursor === null)).toEqual([true, false, true]);
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.offers).toHaveLength(40));
  });

  it('does not loop when the server keeps refusing cursors', async () => {
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.offers).toHaveLength(20));
    const real = server.rpc;
    rpc.mockImplementation((name: string, args?: Record<string, unknown>) =>
      args?.p_cursor
        ? Promise.resolve({ data: null, error: pgError('invalid_cursor') })
        : real(name, args),
    );
    await act(async () => {
      await result.current.loadMore();
    });
    await act(async () => {
      await result.current.loadMore();
    });
    // The first refusal restarts once; the second stays an error for the footer's Try again.
    expect(rpc.mock.calls.filter(([, a]) => a.p_cursor === null)).toHaveLength(2);
    expect(rpc.mock.calls.filter(([, a]) => a.p_cursor !== null)).toHaveLength(2);
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    expect(result.current.offers).toHaveLength(20);
  });

  it('gives a new list (a changed filter) its own quiet restart on a stale cursor', async () => {
    const { result, rerender } = await renderOffers();
    await waitFor(() => expect(result.current.offers).toHaveLength(20));
    // First list: its cursor is refused (more than a day old) and it restarts once.
    server.now = new Date(OFFERS_NOW.getTime() + 2 * DAY_MS);
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(calls().map((c) => c.p_cursor === null)).toEqual([true, false, true]);

    // A new list (About 30 km), then its cursor is refused too: it still gets its restart.
    await rerender({ point: POINT, filters: { ...DEFAULT_OFFER_FILTERS, distanceKm: 30 } });
    await waitFor(() => expect(calls().at(-1)?.p_distance_km).toBe(30));
    await waitFor(() => expect(result.current.offers).toHaveLength(20));
    server.now = new Date(OFFERS_NOW.getTime() + 4 * DAY_MS);
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.isError).toBe(false));
    const tail = calls().slice(-3);
    expect(tail.map((c) => [c.p_distance_km, c.p_cursor === null])).toEqual([
      [30, true],
      [30, false],
      [30, true],
    ]);
    expect(result.current.isFetchNextPageError).toBe(false);
  });

  it('does not ask again for a refused first page when the app comes back into focus', async () => {
    server.failAlways = pgError('rate_limited');
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.error?.code).toBe('rate_limited'));
    expect(calls()).toHaveLength(1);
    try {
      await act(async () => {
        focusManager.setFocused(false);
      });
      await act(async () => {
        focusManager.setFocused(true);
      });
      await act(async () => {});
      expect(calls()).toHaveLength(1);
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it('pull to refresh goes back to page 1 only', async () => {
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.offers).toHaveLength(20));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.offers).toHaveLength(40));
    server.rows = manyOffers(2);
    let ok = false;
    await act(async () => {
      ok = await result.current.refresh();
    });
    expect(ok).toBe(true);
    await waitFor(() => expect(result.current.offers).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.refreshFailed).toBe(false);
    expect(result.current.refreshing).toBe(false);
  });

  it('keeps the loaded list when a refresh fails, and says so', async () => {
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.offers).toHaveLength(20));
    server.failNext = NETWORK_ERROR;
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.refreshFailed).toBe(true));
    expect(result.current.offers).toHaveLength(20);
  });

  it('never retries a rate limit on its own', async () => {
    server.failAlways = pgError('rate_limited');
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.code).toBe('rate_limited');
    await act(async () => {});
    expect(calls()).toHaveLength(1);
  });

  it('never retries a refused request on its own', async () => {
    server.failAlways = pgError('invalid_point');
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.error?.code).toBe('invalid_point'));
    expect(calls()).toHaveLength(1);
  });

  it('tries a lost connection once more', async () => {
    server.failNext = NETWORK_ERROR;
    const { result } = await renderOffers();
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(calls()).toHaveLength(2);
  });

  it('shares one root key, so ended offers can be refreshed everywhere', () => {
    expect(offersKey(POINT, DEFAULT_OFFER_FILTERS).slice(0, 1)).toEqual([...offersKeyRoot]);
  });
});

describe('flattenOffers', () => {
  it('keeps the server order and lists each business once (first wins)', () => {
    const page = (offers: Record<string, unknown>[]): OffersPage =>
      ({ offers, next_cursor: null }) as unknown as OffersPage;
    const a = makeOffer({ business_id: offerId(1), name: 'A' });
    const b = makeOffer({ business_id: offerId(2), name: 'B' });
    const aLater = makeOffer({ business_id: offerId(1), name: 'A again' });
    const result = flattenOffers({
      pages: [page([a, b]), page([aLater])],
      pageParams: [null, 'x'],
    });
    expect(result.map((o) => o.name)).toEqual(['A', 'B']);
    expect(flattenOffers(undefined)).toEqual([]);
  });
});
