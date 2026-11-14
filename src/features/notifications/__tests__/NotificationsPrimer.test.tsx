import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';

import { NotificationsPrimer } from '../components/NotificationsPrimer';
import { PRIMER_KEY_PREFIX, hasOpenedThisRun, resetPrimerMomentForTests } from '../primerMoment';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
// The real client would start its auth storage and timers on import (via AuthProvider).
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const askPermission = jest.mocked(Notifications.requestPermissionsAsync);

const authValue: AuthContextValue = {
  session: { user: { id: 'user-1' } } as unknown as AuthContextValue['session'],
  isLoading: false,
  isRecovering: false,
  notice: null,
  prepareRecovery: jest.fn(),
  abandonRecovery: jest.fn(),
  markRecovering: jest.fn(),
  clearRecovering: jest.fn(),
  dismissNotice: jest.fn(),
};

// Without starting metrics SafeAreaProvider renders nothing under jest.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let client: QueryClient;
async function show(role: 'customer' | 'owner' = 'customer') {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthContext.Provider value={authValue}>
        <QueryClientProvider client={client}>
          <NotificationsPrimer role={role} />
        </QueryClientProvider>
      </AuthContext.Provider>
    </SafeAreaProvider>,
  );
}

beforeEach(async () => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  await AsyncStorage.clear();
});

afterEach(async () => {
  await cleanup();
  client.clear();
  resetPrimerMomentForTests();
  mockRouter.canGoBack.mockReturnValue(true);
  jest.clearAllMocks();
});

describe('NotificationsPrimer', () => {
  it('explains what a customer gets, before any system prompt', async () => {
    await show('customer');
    expect(screen.getByRole('header', { name: 'Turn on notifications' })).toBeOnTheScreen();
    expect(
      screen.getByText("We'll let you know when a place answers your request."),
    ).toBeOnTheScreen();
    expect(askPermission).not.toHaveBeenCalled();
  });

  it('explains what an owner gets', async () => {
    await show('owner');
    expect(screen.getByText("We'll let you know when a new request arrives.")).toBeOnTheScreen();
  });

  it('never describes anything as confirmed', async () => {
    await show('customer');
    expect(screen.queryByText(/confirm/i)).toBeNull();
  });

  it('counts as asked the moment it opens (so a swipe-away counts too)', async () => {
    await show();
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(`${PRIMER_KEY_PREFIX}user-1`)).toBe('1'),
    );
    expect(hasOpenedThisRun('user-1')).toBe(true);
  });

  it('closed while the system prompt was up: nothing navigates afterwards (review S7)', async () => {
    let answer: () => void = () => undefined;
    askPermission.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () =>
            resolve({ status: 'granted', granted: true, canAskAgain: true, expires: 'never' } as Awaited<
              ReturnType<typeof Notifications.requestPermissionsAsync>
            >);
        }),
    );
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on notifications' }));
    await waitFor(() => expect(askPermission).toHaveBeenCalledTimes(1));
    await cleanup();
    answer();
    await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('Turn on shows the system prompt, then closes', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on notifications' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(askPermission).toHaveBeenCalledTimes(1);
  });

  it('Not now closes without asking the system', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(askPermission).not.toHaveBeenCalled();
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(`${PRIMER_KEY_PREFIX}user-1`)).toBe('1'),
    );
  });

  it('with nothing to go back to, closes to Profile', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/profile');
  });

  it('says what Turn on does for a screen reader', async () => {
    await show();
    expect(
      screen.getByHintText('Your phone will ask you to allow notifications.'),
    ).toBeOnTheScreen();
  });
});
