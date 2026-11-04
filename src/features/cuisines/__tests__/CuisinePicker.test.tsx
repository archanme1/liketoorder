import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { CuisineAppError, listCuisines } from '../api';
import { CuisinePicker } from '../components/CuisinePicker';
import type { Cuisine } from '../schema';
import { filterCuisines, foldForSearch } from '../search';

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listCuisines: jest.fn(),
}));

const mockedList = listCuisines as unknown as jest.Mock;

const italy: Cuisine = {
  code: 'IT',
  kind: 'country',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 100,
};
const ivoryCoast: Cuisine = {
  code: 'CI',
  kind: 'country',
  name: "Côte d'Ivoire",
  flag: '🇨🇮',
  icon: null,
  sort_order: 110,
};
const france: Cuisine = {
  code: 'FR',
  kind: 'country',
  name: 'France',
  flag: '🇫🇷',
  icon: null,
  sort_order: 120,
};
const streetFood: Cuisine = {
  code: 'street-food',
  kind: 'neutral',
  name: 'Street food',
  flag: null,
  icon: 'restaurant-outline',
  sort_order: 900,
};
const catalog = [italy, ivoryCoast, france, streetFood];

const REGIONAL_INDICATOR = /[\u{1F1E6}-\u{1F1FF}]/u;
const ALL = { includeHiddenElements: true } as const;

type Node = { props: Record<string, unknown>; parent: Node | null };

