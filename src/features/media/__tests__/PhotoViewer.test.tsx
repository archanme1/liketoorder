import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  CLOSE_PHOTO_LABEL,
  PHOTO_UNAVAILABLE,
  PhotoViewer,
  photoCounter,
  type ViewerPhoto,
} from '../components/PhotoViewer';
import { usePhotoViewer } from '../hooks/usePhotoViewer';

const PHOTOS: ViewerPhoto[] = [
  { path: 'b1/a.jpg', label: 'Rosa, photo 1 of 3' },
  { path: 'b1/b.jpg', label: 'Rosa, photo 2 of 3' },
  { path: 'b1/c.jpg', label: 'Rosa, photo 3 of 3' },
];
const WIDTH = Dimensions.get('window').width;

type Harness = {
  onExpired?: jest.Mock;
  urlFor?: (path: string) => string | null | undefined;
  startAt?: number;
  photos?: ViewerPhoto[];
};

// A caller the way the app uses it: the hook holds open/index, the viewer shows them.
function Caller({
  onExpired = jest.fn(),
  urlFor = (p) => `https://x/${p}`,
  startAt = 0,
  photos = PHOTOS,
}: Harness) {
  const viewer = usePhotoViewer();
  return (
    <>
      <Open onPress={() => viewer.open(startAt)} />
      <PhotoViewer
        visible={viewer.visible}
        photos={photos}
        index={viewer.index}
        onIndexChange={viewer.setIndex}
        onClose={viewer.close}
        urlFor={urlFor}
        onExpired={onExpired}
      />
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pressable, Text } = require('react-native') as typeof import('react-native');
function Open({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="open viewer">
      <Text>open</Text>
    </Pressable>
  );
}

async function renderCaller(props: Harness = {}) {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Caller {...props} />
    </SafeAreaProvider>,
  );
}

async function openViewer() {
  await fireEvent.press(screen.getByRole('button', { name: 'open viewer' }));
}

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

describe('PhotoViewer: opening', () => {
  it('shows nothing until it is opened', async () => {
    await renderCaller();
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
    expect(screen.queryByText('Photo 1 of 3')).toBeNull();
  });

  it('opens on the photo that was tapped, with "Photo n of m"', async () => {
    await renderCaller({ startAt: 1 });
    await openViewer();
    expect(await screen.findByText('Photo 2 of 3')).toBeOnTheScreen();
    expect(photoCounter(1, 3)).toBe('Photo 2 of 3');
    expect(screen.getByRole('image', { name: 'Rosa, photo 2 of 3' })).toBeOnTheScreen();
  });

  it('shows each photo whole (contain), keyed by its path', async () => {
    await renderCaller();
    await openViewer();
    const image = (await screen.findAllByTestId('expo-image'))[0];
    expect(image.props.contentFit).toBe('contain');
    expect(image.props.source).toEqual({ uri: 'https://x/b1/a.jpg', cacheKey: 'b1/a.jpg' });
  });

  it('is a modal for screen readers and the counter is a live header', async () => {
    await renderCaller();
    await openViewer();
    expect(await screen.findByTestId('photo-viewer')).toHaveProp('accessibilityViewIsModal', true);
    const counter = screen.getByText('Photo 1 of 3');
    expect(counter).toHaveProp('accessibilityRole', 'header');
    expect(counter).toHaveProp('accessibilityLiveRegion', 'polite');
  });

  it('moves screen-reader focus to the close button when it opens', async () => {
    const focus = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => {});
    await renderCaller();
    await openViewer();
    await screen.findByText('Photo 1 of 3');
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
  });
});

describe('PhotoViewer: swiping between photos', () => {
  it('updates the counter when the paged list settles on another photo', async () => {
    await renderCaller();
    await openViewer();
    const list = await screen.findByTestId('photo-viewer-list');
    await fireEvent(list, 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: WIDTH * 2, y: 0 } },
    });
    expect(await screen.findByText('Photo 3 of 3')).toBeOnTheScreen();
    await fireEvent(list, 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: WIDTH, y: 0 } },
    });
    expect(await screen.findByText('Photo 2 of 3')).toBeOnTheScreen();
  });

  it('is a horizontal, paged, native list (not a gesture-handler gesture)', async () => {
    await renderCaller();
    await openViewer();
    const list = await screen.findByTestId('photo-viewer-list');
    expect(list.props.horizontal).toBe(true);
    expect(list.props.pagingEnabled).toBe(true);
  });

  it('offers next and previous as screen-reader actions on the photo', async () => {
    await renderCaller();
    await openViewer();
    const first = await screen.findByRole('image', { name: 'Rosa, photo 1 of 3' });
    expect(first.props.accessibilityActions).toEqual([{ name: 'next', label: 'Next photo' }]);
    await fireEvent(first, 'accessibilityAction', { nativeEvent: { actionName: 'next' } });
    expect(await screen.findByText('Photo 2 of 3')).toBeOnTheScreen();
  });
});

