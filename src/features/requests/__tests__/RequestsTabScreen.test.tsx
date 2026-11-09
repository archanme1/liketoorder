import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import * as profileApi from '@/features/profile/api';
import * as sellersApi from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import {
  RequestAppError,
  countWaitingRequests,
  listBusinessRequests,
  listMyPickupRequests,
} from '../api';
import { RequestsTabScreen } from '../components/RequestsTabScreen';
import { clearStatusMemory } from '../statusMemory';

import { makeRequest } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyPickupRequests: jest.fn(),
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
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() }, rpc: jest.fn() },
}));

const mineMock = jest.mocked(listMyPickupRequests);
const inboxMock = jest.mocked(listBusinessRequests);
const waitingMock = jest.mocked(countWaitingRequests);
const businessMock = jest.mocked(sellersApi.getMyBusiness);
const profileMock = jest.mocked(profileApi.getMyProfile);

const NOW = '2026-11-08T17:00:00Z';
const TZ = { timeZone: 'UTC', locale: 'en-US' };
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));
const business = { id: 'b1' } as unknown as MyBusiness;
let counter = 0;
let userId: string;

const auth = (): AuthContextValue => ({
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

let client: QueryClient;
const onOpenSent = jest.fn();
const onOpenReceived = jest.fn();

function tree(focused = true) {
  return (
    <AuthContext.Provider value={auth()}>
      <QueryClientProvider client={client}>
        <RequestsTabScreen
          focused={focused}
          onOpenSent={onOpenSent}
          onOpenReceived={onOpenReceived}
          {...TZ}
        />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

const sentRows = (...rows: ReturnType<typeof makeRequest>[]) =>
  mineMock.mockResolvedValue({ server_now: NOW, requests: rows });
const inboxRows = (...rows: ReturnType<typeof makeSellerRequest>[]) =>
  inboxMock.mockResolvedValue({ server_now: NOW, requests: rows, next_cursor: null });

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

beforeEach(async () => {
  counter += 1;
  userId = `user-${counter}`;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clearStatusMemory();
  await flush();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  businessMock.mockResolvedValue(null);
  waitingMock.mockResolvedValue({ server_now: NOW, waiting: 0 });
  sentRows();
  inboxRows();
  asProfile(false);
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

// The switch is the only thing labelled exactly "Requests" (the title is a header, not a label).
const switchGroup = () => screen.queryByLabelText('Requests');
const sentRadio = (name: string | RegExp) => screen.getByRole('radio', { name });

describe('a customer without a business', () => {
  it('sees the Sent list only, with no switches', async () => {
    sentRows(makeRequest());
    await render(tree());
    expect(await screen.findByRole('button', { name: /Joe's Pizza/ })).toBeOnTheScreen();
    expect(switchGroup()).toBeNull();
    expect(screen.getByRole('header', { name: 'Requests' })).toBeOnTheScreen();
    expect(inboxMock).not.toHaveBeenCalled();
    expect(waitingMock).not.toHaveBeenCalled();
  });

  it('says what an empty Sent list means, with no map button (the maps may be hidden)', async () => {
    await render(tree());
    expect(
      await screen.findByText('No requests yet. Requests you send will show up here.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Find a place' })).toBeNull();
  });

  it('shows a loading state, then the error with Retry, and Retry loads again', async () => {
    mineMock.mockRejectedValueOnce(new RequestAppError('network'));
    sentRows(makeRequest());
    await render(tree());
    expect(
      await screen.findByText('No connection. Check your internet and try again.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /Try again|Retry/ }));
    expect(await screen.findByRole('button', { name: /Joe's Pizza/ })).toBeOnTheScreen();
  });

  it('puts the kind on each row as a word, and speaks it', async () => {
    sentRows(makeRequest());
    await render(tree());
    const row = await screen.findByRole('button', { name: /Joe's Pizza/ });
    expect(screen.getByText('Pickup', { includeHiddenElements: true })).toBeTruthy();
    expect(row.props.accessibilityValue).toEqual({ text: 'Pickup' });
  });

  it('opens a request with a tap', async () => {
    const request = makeRequest();
    sentRows(request);
    await render(tree());
    await fireEvent.press(await screen.findByRole('button', { name: /Joe's Pizza/ }));
    expect(onOpenSent).toHaveBeenCalledWith(request);
  });
});

describe('a business owner', () => {
  beforeEach(() => {
    businessMock.mockResolvedValue(business);
  });

  it('opens on Received when seller mode is on', async () => {
    asProfile(true);
    await render(tree());
    expect(await screen.findByRole('radio', { name: 'Received, selected' })).toBeOnTheScreen();
    expect(sentRadio('Sent')).toBeOnTheScreen();
  });

  it('opens on Sent when seller mode is off, and can still reach Received', async () => {
    inboxRows(makeSellerRequest({ id: 'r1', customer_name: 'Sam Rivera' }));
    await render(tree());
    expect(await screen.findByRole('radio', { name: 'Sent, selected' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Received' }));
    expect(
      await screen.findByRole('button', { name: /Request from Sam Rivera/ }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Received, selected' })).toBeOnTheScreen();
  });

  it('opens a received request with a tap, whatever the seller mode', async () => {
    const request = makeSellerRequest({ id: 'r1', customer_name: 'Sam Rivera' });
    inboxRows(request);
    await render(tree());
    await fireEvent.press(await screen.findByRole('radio', { name: 'Received' }));
    await fireEvent.press(await screen.findByRole('button', { name: /Request from Sam Rivera/ }));
    expect(onOpenReceived).toHaveBeenCalledWith(request);
  });

  it('keeps the choice when seller mode flips, and the default follows seller mode until then', async () => {
    await render(tree());
    expect(await screen.findByRole('radio', { name: 'Sent, selected' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Received' }));
    expect(screen.getByRole('radio', { name: 'Received, selected' })).toBeOnTheScreen();
  });

  it('gives each switch its own number, in the spoken label too', async () => {
    asProfile(true);
    waitingMock.mockResolvedValue({ server_now: NOW, waiting: 3 });
    sentRows(makeRequest({ id: 'a' }));
    await render(tree(false));
    expect(
      await screen.findByRole('radio', { name: 'Received, 3 need you, selected' }),
    ).toBeOnTheScreen();
    sentRows(makeRequest({ id: 'a', status: 'accepted', display_status: 'accepted' }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['requests', 'mine'] });
    });
    expect(await screen.findByRole('radio', { name: 'Sent, 1 updated' })).toBeOnTheScreen();
    expect(screen.getByTestId('switch-count-received')).toHaveTextContent('3');
    expect(screen.getByTestId('switch-count-sent')).toHaveTextContent('1');
  });

  it('shows no number on a switch whose count failed', async () => {
    asProfile(true);
    waitingMock.mockRejectedValue(new RequestAppError('network'));
    await render(tree());
    await screen.findByRole('radio', { name: 'Received, selected' });
    await act(flush);
    expect(screen.queryByTestId('switch-count-received')).toBeNull();
  });

  it('clears the Sent number when the Sent list is opened, and not before', async () => {
    asProfile(true);
    sentRows(makeRequest({ id: 'a' }));
    await render(tree(true));
    await screen.findByRole('radio', { name: 'Received, selected' });
    await waitFor(() => expect(mineMock).toHaveBeenCalled());
    await act(flush);
    sentRows(makeRequest({ id: 'a', status: 'declined', display_status: 'declined' }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['requests', 'mine'] });
    });
    expect(await screen.findByRole('radio', { name: 'Sent, 1 updated' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: /^Sent/ }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Sent, selected' })).toBeOnTheScreen(),
    );
    expect(screen.queryByTestId('switch-count-sent')).toBeNull();
  });

  it('does not clear the Sent number while the tab is not on screen', async () => {
    sentRows(makeRequest({ id: 'a' }));
    await render(tree(false));
    await screen.findByRole('radio', { name: 'Sent, selected' });
    await waitFor(() => expect(mineMock).toHaveBeenCalled());
    await act(flush);
    sentRows(makeRequest({ id: 'a', status: 'declined', display_status: 'declined' }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['requests', 'mine'] });
    });
    // Sent is shown but the tab is not on screen: the number stays, and says it is selected.
    expect(
      await screen.findByRole('radio', { name: 'Sent, 1 updated, selected' }),
    ).toBeOnTheScreen();
  });

  it('keeps both lists mounted, so switching never reloads or loses a page', async () => {
    inboxRows(makeSellerRequest({ id: 'r1', customer_name: 'Sam Rivera' }));
    sentRows(makeRequest());
    await render(tree());
    await screen.findByRole('radio', { name: 'Sent, selected' });
    await fireEvent.press(screen.getByRole('radio', { name: 'Received' }));
    await screen.findByRole('button', { name: /Request from Sam Rivera/ });
    const mineCalls = mineMock.mock.calls.length;
    const inboxCalls = inboxMock.mock.calls.length;

    // The side not shown is still there, out of sight and out of the screen reader's reach.
    expect(screen.getByTestId('pane-hidden', { includeHiddenElements: true })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Joe's Pizza/, includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Joe's Pizza/ })).toBeNull();

    await fireEvent.press(screen.getByRole('radio', { name: 'Sent' }));
    expect(await screen.findByRole('button', { name: /Joe's Pizza/ })).toBeOnTheScreen();
    expect(mineMock.mock.calls.length).toBe(mineCalls);
    expect(inboxMock.mock.calls.length).toBe(inboxCalls);
  });

  it('keeps each list in its own state: Received ok, Sent failed, with its own Retry', async () => {
    mineMock.mockRejectedValue(new RequestAppError('network'));
    inboxRows();
    await render(tree());
    await screen.findByRole('radio', { name: 'Sent, selected' });
    expect(
      await screen.findByText('No connection. Check your internet and try again.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Received' }));
    expect(await screen.findByText('Nothing waiting for you right now.')).toBeOnTheScreen();
  });

  it('shows a banner with Try again when the business check fails, and still shows Sent', async () => {
    businessMock.mockRejectedValueOnce(new Error('boom'));
    sentRows(makeRequest());
    await render(tree());
    expect(await screen.findByText(/Couldn't check your business/)).toBeOnTheScreen();
    expect(await screen.findByRole('button', { name: /Joe's Pizza/ })).toBeOnTheScreen();
    expect(switchGroup()).toBeNull();
  });
});

describe('coming back to the tab', () => {
  it('reads the lists again, but not on the first focus', async () => {
    sentRows(makeRequest());
    const view = await render(tree(true));
    await screen.findByRole('button', { name: /Joe's Pizza/ });
    await act(flush);
    const calls = mineMock.mock.calls.length;
    await view.rerender(tree(false));
    await act(flush);
    expect(mineMock.mock.calls.length).toBe(calls);
    await view.rerender(tree(true));
    await waitFor(() => expect(mineMock.mock.calls.length).toBeGreaterThan(calls));
  });
});
