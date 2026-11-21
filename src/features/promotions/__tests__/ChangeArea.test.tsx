import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ChangeArea, type AreaOption } from '../components/ChangeArea';

async function renderSheet({
  current = 'me' as AreaOption,
  hasLastMap = false,
  visible = true,
} = {}) {
  const onChoose = jest.fn();
  const onClose = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ChangeArea
        visible={visible}
        current={current}
        hasLastMap={hasLastMap}
        onChoose={onChoose}
        onClose={onClose}
      />
    </SafeAreaProvider>,
  );
  return { onChoose, onClose };
}

afterEach(async () => {
  await cleanup();
});

describe('ChangeArea', () => {
  it('offers my location and the launch area, with the current one selected', async () => {
    await renderSheet();
    expect(screen.getByRole('header', { name: 'Show offers near' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Show offers near').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'Use my location, selected',
      'Oshawa (launch area)',
    ]);
    expect(screen.getByTestId('change-area').props.accessibilityViewIsModal).toBe(true);
  });

  it('adds the last map view when there is one', async () => {
    await renderSheet({ current: 'last_map', hasLastMap: true });
    expect(screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'Use my location',
      'Area last viewed on the map, selected',
      'Oshawa (launch area)',
    ]);
  });

  it('hands back the choice', async () => {
    const { onChoose } = await renderSheet({ hasLastMap: true });
    await fireEvent.press(screen.getByRole('radio', { name: 'Oshawa (launch area)' }));
    expect(onChoose).toHaveBeenLastCalledWith('launch');
    await fireEvent.press(screen.getByRole('radio', { name: 'Area last viewed on the map' }));
    expect(onChoose).toHaveBeenLastCalledWith('last_map');
    await fireEvent.press(screen.getByRole('radio', { name: 'Use my location, selected' }));
    expect(onChoose).toHaveBeenLastCalledWith('me');
  });

  it('closes with Close or Cancel', async () => {
    const { onClose, onChoose } = await renderSheet();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('shows nothing while closed', async () => {
    await renderSheet({ visible: false });
    expect(screen.queryByTestId('change-area')).toBeNull();
  });

  it('gives every option a target of at least 44 pt', async () => {
    await renderSheet({ hasLastMap: true });
    for (const option of screen.getAllByRole('radio')) {
      const style = option.props.style;
      const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    }
  });
});
