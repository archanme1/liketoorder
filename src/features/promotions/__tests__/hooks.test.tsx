import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useSession } from '@/features/auth/hooks/useSession';
import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { supabase } from '@/lib/supabase';

import {
  createFakeServer,
  pgError,
  PROMOTION_ID,
  storedRow,
  type FakeServer,
} from '../__fixtures__/promotion';
import type { PromotionErrorCode } from '../api';
import { useCancelPromotion } from '../hooks/useCancelPromotion';
import { myPromotionKey, useMyPromotion } from '../hooks/useMyPromotion';
import { useRequestPromotion } from '../hooks/useRequestPromotion';
import type { MyPromotion } from '../schema';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/features/auth/hooks/useSession', () => ({ useSession: jest.fn() }));

const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;
const mockedSession = jest.mocked(useSession);
const REQUEST = { category: 'featured' as const, headline: 'Fresh tacos', preferredStart: null };

let client: QueryClient;
let server: FakeServer;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function signedIn({ recovering = false } = {}) {
  mockedSession.mockReturnValue({
    session: { user: { id: 'u1' } },
    isRecovering: recovering,
  } as unknown as ReturnType<typeof useSession>);
}

const reads = () => rpc.mock.calls.filter(([name]) => name === 'get_my_promotion').length;

beforeEach(() => {
  client = new QueryClient(testClientOptions());
  server = createFakeServer();
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => server.rpc(name, args));
  signedIn();
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('@/lib/supabase', '@/features/auth/hooks/useSession');
});

describe('useMyPromotion', () => {
  it("loads the seller's own answer", async () => {
    server.rows.push(storedRow('active'));
    const { result } = await renderHook(() => useMyPromotion(), { wrapper });
    await waitFor(() => expect(result.current.data?.promotion?.state).toBe('active'));
    expect(result.current.data?.settings).toEqual({
      price_cents: 2500,
      currency_code: 'CAD',
      length_days: 7,
    });
  });

  it('does not ask the server for a guest', async () => {
    mockedSession.mockReturnValue({
      session: null,
      isRecovering: false,
    } as unknown as ReturnType<typeof useSession>);
    const { result } = await renderHook(() => useMyPromotion(), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not ask the server mid-recovery', async () => {
    signedIn({ recovering: true });
    await renderHook(() => useMyPromotion(), { wrapper });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('gives a coded error when the connection is lost', async () => {
    server.failNext();
    const { result } = await renderHook(() => useMyPromotion(), { wrapper });
    await waitFor(() => expect(result.current.error?.code).toBe('network'));
  });
});

describe('useRequestPromotion and useCancelPromotion: the cache', () => {
  async function screenHooks() {
    const hook = await renderHook(
      () => ({ mine: useMyPromotion(), send: useRequestPromotion(), cancel: useCancelPromotion() }),
      { wrapper },
    );
    await waitFor(() => expect(hook.result.current.mine.isSuccess).toBe(true));
    return hook;
  }

  it('shows a sent request at once from the answer, then reads the server again', async () => {
    const { result } = await screenHooks();
    expect(result.current.mine.data?.promotion).toBeNull();
    const before = reads();
    const setData = jest.spyOn(client, 'setQueryData');

    await act(async () => {
      await result.current.send.mutateAsync(REQUEST);
    });

    expect(setData).toHaveBeenCalledWith(
      myPromotionKey,
      expect.objectContaining({ promotion: expect.objectContaining({ state: 'requested' }) }),
    );
    await waitFor(() => expect(result.current.mine.data?.promotion?.state).toBe('requested'));
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it('shows Cancelled after a cancel, with no stale state left', async () => {
    server.rows.push(storedRow('scheduled'));
    const { result } = await screenHooks();
    expect(result.current.mine.data?.promotion?.state).toBe('scheduled');
    const before = reads();

    await act(async () => {
      await result.current.cancel.mutateAsync(PROMOTION_ID);
    });

    await waitFor(() => expect(result.current.mine.data?.promotion?.state).toBe('cancelled'));
    await waitFor(() => expect(reads()).toBe(before + 1));
    expect((client.getQueryData(myPromotionKey) as MyPromotion).promotion?.state).toBe('cancelled');
  });

  it.each([
    'already_open',
    'not_eligible',
    'not_configured',
    'not_found',
    'not_cancellable',
    'contact_support',
  ] as const)('re-reads the server after the refusal %s', async (code) => {
    const { result } = await screenHooks();
    const before = reads();
    rpc.mockResolvedValueOnce({ data: null, error: pgError(code) });

    await act(async () => {
      await result.current.send.mutateAsync(REQUEST).catch(() => undefined);
    });

    await waitFor(() => expect(result.current.send.error?.code).toBe(code));
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it.each(['invalid_headline', 'too_many_requests', 'invalid_start'] as PromotionErrorCode[])(
    'does not re-read after %s (nothing changed on the server)',
    async (code) => {
      const { result } = await screenHooks();
      const invalidate = jest.spyOn(client, 'invalidateQueries');
      rpc.mockResolvedValueOnce({ data: null, error: pgError(code) });

      await act(async () => {
        await result.current.send.mutateAsync(REQUEST).catch(() => undefined);
      });

      await waitFor(() => expect(result.current.send.error?.code).toBe(code));
      expect(invalidate).not.toHaveBeenCalled();
    },
  );

  it('the fake server refuses a second request with already_open, as the real one does', async () => {
    const { result } = await screenHooks();
    await act(async () => {
      await result.current.send.mutateAsync(REQUEST);
    });
    await act(async () => {
      await result.current.send.mutateAsync(REQUEST).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.send.error?.code).toBe('already_open'));
    expect(server.rows).toHaveLength(1);
  });
});
