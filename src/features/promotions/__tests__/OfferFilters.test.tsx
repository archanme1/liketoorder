import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';

import { OfferFilters } from '../components/OfferFilters';
import { DEFAULT_OFFER_FILTERS, type OfferFilters as Filters } from '../schema';

async function renderFilters(value: Filters = DEFAULT_OFFER_FILTERS) {
  const onChange = jest.fn();
  await render(<OfferFilters value={value} onChange={onChange} />);
  return { onChange };
}

const group = (name: string) => within(screen.getByLabelText(name));

afterEach(async () => {
  await cleanup();
});

describe('OfferFilters', () => {
  it('has four radio groups with the chips in order, and no cuisine filter', async () => {
    await renderFilters();
    const names = (label: string) =>
      group(label)
        .getAllByRole('radio')
        .map((chip) => chip.props.accessibilityLabel);
    expect(names('Category')).toEqual([
      'All, selected',
      'New on the menu',
      'Special offer',
      'Featured',
    ]);
    expect(names('Type')).toEqual(['All, selected', 'Restaurants', 'Home cooks']);
    expect(names('Distance')).toEqual(['About 5 km', 'About 15 km, selected', 'About 30 km']);
    expect(names('Table requests')).toEqual(['Any, selected', 'Takes table requests']);
    expect(screen.queryByLabelText(/cuisine/i)).toBeNull();
    for (const name of ['Category', 'Type', 'Distance', 'Table requests']) {
      expect(screen.getByLabelText(name).props.accessibilityRole).toBe('radiogroup');
    }
  });

  it('marks exactly one chip per group as selected, in words and in its state', async () => {
    await renderFilters({ distanceKm: 30, category: 'featured', type: 'homemade', tables: true });
    for (const [label, chip] of [
      ['Category', 'Featured'],
      ['Type', 'Home cooks'],
      ['Distance', 'About 30 km'],
      ['Table requests', 'Takes table requests'],
    ]) {
      const selected = group(label)
        .getAllByRole('radio')
        .filter((radio) => radio.props.accessibilityState?.selected);
      expect(selected).toHaveLength(1);
      expect(selected[0].props.accessibilityLabel).toBe(`${chip}, selected`);
    }
  });

  it('hands back the whole filter set with the one change', async () => {
    const { onChange } = await renderFilters();
    await fireEvent.press(screen.getByRole('radio', { name: 'Special offer' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_OFFER_FILTERS,
      category: 'special_offer',
    });
    await fireEvent.press(screen.getByRole('radio', { name: 'Restaurants' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_OFFER_FILTERS, type: 'restaurant' });
    await fireEvent.press(screen.getByRole('radio', { name: 'About 5 km' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_OFFER_FILTERS, distanceKm: 5 });
    await fireEvent.press(screen.getByRole('radio', { name: 'Takes table requests' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_OFFER_FILTERS, tables: true });
  });

  it('goes back to All and Any', async () => {
    const { onChange } = await renderFilters({
      distanceKm: 5,
      category: 'new_dish',
      type: 'restaurant',
      tables: true,
    });
    await fireEvent.press(group('Category').getByRole('radio', { name: 'All' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ category: null }));
    await fireEvent.press(group('Type').getByRole('radio', { name: 'All' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: null }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Any' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tables: false }));
  });

  it('gives every chip a target of at least 44 pt', async () => {
    await renderFilters();
    for (const chip of screen.getAllByRole('radio')) {
      const style = chip.props.style;
      const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    }
  });
});
