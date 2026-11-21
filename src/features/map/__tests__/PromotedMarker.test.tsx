import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import MapView from 'react-native-maps';
import {
  cancelAnimation,
  useReducedMotion,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { Cuisine } from '@/features/cuisines/schema';
import { colors, size, stroke } from '@/theme/tokens';

import { AD_BADGE_TEXT, sponsoredLabel } from '../components/AdBadge';
import { homemadeMarkerLabel, HomemadeMarker } from '../components/HomemadeMarker';
import { PromotedMarker } from '../components/PromotedMarker';
import {
  FLOAT_MS,
  FLOAT_PX,
  MAX_START_DELAY_MS,
  POP_IN_MS,
  POP_FROM,
} from '../hooks/usePromotedFloat';
import type { Pin } from '../schema';

const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: String.fromCodePoint(0x1f1ee, 0x1f1f9),
  icon: null,
  sort_order: 1,
};
const pho: Pin = {
  id: 'r2',
  name: 'Simcoe Street Pho',
  cuisine_code: 'IT',
  lat: 43.8971,
  lng: -78.8658,
  promoted: true,
};

const flat = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style);
const marker = () => screen.getByTestId('marker');

async function renderPromoted(props: Partial<React.ComponentProps<typeof PromotedMarker>> = {}) {
  await render(
    <MapView>
      <PromotedMarker pin={pho} cuisine={italy} selected={false} onSelect={jest.fn()} {...props} />
    </MapView>,
  );
}

/** Our live Reduce Motion hook: what the system says first, and the change listener. */
function liveReduceMotion(initial: boolean) {
  const listeners: ((value: boolean) => void)[] = [];
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(initial);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    _event: string,
    handler: (value: boolean) => void,
  ) => {
    listeners.push(handler);
    return { remove: jest.fn() };
  }) as never);
  return {
    change: (value: boolean) =>
      act(async () => {
        for (const listener of listeners) listener(value);
      }),
  };
}

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

describe('PromotedMarker: look and label', () => {
  it('says the name, the cuisine and ", sponsored"', async () => {
    await renderPromoted();
    expect(
      screen.getByRole('button', { name: 'Simcoe Street Pho, Italy cuisine, sponsored' }),
    ).toBeOnTheScreen();
    expect(sponsoredLabel('X')).toBe('X, sponsored');
  });

  it('still says ", sponsored" while the cuisine list loads', async () => {
    await renderPromoted({ cuisine: undefined });
    expect(screen.getByRole('button', { name: 'Simcoe Street Pho, sponsored' })).toBeOnTheScreen();
  });

  it('shows the written "Ad" badge, hidden from screen readers (the label says it)', async () => {
    await renderPromoted();
    expect(AD_BADGE_TEXT).toBe('Ad');
    expect(screen.getByText('Ad', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Ad')).toBeNull();
    const badge = screen.getByTestId('ad-badge', { includeHiddenElements: true });
    expect(badge.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(badge.props.accessibilityElementsHidden).toBe(true);
  });

  it('draws the ad ring around a pill larger than the normal flag pill', async () => {
    await renderPromoted();
    expect(flat('promoted-ring')).toMatchObject({
      borderColor: colors.adRing,
      borderWidth: stroke.adRing,
    });
    expect(size.promotedFlagWidth).toBe(Math.round(size.flagWidth * 1.3));
    expect(size.promotedFlagHeight).toBe(Math.round(size.flagHeight * 1.3));
    expect(flat('promoted-pill').minWidth as number).toBeGreaterThan(size.flagWidth + 8);
  });

  it('has a touch target of at least 44 points', async () => {
    await renderPromoted();
    const hit = flat('promoted-hit');
    expect(hit.width).toBe(size.promotedMarker);
    expect(hit.height).toBe(size.promotedMarker);
    expect(size.promotedMarker).toBeGreaterThanOrEqual(size.touch);
  });

  it('asks the library to stop the press at the marker, and sits above organic flags', async () => {
    const onSelect = jest.fn();
    await renderPromoted({ onSelect });
    expect(marker().props.stopPropagation).toBe(true);
    expect(marker().props.zIndex).toBe(3);
    await fireEvent.press(marker());
    expect(onSelect).toHaveBeenCalledWith(pho);
  });

  it('marks the selected one with a darker inner border, not a bigger marker', async () => {
    await renderPromoted({ selected: true });
    expect(flat('promoted-pill')).toMatchObject({
      borderColor: colors.text,
      borderWidth: stroke.selected,
    });
    expect(flat('promoted-hit').width).toBe(size.promotedMarker);
    expect(marker().props.zIndex).toBe(4);
  });

  it('a homemade one keeps the homemade label and ends with ", sponsored"', async () => {
    await render(
      <MapView>
        <HomemadeMarker
          pin={{ ...pho, name: "Nonna Rosa's Table" }}
          cuisine={italy}
          selected={false}
          onSelect={jest.fn()}
          zoomedIn
          promotion="large"
        />
      </MapView>,
    );
    expect(
      screen.getByRole('button', {
        name: sponsoredLabel(homemadeMarkerLabel("Nonna Rosa's Table", italy)),
      }),
    ).toBeOnTheScreen();
    expect(homemadeMarkerLabel("Nonna Rosa's Table", italy)).toBe(
      "Nonna Rosa's Table, Italy cuisine, homemade, approximate area",
    );
  });

  it('does not re-render when its parent does and the props are equal', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const maps = require('react-native-maps') as { Marker: (props: object) => unknown };
    const markerRenders = jest.spyOn(maps, 'Marker');
    const onSelect = jest.fn();
    function Parent() {
      const [tick, setTick] = useState(0);
      return (
        <MapView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="rerender"
            onPress={() => setTick(tick + 1)}
          />
          <PromotedMarker pin={pho} cuisine={italy} selected={false} onSelect={onSelect} />
        </MapView>
      );
    }
    await render(<Parent />);
    const before = markerRenders.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'rerender' }));
    await fireEvent.press(screen.getByRole('button', { name: 'rerender' }));
    expect(markerRenders.mock.calls.length).toBe(before);
  });
});

