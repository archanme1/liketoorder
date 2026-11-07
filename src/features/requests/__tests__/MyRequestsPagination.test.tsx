import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makeRows, pagedServer } from '../__fixtures__/pagedServer';
import { RequestAppError, listMyPickupRequests } from '../api';
import { MyRequestsScreen } from '../components/MyRequestsScreen';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyPickupRequests: jest.fn(),
}));

const listMock = jest.mocked(listMyPickupRequests);
const server = { rows: makeRows(120) };
let client: QueryClient;

function renderScreen() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <MyRequestsScreen onBack={jest.fn()} onOpen={jest.fn()} onFindPlace={jest.fn()} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

const endReached = () =>
  act(async () => fireEvent(screen.getByTestId('requests-list'), 'endReached'));

beforeEach(() => {
  server.rows = makeRows(120);
  listMock.mockReset();
  listMock.mockImplementation(pagedServer(server));
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('loading more as you scroll', () => {
  it('reads the next page when the end is near, once', async () => {
    await renderScreen();
    await screen.findByText('Place 1');
    expect(listMock).toHaveBeenCalledTimes(1);
    await endReached();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(listMock).toHaveBeenLastCalledWith(server.rows[49].created_at);
  });

  it('does not ask again while a page is loading, and shows a footer spinner', async () => {
    await renderScreen();
    await screen.findByText('Place 1');
    let finish: () => void = () => undefined;
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ server_now: '2026-11-08T17:00:00Z', requests: server.rows.slice(50, 100) });
        }),
    );
    await endReached();
    expect(await screen.findByLabelText('Loading more requests')).toBeOnTheScreen();
    await endReached();
    await endReached();
    expect(listMock).toHaveBeenCalledTimes(2);
    await act(async () => finish());
    await waitFor(() =>
      expect(screen.queryByLabelText('Loading more requests')).not.toBeOnTheScreen(),
    );
  });

  it('stops at the end of the list', async () => {
    await renderScreen();
    await screen.findByText('Place 1');
    for (let n = 0; n < 4; n += 1) {
      await endReached();
      await act(async () => undefined);
    }
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(3)); // 50 + 50 + 20
    await endReached();
    expect(listMock).toHaveBeenCalledTimes(3);
  });
});

describe('when a page fails', () => {
  it('a failed next page: an inline Try again, and the loaded rows stay', async () => {
    await renderScreen();
    await screen.findByText('Place 1');
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await endReached();
    expect(await screen.findByText("Couldn't load more requests.")).toBeOnTheScreen();
    expect(screen.getByText('Place 1')).toBeOnTheScreen();
    expect(screen.queryByText(/No connection/)).not.toBeOnTheScreen(); // not the full-screen error
    // End-reached does not keep hammering a failing page.
    const calls = listMock.mock.calls.length;
    await endReached();
    expect(listMock.mock.calls.length).toBe(calls);

    await fireEvent.press(screen.getByRole('button', { name: 'Try loading more requests again' }));
    await waitFor(() =>
      expect(screen.queryByText("Couldn't load more requests.")).not.toBeOnTheScreen(),
    );
    expect(listMock).toHaveBeenLastCalledWith(server.rows[49].created_at);
  });

  it('a failed refresh with rows on screen: a small banner, the list stays', async () => {
    await renderScreen();
    await screen.findByText('Place 1');
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText("Couldn't refresh your requests.")).toBeOnTheScreen();
    expect(screen.getByText('Place 1')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try refreshing again' }));
    await waitFor(() =>
      expect(screen.queryByText("Couldn't refresh your requests.")).not.toBeOnTheScreen(),
    );
  });

  it('a failed FIRST load is still the full-screen error with Try again', async () => {
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await renderScreen();
    expect(await screen.findByText(/No connection/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Place 1')).toBeOnTheScreen();
  });
});

describe('pull to refresh', () => {
  it('starts again from the newest 50 with one read', async () => {
    await renderScreen();
    await screen.findByText('Place 1');
    await endReached();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    listMock.mockClear();

    const control = screen.getByTestId('requests-list').props.refreshControl;
    await act(async () => {
      control.props.onRefresh();
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    expect(listMock).toHaveBeenCalledWith(undefined);
    // Back on page 1: reaching the end asks for page 2 again.
    await act(async () => undefined);
    await endReached();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(listMock).toHaveBeenLastCalledWith(server.rows[49].created_at);
  });
});
