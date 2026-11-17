import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';
import { colors, size, stroke } from '@/theme/tokens';

import {
  activityFrom,
  activityJson,
  CUISINES_WITH_NEUTRAL,
  cuisineDaysJson,
  dayJson,
  foodLog,
  resetModuleMocks,
  testClientOptions,
  ZERO_STATS,
} from '../__fixtures__/foodLog';
import { ACTIVITY_EMPTY, CUISINE_LEGEND, GLOBE } from '../activity';
import {
  FoodLogAppError,
  getMyFoodLogActivity,
  getMyFoodLogCuisineDays,
  listMyFoodLogsOn,
} from '../api';
import { ActivitySection } from '../components/ActivitySection';
import { foodLogErrorMessage } from '../messages';

// Spec 15: the Cuisine view of ActivitySection. RPC fakes return the migrations' JSON shapes
// (activityJson, cuisineDaysJson); today is Thu 2026-11-12 unless a test moves it.

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyFoodLogActivity: jest.fn(),
  getMyFoodLogCuisineDays: jest.fn(),
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
const mockedCuisineDays = jest.mocked(getMyFoodLogCuisineDays);
const mockedCatalog = jest.mocked(listCuisines);

const ITALY_FLAG = String.fromCodePoint(0x1f1ee, 0x1f1f9);
const CUISINE_SUMMARY = 'Cuisines, last 17 weeks, 10 uploads';

let client: QueryClient;

beforeEach(() => {
  mockedCatalog.mockResolvedValue(CUISINES_WITH_NEUTRAL);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
    );
  mockedActivity.mockResolvedValue(activityJson());
  mockedCuisineDays.mockResolvedValue(cuisineDaysJson());
  jest
    .mocked(listMyFoodLogsOn)
    .mockImplementation(async (date) =>
      dayJson([foodLog(1, { local_date: date, description: `Meal on ${date}` })]),
    );
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('../api', '@/features/media/api', '@/features/cuisines/api');
});

async function renderSection() {
  client = new QueryClient(testClientOptions());
  await render(
    <QueryClientProvider client={client}>
      <ActivitySection weeks={17} showFullYear />
    </QueryClientProvider>,
  );
}

