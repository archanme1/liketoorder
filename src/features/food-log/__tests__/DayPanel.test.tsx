import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';

import {
  CUISINES,
  dayJson,
  foodLog,
  resetModuleMocks,
  testClientOptions,
} from '../__fixtures__/foodLog';
import { FoodLogAppError, listMyFoodLogsOn } from '../api';
import { DayPanel } from '../components/DayPanel';
import { foodLogErrorMessage } from '../messages';

type Element = ReturnType<typeof screen.getByText>;

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
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

const mockedDay = jest.mocked(listMyFoodLogsOn);
const ITALY_FLAG = CUISINES[0].flag ?? '';
// "Pasta", a line break, then "with basil": one line in the row and in the label.
const PASTA = foodLog(1, {
  local_date: '2026-11-12',
  description: 'Pasta' + String.fromCodePoint(0x0a) + 'with basil',
  is_public: false,
  created_at: '2026-11-12T19:45:00+00:00',
});
const SUSHI = foodLog(2, {
  local_date: '2026-11-12',
  cuisine_code: 'JP',
  description: null,
  created_at: '2026-11-12T21:05:00+00:00',
});

let client: QueryClient;
const onChangeDate = jest.fn();

beforeEach(() => {
  jest.mocked(listCuisines).mockResolvedValue(CUISINES);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
    );
  mockedDay.mockResolvedValue(dayJson([PASTA, SUSHI]));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('../api', '@/features/media/api', '@/features/cuisines/api');
});

async function renderPanel(date = '2026-11-12', from = '2026-07-19', today = '2026-11-12') {
  client = new QueryClient(testClientOptions());
  await render(
    <QueryClientProvider client={client}>
      <DayPanel date={date} from={from} today={today} onChangeDate={onChangeDate} />
    </QueryClientProvider>,
  );
}

/** True when the element or an ancestor hides it from screen readers on both platforms. */
function isHidden(element: Element | null): boolean {
  for (let node = element; node; node = node.parent) {
    if (
      node.props.accessibilityElementsHidden === true &&
      (node.props.importantForAccessibility === 'no-hide-descendants' ||
        node.props.importantForAccessibility === 'no')
    ) {
      return true;
    }
  }
  return false;
}

describe('DayPanel: the 4 states', () => {
  it('loading', async () => {
    mockedDay.mockReturnValue(new Promise(() => {}));
    await renderPanel();
    expect(screen.getByLabelText("Loading this day's photos")).toBeTruthy();
  });

  it('error, then Try again', async () => {
    mockedDay.mockRejectedValueOnce(new FoodLogAppError('network'));
    await renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent(foodLogErrorMessage('network'));
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^Food photo, Italy\./ })).toBeTruthy();
  });

  it('empty: "Nothing logged on <date>."', async () => {
    mockedDay.mockResolvedValue(dayJson([]));
    await renderPanel();
    expect(await screen.findByText('Nothing logged on Thu, Nov 12, 2026.')).toBeTruthy();
  });

  it('success: the date as a header and the rows oldest first', async () => {
    await renderPanel();
    expect(screen.getByRole('header', { name: 'Thu, Nov 12, 2026' })).toBeTruthy();
    const rows = await screen.findAllByTestId(/^day-panel-row-/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      `day-panel-row-${PASTA.id}`,
      `day-panel-row-${SUSHI.id}`,
    ]);
    expect(mockedDay).toHaveBeenCalledWith('2026-11-12');
  });
});

describe('DayPanel rows', () => {
  it('speak the cuisine, one line of the description and "Private"; no date, no time', async () => {
    await renderPanel();
    expect(
      await screen.findByRole('button', {
        name: 'Food photo, Italy. Pasta with basil. Private',
      }),
    ).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Food photo, Japan. No description.' }),
    ).toBeTruthy();
  });

  // The rows can render before the cuisine catalog (its own query) resolves, showing "Loading
  // cuisine" for a moment; the tests that read the cuisine wait for the names themselves.
  it('show CuisineLabel, the description on one line and "Private" as a word', async () => {
    await renderPanel();
    const visible = { includeHiddenElements: true };
    expect(await screen.findByText('Italy', visible)).toBeTruthy();
    expect(await screen.findByText('Japan', visible)).toBeTruthy();
    expect(screen.getByText(PASTA.description ?? '', visible).props.numberOfLines).toBe(1);
    expect(screen.getAllByText('Private', visible)).toHaveLength(1);
  });

  it('hide the flag from screen readers (spec 04 display rule)', async () => {
    await renderPanel();
    const flags = await screen.findAllByText(ITALY_FLAG, { includeHiddenElements: true });
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) expect(isHidden(flag)).toBe(true);
    expect(screen.queryByText(ITALY_FLAG)).toBeNull();
  });

  it('show no time (Decision 12)', async () => {
    await renderPanel();
    // Fully loaded rows (cuisine names in), so the absence check is not vacuous.
    await screen.findByRole('button', { name: /^Food photo, Japan\./ });
    expect(screen.queryByText(/\d{1,2}:\d{2}/, { includeHiddenElements: true })).toBeNull();
    for (const row of screen.getAllByTestId(/^day-panel-row-/)) {
      expect(row.props.accessibilityLabel).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });

  it('open the detail page on tap', async () => {
    await renderPanel();
    await fireEvent.press(await screen.findByRole('button', { name: /^Food photo, Japan/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/food-log/[id]',
      params: { id: SUSHI.id },
    });
  });
});

describe('DayPanel: Previous and Next day', () => {
  it('move one day inside the range', async () => {
    await renderPanel('2026-11-10');
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(onChangeDate).toHaveBeenLastCalledWith('2026-11-09');
    await fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
    expect(onChangeDate).toHaveBeenLastCalledWith('2026-11-11');
    expect(screen.queryByText('First day of this range')).toBeNull();
    expect(screen.queryByText('Last day of this range')).toBeNull();
  });

  it('are disabled at the range edges, with the state in words', async () => {
    await renderPanel('2026-07-19');
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
    expect(screen.getByText('First day of this range')).toBeTruthy();
    await cleanup();
    client.clear();
    await renderPanel('2026-11-12');
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    expect(screen.getByText('Last day of this range')).toBeTruthy();
  });
});