describe('PromotedMarker: motion (usePromotedFloat)', () => {
  it('pops in once (0.8 to 1 in 220 ms) and then floats 4 points, 1.4 s each way, forever', async () => {
    liveReduceMotion(false);
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    await renderPromoted();
    // The first frame is the small one; the pop-in grows it to full size.
    expect(POP_FROM).toBe(0.8);
    expect(flat('promoted-float').transform).toEqual([{ translateY: 0 }, { scale: POP_FROM }]);
    expect(jest.mocked(withTiming)).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: POP_IN_MS }),
    );
    expect(POP_IN_MS).toBe(220);
    expect(jest.mocked(withTiming)).toHaveBeenCalledWith(
      -FLOAT_PX,
      expect.objectContaining({ duration: FLOAT_MS }),
    );
    expect([FLOAT_PX, FLOAT_MS]).toEqual([4, 1400]);
    // Infinite and reversing: up, down, up... never a grow-and-shrink loop.
    expect(jest.mocked(withRepeat)).toHaveBeenCalledWith(expect.anything(), -1, true);
    const repeated = jest.mocked(withRepeat).mock.calls.length;
    expect(repeated).toBe(1);
    // The float waits for the pop-in plus its own random delay (0.5 of the maximum here).
    expect(jest.mocked(withDelay)).toHaveBeenCalledWith(
      POP_IN_MS + 0.5 * MAX_START_DELAY_MS,
      expect.anything(),
    );
    // The pop-in is never repeated: only the float goes through withRepeat.
    const scaleCalls = jest.mocked(withTiming).mock.calls.filter((call) => call[0] === 1);
    expect(scaleCalls).toHaveLength(1);
  });

  it('keeps re-drawing its picture while it moves', async () => {
    liveReduceMotion(false);
    await renderPromoted();
    expect(marker().props.tracksViewChanges).toBe(true);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(marker().props.tracksViewChanges).toBe(true);
  });

  it('with Reduce Motion on, starts no animation at all and stops re-drawing', async () => {
    jest.mocked(useReducedMotion).mockReturnValue(true);
    liveReduceMotion(true);
    await renderPromoted();
    await waitFor(() => expect(marker().props.tracksViewChanges).toBe(false));
    expect(jest.mocked(withTiming)).not.toHaveBeenCalled();
    expect(jest.mocked(withDelay)).not.toHaveBeenCalled();
    expect(jest.mocked(withRepeat)).not.toHaveBeenCalled();
    // Full size and in place from the first frame: no pop-in.
    expect(flat('promoted-float').transform).toEqual([{ translateY: 0 }, { scale: 1 }]);
    // Still the larger marker, with the ring and the badge.
    expect(flat('promoted-ring').borderColor).toBe(colors.adRing);
    expect(screen.getByText('Ad', { includeHiddenElements: true })).toBeTruthy();
  });

  it('with only the system value (read on the first frame) saying Reduce Motion, nothing starts', async () => {
    jest.mocked(useReducedMotion).mockReturnValue(true);
    liveReduceMotion(false);
    await renderPromoted();
    await waitFor(() => expect(marker().props.tracksViewChanges).toBe(false));
    expect(jest.mocked(withTiming)).not.toHaveBeenCalled();
    expect(jest.mocked(withRepeat)).not.toHaveBeenCalled();
  });

  it('stops at once when Reduce Motion is turned on, and does not start again when it is turned off', async () => {
    const reduce = liveReduceMotion(false);
    await renderPromoted();
    expect(jest.mocked(withRepeat)).toHaveBeenCalledTimes(1);
    await reduce.change(true);
    expect(jest.mocked(cancelAnimation)).toHaveBeenCalledTimes(2); // scale and float
    await waitFor(() => expect(marker().props.tracksViewChanges).toBe(false));
    await reduce.change(false);
    expect(jest.mocked(withRepeat)).toHaveBeenCalledTimes(1);
    expect(marker().props.tracksViewChanges).toBe(false);
  });
});