async function switchTo(view: 'Activity' | 'Cuisine') {
  await fireEvent.press(await screen.findByRole('radio', { name: view }));
}

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('ActivitySection in Cuisine: the states', () => {
  it('loading: a skeleton while the cuisine days load; the stats and the switch stay', async () => {
    mockedCuisineDays.mockReturnValue(new Promise(() => {}));
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByLabelText('Loading cuisines')).toBeTruthy();
    expect(screen.getByLabelText('Current streak, 3 days')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Cuisine, selected', selected: true })).toBeTruthy();
  });

  it('loading: a skeleton while the cuisine catalog loads', async () => {
    mockedCatalog.mockReturnValue(new Promise(() => {}));
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByLabelText('Loading cuisines')).toBeTruthy();
    await waitFor(() => expect(mockedCuisineDays).toHaveBeenCalled());
    expect(screen.getByLabelText('Loading cuisines')).toBeTruthy();
  });

  it('error, then Try again loads the cuisine grid; the stats and the switch stay', async () => {
    mockedCuisineDays.mockRejectedValueOnce(new FoodLogAppError('network'));
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByText(foodLogErrorMessage('network'))).toBeTruthy();
    expect(screen.getByLabelText('Current streak, 3 days')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Cuisine, selected' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(CUISINE_SUMMARY)).toBeTruthy();
  });

  it('success: cells speak the cuisine labels, glyphs are hidden, the legend speaks', async () => {
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByText(CUISINE_SUMMARY)).toBeTruthy();
    expect(screen.getByRole('summary')).toHaveTextContent(CUISINE_SUMMARY);

    // A flag day, a neutral day, a globe day and today.
    for (const name of [
      'Nov 3, Italy, 1 upload',
      'Nov 10, Street food, 2 uploads',
      'Nov 11, 3 cuisines, 4 uploads',
      'Nov 12, Japan, 3 uploads, today',
      'Nov 4, no uploads',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    for (const date of ['2026-11-03', '2026-11-10', '2026-11-11', '2026-11-12']) {
      expect(
        screen.getByTestId(`activity-glyph-${date}`, { includeHiddenElements: true }),
      ).toBeTruthy();
    }
    expect(
      screen.queryByTestId('activity-glyph-2026-11-04', { includeHiddenElements: true }),
    ).toBeNull();

    // Drawn, never spoken (spec 04 display rule).
    expect(screen.getByText(ITALY_FLAG, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText(ITALY_FLAG)).toBeNull();
    expect(screen.getAllByText(GLOBE, { includeHiddenElements: true }).length).toBeGreaterThan(1);
    expect(screen.queryByText(GLOBE)).toBeNull();

    // The Cuisine legend replaces the intensity one and speaks one sentence.
    expect(screen.getByLabelText(CUISINE_LEGEND.spoken)).toBeTruthy();
    expect(screen.queryByLabelText('Fewer to more uploads')).toBeNull();
  });

  it('a failed background refresh keeps the cuisine grid and shows the banner', async () => {
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByText(CUISINE_SUMMARY)).toBeTruthy();

    mockedCuisineDays.mockRejectedValue(new FoodLogAppError('network'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['food-log', 'cuisine-days'] });
    });

    expect(
      await screen.findByRole('button', { name: 'Try loading your cuisines again' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nov 11, 3 cuisines, 4 uploads' })).toBeTruthy();
    expect(screen.getByText(CUISINE_SUMMARY)).toBeTruthy();
  });

  it('an empty section shows no switch', async () => {
    mockedActivity.mockResolvedValue(activityJson({ days: [], stats: ZERO_STATS }));
    await renderSection();
    expect(await screen.findByText(ACTIVITY_EMPTY)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Cuisine' })).toBeNull();
    expect(screen.queryByLabelText('Grid view')).toBeNull();
    expect(mockedCuisineDays).not.toHaveBeenCalled();
  });
});

describe('ActivitySection in Cuisine: requests', () => {
  it('sends no cuisine-days request and loads no catalog while Activity is shown', async () => {
    await renderSection();
    expect(await screen.findByText('Activity, last 17 weeks, 10 uploads')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Activity, selected' })).toBeTruthy();
    expect(mockedCuisineDays).not.toHaveBeenCalled();
    expect(mockedCatalog).not.toHaveBeenCalled();
  });

  it("sends only the phone's zone (the getCalendars fake) and the week count, never a date", async () => {
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByText(CUISINE_SUMMARY)).toBeTruthy();
    expect(mockedCuisineDays.mock.calls).toEqual([['UTC', 17]]);
  });
});

describe('ActivitySection in Cuisine: list view and 44 pt alternatives', () => {
  it('the list view uses the cuisine labels, newest first', async () => {
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByText(CUISINE_SUMMARY)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Show as list' }));
    expect(
      screen.getAllByTestId(/^activity-day-/).map((row) => row.props.accessibilityLabel),
    ).toEqual([
      'Nov 12, Japan, 3 uploads, today',
      'Nov 11, 3 cuisines, 4 uploads',
      'Nov 10, Street food, 2 uploads',
      'Nov 3, Italy, 1 upload',
    ]);
  });

  it('the 44 pt alternatives work in Cuisine without pressing a cell', async () => {
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByText(CUISINE_SUMMARY)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Show as list' }));

    const row = screen.getByTestId('activity-day-2026-11-11');
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(size.touch);
    await fireEvent.press(row);
    expect(await screen.findByRole('header', { name: 'Wed, Nov 11, 2026' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByRole('header', { name: 'Tue, Nov 10, 2026' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Next day' }));
    expect(await screen.findByRole('header', { name: 'Thu, Nov 12, 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
  });

  it('"View full year" in Cuisine opens Your year in Cuisine; in Activity, as before', async () => {
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByText(CUISINE_SUMMARY)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'View full year' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/food-log/year',
      params: { view: 'cuisine' },
    });

    await switchTo('Activity');
    await fireEvent.press(await screen.findByRole('button', { name: 'View full year' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/food-log/year');
  });
});

describe('ActivitySection in Cuisine: the per-view range', () => {
  it("per-view range: each view's today outline and Previous / Next limits follow its own query", async () => {
    // Midnight passed between the two queries: the cuisine days already say Nov 13.
    mockedCuisineDays.mockResolvedValue(
      cuisineDaysJson({
        today: '2026-11-13',
        days: [
          ...cuisineDaysJson().days,
          { date: '2026-11-13', count: 1, cuisines: 1, cuisine: 'IT' },
        ],
      }),
    );
    await renderSection();
    expect(await screen.findByRole('button', { name: 'Nov 12, 3 uploads, today' })).toBeTruthy();
    expect(styleOf('activity-cell-2026-11-12')).toMatchObject({
      borderWidth: stroke.today,
      borderColor: colors.text,
    });
    expect(screen.queryByTestId('activity-cell-2026-11-13')).toBeNull();

    await switchTo('Cuisine');
    expect(
      await screen.findByRole('button', { name: 'Nov 13, Italy, 1 upload, today' }),
    ).toBeTruthy();
    expect(styleOf('activity-cell-2026-11-13')).toMatchObject({
      borderWidth: stroke.today,
      borderColor: colors.text,
    });
    expect(screen.getByRole('button', { name: 'Nov 12, Japan, 3 uploads' })).toBeTruthy();

    // Next day reaches the Cuisine query's today.
    await fireEvent.press(screen.getByTestId('activity-cell-2026-11-12'));
    expect(await screen.findByRole('header', { name: 'Thu, Nov 12, 2026' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
    expect(await screen.findByRole('header', { name: 'Fri, Nov 13, 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();

    // Back in Activity, Nov 13 is after that query's today: the selection is cleared.
    await switchTo('Activity');
    expect(await screen.findByRole('button', { name: 'Nov 12, 3 uploads, today' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Fri, Nov 13, 2026' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next day' })).toBeNull();
  });
});

describe('the chosen-day rule (spec 14 refresh, spec 15 switch)', () => {
  it('chosen day (a): a refresh that moves today keeps the chosen day in the same view', async () => {
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByText(CUISINE_SUMMARY)).toBeTruthy();
    const oldFrom = activityFrom('2026-11-12', 17);
    await fireEvent.press(screen.getByTestId(`activity-cell-${oldFrom}`));
    expect(await screen.findByRole('header', { name: 'Sun, Jul 19, 2026' })).toBeTruthy();

    // A week later the range starts a week later, so the chosen day is before it.
    mockedCuisineDays.mockResolvedValue(cuisineDaysJson({ today: '2026-11-19' }));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['food-log', 'cuisine-days'] });
    });

    expect(await screen.findByRole('button', { name: 'Nov 19, no uploads, today' })).toBeTruthy();
    expect(screen.queryByTestId(`activity-cell-${oldFrom}`)).toBeNull();
    expect(screen.getByRole('header', { name: 'Sun, Jul 19, 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
  });

  it('chosen day (b): a switch to a view whose range excludes it clears it and closes the panel', async () => {
    // The cuisine query's range starts a week after the activity query's.
    mockedCuisineDays.mockResolvedValue(cuisineDaysJson({ today: '2026-11-19' }));
    await renderSection();
    const activityStart = activityFrom('2026-11-12', 17);
    await fireEvent.press(await screen.findByTestId(`activity-cell-${activityStart}`));
    expect(await screen.findByRole('header', { name: 'Sun, Jul 19, 2026' })).toBeTruthy();

    await switchTo('Cuisine');
    expect(await screen.findByRole('button', { name: 'Nov 19, no uploads, today' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Sun, Jul 19, 2026' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous day' })).toBeNull();
    expect(screen.queryAllByRole('button', { selected: true })).toHaveLength(0);

    // Still cleared back in Activity, where the day would be in range again.
    await switchTo('Activity');
    expect(await screen.findByText('Activity, last 17 weeks, 10 uploads')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Sun, Jul 19, 2026' })).toBeNull();
  });

  it('chosen day (b): a chosen day inside the new range survives the switch, both ways', async () => {
    await renderSection();
    await fireEvent.press(await screen.findByTestId('activity-cell-2026-11-11'));
    expect(await screen.findByRole('header', { name: 'Wed, Nov 11, 2026' })).toBeTruthy();

    await switchTo('Cuisine');
    expect(
      await screen.findByRole('button', { name: 'Nov 11, 3 cuisines, 4 uploads', selected: true }),
    ).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Wed, Nov 11, 2026' })).toBeTruthy();

    await switchTo('Activity');
    expect(
      await screen.findByRole('button', { name: 'Nov 11, 4 uploads', selected: true }),
    ).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Wed, Nov 11, 2026' })).toBeTruthy();
  });
});

describe('ActivitySection in Cuisine: the catalog', () => {
  it('catalog failure Retry: Try again reloads the catalog and the cuisine days', async () => {
    mockedCatalog.mockRejectedValueOnce(new Error('offline'));
    await renderSection();
    await switchTo('Cuisine');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(CUISINE_SUMMARY)).toBeNull();
    await waitFor(() => expect(mockedCuisineDays).toHaveBeenCalledTimes(1));
    expect(mockedCatalog).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(CUISINE_SUMMARY)).toBeTruthy();
    expect(mockedCatalog).toHaveBeenCalledTimes(2);
    expect(mockedCuisineDays).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Nov 3, Italy, 1 upload' })).toBeTruthy();
  });
});
