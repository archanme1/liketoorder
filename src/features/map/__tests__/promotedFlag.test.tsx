import { cleanup, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import MapView from 'react-native-maps';

import type { Cuisine } from '@/features/cuisines/schema';
import { colors, size, stroke } from '@/theme/tokens';

import { FlagMarker } from '../components/FlagMarker';
import { HomemadeMarker } from '../components/HomemadeMarker';
import type { Pin } from '../schema';

const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: String.fromCodePoint(0x1f1ee, 0x1f1f9),
  icon: null,
  sort_order: 1,
};
const place: Pin = {
  id: 'r7',
  name: 'Tokyo Bento Bar',
  cuisine_code: 'IT',
  lat: 43.9,
  lng: -78.86,
  promoted: true,
};

const flat = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style);

async function renderFlag(promotion: 'none' | 'ring') {
  await render(
    <MapView>
      <FlagMarker
        pin={place}
        cuisine={italy}
        selected={false}
        onSelect={jest.fn()}
        promotion={promotion}
      />
    </MapView>,
  );
}

afterEach(async () => {
  await cleanup();
});

describe('FlagMarker with the ad ring (a promoted place not drawn large)', () => {
  it('is the same size as an organic flag: never bigger', async () => {
    await renderFlag('none');
    const organic = { pill: flat('flag-pill'), hit: flat('flag-hit') };
    await cleanup();
    await renderFlag('ring');
    expect(flat('flag-pill').minWidth).toBe(organic.pill.minWidth);
    expect(flat('flag-pill').height).toBe(organic.pill.height);
    expect(flat('flag-hit').width).toBe(size.touch);
    expect(flat('flag-hit').height).toBe(size.touch);
  });

  it('draws the ad ring and the written "Ad" badge', async () => {
    await renderFlag('ring');
    expect(flat('flag-ad-ring')).toMatchObject({
      borderColor: colors.adRing,
      borderWidth: stroke.adRing,
    });
    expect(screen.getByText('Ad', { includeHiddenElements: true })).toBeTruthy();
  });

  it('says ", sponsored" and sits above organic flags', async () => {
    await renderFlag('ring');
    expect(
      screen.getByRole('button', { name: 'Tokyo Bento Bar, Italy cuisine, sponsored' }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('marker').props.zIndex).toBe(3);
    expect(screen.getByTestId('marker').props.stopPropagation).toBe(true);
  });

  it('stops re-drawing after its first draw, like every still marker', async () => {
    await renderFlag('ring');
    expect(screen.getByTestId('marker').props.tracksViewChanges).toBe(true);
    await waitFor(() => expect(screen.getByTestId('marker').props.tracksViewChanges).toBe(false));
  });

  it('an organic flag has no ring, no badge and no "sponsored"', async () => {
    await renderFlag('none');
    expect(screen.queryByTestId('flag-ad-ring')).toBeNull();
    expect(screen.queryByText('Ad', { includeHiddenElements: true })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Tokyo Bento Bar, Italy cuisine' }),
    ).toBeOnTheScreen();
  });

  it('a ringed homemade flag keeps the homemade label and adds ", sponsored"', async () => {
    await render(
      <MapView>
        <HomemadeMarker
          pin={{ ...place, name: "Amara's Jollof Kitchen" }}
          cuisine={italy}
          selected={false}
          onSelect={jest.fn()}
          zoomedIn={false}
          promotion="ring"
        />
      </MapView>,
    );
    expect(
      screen.getByRole('button', {
        name: "Amara's Jollof Kitchen, Italy cuisine, homemade, approximate area, sponsored",
      }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('flag-ad-ring')).toBeTruthy();
  });
});
