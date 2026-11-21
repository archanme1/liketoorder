import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';

import type { Cuisine } from '@/features/cuisines/schema';
import { testClientOptions } from '@/features/food-log/__fixtures__/foodLog';

import { COVER_JSON, makeOffer } from '../__fixtures__/offers';
import { VIETNAM } from '../__fixtures__/offersScreen';
import { OfferCard, offerCardLabel } from '../components/OfferCard';
import { offerSchema, type Offer } from '../schema';

const offer = (overrides: Record<string, unknown> = {}): Offer =>
  offerSchema.parse(makeOffer(overrides));
const STREET: Cuisine = {
  kind: 'neutral',
  code: 'street-food',
  name: 'Street food',
  flag: null,
  icon: 'fast-food-outline',
  sort_order: 2,
};

let client: QueryClient;

async function renderCard(props: Partial<Parameters<typeof OfferCard>[0]> = {}) {
  const onOpen = jest.fn();
  await render(
    <QueryClientProvider client={client}>
      <OfferCard
        offer={offer()}
        cuisine={VIETNAM}
        distance="About 4 km away"
        coverUri={null}
        onCoverExpired={jest.fn()}
        onOpen={onOpen}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpen };
}

beforeEach(() => {
  client = new QueryClient(testClientOptions());
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('OfferCard', () => {
  it('is one button whose label reads the card in order and ends with sponsored', async () => {
    await renderCard();
    const card = screen.getByRole('button');
    expect(card.props.accessibilityLabel).toBe(
      'Simcoe Street Pho, Vietnam cuisine, restaurant. Special offer: Two bowls of pho for the price of one. About 4 km away, sponsored',
    );
    expect(card.props.accessibilityHint).toBe('Opens it on the map');
  });

  it('writes every part, "Sponsored" included, as text (hidden inside the one label)', async () => {
    await renderCard();
    const card = screen.getByRole('button');
    const hidden = { includeHiddenElements: true };
    for (const text of [
      'Simcoe Street Pho',
      'Vietnam',
      'About 4 km away',
      'Restaurant',
      'Sponsored',
    ]) {
      expect(within(card).getByText(text, hidden)).toBeTruthy();
    }
    expect(
      within(card).getByText('Special offer: Two bowls of pho for the price of one', hidden),
    ).toBeTruthy();
    // The flag on the tile (no cover here) and beside the cuisine name.
    expect(within(card).getAllByText(VIETNAM.flag as string, hidden)).toHaveLength(2);
    // Heard once, through the card's label: the parts are not separate stops.
    expect(screen.queryByText('Sponsored')).toBeNull();
  });

  it('words a home cook with the approximate area', async () => {
    await renderCard({
      offer: offer({
        type: 'homemade',
        name: 'Amara Jollof',
        category: 'new_dish',
        headline: 'New: jollof tray',
      }),
      distance: 'About 2 km away, approximate area',
    });
    expect(screen.getByRole('button').props.accessibilityLabel).toBe(
      'Amara Jollof, Vietnam cuisine, home cook. New on the menu: New: jollof tray. About 2 km away, approximate area, sponsored',
    );
    expect(
      within(screen.getByRole('button')).getByText('Home cook', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('leaves the distance out when it cannot be worked out, and still says sponsored', async () => {
    await renderCard({ distance: null });
    expect(screen.getByRole('button').props.accessibilityLabel).toBe(
      'Simcoe Street Pho, Vietnam cuisine, restaurant. Special offer: Two bowls of pho for the price of one, sponsored',
    );
  });

  it('shows the flag tile when there is no cover, and the cover photo when there is one', async () => {
    await renderCard();
    expect(screen.getByTestId('offer-flag-tile', { includeHiddenElements: true })).toBeTruthy();
    await cleanup();
    await renderCard({
      offer: offer({ cover: COVER_JSON }),
      coverUri: 'https://example.test/c.jpg',
    });
    expect(screen.queryByTestId('offer-flag-tile', { includeHiddenElements: true })).toBeNull();
    expect(
      screen.getByLabelText('Cover photo, Simcoe Street Pho', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('shows a neutral cuisine with its icon and name', async () => {
    await renderCard({ cuisine: STREET });
    expect(screen.getByRole('button').props.accessibilityLabel).toMatch(
      /^Simcoe Street Pho, Street food cuisine, restaurant\./,
    );
  });

  it('says just the name when the cuisine is unknown', () => {
    expect(offerCardLabel(offer(), undefined, null)).toBe(
      'Simcoe Street Pho, restaurant. Special offer: Two bowls of pho for the price of one, sponsored',
    );
  });

  it('opens its offer, and is at least 44 pt tall', async () => {
    const { onOpen } = await renderCard();
    await fireEvent.press(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(offer());
    const style = screen.getByRole('button').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
  });
});
