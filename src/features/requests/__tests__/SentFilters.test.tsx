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
  listMyRequests,
} from '../api';
import { RequestsTabScreen } from '../components/RequestsTabScreen';
import type { CustomerRequest, SellerRequest } from '../schema';
import { clearStatusMemory } from '../statusMemory';

import { cursorOf, makeMixedRows, makeRows, pagedServer } from '../__fixtures__/pagedServer';
import { makeSellerRows, sellerPagedServer } from '../__fixtures__/sellerRequests';
import { makeTableRequest } from '../__fixtures__/tableRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
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
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() }, rpc: jest.fn() },
}));

const mineMock = jest.mocked(listMyRequests);
const inboxMock = jest.mocked(listBusinessRequests);
const waitingMock = jest.mocked(countWaitingRequests);
const businessMock = jest.mocked(sellersApi.getMyBusiness);
const profileMock = jest.mocked(profileApi.getMyProfile);

const NOW = '2026-11-08T17:00:00Z';
const TZ = { timeZone: 'UTC', locale: 'en-US' };
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));
const sent: { rows: CustomerRequest[] } = { rows: [] };
const inbox: { rows: SellerRequest[] } = { rows: [] };
let counter = 0;
let userId: string;
let client: QueryClient;

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

function tree(focused = true) {
  return (
    <AuthContext.Provider value={auth()}>
      <QueryClientProvider client={client}>
        <RequestsTabScreen
          focused={focused}
          onOpenSent={jest.fn()}
          onOpenReceived={jest.fn()}
          {...TZ}
        />
      </QueryClientProvider>
    </AuthContext.Provider>
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

/** One row per status, both kinds, named by status so each is easy to find. */
function everyStatus(): CustomerRequest[] {
  const statuses = [
    ['pending', 'pickup'],
    ['pending', 'table'],
    ['accepted', 'table'],
    ['completed', 'pickup'],
    ['no_show', 'table'],
    ['declined', 'pickup'],
    ['cancelled', 'pickup'],
    ['expired', 'table'],
  ] as const;
  return makeRows(statuses.length).map((row, i) => {
    const [status, kind] = statuses[i];
    const base = {
      id: row.id,
      created_at: row.created_at,
      business_name: `Place ${status}`,
      status,
      display_status: status,
    };
    return kind === 'table' ? makeTableRequest(base) : { ...row, ...base };
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
  sent.rows = everyStatus();
  inbox.rows = [];
  mineMock.mockImplementation(pagedServer(sent));
  inboxMock.mockImplementation(sellerPagedServer(inbox));
  asProfile(false);
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

const shownRows = () => screen.getAllByRole('button', { name: /^(Pickup|Table)\. Place / });
const chip = (name: string) => screen.getByRole('radio', { name });

describe('Sent filters', () => {
  it('opens on All with four chips under "Filter sent requests", asking the server with no filter', async () => {
    await render(tree());
    expect(await screen.findByRole('button', { name: /Place cancelled/ })).toBeOnTheScreen();
    expect(screen.getByLabelText('Filter sent requests').props.accessibilityRole).toBe(
      'radiogroup',
    );
    expect(screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'All, selected',
      'Pending',
      'Accepted',
      'Declined',
    ]);
    expect(shownRows()).toHaveLength(8);
    expect(mineMock.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it.each([
    ['Pending', 'pending', ['Place pending', 'Place pending']],
    ['Accepted', 'accepted', ['Place accepted', 'Place completed', 'Place no_show']],
    ['Declined', 'declined', ['Place declined']],
  ])(
    '%s asks the server for %s and shows only its rows, each with its kind',
    async (label, value, names) => {
      await render(tree());
      await screen.findByRole('button', { name: /Place cancelled/ });
      await fireEvent.press(chip(label));
      await waitFor(() => expect(mineMock).toHaveBeenLastCalledWith(undefined, value));
      await waitFor(() => expect(shownRows()).toHaveLength(names.length));
      expect(screen.getByRole('radio', { name: `${label}, selected` })).toBeOnTheScreen();
      for (const row of shownRows()) {
        const spoken = row.props.accessibilityLabel as string;
        expect(names.some((name) => spoken.includes(name))).toBe(true);
        expect(spoken).toMatch(/^(Pickup|Table)\. /);
      }
      expect(screen.queryByRole('button', { name: /Place cancelled|Place expired/ })).toBeNull();
    },
  );

  it('the Accepted list never shows a pending row, in text or in the spoken label', async () => {
    await render(tree());
    await screen.findByRole('button', { name: /Place cancelled/ });
    await fireEvent.press(chip('Accepted'));
    await waitFor(() => expect(shownRows()).toHaveLength(3));
    expect(screen.queryByText('Waiting')).toBeNull();
    for (const row of shownRows()) expect(row.props.accessibilityLabel).not.toContain('Waiting');
  });

  it.each([
    ['All', 'No requests yet. Requests you send will show up here.'],
    ['Pending', 'Nothing waiting for an answer right now.'],
    ['Accepted', 'No accepted requests yet.'],
    ['Declined', 'No declined requests.'],
  ])('empty %s says "%s"', async (label, text) => {
    sent.rows = [];
    await render(tree());
    if (label !== 'All') {
      await screen.findByText('No requests yet. Requests you send will show up here.');
      await fireEvent.press(chip(label));
    }
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it('a filtered list loads more on scroll with the cursor, under the same filter', async () => {
    sent.rows = [
      ...makeMixedRows(120),
      ...everyStatus().map((r, i) => ({
        ...r,
        id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      })),
    ];
    await render(tree());
    await screen.findByTestId('requests-list');
    await fireEvent.press(chip('Declined'));
    await waitFor(() => expect(mineMock).toHaveBeenLastCalledWith(undefined, 'declined'));
    await waitFor(() => expect(screen.getByTestId('requests-list').props.data).toHaveLength(50));
    const cursor = (await mineMock.mock.results.at(-1)?.value).next_cursor as string;
    expect(cursor).toBe(cursorOf(screen.getByTestId('requests-list').props.data[49]));
    await act(async () => fireEvent(screen.getByTestId('requests-list'), 'endReached'));
    await waitFor(() => expect(mineMock).toHaveBeenLastCalledWith(cursor, 'declined'));
    await waitFor(
      async () => {
        await act(async () => fireEvent(screen.getByTestId('requests-list'), 'endReached'));
        expect(screen.getByTestId('requests-list').props.data).toHaveLength(121);
      },
      { timeout: 5000 },
    );
    const data = screen.getByTestId('requests-list').props.data as CustomerRequest[];
    expect(new Set(data.map((r) => r.id)).size).toBe(121);
    expect(data.every((r) => r.display_status === 'declined')).toBe(true);
    expect(new Set(data.map((r) => r.kind))).toEqual(new Set(['pickup', 'table']));
  });

  it('a filter that fails to load shows the error with Try again, then its rows', async () => {
    await render(tree());
    await screen.findByRole('button', { name: /Place cancelled/ });
    mineMock.mockRejectedValueOnce(new RequestAppError('network'));
    await fireEvent.press(chip('Declined'));
    expect(await screen.findByText(/No connection/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(shownRows()).toHaveLength(1));
  });

  it('keeps the choice when the person leaves the tab and comes back', async () => {
    const view = await render(tree());
    await screen.findByRole('button', { name: /Place cancelled/ });
    await fireEvent.press(chip('Accepted'));
    await waitFor(() => expect(shownRows()).toHaveLength(3));
    await view.rerender(tree(false));
    await view.rerender(tree(true));
    expect(screen.getByRole('radio', { name: 'Accepted, selected' })).toBeOnTheScreen();
    await waitFor(() => expect(mineMock).toHaveBeenLastCalledWith(undefined, 'accepted'));
    await waitFor(() => expect(shownRows()).toHaveLength(3));
  });

  it('going back to a filter shows its cached rows at once, then re-reads them', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
    await render(tree());
    await screen.findByRole('button', { name: /Place cancelled/ });
    await fireEvent.press(chip('Declined'));
    await waitFor(() => expect(shownRows()).toHaveLength(1));
    await fireEvent.press(chip('All'));
    await waitFor(() => expect(shownRows()).toHaveLength(8));
    let resolve: () => void = () => undefined;
    mineMock.mockImplementationOnce(
      (before, filter) =>
        new Promise((done) => {
          resolve = () => void pagedServer(sent)(before, filter).then(done);
        }),
    );
    await fireEvent.press(chip('Declined'));
    // The cached Declined rows are on screen while the re-read is still out.
    expect(screen.queryByLabelText('Loading requests')).toBeNull();
    expect(shownRows()).toHaveLength(1);
    await act(async () => resolve());
  });
});

describe('a business owner: Sent and Received keep their own choices', () => {
  it('switching Sent and Received keeps each filter', async () => {
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    inbox.rows = makeSellerRows(3, { status: 'pending' });
    await render(tree());
    expect(await screen.findByRole('radio', { name: 'Sent, selected' })).toBeOnTheScreen();
    await fireEvent.press(chip('Declined'));
    expect(screen.getByRole('radio', { name: 'Declined, selected' })).toBeOnTheScreen();

    await fireEvent.press(chip('Received'));
    expect(await screen.findByLabelText('Filter received requests')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Pending, selected' })).toBeOnTheScreen();
    await fireEvent.press(chip('Accepted'));
    await waitFor(() => expect(inboxMock).toHaveBeenLastCalledWith('accepted', undefined));

    await fireEvent.press(chip('Sent'));
    expect(screen.getByLabelText('Filter sent requests')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Declined, selected' })).toBeOnTheScreen();
    await fireEvent.press(chip('Received'));
    expect(screen.getByRole('radio', { name: 'Accepted, selected' })).toBeOnTheScreen();
  });
});
