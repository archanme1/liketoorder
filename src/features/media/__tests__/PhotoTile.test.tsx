import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoTile } from '../components/PhotoTile';

const PATH = 'biz-1/photo-1.jpg';
const LABEL = "Cover photo, Maria's Kitchen";

type Props = Partial<Parameters<typeof PhotoTile>[0]>;

function tile(props: Props = {}) {
  return (
    <PhotoTile
      path={PATH}
      uri="https://signed/one"
      accessibilityLabel={LABEL}
      onExpired={jest.fn()}
      {...props}
    />
  );
}

function image() {
  return screen.getByTestId('expo-image');
}

async function fire(handler: 'onError' | 'onLoad') {
  await act(async () => {
    image().props[handler]();
  });
}

// The loading placeholder is the only element hidden from screen readers in the tile.
function isLoadingPlaceholderShown() {
  return JSON.stringify(screen.toJSON()).includes('"accessibilityElementsHidden":true');
}

function minSizeOf(node: unknown): number {
  // Largest height/minHeight declared by the element or anything inside it.
  let best = 0;
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const element = n as { props?: { style?: unknown }; children?: unknown[] };
    const flat = Object.assign(
      {},
      ...[element.props?.style].flat(Infinity).filter((s) => s && typeof s === 'object'),
    ) as { height?: number; minHeight?: number };
    best = Math.max(best, Number(flat.height ?? 0), Number(flat.minHeight ?? 0));
    (element.children ?? []).forEach(visit);
  };
  visit(node);
  return best;
}

describe('PhotoTile: image props', () => {
  it('passes the stored path as cacheKey and memory-disk caching to expo-image', async () => {
    await render(tile());

    expect(image().props.source).toEqual({ uri: 'https://signed/one', cacheKey: PATH });
    expect(image().props.cachePolicy).toBe('memory-disk');
  });

  it('keeps the same cacheKey when the signed URL changes for the same path', async () => {
    await render(tile());
    await fire('onLoad');

    await screen.rerender(tile({ uri: 'https://signed/two' }));

    expect(image().props.source).toEqual({ uri: 'https://signed/two', cacheKey: PATH });
  });

  it('does not go back to its loading state when the URL changes after a load', async () => {
    await render(tile());
    expect(isLoadingPlaceholderShown()).toBe(true);
    await fire('onLoad');
    expect(isLoadingPlaceholderShown()).toBe(false);

    await screen.rerender(tile({ uri: 'https://signed/two' }));

    expect(isLoadingPlaceholderShown()).toBe(false);
  });

  it('shows a loading placeholder while the URL is still being fetched', async () => {
    await render(tile({ uri: undefined }));

    expect(screen.queryByTestId('expo-image')).toBeNull();
    expect(isLoadingPlaceholderShown()).toBe(true);
    expect(screen.queryByText('Photo unavailable')).toBeNull();
  });
});

describe('PhotoTile: failure handling', () => {
  it('shows "Photo unavailable" when the server gave no URL (null)', async () => {
    await render(tile({ uri: null }));

    expect(screen.getByText('Photo unavailable')).toBeTruthy();
  });

  it('calls onExpired once with the path on the first error, without showing the failed state', async () => {
    const onExpired = jest.fn();
    await render(tile({ onExpired }));

    await fire('onError');

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledWith(PATH);
    expect(screen.queryByText('Photo unavailable')).toBeNull();
  });

  it('shows "Photo unavailable" on a second error and does not call onExpired again', async () => {
    const onExpired = jest.fn();
    await render(tile({ onExpired }));

    await fire('onError');
    await fire('onError');

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Photo unavailable')).toBeTruthy();
  });

  it('shows "Photo unavailable" when the renewed URL comes back null', async () => {
    const onExpired = jest.fn();
    await render(tile({ onExpired }));
    await fire('onError');

    await screen.rerender(tile({ onExpired, uri: null }));

    expect(screen.getByText('Photo unavailable')).toBeTruthy();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});

describe('PhotoTile: accessibility', () => {
  it('view mode: an image with the spoken name', async () => {
    await render(tile());

    expect(screen.getByRole('image', { name: LABEL })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('edit mode: a button named by editLabel that calls onPress', async () => {
    const onPress = jest.fn();
    await render(
      tile({
        onPress,
        editLabel: 'Gallery photo 2 of 6. Opens photo options.',
        accessibilityLabel: 'Photo 2 of 6, Maria’s Kitchen',
      }),
    );

    const button = screen.getByRole('button', {
      name: 'Gallery photo 2 of 6. Opens photo options.',
    });
    await fireEvent.press(button);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('edit mode touch target is at least 44pt even for a small size', async () => {
    await render(tile({ onPress: jest.fn(), editLabel: 'Edit photo', size: 20 }));

    const button = screen.getByRole('button', { name: 'Edit photo' });
    expect(minSizeOf(button)).toBeGreaterThanOrEqual(44);
  });

  it('a failed view-mode tile still exposes its name to screen readers', async () => {
    await render(tile({ uri: null }));

    expect(screen.getByRole('image', { name: new RegExp(LABEL) })).toBeTruthy();
  });
});
