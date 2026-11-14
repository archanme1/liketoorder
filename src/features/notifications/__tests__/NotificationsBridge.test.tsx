import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';

import { NotificationsBridge } from '../components/NotificationsBridge';
import { resetPrimerMomentForTests } from '../primerMoment';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/restaurants',
}));

const authValue: AuthContextValue = {
  session: null,
  isLoading: false,
  isRecovering: false,
  notice: null,
  prepareRecovery: jest.fn(),
  abandonRecovery: jest.fn(),
  markRecovering: jest.fn(),
  clearRecovering: jest.fn(),
  dismissNotice: jest.fn(),
};

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  resetPrimerMomentForTests();
  jest.clearAllMocks();
});

describe('NotificationsBridge', () => {
  it('shows a push that arrives in the foreground as a banner with sound, never an icon badge', async () => {
    await render(
      <AuthContext.Provider value={authValue}>
        <QueryClientProvider client={client}>
          <NotificationsBridge />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1));
    const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls[0][0];
    await expect(handler?.handleNotification({} as Notifications.Notification)).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
    // Nothing opens at launch.
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