function isHiddenFromScreenReaders(node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    const p = current.props ?? {};
    if (
      p.accessibilityElementsHidden === true ||
      p['aria-hidden'] === true ||
      p.importantForAccessibility === 'no' ||
      p.importantForAccessibility === 'no-hide-descendants'
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

// onChange may receive the code or the cuisine; the spec only fixes that the pick is reported.
function chosenCode(arg: unknown): unknown {
  return arg && typeof arg === 'object' && 'code' in arg ? (arg as { code: unknown }).code : arg;
}

async function renderPicker(value: string | null = null, onChange = jest.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <CuisinePicker value={value as string} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedList.mockResolvedValue(catalog);
});

describe('CuisinePicker states', () => {
  it('shows a loading state while the list loads', async () => {
    mockedList.mockReturnValue(new Promise(() => {}));
    await renderPicker();
    expect(screen.getByLabelText('Loading cuisines')).toBeTruthy();
  });

  it('shows an error with a Try again button that reloads the list', async () => {
    mockedList.mockRejectedValueOnce(new CuisineAppError('network'));
    mockedList.mockResolvedValueOnce(catalog);
    await renderPicker();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: 'Italy' })).toBeTruthy();
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it('lists every cuisine as a radio row', async () => {
    await renderPicker();
    expect(await screen.findByRole('radio', { name: 'Italy' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(catalog.length);
  });

  it('shows "No cuisines match" when the search finds nothing', async () => {
    await renderPicker();
    await screen.findByRole('radio', { name: 'Italy' });
    await fireEvent.changeText(screen.getByLabelText('Search cuisines'), 'zzzzzz');
    expect(screen.getByText('No cuisines match')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('CuisinePicker search', () => {
  it('finds "Côte d\'Ivoire" when you type "cote"', async () => {
    await renderPicker();
    await screen.findByRole('radio', { name: 'Italy' });
    await fireEvent.changeText(screen.getByLabelText('Search cuisines'), 'cote');
    expect(screen.getByRole('radio', { name: "Côte d'Ivoire" })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Italy' })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });

  it.each(['COTE', 'côte', 'Cote d', 'ivoire'])(
    'is accent and case insensitive (%s)',
    async (query) => {
      await renderPicker();
      await screen.findByRole('radio', { name: 'Italy' });
      await fireEvent.changeText(screen.getByLabelText('Search cuisines'), query);
      expect(screen.getByRole('radio', { name: "Côte d'Ivoire" })).toBeTruthy();
    },
  );

  it('filters by part of a name', async () => {
    await renderPicker();
    await screen.findByRole('radio', { name: 'Italy' });
    await fireEvent.changeText(screen.getByLabelText('Search cuisines'), 'fran');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'France' })).toBeTruthy();
  });

  it('shows the whole list again when the search is cleared', async () => {
    await renderPicker();
    await screen.findByRole('radio', { name: 'Italy' });
    const search = screen.getByLabelText('Search cuisines');
    await fireEvent.changeText(search, 'fran');
    await fireEvent.changeText(search, '');
    expect(screen.getAllByRole('radio')).toHaveLength(catalog.length);
  });
});

describe('CuisinePicker selection and accessibility', () => {
  it('marks only the selected row as checked', async () => {
    await renderPicker('IT');
    const selected = await screen.findByRole('radio', { name: 'Italy' });
    expect(selected).toBeChecked();
    expect(screen.getByRole('radio', { name: 'France' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: "Côte d'Ivoire" })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Street food' })).not.toBeChecked();
  });

  it('marks nothing as checked when there is no value', async () => {
    await renderPicker(null);
    await screen.findByRole('radio', { name: 'Italy' });
    for (const row of screen.getAllByRole('radio')) {
      expect(row).not.toBeChecked();
    }
  });

  it('reports the picked cuisine once', async () => {
    const onChange = await renderPicker();
    await fireEvent.press(await screen.findByRole('radio', { name: 'France' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(chosenCode(onChange.mock.calls[0][0])).toBe('FR');
  });

  it('reports a pick made after searching', async () => {
    const onChange = await renderPicker();
    await screen.findByRole('radio', { name: 'Italy' });
    await fireEvent.changeText(screen.getByLabelText('Search cuisines'), 'cote');
    await fireEvent.press(screen.getByRole('radio', { name: "Côte d'Ivoire" }));
    expect(chosenCode(onChange.mock.calls[0][0])).toBe('CI');
  });

  it('labels each row with the cuisine name', async () => {
    await renderPicker();
    await screen.findByRole('radio', { name: 'Italy' });
    for (const cuisine of catalog) {
      expect(screen.getByLabelText(cuisine.name)).toBeTruthy();
    }
  });

  it('shows the name as visible text and hides the flag from screen readers', async () => {
    await renderPicker();
    const row = await screen.findByRole('radio', { name: 'Italy' });
    const name = within(row).getByText('Italy');
    expect(isHiddenFromScreenReaders(name as unknown as Node)).toBe(false);
    const flag = within(row).getByText('🇮🇹', ALL);
    expect(isHiddenFromScreenReaders(flag as unknown as Node)).toBe(true);
  });

  it('shows a neutral icon, not a flag, for street-food, and hides it from screen readers', async () => {
    await renderPicker();
    await screen.findByRole('radio', { name: 'Italy' });
    await fireEvent.changeText(screen.getByLabelText('Search cuisines'), 'street');
    const row = screen.getByRole('radio', { name: 'Street food' });
    expect(within(row).getByText('Street food')).toBeTruthy();
    expect(within(row).queryByText(REGIONAL_INDICATOR, ALL)).toBeNull();

    const icons = screen.container.queryAll((node) => node.props.name === 'restaurant-outline');
    expect(icons.length).toBeGreaterThanOrEqual(1);
    expect(icons[icons.length - 1].props.name).toBe('restaurant-outline');
    expect(isHiddenFromScreenReaders(icons[icons.length - 1] as unknown as Node)).toBe(true);
  });
});

describe('foldForSearch and filterCuisines', () => {
  it('folds case and accents to the same form', () => {
    expect(foldForSearch('Côte')).toBe(foldForSearch('cote'));
    expect(foldForSearch('CÔTE')).toBe(foldForSearch('cote'));
  });

  it('finds Côte d\'Ivoire for "cote"', () => {
    expect(filterCuisines(catalog, 'cote').map((c) => c.code)).toEqual(['CI']);
  });

  it('returns everything for an empty or blank query', () => {
    expect(filterCuisines(catalog, '')).toHaveLength(catalog.length);
    expect(filterCuisines(catalog, '   ')).toHaveLength(catalog.length);
  });

  it('returns nothing when no name matches', () => {
    expect(filterCuisines(catalog, 'zzzzzz')).toEqual([]);
  });

  it('keeps the original order', () => {
    expect(filterCuisines(catalog, 'e').map((c) => c.code)).toEqual(
      catalog.filter((c) => foldForSearch(c.name).includes('e')).map((c) => c.code),
    );
  });
});
