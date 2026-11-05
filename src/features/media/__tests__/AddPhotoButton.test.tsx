import { fireEvent, render, screen } from '@testing-library/react-native';

import { AddPhotoButton } from '../components/AddPhotoButton';

describe('AddPhotoButton', () => {
  it('is a labelled button that calls onPress', async () => {
    const onPress = jest.fn();
    await render(<AddPhotoButton label="Add gallery photo" onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Add gallery photo' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows an "Uploading…" state and ignores presses while uploading', async () => {
    const onPress = jest.fn();
    await render(<AddPhotoButton label="Add gallery photo" onPress={onPress} uploading />);

    expect(screen.getByText('Uploading…')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('is disabled with the reason visible when full', async () => {
    const onPress = jest.fn();
    await render(
      <AddPhotoButton
        label="Add gallery photo"
        onPress={onPress}
        disabledReason="Gallery is full (6 of 6)"
      />,
    );

    expect(screen.getByText('Gallery is full (6 of 6)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('is at least 44pt tall', async () => {
    await render(<AddPhotoButton label="Add gallery photo" onPress={jest.fn()} />);

    const button = screen.getByRole('button', { name: 'Add gallery photo' });
    let best = 0;
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const el = n as { props?: { style?: unknown }; children?: unknown[]; parent?: unknown };
      const flat = Object.assign(
        {},
        ...[el.props?.style].flat(Infinity).filter((s) => s && typeof s === 'object'),
      ) as { height?: number; minHeight?: number };
      best = Math.max(best, Number(flat.height ?? 0), Number(flat.minHeight ?? 0));
      (el.children ?? []).forEach(visit);
    };
    visit(button);

    expect(best).toBeGreaterThanOrEqual(44);
  });
});
