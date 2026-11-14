import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import * as profileApi from '@/features/profile/api';
import * as sellersApi from '@/features/sellers/api';

import {
  countMyRequestUpdates,
  countWaitingRequests,
  listBusinessRequests,
  listMyRequests,
  markMyRequestsSeen,
} from '../api';
import { RequestsTabScreen } from '../components/RequestsTabScreen';
import { requestKeys } from '../hooks/keys';

import { makeRequest } from '../__fixtures__/requests';

// Spec 12: the Sent number is the server's. While Sent is on screen it is cleared on opening and
// again after each re-read that brings a new change; and a notification for another account shows
// a neutral, dismissible line.

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyRequests: jest.fn(),
  listBusinessRequests: jest.fn(),
  countWaitingRequests: jest.fn(),
  countMyRequestUpdates: jest.fn(),
  markMyRequestsSeen: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));
jest.mock('@/features/profile/api', () => ({
  ...jest.requireActual('@/features/profile/api'),
  getMyProfile: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() }, rpc: jest.fn() },
}));

const NOW = '2026-11-08T17:00:00Z';
const mineMock = jest.mocked(listMyRequests);
const updatesMock = jest.mocked(countMyRequestUpdates);
const markSeenMock = jest.mocked(markMyRequestsSeen);
let serverUpdates = 0;
let client: QueryClient;

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

function tree(props: { focused?: boolean; notice?: 'other-account'; onDismiss?: () => void } = {}) {
  return (
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={client}>
        <RequestsTabScreen
          focused={props.focused ?? true}
          onOpenSent={jest.fn()}
          onOpenReceived={jest.fn()}
          notice={props.notice}
          onDismissNotice={props.onDismiss}
          timeZone="UTC"
          locale="en-US"
        />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

beforeEach(async () => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  serverUpdates = 0;
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mineMock.mockResolvedValue({ server_now: NOW, requests: [makeRequest()], next_cursor: null });
  jest
    .mocked(listBusinessRequests)
    .mockResolvedValue({ server_now: NOW, requests: [], next_cursor: null });
  jest.mocked(countWaitingRequests).mockResolvedValue({ server_now: NOW, waiting: 0 });
  jest.mocked(sellersApi.getMyBusiness).mockResolvedValue(null);
  jest.mocked(profileApi.getMyProfile).mockResolvedValue({
    id: 'user-1',
    username: 'archan',
    display_name: 'Archan Me',
    bio: '',
    city: '',
    is_seller: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });
  updatesMock.mockImplementation(async () => serverUpdates);
  markSeenMock.mockImplementation(async () => {
    serverUpdates = 0;
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('Sent on screen clears the server number', () => {
  it('on opening, and again after a Sent re-read brings a new change', async () => {
    serverUpdates = 1;
    await render(tree());
    await waitFor(() => expect(markSeenMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(updatesMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    // The seller answers another request; the list is re-read while Sent is still open.
    serverUpdates = 1;
    await act(async () => {
      await client.invalidateQueries({ queryKey: requestKeys.mine });
    });
    await waitFor(() => expect(markSeenMock).toHaveBeenCalledTimes(2));
  });

  it('never calls the server to clear a zero', async () => {
    await render(tree());
    await waitFor(() => expect(updatesMock).toHaveBeenCalled());
    await act(async () => {
      await client.invalidateQueries({ queryKey: requestKeys.mine });
    });
    await waitFor(() => expect(mineMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(markSeenMock).not.toHaveBeenCalled();
  });

  it('not while the tab is off screen', async () => {
    serverUpdates = 2;
    await render(tree({ focused: false }));
    await waitFor(() => expect(updatesMock).toHaveBeenCalled());
    await waitFor(() => expect(mineMock).toHaveBeenCalled());
    await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
    expect(markSeenMock).not.toHaveBeenCalled();
  });
});

describe('a notification for another account', () => {
  it('shows a neutral line that can be dismissed', async () => {
    const onDismiss = jest.fn();
    await render(tree({ notice: 'other-account', onDismiss }));
    expect(screen.getByText('This notification was for another account.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss the notification message' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows nothing without the notice', async () => {
    await render(tree());
    expect(screen.queryByText('This notification was for another account.')).toBeNull();
  });
});
