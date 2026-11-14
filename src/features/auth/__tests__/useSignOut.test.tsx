import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
  UNREGISTER_TIMEOUT_MS,
  readStoredToken,
  saveStoredToken,
} from '@/features/notifications/tokenStore';
import { supabase } from '@/lib/supabase';

import { AuthContext, type AuthContextValue } from '../components/AuthProvider';
import { useSignOut } from '../hooks/useSignOut';

const TOKEN = 'ExponentPushToken[test-0001]';

// One ordered log of what reached the server, so the test can see unregister came first.
const mockCalls: string[] = [];
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(async (name: string) => {
      mockCalls.push(`rpc:${name}`);
      return { data: null, error: null };
    }),
    auth: {
      signOut: jest.fn(async () => {
        mockCalls.push('auth:signOut');
        return { error: null };
      }),
    },
  },
}));

const db = supabase as unknown as { rpc: jest.Mock; auth: { signOut: jest.Mock } };
const defaultRpc = db.rpc.getMockImplementation();

let client: QueryClient;
let authValue: AuthContextValue;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}

beforeEach(async () => {
  // Mutations get gcTime 0 too: a finished mutation's default 5-minute timer would hold jest open.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  authValue = {
    session: { user: { id: 'user-1' } } as unknown as AuthContextValue['session'],
    isLoading: false,
    isRecovering: false,
    notice: null,
    prepareRecovery: jest.fn(),
    abandonRecovery: jest.fn(),
    markRecovering: jest.fn(),
    clearRecovering: jest.fn(async () => {
      mockCalls.push('clearRecovering');
    }),
    dismissNotice: jest.fn(),
  };
  mockCalls.length = 0;
  await AsyncStorage.clear();
});

afterEach(async () => {
  await cleanup();
  client.clear();
  db.rpc.mockImplementation(defaultRpc);
  jest.clearAllMocks();
});

async function signOutWith(options?: Parameters<typeof useSignOut>[0]) {
  const { result } = await renderHook(() => useSignOut(options), { wrapper });
  await act(async () => {
    await result.current.mutateAsync();
  });
  return result;
}

describe('useSignOut and this phone push token (spec 12)', () => {
  it('removes the token BEFORE signing out, while the session can still authorize it', async () => {
    await saveStoredToken(TOKEN);
    const result = await signOutWith();
    expect(mockCalls).toEqual(['rpc:unregister_push_token', 'auth:signOut', 'clearRecovering']);
    expect(db.rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TOKEN });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await expect(readStoredToken()).resolves.toBeNull();
  });

  it('signs out without a server call when this phone never registered', async () => {
    await signOutWith();
    expect(mockCalls).toEqual(['auth:signOut', 'clearRecovering']);
  });

  it('still signs out when removing the token fails', async () => {
    await saveStoredToken(TOKEN);
    db.rpc.mockImplementationOnce(async (name: string) => {
      mockCalls.push(`rpc:${name}`);
      return { data: null, error: { code: 'P0001', message: 'not_signed_in' } };
    });
    const result = await signOutWith();
    expect(mockCalls).toEqual(['rpc:unregister_push_token', 'auth:signOut', 'clearRecovering']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('still signs out when the server never answers (gives up after the timeout)', async () => {
    await saveStoredToken(TOKEN);
    db.rpc.mockImplementationOnce((name: string) => {
      mockCalls.push(`rpc:${name}`);
      return new Promise(() => undefined);
    });
    const result = await signOutWith({ unregisterTimeoutMs: 20 });
    expect(mockCalls).toEqual(['rpc:unregister_push_token', 'auth:signOut', 'clearRecovering']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('waits at most 3 seconds by default', () => {
    expect(UNREGISTER_TIMEOUT_MS).toBe(3000);
  });
});
