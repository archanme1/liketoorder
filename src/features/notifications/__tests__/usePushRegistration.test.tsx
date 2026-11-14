import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import { supabase } from '@/lib/supabase';

import { usePushRegistration } from '../hooks/usePushRegistration';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { readStoredToken } from '../tokenStore';

import {
  OTHER_TEST_TOKEN,
  TEST_TOKEN,
  deviceToken,
  fakeNotifications,
} from '../__fixtures__/notifications';

// The client's current session follows `mockSession.userId` (what getSignedInUserId reads).
const mockSession: { userId: string | null } = { userId: 'user-1' };
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: mockSession.userId ? { user: { id: mockSession.userId } } : null },
      })),
    },
  },
}));

// expo-constants under jest-expo has a non-configurable expoConfig getter; fake the two fields
// pushModule reads. Default here: built after `eas init` (projectId.test.ts covers "no id").
const mockProject: { id: string | undefined } = { id: '11111111-2222-4333-8444-555555555555' };
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {
        name: 'LikeToOrder',
        slug: 'liketoorder',
        extra: { eas: { projectId: mockProject.id } },
      };
    },
    easConfig: null,
  },
}));

const db = supabase as unknown as { rpc: jest.Mock };
const fakeDevice = Device as typeof Device & { __setIsDevice: (value: boolean) => void };
const getPermission = jest.mocked(Notifications.getPermissionsAsync);
const getToken = jest.mocked(Notifications.getExpoPushTokenAsync);
const defaultGet = getPermission.getMockImplementation();
const defaultToken = getToken.getMockImplementation();
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

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

/** Mounts the hook and waits until the permission has been read, so "nothing" can be asserted. */
async function mount() {
  const view = await renderHook(
    () => {
      usePushRegistration();
      return useNotificationPermission().state;
    },
    { wrapper },
  );
  await waitFor(() => expect(view.result.current).toBeDefined());
  await act(flush);
  await act(flush);
  return view;
}

const registerCalls = () => db.rpc.mock.calls.filter(([name]) => name === 'register_push_token');

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  authValue = auth('user-1');
  mockSession.userId = 'user-1';
  await AsyncStorage.clear();
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({ data: null, error: null });
  permission('granted');
});

afterEach(async () => {
  await cleanup();
  client.clear();
  mockProject.id = '11111111-2222-4333-8444-555555555555';
  getPermission.mockImplementation(defaultGet);
  getToken.mockImplementation(defaultToken);
  jest.clearAllMocks();
});

describe('usePushRegistration', () => {
  it('registers this phone for the signed-in user and remembers the token', async () => {
    await mount();
    await waitFor(() =>
      expect(db.rpc).toHaveBeenCalledWith('register_push_token', {
        p_token: TEST_TOKEN,
        p_platform: 'ios',
      }),
    );
    await waitFor(async () => expect(await readStoredToken()).toBe(TEST_TOKEN));
  });

  it('on the Simulator registers nothing and does not throw (Decision 19)', async () => {
    fakeDevice.__setIsDevice(false);
    await mount();
    expect(getToken).not.toHaveBeenCalled();
    expect(registerCalls()).toHaveLength(0);
    await expect(readStoredToken()).resolves.toBeNull();
  });

  it('without an EAS project id registers nothing and does not throw (Decision 19)', async () => {
    mockProject.id = undefined;
    await mount();
    expect(getToken).not.toHaveBeenCalled();
    expect(registerCalls()).toHaveLength(0);
  });

  it('registers nothing before permission, then registers once it is granted', async () => {
    permission('undetermined');
    const view = await mount();
    expect(registerCalls()).toHaveLength(0);

    permission('granted');
    await act(() => client.invalidateQueries({ queryKey: ['notifications', 'permission'] }));
    await waitFor(() => expect(view.result.current).toBe('granted'));
    await waitFor(() => expect(registerCalls()).toHaveLength(1));
  });

  it('registers nothing when the permission is denied', async () => {
    permission('denied');
    await mount();
    expect(registerCalls()).toHaveLength(0);
  });

  it('registers nothing for a guest or during a password reset', async () => {
    authValue = auth(null);
    await mount();
    await cleanup();
    authValue = auth('user-1', true);
    await mount();
    expect(registerCalls()).toHaveLength(0);
  });

  it('registers again after a sign-in as someone else (the server moves the token)', async () => {
    const view = await mount();
    await waitFor(() => expect(registerCalls()).toHaveLength(1));
    authValue = auth('user-2');
    mockSession.userId = 'user-2';
    await view.rerender(undefined);
    await waitFor(() => expect(registerCalls()).toHaveLength(2));
  });

  it('registers the new token when the phone token changes', async () => {
    await mount();
    await waitFor(() => expect(registerCalls()).toHaveLength(1));
    getToken.mockResolvedValue({ type: 'expo', data: OTHER_TEST_TOKEN });
    await act(async () => fakeNotifications.__emitToken(deviceToken('device-token-2')));
    await waitFor(() =>
      expect(db.rpc).toHaveBeenLastCalledWith('register_push_token', {
        p_token: OTHER_TEST_TOKEN,
        p_platform: 'ios',
      }),
    );
    await waitFor(async () => expect(await readStoredToken()).toBe(OTHER_TEST_TOKEN));
  });

  it('if the person changed while the call was out, takes the token back off them (best effort)', async () => {
    // The register call is still out when the session changes (sign-out or another account).
    let finishRegister: () => void = () => undefined;
    db.rpc.mockImplementation((name: string) => {
      if (name === 'register_push_token') {
        return new Promise((resolve) => {
          finishRegister = () => resolve({ data: null, error: null });
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    await mount();
    await waitFor(() => expect(registerCalls()).toHaveLength(1));
    mockSession.userId = null;
    await act(async () => finishRegister());
    await waitFor(() =>
      expect(db.rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TEST_TOKEN }),
    );
    await waitFor(async () => expect(await readStoredToken()).toBeNull());
  });

  it('keeps the token when the person is still the same after the call', async () => {
    await mount();
    await waitFor(async () => expect(await readStoredToken()).toBe(TEST_TOKEN));
    expect(db.rpc).not.toHaveBeenCalledWith('unregister_push_token', expect.anything());
  });

  it('swallows a server error and stores nothing', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_input' } });
    await mount();
    await waitFor(() => expect(registerCalls()).toHaveLength(1));
    await act(flush);
    await expect(readStoredToken()).resolves.toBeNull();
  });

  it('stops listening for token changes when unmounted', async () => {
    const view = await mount();
    expect(fakeNotifications.__listenerCount()).toBe(1);
    await view.unmount();
    expect(fakeNotifications.__listenerCount()).toBe(0);
  });
});
