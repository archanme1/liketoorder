import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable } from 'react-native';
import MapView from 'react-native-maps';

import type { Cuisine } from '@/features/cuisines/schema';
import { mapArea } from '@/theme/tokens';

import { HomemadeMarker, homemadeMarkerLabel } from '../components/HomemadeMarker';
import type { Pin } from '../schema';

const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 1,
};
// A point with awkward digits: the circle must use it exactly, never a rounded or offset copy.
const cook: Pin = {
  id: 'h1',
  name: "Nonna Rosa's Table",
  cuisine_code: 'IT',
  lat: 43.89713,
  lng: -78.86583,
};

async function renderMarker(zoomedIn: boolean, onSelect = jest.fn()) {
  await render(
    <MapView>
      <HomemadeMarker
        pin={cook}
        cuisine={italy}
        selected={false}
        onSelect={onSelect}
        zoomedIn={zoomedIn}
      />
    </MapView>,
  );
}

describe('HomemadeMarker', () => {
  it('draws a 500 m circle centred exactly on the pin the server gave, when zoomed in', async () => {
    await renderMarker(true);
    const circle = screen.getByTestId('map-circle');
    // Never smaller than the largest shift the server applies (500 m), so the real home is inside.
    expect(circle.props.radius).toBeGreaterThanOrEqual(500);
    expect(circle.props.center).toEqual({ latitude: 43.89713, longitude: -78.86583 });
    expect(circle.props.fillColor).toBe(mapArea.fill);
    expect(circle.props.strokeColor).toBe(mapArea.stroke);
    expect(circle.props.strokeWidth).toBe(mapArea.strokeWidth);
  });

  it('draws no circle when zoomed out, but still draws the flag', async () => {
    await renderMarker(false);
    expect(screen.queryByTestId('map-circle')).not.toBeOnTheScreen();
    expect(screen.getByTestId('marker')).toBeOnTheScreen();
  });

  it('draws the flag at the same point as the circle', async () => {
    await renderMarker(true);
    expect(screen.getByTestId('marker').props.coordinate).toEqual(
      screen.getByTestId('map-circle').props.center,
    );
  });

  it('puts the circle under the flag', async () => {
    await renderMarker(true);
    expect(screen.getByTestId('map-circle').props.zIndex).toBe(0);
    expect(screen.getByTestId('marker').props.zIndex).toBeGreaterThan(0);
  });

  it('gives the circle no press: the library has none, so it cannot open or close anything', async () => {
    await renderMarker(true);
    const props = screen.getByTestId('map-circle').props;
    expect(props.onPress).toBeUndefined();
    expect(props.tappable).toBeUndefined();
    expect(props.stopPropagation).toBeUndefined();
  });

  it('names the cook, the cuisine and "homemade, approximate area"', async () => {
    await renderMarker(true);
    expect(
      screen.getByRole('button', {
        name: "Nonna Rosa's Table, Italy cuisine, homemade, approximate area",
      }),
    ).toBeOnTheScreen();
    expect(homemadeMarkerLabel('Amy', undefined)).toBe('Amy, homemade, approximate area');
  });

  it('keeps stopPropagation on the flag so its press never reaches the map', async () => {
    await renderMarker(true);
    expect(screen.getByTestId('marker').props.stopPropagation).toBe(true);
  });
});

describe('HomemadeMarker: re-renders', () => {
  it('does not re-render when its parent does and the props are equal', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const maps = require('react-native-maps') as { Circle: (props: object) => unknown };
    const circle = jest.spyOn(maps, 'Circle');
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
          <HomemadeMarker
            pin={cook}
            cuisine={italy}
            selected={false}
            onSelect={onSelect}
            zoomedIn
          />
        </MapView>
      );
    }
    await render(<Parent />);
    const before = circle.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'rerender' }));
    await fireEvent.press(screen.getByRole('button', { name: 'rerender' }));
    expect(circle.mock.calls.length).toBe(before);
    circle.mockRestore();
  });

  it('re-renders when the zoom band flips (the circle must appear or go)', async () => {
    const { rerender } = await render(
      <MapView>
        <HomemadeMarker pin={cook} cuisine={italy} selected={false} onSelect={jest.fn()} zoomedIn />
      </MapView>,
    );
    expect(screen.getByTestId('map-circle')).toBeOnTheScreen();
    await rerender(
      <MapView>
        <HomemadeMarker
          pin={cook}
          cuisine={italy}
          selected={false}
          onSelect={jest.fn()}
          zoomedIn={false}
        />
      </MapView>,
    );
    expect(screen.queryByTestId('map-circle')).toBeNull();
  });
});
