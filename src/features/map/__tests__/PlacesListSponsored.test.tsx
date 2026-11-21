import { cleanup, render, screen, within } from '@testing-library/react-native';

import type { Cuisine } from '@/features/cuisines/schema';
import { SPONSORED_TEXT } from '@/features/promotions/components/SponsoredLabel';

import { PlacesList } from '../components/PlacesList';
import type { Pin } from '../schema';

const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: String.fromCodePoint(0x1f1ee, 0x1f1f9),
  icon: null,
  sort_order: 1,
};
const cuisines = new Map([['IT', italy]]);
const pin = (id: string, name: string, promoted: boolean): Pin => ({
  id,
  name,
  cuisine_code: 'IT',
  lat: 43.9,
  lng: -78.86,
  promoted,
});

afterEach(async () => {
  await cleanup();
});

describe('PlacesList rows for promoted places (spec 16)', () => {
  it('a promoted row shows "Sponsored" and says ", sponsored"; others show and say nothing', async () => {
    await render(
      <PlacesList
        pins={[pin('a', 'Bangkok Garden', true), pin('b', 'Casa Lisboa', false)]}
        cuisineByCode={cuisines}
        onSelect={jest.fn()}
        contentContainerStyle={{ padding: 0 }}
      />,
    );
    const promoted = screen.getByRole('button', {
      name: 'Bangkok Garden, Italy cuisine, sponsored',
    });
    const organic = screen.getByRole('button', { name: 'Casa Lisboa, Italy cuisine' });
    expect(SPONSORED_TEXT).toBe('Sponsored');
    expect(within(promoted).getByText('Sponsored', { includeHiddenElements: true })).toBeTruthy();
    expect(within(organic).queryByText('Sponsored', { includeHiddenElements: true })).toBeNull();
    // The written label is not read a second time: the row's own label already says it.
    expect(within(promoted).queryByText('Sponsored')).toBeNull();
  });
});
