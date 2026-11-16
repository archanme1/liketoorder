import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';

import {
  activityFrom,
  activityJson,
  CUISINES,
  dayJson,
  foodLog,
  resetModuleMocks,
  testClientOptions,
  ZERO_STATS,
} from '../__fixtures__/foodLog';
import { ACTIVITY_EMPTY } from '../activity';
import { FoodLogAppError, getMyFoodLogActivity, listMyFoodLogsOn } from '../api';
import { ActivitySection } from '../components/ActivitySection';
import { foodLogErrorMessage } from '../messages';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyFoodLogActivity: jest.fn(),
  listMyFoodLogsOn: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  signedUrls: jest.fn(),
  uploadToBucket: jest.fn(),
  removeFromBucket: jest.fn(),
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));

const mockedActivity = jest.mocked(getMyFoodLogActivity);
const mockedDay = jest.mocked(listMyFoodLogsOn);

let client: QueryClient;

beforeEach(() => {
  jest.mocked(listCuisines).mockResolvedValue(CUISINES);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
    );
  mockedActivity.mockResolvedValue(activityJson());
  mockedDay.mockImplementation(async (date) =>
    dayJson([foodLog(1, { local_date: date, description: `Meal on ${date}` })]),
  );
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('../api', '@/features/media/api', '@/features/cuisines/api');
});

async function renderSection(weeks = 17) {
  client = new QueryClient(testClientOptions());
  await render(
    <QueryClientProvider client={client}>
      <ActivitySection weeks={weeks} showFullYear />
    </QueryClientProvider>,
  );
}

describe('ActivitySection: the 4 states', () => {
  it('loading', async () => {
    mockedActivity.mockReturnValue(new Promise(() => {}));
    await renderSection();
    expect(screen.getByLabelText('Loading your activity')).toBeTruthy();
  });

  it('error, then Try again loads the grid', async () => {
    mockedActivity.mockRejectedValueOnce(new FoodLogAppError('network'));
    await renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent(foodLogErrorMessage('network'));
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Nov 12, 3 uploads, today' })).toBeTruthy();
    expect(mockedActivity).toHaveBeenCalledTimes(2);
  });

  it('empty: zero stats, the empty grid, the line and Add photo', async () => {
    mockedActivity.mockResolvedValue(activityJson({ days: [], stats: ZERO_STATS }));
    await renderSection();
    expect(await screen.findByText(ACTIVITY_EMPTY)).toBeTruthy();
    expect(screen.getByLabelText('Total this year, no uploads')).toBeTruthy();
    expect(screen.getByLabelText('Current streak, 0 days')).toBeTruthy();
    // The grid's shape stays visible.
    expect(screen.getByRole('button', { name: 'Nov 12, no uploads, today' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View full year' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show as list' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/food-log/new');
  });

  it('success: the stats as text, the grid, the summary and the legend', async () => {
    await renderSection();
    expect(await screen.findByLabelText('Total this year, 40 uploads')).toHaveTextContent(
      '40Total this year',
    );
    expect(screen.getByLabelText('Current streak, 3 days')).toHaveTextContent('3Current streak');
    expect(screen.getByLabelText('Longest streak, 9 days')).toHaveTextContent('9Longest streak');
    expect(screen.getByLabelText('Cuisines tried, 6')).toHaveTextContent('6Cuisines tried');
    expect(screen.getByRole('summary')).toHaveTextContent('Activity, last 17 weeks, 10 uploads');
    expect(screen.getByLabelText('Fewer to more uploads')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nov 11, 4 uploads' })).toBeTruthy();
    expect(screen.queryByText(ACTIVITY_EMPTY)).toBeNull();
  });
});

describe('ActivitySection: what it sends and where it ends', () => {
  it("sends the phone's zone (the getCalendars fake) and no date", async () => {
    await renderSection();
    await screen.findByRole('summary');
    expect(mockedActivity).toHaveBeenCalledTimes(1);
    expect(mockedActivity.mock.calls[0]).toEqual(['UTC', 17]);
  });

  it('ends the grid at the server today even when the phone clock is years off', async () => {
    // The server says Wed 2020-06-10; the clock this test runs under is years later.
    const today = '2020-06-10';
    mockedActivity.mockResolvedValue(
      activityJson({ today, from: activityFrom(today, 17), days: [{ date: today, count: 1 }] }),
    );
    await renderSection();
    expect(await screen.findByRole('button', { name: 'Jun 10, 1 upload, today' })).toBeTruthy();
    // Thu to Sat of that week are padding, and the phone's own today is nowhere.
    for (const date of ['2020-06-11', '2020-06-12', '2020-06-13']) {
      expect(screen.queryByTestId(`activity-cell-${date}`)).toBeNull();
    }
    const phoneToday = new Date().toISOString().slice(0, 10);
    expect(screen.queryByTestId(`activity-cell-${phoneToday}`)).toBeNull();
    expect(screen.getByTestId(`activity-cell-${activityFrom(today, 17)}`)).toBeTruthy();
  });
});

describe('ActivitySection: choosing a day', () => {
  it('tapping a day opens its panel', async () => {
    await renderSection();
    await fireEvent.press(await screen.findByTestId('activity-cell-2026-11-11'));
    expect(await screen.findByRole('header', { name: 'Wed, Nov 11, 2026' })).toBeTruthy();
    expect(mockedDay).toHaveBeenCalledWith('2026-11-11');
    expect(
      await screen.findByRole('button', { name: 'Food photo, Italy. Meal on 2026-11-11.' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nov 11, 4 uploads', selected: true })).toBeTruthy();
  });

  it('Previous and Next day stay inside the range', async () => {
    await renderSection();
    // Today is the last day: Next is disabled and says so in words.
    await fireEvent.press(await screen.findByTestId('activity-cell-2026-11-12'));
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    expect(screen.getByText('Last day of this range')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByRole('header', { name: 'Wed, Nov 11, 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();

    // The range's first day: Previous is disabled.
    const from = activityFrom('2026-11-12', 17);
    await fireEvent.press(screen.getByTestId(`activity-cell-${from}`));
    expect(await screen.findByRole('header', { name: 'Sun, Jul 19, 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
    expect(screen.getByText('First day of this range')).toBeTruthy();
  });
});

describe('ActivitySection: list view and buttons', () => {
  it('"Show as list" lists only the days with uploads, newest first', async () => {
    await renderSection();
    await fireEvent.press(await screen.findByRole('button', { name: 'Show as list' }));
    const rows = screen.getAllByTestId(/^activity-day-/);
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      'Nov 12, 3 uploads, today',
      'Nov 11, 4 uploads',
      'Nov 10, 2 uploads',
      'Nov 3, 1 upload',
    ]);
    expect(screen.queryByTestId('activity-cell-2026-11-12')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Show as grid' }));
    expect(screen.getByTestId('activity-cell-2026-11-12')).toBeTruthy();
  });

  it('"View full year" opens /food-log/year', async () => {
    await renderSection();
    await fireEvent.press(await screen.findByRole('button', { name: 'View full year' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/food-log/year');
  });

  it('a failed refresh keeps the grid and shows a banner', async () => {
    await renderSection();
    await screen.findByRole('summary');
    mockedActivity.mockRejectedValueOnce(new FoodLogAppError('network'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['food-log', 'activity'] });
    });
    expect(await screen.findByText(foodLogErrorMessage('network'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nov 12, 3 uploads, today' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try loading your activity again' })).toBeTruthy();
    await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(2));
  });
});
