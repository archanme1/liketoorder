import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makeSellerRows, sellerPagedServer } from '../__fixtures__/sellerRequests';
import { listBusinessRequests } from '../api';
import { SellerRequestsScreen } from '../components/SellerRequestsScreen';

// Each row draws a status chip, so the chip's render count is the row's render count.
const mockChipRender = jest.fn();
jest.mock('../components/RequestStatusChip', () => ({
  RequestStatusChip: ({ status }: { status: string }) => {
    mockChipRender(status);
    return null;
  },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listBusinessRequests: jest.fn(),
}));

const listMock = jest.mocked(listBusinessRequests);
let client: QueryClient;

// A parent that re-renders on demand and hands the screen either a stable onOpen (like the route)
// or a new arrow every time.
function Harness({ inline }: { inline: boolean }) {
  const [, setTick] = useState(0);
  const stable = useCallback(() => undefined, []);
  return (
    <>
      <Pressable testID="rerender-parent" onPress={() => setTick((n) => n + 1)} />
      <SellerRequestsScreen onOpen={inline ? () => undefined : stable} />
    </>
  );
}

async function renderHarness(inline: boolean) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <Harness inline={inline} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('Customer 1');
}

beforeEach(() => {
  mockChipRender.mockClear();
  listMock.mockReset();
  listMock.mockImplementation(
    sellerPagedServer({ rows: makeSellerRows(3, { status: 'pending' }) }),
  );
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('a parent re-render does not re-render the rows', () => {
  it('with a stable onOpen (what the route passes), no row re-renders', async () => {
    await renderHarness(false);
    const drawn = mockChipRender.mock.calls.length;
    expect(drawn).toBeGreaterThanOrEqual(3);

    await fireEvent.press(screen.getByTestId('rerender-parent'));
    await fireEvent.press(screen.getByTestId('rerender-parent'));
    expect(mockChipRender.mock.calls.length).toBe(drawn);
  });

  it('with a new onOpen every render, every row re-renders (what the route must not do)', async () => {
    await renderHarness(true);
    const drawn = mockChipRender.mock.calls.length;
    await fireEvent.press(screen.getByTestId('rerender-parent'));
    expect(mockChipRender.mock.calls.length).toBeGreaterThan(drawn);
  });
});
