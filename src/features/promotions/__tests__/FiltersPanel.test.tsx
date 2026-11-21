import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FiltersPanel } from '../components/FiltersPanel';
import { DEFAULT_OFFER_FILTERS, type OfferFilters } from '../schema';

const APPLIED: OfferFilters = {
  distanceKm: 30,
  category: 'featured',
  type: 'restaurant',
  tables: false,
};

async function renderPanel(applied: OfferFilters = APPLIED) {
  const onApply = jest.fn();
  const onClose = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <FiltersPanel applied={applied} onApply={onApply} onClose={onClose} />
    </SafeAreaProvider>,
  );
  // useReduceMotion reads the setting after the first render.
  await act(async () => {});
  return { onApply, onClose };
}

const panel = () => within(screen.getByTestId('filters-panel'));
const flat = (style: unknown) =>
  Array.isArray(style) ? Object.assign({}, ...style.flat()) : (style as Record<string, unknown>);
function modal() {
  let node = screen.getByTestId('filters-panel').parent;
  while (node && node.type !== 'Modal') node = node.parent;
  if (!node) throw new Error('no Modal around the panel');
  return node;
}

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

describe('FiltersPanel', () => {
  it('is a modal panel titled Filters, with a Close filters button', async () => {
    await renderPanel();
    expect(screen.getByTestId('filters-panel').props.accessibilityViewIsModal).toBe(true);
    expect(panel().getByRole('header', { name: 'Filters' })).toBeOnTheScreen();
    expect(panel().getByRole('button', { name: 'Close filters' })).toBeOnTheScreen();
  });

  it('opens on the applied filters', async () => {
    await renderPanel();
    for (const name of [
      'Featured, selected',
      'Restaurants, selected',
      'About 30 km, selected',
      'Any, selected',
    ]) {
      expect(panel().getByRole('radio', { name })).toBeOnTheScreen();
    }
  });

  it('has the same four radio groups, each chip a radio of at least 44 pt', async () => {
    await renderPanel();
    for (const name of ['Category', 'Type', 'Distance', 'Table requests']) {
      expect(panel().getByLabelText(name).props.accessibilityRole).toBe('radiogroup');
    }
    const radios = panel().getAllByRole('radio');
    expect(radios).toHaveLength(12);
    for (const radio of radios)
      expect(flat(radio.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('changes only the draft on a chip tap', async () => {
    const { onApply, onClose } = await renderPanel();
    await fireEvent.press(panel().getByRole('radio', { name: 'Special offer' }));
    expect(panel().getByRole('radio', { name: 'Special offer, selected' })).toBeOnTheScreen();
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Show offers hands back the draft, once', async () => {
    const { onApply } = await renderPanel();
    await fireEvent.press(panel().getByRole('radio', { name: 'Home cooks' }));
    await fireEvent.press(panel().getByRole('radio', { name: 'Takes table requests' }));
    await fireEvent.press(panel().getByRole('button', { name: 'Show offers' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ ...APPLIED, type: 'homemade', tables: true });
  });

  it('Clear all resets the draft to the defaults and applies nothing', async () => {
    const { onApply, onClose } = await renderPanel();
    await fireEvent.press(panel().getByRole('button', { name: 'Clear all' }));
    expect(panel().getByRole('radio', { name: 'About 15 km, selected' })).toBeOnTheScreen();
    expect(panel().getAllByRole('radio', { name: 'All, selected' })).toHaveLength(2);
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.press(panel().getByRole('button', { name: 'Show offers' }));
    expect(onApply).toHaveBeenCalledWith(DEFAULT_OFFER_FILTERS);
  });

  it.each([
    [
      'the Close x',
      async () => fireEvent.press(panel().getByRole('button', { name: 'Close filters' })),
    ],
    ['the back gesture', async () => fireEvent(modal(), 'requestClose')],
    [
      'a tap outside',
      async () =>
        fireEvent.press(screen.getByTestId('filters-backdrop', { includeHiddenElements: true })),
    ],
  ])('closes with %s without applying the draft', async (_, close) => {
    const { onApply, onClose } = await renderPanel();
    await fireEvent.press(panel().getByRole('radio', { name: 'About 5 km' }));
    await close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('slides in normally, and appears without animation with Reduce Motion on', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    await renderPanel();
    expect(modal().props.animationType).toBe('slide');
    await cleanup();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await renderPanel();
    expect(modal().props.animationType).toBe('none');
  });

  it('lets the chips and the bottom buttons wrap at large text sizes', async () => {
    await renderPanel();
    const chipRow = panel().getByLabelText('Category');
    expect(flat(chipRow.props.style)).toMatchObject({ flexWrap: 'wrap' });
    const actions = panel().getByRole('button', { name: 'Show offers' }).parent?.parent;
    expect(flat(actions?.props.style)).toMatchObject({ flexWrap: 'wrap' });
    for (const name of ['Clear all', 'Show offers', 'Close filters']) {
      const button = panel().getByRole('button', { name });
      const style = flat(button.props.style);
      expect(
        Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0)),
      ).toBeGreaterThanOrEqual(44);
    }
  });
});
