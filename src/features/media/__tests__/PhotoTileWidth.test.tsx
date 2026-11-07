import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PhotoTile } from '../components/PhotoTile';

function tileBox() {
  const tile = screen.getByRole('image', { name: 'Cover' });
  // The first child of the tile is the sized box.
  const box = (tile.children[0] as unknown as { props: { style: unknown } }).props;
  return StyleSheet.flatten(box.style as never);
}

describe('PhotoTile width', () => {
  it('is square by default, as every existing use expects', async () => {
    await render(
      <PhotoTile
        path="p"
        uri="https://x/p"
        accessibilityLabel="Cover"
        onExpired={jest.fn()}
        size={96}
      />,
    );
    const box = tileBox();
    expect(box.width).toBe(96);
    expect(box.height).toBe(96);
  });

  it('takes a full-width banner when asked, keeping the height', async () => {
    await render(
      <PhotoTile
        path="p"
        uri="https://x/p"
        accessibilityLabel="Cover"
        onExpired={jest.fn()}
        size={88}
        width="100%"
      />,
    );
    const box = tileBox();
    expect(box.width).toBe('100%');
    expect(box.height).toBe(88);
  });

  it('crops to fill (cover) and keeps the "Photo unavailable" behaviour in a banner', async () => {
    await render(
      <PhotoTile
        path="p"
        uri={null}
        accessibilityLabel="Cover"
        onExpired={jest.fn()}
        size={88}
        width="100%"
      />,
    );
    expect(screen.getByText('Photo unavailable')).toBeOnTheScreen();
  });

  it('crops the photo to fill the banner', async () => {
    await render(
      <PhotoTile
        path="p"
        uri="https://x/p"
        accessibilityLabel="Cover"
        onExpired={jest.fn()}
        size={88}
        width="100%"
      />,
    );
    expect(screen.getByTestId('expo-image').props.contentFit).toBe('cover');
  });
});
