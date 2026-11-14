import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';

import { usePrimerOpener } from '../hooks/usePrimerMoment';
import {
  PRIMER_KEY_PREFIX,
  getPendingPrimer,
  requestPrimer,
  resetPrimerMomentForTests,
} from '../primerMoment';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const mockRoute = { pathname: '/requests/new' };
// The real client would start its auth storage and timers on import (via AuthProvider).
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockRoute.pathname,
}));

// Generous, so a stalled event loop on a busy CI machine cannot open the primer early.
const SETTLE = 400;
const getPermission = jest.mocked(Notifications.getPermissionsAsync);
const defaultGet = getPermission.getMockImplementation();

/** Real time passing, for "nothing happened" checks (no fake timers). */
const passTime = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

function permission(status: 'undetermined' | 'granted' | 'denied') {
  getPermission.mockResolvedValue({
    status,
    granted: status === 'granted',
    canAskAgain: status !== 'denied',
    expires: 'never',
  } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
}

function auth(userId: string | null, isRecovering = false): AuthContextValue {
  return {
    session: userId ? ({ user: { id: userId } } as unknown as AuthContextValue['session']) : null,
    isLoading: false,
    isRecovering,
    notice: null,
    prepareRecovery: jest.fn(),
    abandonRecovery: jest.fn(),
    markRecovering: jest.fn(),
    clearRecovering: jest.fn(),
    dismissNotice: jest.fn(),
  };
}

let client: QueryClient;
let authValue: AuthContextValue;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}

async function mount() {
  const view = await renderHook(() => usePrimerOpener(SETTLE), { wrapper });
  // Let the permission read land first.
  await passTime(20);
  return view;
}

beforeEach(async () => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  authValue = auth('user-1');
  mockRoute.pathname = '/requests/new';
  permission('undetermined');
  await AsyncStorage.clear();
});

afterEach(async () => {
  await cleanup();
  client.clear();
  resetPrimerMomentForTests();
  getPermission.mockImplementation(defaultGet);
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const opened = () => mockRouter.push.mock.calls;

describe('usePrimerOpener (Decision 7)', () => {
  it('opens the primer once the screen has settled after a moment, with the role', async () => {
    await mount();
    await act(async () => requestPrimer('customer'));
    await waitFor(() => expect(opened()).toHaveLength(1));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/notifications/allow',
      params: { role: 'customer' },
    });
    expect(getPendingPrimer()).toBeNull();
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(`${PRIMER_KEY_PREFIX}user-1`)).toBe('1'),
    );
  });

  it('never opens at launch: mounting alone does nothing', async () => {
    await mount();
    await passTime(SETTLE * 2);
    expect(opened()).toHaveLength(0);
  });

  it('never opens while a navigation is in progress; opens once the route stays put', async () => {
    const view = await mount();
    await act(async () => requestPrimer('customer'));
    // The route keeps changing faster than the settle time (each change restarts the wait).
    for (const path of [
      '/requests',
      '/requests/a',
      '/requests',
      '/requests/b',
      '/requests',
      '/manage',
    ]) {
      await passTime(SETTLE / 4);
      mockRoute.pathname = path;
      await view.rerender(undefined);
    }
    expect(opened()).toHaveLength(0);
    await waitFor(() => expect(opened()).toHaveLength(1));
  });

  it('after View my requests (a navigation), waits for that navigation before opening', async () => {
    const view = await mount();
    await act(async () => requestPrimer('customer'));
    await passTime(SETTLE / 2);
    mockRoute.pathname = '/requests';
    await view.rerender(undefined);
    await passTime(SETTLE * 0.75);
    // Less than one settle time since the navigation: still waiting.
    expect(opened()).toHaveLength(0);
    await waitFor(() => expect(opened()).toHaveLength(1));
  });

  it('does not open over a notification screen', async () => {
    mockRoute.pathname = '/notifications/allow';
    await mount();
    await act(async () => requestPrimer('owner'));
    await passTime(SETTLE * 2);
    expect(opened()).toHaveLength(0);
  });

  it.each(['granted', 'denied'] as const)(
    'does nothing when the phone permission is %s',
    async (state) => {
      permission(state);
      await mount();
      await act(async () => requestPrimer('customer'));
      await passTime(SETTLE * 2);
      expect(opened()).toHaveLength(0);
      expect(getPendingPrimer()).toBeNull();
    },
  );

  it('does nothing for a guest or during a password reset', async () => {
    authValue = auth(null);
    await mount();
    await act(async () => requestPrimer('customer'));
    await passTime(SETTLE * 2);
    await cleanup();
    authValue = auth('user-1', true);
    await mount();
    await act(async () => requestPrimer('customer'));
    await passTime(SETTLE * 2);
    expect(opened()).toHaveLength(0);
  });

  it('Not now is remembered per person: not again for them, still offered to someone else', async () => {
    await AsyncStorage.setItem(`${PRIMER_KEY_PREFIX}user-1`, '1');
    await mount();
    await act(async () => requestPrimer('customer'));
    await passTime(SETTLE * 2);
    expect(opened()).toHaveLength(0);

    await cleanup();
    authValue = auth('user-2');
    await mount();
    await act(async () => requestPrimer('customer'));
    await waitFor(() => expect(opened()).toHaveLength(1));
  });

  it('opens at most once per app run, even when the stored flag cannot be written', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));
    await mount();
    await act(async () => requestPrimer('customer'));
    await waitFor(() => expect(opened()).toHaveLength(1));
    await act(async () => requestPrimer('owner'));
    await passTime(SETTLE * 2);
    expect(opened()).toHaveLength(1);
  });

  it('does not nag when the stored flag cannot be read', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('disk'));
    await mount();
    await act(async () => requestPrimer('customer'));
    await passTime(SETTLE * 2);
    expect(opened()).toHaveLength(0);
  });
});
