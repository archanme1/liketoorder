import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import { listCuisines } from '../api';
import { CuisineLabel } from '../components/CuisineLabel';
import type { Cuisine } from '../schema';

// Spec 04 display rule: the name is always visible; the flag or icon is hidden from screen
// readers; a country shows its flag, a neutral cuisine shows an icon (never a flag).

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
const streetFood: Cuisine = {
  code: 'street-food',
  kind: 'neutral',
  name: 'Street food',
  flag: null,
  icon: 'restaurant-outline',
  sort_order: 900,
};

const REGIONAL_INDICATOR = /[\u{1F1E6}-\u{1F1FF}]/u;
const ALL = { includeHiddenElements: true } as const;

type Node = { props: Record<string, unknown>; parent: Node | null };

// True when the node, or any ancestor, is explicitly kept away from screen readers.
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

async function renderLabel(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedList.mockResolvedValue([italy, streetFood]);
});

describe('CuisineLabel with a cuisine object', () => {
  it('exposes the cuisine name as the accessibility label of the whole label', async () => {
    await renderLabel(<CuisineLabel cuisine={italy} />);
    expect(screen.getByLabelText('Italy')).toBeTruthy();
  });

  it('shows the name as visible text', async () => {
    await renderLabel(<CuisineLabel cuisine={italy} />);
    expect(screen.getByText('Italy')).toBeTruthy();
  });

  it('shows the flag for a country cuisine, hidden from screen readers', async () => {
    await renderLabel(<CuisineLabel cuisine={italy} />);
    const flag = screen.getByText('🇮🇹', ALL);
    expect(isHiddenFromScreenReaders(flag as unknown as Node)).toBe(true);
  });

  it('keeps the name itself available to screen readers', async () => {
    await renderLabel(<CuisineLabel cuisine={italy} />);
    // Found without includeHiddenElements, so it is not hidden.
    const name = screen.getByText('Italy');
    expect(isHiddenFromScreenReaders(name as unknown as Node)).toBe(false);
  });

  it('shows an icon, not a flag, for a neutral cuisine', async () => {
    await renderLabel(<CuisineLabel cuisine={streetFood} />);
    expect(screen.getByText('Street food')).toBeTruthy();
    expect(screen.queryByText(REGIONAL_INDICATOR, ALL)).toBeNull();

    const icons = screen.container.queryAll((node) => node.props.name === 'restaurant-outline');
    expect(icons.length).toBeGreaterThanOrEqual(1);
    expect(icons[icons.length - 1].props.name).toBe('restaurant-outline');
    expect(isHiddenFromScreenReaders(icons[icons.length - 1] as unknown as Node)).toBe(true);
  });

  it('announces a neutral cuisine by name', async () => {
    await renderLabel(<CuisineLabel cuisine={streetFood} />);
    expect(screen.getByLabelText('Street food')).toBeTruthy();
  });

  it.each(['caption', 'body', 'bodyLg', 'title', 'h1'] as const)(
    'renders the visible name and the accessibility label in the %s variant',
    async (variant) => {
      await renderLabel(<CuisineLabel cuisine={italy} variant={variant} />);
      expect(screen.getByText('Italy')).toBeTruthy();
      expect(screen.getByLabelText('Italy')).toBeTruthy();
      expect(isHiddenFromScreenReaders(screen.getByText('🇮🇹', ALL) as unknown as Node)).toBe(true);
    },
  );
});

describe('CuisineLabel with a code', () => {
  it('looks up the cuisine by code', async () => {
    await renderLabel(<CuisineLabel code="IT" />);
    expect(await screen.findByText('Italy')).toBeTruthy();
    expect(screen.getByLabelText('Italy')).toBeTruthy();
    expect(isHiddenFromScreenReaders(screen.getByText('🇮🇹', ALL) as unknown as Node)).toBe(true);
  });

  it('looks up a neutral cuisine by its slug and shows an icon', async () => {
    await renderLabel(<CuisineLabel code="street-food" />);
    expect(await screen.findByText('Street food')).toBeTruthy();
    expect(screen.queryByText(REGIONAL_INDICATOR, ALL)).toBeNull();
    const icons = screen.container.queryAll((node) => node.props.name === 'restaurant-outline');
    expect(icons.length).toBeGreaterThanOrEqual(1);
    expect(icons[icons.length - 1].props.name).toBe('restaurant-outline');
  });

  it('shows "Unknown cuisine" for a code that is not in the catalog', async () => {
    await renderLabel(<CuisineLabel code="XX" />);
    expect(await screen.findByText('Unknown cuisine')).toBeTruthy();
  });
});