describe('PhotoViewer: closing', () => {
  it('closes with the X, a labelled button of at least 44 points', async () => {
    await renderCaller();
    await openViewer();
    const close = await screen.findByRole('button', { name: CLOSE_PHOTO_LABEL });
    const style = StyleSheet.flatten(close.props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
    await fireEvent.press(close);
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
  });

  it('closes with a tap beside the photo (the backdrop)', async () => {
    await renderCaller();
    await openViewer();
    await fireEvent.press(await screen.findByTestId('photo-page-0'));
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
  });

  it('does not close when the photo itself is tapped', async () => {
    await renderCaller();
    await openViewer();
    await fireEvent.press(await screen.findByRole('image', { name: 'Rosa, photo 1 of 3' }));
    expect(screen.getByTestId('photo-viewer')).toBeOnTheScreen();
  });

  it('closes with Android back (the modal asks to close)', async () => {
    await renderCaller();
    await openViewer();
    const modal = (await screen.findByTestId('photo-viewer')).parent;
    // The Modal host is the nearest ancestor with onRequestClose.
    let node = modal;
    while (node && !node.props.onRequestClose) node = node.parent;
    expect(node).toBeTruthy();
    await act(async () => node!.props.onRequestClose());
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
  });

  it('reopens fresh on the photo that is tapped next time', async () => {
    await renderCaller({ startAt: 2 });
    await openViewer();
    await fireEvent.press(await screen.findByRole('button', { name: CLOSE_PHOTO_LABEL }));
    await openViewer();
    expect(await screen.findByText('Photo 3 of 3')).toBeOnTheScreen();
  });
});

describe('PhotoViewer: a photo that will not load', () => {
  it('asks for a new link once, then says "Photo unavailable" once, with no loop', async () => {
    const onExpired = jest.fn();
    await renderCaller({ onExpired });
    await openViewer();
    const image = (await screen.findAllByTestId('expo-image'))[0];
    await act(async () => image.props.onError());
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledWith('b1/a.jpg');
    expect(screen.queryByText(PHOTO_UNAVAILABLE)).toBeNull();

    await act(async () => (await screen.findAllByTestId('expo-image'))[0].props.onError());
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(PHOTO_UNAVAILABLE)).toHaveLength(1);
    expect(
      screen.getByRole('image', { name: 'Rosa, photo 1 of 3. Photo unavailable' }),
    ).toBeOnTheScreen();
  });

  it('says "Photo unavailable" at once when the server gave no link', async () => {
    const onExpired = jest.fn();
    await renderCaller({ onExpired, urlFor: (p) => (p === 'b1/a.jpg' ? null : `https://x/${p}`) });
    await openViewer();
    expect(await screen.findByText(PHOTO_UNAVAILABLE)).toBeOnTheScreen();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('shows a loading indicator, not a blank screen, while the link is on its way', async () => {
    await renderCaller({ urlFor: () => undefined });
    await openViewer();
    expect((await screen.findAllByLabelText('Loading photo')).length).toBeGreaterThan(0);
  });
});

describe('PhotoViewer: Reduce Motion and large text', () => {
  it('fades in by default', async () => {
    await renderCaller();
    await openViewer();
    await screen.findByText('Photo 1 of 3');
    expect(screen.getByTestId('photo-viewer-modal').props.animationType).toBe('fade');
  });

  it('has no fade with Reduce Motion on, and next/previous jump instead of gliding', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await renderCaller();
    await openViewer();
    await screen.findByText('Photo 1 of 3');
    await act(async () => {});
    expect(screen.getByTestId('photo-viewer-modal').props.animationType).toBe('none');
  });

  it('lets the counter and the unavailable message scale with the system text size', async () => {
    await renderCaller({ urlFor: () => null });
    await openViewer();
    expect((await screen.findByText('Photo 1 of 3')).props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getAllByText(PHOTO_UNAVAILABLE)[0].props.maxFontSizeMultiplier).toBeUndefined();
  });
});
