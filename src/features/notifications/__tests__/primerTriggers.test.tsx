import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import * as profileApi from '@/features/profile/api';
import {
  countWaitingRequests,
  listBusinessRequests,
  listMyRequests,
} from '@/features/requests/api';
import { RequestsTabScreen } from '@/features/requests/components/RequestsTabScreen';
import * as sellersApi from '@/features/sellers/api';
import { SellerOnboardingScreen } from '@/features/sellers/components/SellerOnboardingScreen';
import type { MyBusiness } from '@/features/sellers/schema';

import { getPendingPrimer, resetPrimerMomentForTests } from '../primerMoment';

// The two screen triggers of Decision 7 (the request-sent trigger is useSubmitPrimerWatcher).
// A trigger only asks; usePrimerOpener (tested on its own) decides when, and whether, to open.

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: () => null,
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() }, rpc: jest.fn() },
}));
jest.mock('@/features/requests/api', () => ({
  ...jest.requireActual('@/features/requests/api'),
  listMyRequests: jest.fn(),
  listBusinessRequests: jest.fn(),
  countWaitingRequests: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));
jest.mock('@/features/profile/api', () => ({
  ...jest.requireActual('@/features/profile/api'),
  getMyProfile: jest.fn(),
}));
// Onboarding at step 2: the business was just created; picking an address is one button here.
jest.mock('@/features/sellers/hooks/useCreateBusiness', () => ({
  useCreateBusiness: () => ({
    isSuccess: true,
    isPending: false,
    variables: { type: 'restaurant' },
  }),
}));
jest.mock('@/features/sellers/components/AddressAutocomplete', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createElement } = require('react');
  const { Pressable } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    AddressAutocomplete: ({ onResolved }: { onResolved: (business: unknown) => void }) =>
      createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Pick the address',
        onPress: () => onResolved({ id: 'b1' }),
      }),
  };
});

const NOW = '2026-11-08T17:00:00Z';
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const businessMock = jest.mocked(sellersApi.getMyBusiness);
const profileMock = jest.mocked(profileApi.getMyProfile);

let counter = 0;
let userId: string;
let client: QueryClient;

const authValue = (): AuthContextValue => ({
  session: { user: { id: userId } } as unknown as AuthContextValue['session'],
  isLoading: false,
  isRecovering: false,
  notice: null,
  prepareRecovery: jest.fn(),
  abandonRecovery: jest.fn(),
  markRecovering: jest.fn(),
  clearRecovering: jest.fn(),
  dismissNotice: jest.fn(),
});

function frame(children: ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthContext.Provider value={authValue()}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AuthContext.Provider>
    </SafeAreaProvider>
  );
}

function asProfile(isSeller: boolean) {
  profileMock.mockResolvedValue({
    id: userId,
    username: 'archan',
    display_name: 'Archan Me',
    bio: '',
    city: '',
    is_seller: isSeller,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });
}

const tab = (focused: boolean) =>
  frame(
    <RequestsTabScreen
      focused={focused}
      onOpenSent={jest.fn()}
      onOpenReceived={jest.fn()}
      timeZone="UTC"
      locale="en-US"
    />,
  );

beforeEach(async () => {
  counter += 1;
  userId = `trigger-user-${counter}`;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  await AsyncStorage.clear();
  jest
    .mocked(listMyRequests)
    .mockResolvedValue({ server_now: NOW, requests: [], next_cursor: null });
  jest
    .mocked(listBusinessRequests)
    .mockResolvedValue({ server_now: NOW, requests: [], next_cursor: null });
  jest.mocked(countWaitingRequests).mockResolvedValue({ server_now: NOW, waiting: 0 });
  businessMock.mockResolvedValue(null);
  asProfile(false);
});

afterEach(async () => {
  await cleanup();
  client.clear();
  resetPrimerMomentForTests();
  jest.clearAllMocks();
});

describe('Requests tab: an owner first looking at Received', () => {
  it('a cold start straight onto Received is not one (never at launch, review S9)', async () => {
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    asProfile(true);
    await render(tab(true));
    expect(await screen.findByRole('radio', { name: /^Received.*selected/ })).toBeOnTheScreen();
    await waitFor(() => expect(businessMock).toHaveBeenCalled());
    expect(getPendingPrimer()).toBeNull();
  });

  it('coming back to Received after leaving the tab is one (owner)', async () => {
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    asProfile(true);
    const view = await render(tab(true));
    await screen.findByRole('radio', { name: /^Received.*selected/ });
    await view.rerender(tab(false));
    expect(getPendingPrimer()).toBeNull();
    await view.rerender(tab(true));
    await waitFor(() => expect(getPendingPrimer()).toBe('owner'));
  });

  it('picking Received with the switch is one (owner)', async () => {
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    // Seller mode off: the tab opens on Sent.
    await render(tab(true));
    await fireEvent.press(await screen.findByRole('radio', { name: /^Received/ }));
    await waitFor(() => expect(getPendingPrimer()).toBe('owner'));
  });

  it('is not one while the tab is not on screen', async () => {
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    asProfile(true);
    await render(tab(false));
    await waitFor(() => expect(businessMock).toHaveBeenCalled());
    await waitFor(() => expect(profileMock).toHaveBeenCalled());
    expect(getPendingPrimer()).toBeNull();
  });

  it('is not one for a customer (Sent only)', async () => {
    await render(tab(true));
    await waitFor(() => expect(businessMock).toHaveBeenCalled());
    expect(getPendingPrimer()).toBeNull();
  });
});

describe('Onboarding: the address is saved', () => {
  it('goes to Manage, then marks a primer moment (owner) for after that navigation', async () => {
    await render(frame(<SellerOnboardingScreen />));
    expect(getPendingPrimer()).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: 'Pick the address' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/manage');
    expect(getPendingPrimer()).toBe('owner');
  });
});
