import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import { clearReturnTo, peekReturnTo } from '@/features/auth/returnTo';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import { HomemadeSheetActions, RestaurantSheetActions } from '../components/SheetActions';
import { useHomemadeDetails } from '../hooks/useHomemadeDetails';
import { useRestaurantDetails } from '../hooks/useRestaurantDetails';
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
jest.mock('../hooks/useRestaurantDetails', () => ({ useRestaurantDetails: jest.fn() }));
jest.mock('../hooks/useHomemadeDetails', () => ({ useHomemadeDetails: jest.fn() }));

const ID = '11111111-1111-4111-8111-111111111111';
const getMine = jest.mocked(getMyBusiness);
const restaurantMock = jest.mocked(useRestaurantDetails);
const homemadeMock = jest.mocked(useHomemadeDetails);

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
let signedIn = true;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth(signedIn)}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

const details = (accepts: boolean) =>
  ({ data: { id: ID, name: 'Luigi', accepts_table_requests: accepts } }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  clearReturnTo();
  signedIn = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  getMine.mockResolvedValue(null);
});

afterEach(async () => {
  await cleanup();
  client.clear();
  clearReturnTo();
});

describe('useSheetActions: Request table', () => {
  const setup = (acceptsTableRequests?: boolean) =>
    renderHook(
      () => ({ actions: useSheetActions({ id: ID, name: 'Luigi', acceptsTableRequests }) }),
      {
        wrapper,
      },
    );

  it('a restaurant that takes tables: Request table next to Request pickup', async () => {
    const { result } = await setup(true);
    await waitFor(() => expect(result.current.actions).toHaveLength(2));
    expect(result.current.actions.map((action) => action.title)).toEqual([
      'Request pickup',
      'Request table',
    ]);
    expect(result.current.actions[1].accessibilityLabel).toBe('Request a table at Luigi');
    result.current.actions[1].onPress();
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/requests/table/new',
      params: { businessId: ID },
    });
  });

  it.each([
    ['says no', false],
    ['says nothing (a homemade sheet never passes it)', undefined],
  ])('a place that %s: only Request pickup', async (_label, flag) => {
    const { result } = await setup(flag);
    await waitFor(() => expect(result.current.actions).toHaveLength(1));
    expect(result.current.actions[0].title).toBe('Request pickup');
  });

  it('a guest: Request table remembers its own form and opens sign-in', async () => {
    signedIn = false;
    const { result } = await setup(true);
    const table = result.current.actions.find((action) => action.key === 'request-table');
    expect(table).toMatchObject({ accessibilityHint: 'Opens sign in first' });
    table?.onPress();
    expect(peekReturnTo()).toBe(`/requests/table/new?businessId=${ID}`);
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
  });

  it('the owner of this restaurant sees neither button', async () => {
    getMine.mockResolvedValue({ id: ID } as unknown as MyBusiness);
    const { result } = await setup(true);
    await waitFor(() => expect(client.getQueryState(['business', 'me'])?.status).toBe('success'));
    expect(result.current.actions).toEqual([]);
  });
});

describe('the sheet action rows', () => {
  it('restaurant sheet, restaurant that accepts tables: the button shows and opens the table form', async () => {
    restaurantMock.mockReturnValue(details(true));
    await render(<RestaurantSheetActions id={ID} />, { wrapper });
    const button = await screen.findByRole('button', { name: 'Request a table at Luigi' });
    await fireEvent.press(button);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/requests/table/new',
      params: { businessId: ID },
    });
  });

  it('restaurant sheet, restaurant that does not accept tables: no table button', async () => {
    restaurantMock.mockReturnValue(details(false));
    await render(<RestaurantSheetActions id={ID} />, { wrapper });
    await screen.findByRole('button', { name: 'Request pickup from Luigi' });
    expect(screen.queryByRole('button', { name: /table/i })).not.toBeOnTheScreen();
  });

  it('homemade sheet: never a table button, whatever the data says', async () => {
    homemadeMock.mockReturnValue({
      data: { id: ID, name: 'Nonna', accepts_table_requests: true },
    } as never);
    await render(<HomemadeSheetActions id={ID} />, { wrapper });
    await screen.findByRole('button', { name: 'Request pickup from Nonna' });
    expect(screen.queryByRole('button', { name: /table/i })).not.toBeOnTheScreen();
  });
});
