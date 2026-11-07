import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  CHOOSE_ADDRESS_LABEL,
  MAP_STATUS_MESSAGE,
  MapStatusLine,
} from '../components/MapStatusLine';

describe('MapStatusLine', () => {
  it('shows nothing without a status', async () => {
    const { toJSON } = await render(<MapStatusLine status={null} onChooseAddress={jest.fn()} />);
    expect(toJSON()).toBeNull();
    await render(<MapStatusLine status={undefined} onChooseAddress={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('uses the exact wording from the spec for each state', () => {
    expect(MAP_STATUS_MESSAGE.visible).toBe('Showing on the map');
    expect(MAP_STATUS_MESSAGE.place_not_found).toBe(
      "Hidden from the map: Google can't find your address any more. Choose your address again to put it back.",
    );
    expect(MAP_STATUS_MESSAGE.needs_refresh).toBe(
      'Hidden from the map for now while we re-check your address. Choosing your address again puts it back at once.',
    );
  });

  it('visible: a message and no button', async () => {
    await render(<MapStatusLine status="visible" onChooseAddress={jest.fn()} />);
    expect(screen.getByText('Showing on the map')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(['place_not_found', 'needs_refresh'] as const)(
    '%s: the message in text (not colour alone) and a labelled button of at least 44',
    async (status) => {
      const onChooseAddress = jest.fn();
      await render(<MapStatusLine status={status} onChooseAddress={onChooseAddress} />);
      expect(screen.getByText(MAP_STATUS_MESSAGE[status])).toBeTruthy();
      const button = screen.getByRole('button', { name: CHOOSE_ADDRESS_LABEL });
      expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
      await fireEvent.press(button);
      expect(onChooseAddress).toHaveBeenCalledTimes(1);
    },
  );
});
