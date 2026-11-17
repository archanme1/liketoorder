import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { dayOfWeek } from '@/lib/localDate';

import {
  activityJson,
  dayJson,
  resetModuleMocks,
  testClientOptions,
} from '../__fixtures__/foodLog';
import { getMyFoodLogActivity, listMyFoodLogsOn } from '../api';
import { ActivityYearScreen } from '../components/ActivityYearScreen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyFoodLogActivity: jest.fn(),
  listMyFoodLogsOn: jest.fn(),
}));

const mockedActivity = jest.mocked(getMyFoodLogActivity);
const TODAY = '2026-11-12';

let client: QueryClient;

beforeEach(() => {
  mockedActivity.mockResolvedValue(activityJson({}, 53));
  jest.mocked(listMyFoodLogsOn).mockResolvedValue(dayJson([]));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('../api');
});

async function renderYear() {
  client = new QueryClient(testClientOptions());
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QueryClientProvider client={client}>
        <ActivityYearScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

describe('ActivityYearScreen', () => {
  it('asks for 53 weeks and shows each day up to today (at most 371 squares)', async () => {
    await renderYear();
    expect(await screen.findByRole('summary')).toHaveTextContent(
      'Activity, last 53 weeks, 10 uploads',
    );
    expect(mockedActivity).toHaveBeenCalledWith('UTC', 53);
    expect(screen.getAllByTestId(/^activity-cell-/)).toHaveLength(7 * 53 - (6 - dayOfWeek(TODAY)));
    expect(screen.getByTestId('activity-cell-2025-11-09')).toBeTruthy();
    expect(screen.queryByTestId('activity-cell-2025-11-08')).toBeNull();
  });

  it('shows the same stats and list toggle, and no "View full year"', async () => {
    await renderYear();
    expect(await screen.findByLabelText('Current streak, 3 days')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View full year' })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Your activity' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Show as list' }));
    expect(screen.getAllByTestId(/^activity-day-/)).toHaveLength(4);
  });

  it('opens the day panel', async () => {
    await renderYear();
    await fireEvent.press(await screen.findByTestId('activity-cell-2026-11-03'));
    expect(await screen.findByText('Nothing logged on Tue, Nov 3, 2026.')).toBeTruthy();
  });

  it('pull to refresh refetches the activity', async () => {
    await renderYear();
    await screen.findByRole('summary');
    await act(async () => {
      await screen.getByTestId('food-log-scroll').props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(2));
  });
});
