import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import * as sellersApi from '@/features/sellers/api';

import * as api from '../api';
import { ProfileScreen } from '../components/ProfileScreen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() } },
}));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), getMyProfile: jest.fn() }));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const auth: AuthContextValue = {
  session: { user: { id: 'u1' } } as unknown as AuthContextValue['session'],
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
  jest.clearAllMocks();
  jest.mocked(api.getMyProfile).mockResolvedValue({
    id: 'u1',
    username: 'archan',
    display_name: 'Archan Me',
    bio: '',
    city: '',
    is_seller: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });
  jest.mocked(sellersApi.getMyBusiness).mockResolvedValue(null);
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('Profile: My requests row', () => {
  it('opens My requests', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <ProfileScreen />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    const row = screen.getByRole('button', { name: 'My requests' });
    const flat = Object.assign({}, ...[row.props.style].flat(Infinity).filter(Boolean));
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(row);
    expect(mockRouter.push).toHaveBeenCalledWith('/requests');
  });
});
