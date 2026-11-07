import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import { clearReturnTo, peekReturnTo } from '@/features/auth/returnTo';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import { RequestPickupButton } from '../components/RequestPickupButton';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
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
function renderButton(value: AuthContextValue | null) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      {value ? <AuthContext.Provider value={value}>{children}</AuthContext.Provider> : children}
    </QueryClientProvider>
  );
  return render(wrap(<RequestPickupButton businessId={ID} name="Joe's Pizza" />));
}

const button = () => screen.queryByRole('button', { name: "Request pickup from Joe's Pizza" });

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

describe('RequestPickupButton', () => {
  it('shows nothing outside the auth provider (nobody knows who is looking)', async () => {
    await renderButton(null);
    expect(button()).not.toBeOnTheScreen();
  });

  it('guest: remembers the form for this business and opens sign-in', async () => {
    await renderButton(auth(false));
    await fireEvent.press(button()!);
    expect(peekReturnTo()).toBe(`/requests/new?businessId=${ID}`);
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
    expect(getMine).not.toHaveBeenCalled();
  });

  it('signed in: opens the request form for this business', async () => {
    await renderButton(auth(true));
    await waitFor(() => expect(button()).toBeOnTheScreen());
    await fireEvent.press(button()!);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/requests/new',
      params: { businessId: ID },
    });
    expect(peekReturnTo()).toBeNull();
  });

  it('signed in as the owner of this business: no button, and never a flash of one', async () => {
    getMine.mockResolvedValue({ id: ID } as unknown as MyBusiness);
    await renderButton(auth(true));
    expect(button()).not.toBeOnTheScreen(); // still checking
    await waitFor(() => expect(getMine).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    // Let the answer reach the component before judging what it shows.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(getMine).toHaveBeenCalledTimes(1);
    expect(button()).not.toBeOnTheScreen();
  });

  it('a seller looking at ANOTHER business still sees the button', async () => {
    getMine.mockResolvedValue({ id: OTHER } as unknown as MyBusiness);
    await renderButton(auth(true));
    await waitFor(() => expect(button()).toBeOnTheScreen());
  });

  it('if the own-business check fails, shows the button (the server still says own_business)', async () => {
    getMine.mockRejectedValue(new Error('offline'));
    await renderButton(auth(true));
    await waitFor(() => expect(button()).toBeOnTheScreen());
  });

  it('has a label that names the business, and a 44 pt target', async () => {
    await renderButton(auth(false));
    const found = button()!;
    expect(found).toHaveProp('accessibilityRole', 'button');
    const flat = Object.assign({}, ...[found.props.style].flat(Infinity).filter(Boolean));
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
  });
});
