import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import { clearReturnTo, peekReturnTo } from '@/features/auth/returnTo';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import { useSheetActions } from '../hooks/useSheetActions';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const business = { id: ID, name: "Joe's Pizza" };
const getMine = jest.mocked(getMyBusiness);

function auth(signedIn: boolean): AuthContextValue {
  return {
    session: signedIn ? ({ user: { id: 'u1' } } as unknown as AuthContextValue['session']) : null,
    isLoading: false,
    isRecovering: false,
    notice: null,
    prepareRecovery: jest.fn(),
    abandonRecovery: jest.fn(),
    markRecovering: jest.fn(),
    clearRecovering: jest.fn(),
    dismissNotice: jest.fn(),
  };
}

let client: QueryClient;
function setup(value: AuthContextValue | null, target: typeof business | null = business) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      {value ? <AuthContext.Provider value={value}>{children}</AuthContext.Provider> : children}
    </QueryClientProvider>
  );
  return renderHook(() => ({ actions: useSheetActions(target) }), { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearReturnTo();
  getMine.mockResolvedValue(null);
});

afterEach(async () => {
  await cleanup();
  client.clear();
  clearReturnTo();
});

describe('useSheetActions', () => {
  it('outside the auth provider: no actions', async () => {
    const { result } = await setup(null);
    expect(result.current.actions).toEqual([]);
  });

  it('no business yet (loading, error, not available): no actions', async () => {
    const { result } = await setup(auth(false), null);
    expect(result.current.actions).toEqual([]);
  });

  it('guest: Request pickup, which remembers the form for this business and opens sign-in', async () => {
    const { result } = await setup(auth(false));
    const [action] = result.current.actions;
    expect(result.current.actions).toHaveLength(1);
    expect(action).toMatchObject({
      key: 'request-pickup',
      title: 'Request pickup',
      accessibilityLabel: "Request pickup from Joe's Pizza",
      accessibilityHint: 'Opens sign in first',
    });
    action.onPress();
    expect(peekReturnTo()).toBe(`/requests/new?businessId=${ID}`);
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
    expect(getMine).not.toHaveBeenCalled();
  });

  it('signed in: opens the request form for this business', async () => {
    const { result } = await setup(auth(true));
    await waitFor(() => expect(result.current.actions).toHaveLength(1));
    result.current.actions[0].onPress();
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/requests/new',
      params: { businessId: ID },
    });
    expect(peekReturnTo()).toBeNull();
  });

  it('the owner of this business: none, and none while that is still being checked', async () => {
    getMine.mockResolvedValue({ id: ID } as unknown as MyBusiness);
    const { result } = await setup(auth(true));
    expect(result.current.actions).toEqual([]); // still checking
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await waitFor(() => expect(client.getQueryState(['business', 'me'])?.status).toBe('success'));
    expect(result.current.actions).toEqual([]);
  });

  it('a seller looking at ANOTHER business still gets Request pickup', async () => {
    getMine.mockResolvedValue({ id: OTHER } as unknown as MyBusiness);
    const { result } = await setup(auth(true));
    await waitFor(() => expect(result.current.actions).toHaveLength(1));
  });

  it('if the own-business check fails: shown (the server still says own_business)', async () => {
    getMine.mockRejectedValue(new Error('offline'));
    const { result } = await setup(auth(true));
    await waitFor(() => expect(result.current.actions).toHaveLength(1));
  });
});
