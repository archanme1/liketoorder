import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import { clearReturnTo, peekReturnTo, setReturnTo } from '@/features/auth/returnTo';
import * as profileApi from '@/features/profile/api';
import * as sellersApi from '@/features/sellers/api';
import { SellerAppError } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import { NotificationOpenResolver } from '../components/NotificationOpenResolver';

import { REQUEST_UUID } from '../__fixtures__/notifications';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));
jest.mock('@/features/profile/api', () => ({
  ...jest.requireActual('@/features/profile/api'),
  getMyProfile: jest.fn(),
}));

const businessMock = jest.mocked(sellersApi.getMyBusiness);
const profileMock = jest.mocked(profileApi.getMyProfile);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const SENT = { v: '1', kind: 'pickup', id: REQUEST_UUID, side: 'sent' };
const RECEIVED = { v: '1', kind: 'table', id: REQUEST_UUID, side: 'received' };
const SENT_HREF = `/notifications/open?v=1&kind=pickup&id=${REQUEST_UUID}&side=sent`;

function auth(signedIn: boolean, extra: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: signedIn
      ? ({ user: { id: 'user-1' } } as unknown as AuthContextValue['session'])
      : null,
    isLoading: false,
    isRecovering: false,
    notice: null,
    prepareRecovery: jest.fn(),
    abandonRecovery: jest.fn(),
    markRecovering: jest.fn(),
    clearRecovering: jest.fn(),
    dismissNotice: jest.fn(),
    ...extra,
  };
}

function asProfile(username: string | null) {
  profileMock.mockResolvedValue({
    id: 'user-1',
    username,
    display_name: 'Archan Me',
    bio: '',
    city: '',
    is_seller: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as Awaited<ReturnType<typeof profileApi.getMyProfile>>);
}

let client: QueryClient;
async function open(params: Record<string, string>, authValue: AuthContextValue = auth(true)) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthContext.Provider value={authValue}>
        <QueryClientProvider client={client}>
          <NotificationOpenResolver params={params} />
        </QueryClientProvider>
      </AuthContext.Provider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  asProfile('archan');
  businessMock.mockResolvedValue(null);
});

afterEach(async () => {
  await cleanup();
  client.clear();
  clearReturnTo();
  jest.clearAllMocks();
});

describe('NotificationOpenResolver', () => {
  it('sent: opens the customer detail with its kind', async () => {
    await open(SENT);
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/requests/[id]',
        params: { id: REQUEST_UUID, kind: 'pickup' },
      }),
    );
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  });

  it('received with a business: opens the owner detail', async () => {
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    await open(RECEIVED);
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/seller/requests/[id]',
        params: { id: REQUEST_UUID },
      }),
    );
  });

  it('received on an account with no business: the Requests tab with the neutral line, never onboarding', async () => {
    await open(RECEIVED);
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/requests',
        params: { notice: 'other-account' },
      }),
    );
    const everywhere = [...mockRouter.replace.mock.calls, ...mockRouter.push.mock.calls].flat();
    expect(JSON.stringify(everywhere)).not.toContain('onboarding');
    expect(JSON.stringify(everywhere)).not.toContain('/seller/requests');
  });

  it('received: waits for the business, and on an error offers Try again (no guess)', async () => {
    businessMock.mockRejectedValueOnce(new SellerAppError('network'));
    await open(RECEIVED);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(mockRouter.replace).not.toHaveBeenCalled();
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    await fireEvent.press(retry);
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/seller/requests/[id]',
        params: { id: REQUEST_UUID },
      }),
    );
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  });

  it('signed out: remembers itself exactly, goes to sign-in, and shows nothing private', async () => {
    await open(SENT, auth(false));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    expect(peekReturnTo()).toBe(SENT_HREF);
    expect(screen.getByLabelText('Opening the notification')).toBeOnTheScreen();
    expect(businessMock).not.toHaveBeenCalled();
    expect(profileMock).not.toHaveBeenCalled();
  });

  it('after sign-in it runs again: routes, and forgets the return-to target', async () => {
    setReturnTo(SENT_HREF);
    await open(SENT);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledTimes(1));
    expect(peekReturnTo()).toBeNull();
  });

  it('signed in with an unfinished profile: remembers itself and goes to finish the profile', async () => {
    asProfile(null);
    await open(SENT);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/setup-profile'));
    expect(peekReturnTo()).toBe(SENT_HREF);
  });

  it('waits while the session is still loading', async () => {
    await open(SENT, auth(false, { isLoading: true }));
    await waitFor(() =>
      expect(screen.getByLabelText('Opening the notification')).toBeOnTheScreen(),
    );
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['another version', { ...SENT, v: '2' }],
    ['a bad id', { ...SENT, id: 'abc' }],
    ['an unknown side', { ...SENT, side: 'both' }],
    ['an extra key', { ...SENT, next: '/profile' }],
    ['nothing', {}],
  ])('%s: the Requests tab, nothing else', async (_label, params) => {
    await open(params);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/requests'));
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(peekReturnTo()).toBeNull();
  });
});
