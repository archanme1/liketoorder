import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { maxFontMultiplier, size } from '@/theme/tokens';

import { RequestFilterChips } from '../components/RequestFilterChips';

afterEach(async () => {
  await cleanup();
});

const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

describe('RequestFilterChips', () => {
  it('has four radios in the order All, Pending, Accepted, Declined inside a labelled group', async () => {
    await render(
      <RequestFilterChips value="all" onChange={jest.fn()} groupLabel="Filter sent requests" />,
    );
    expect(screen.getByLabelText('Filter sent requests').props.accessibilityRole).toBe(
      'radiogroup',
    );
    expect(screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'All, selected',
      'Pending',
      'Accepted',
      'Declined',
    ]);
  });

  it('says which one is selected in words and in accessibilityState', async () => {
    await render(
      <RequestFilterChips
        value="pending"
        onChange={jest.fn()}
        groupLabel="Filter received requests"
      />,
    );
    const chosen = screen.getByRole('radio', { name: 'Pending, selected' });
    expect(chosen.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    for (const name of ['All', 'Accepted', 'Declined']) {
      expect(screen.getByRole('radio', { name }).props.accessibilityState).toEqual(
        expect.objectContaining({ selected: false }),
      );
    }
    expect(
      screen.getAllByRole('radio').filter((r) => r.props.accessibilityState.selected),
    ).toHaveLength(1);
  });

  it('reports the tapped filter value', async () => {
    const onChange = jest.fn();
    await render(
      <RequestFilterChips value="all" onChange={onChange} groupLabel="Filter sent requests" />,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Declined' }));
    expect(onChange).toHaveBeenLastCalledWith('declined');
    await fireEvent.press(screen.getByRole('radio', { name: 'Accepted' }));
    expect(onChange).toHaveBeenLastCalledWith('accepted');
    await fireEvent.press(screen.getByRole('radio', { name: 'Pending' }));
    expect(onChange).toHaveBeenLastCalledWith('pending');
  });

  it('shows the labels with no counts', async () => {
    await render(
      <RequestFilterChips value="all" onChange={jest.fn()} groupLabel="Filter sent requests" />,
    );
    for (const label of ['All', 'Pending', 'Accepted', 'Declined']) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    expect(screen.queryByText(/\d/)).toBeNull();
  });

  it('every chip is at least 44 pt tall with no fixed height, and the group wraps at large text', async () => {
    await render(
      <RequestFilterChips value="all" onChange={jest.fn()} groupLabel="Filter sent requests" />,
    );
    for (const radio of screen.getAllByRole('radio')) {
      const style = flat(radio.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(size.touch);
      expect(style.height).toBeUndefined();
    }
    expect(flat(screen.getByLabelText('Filter sent requests').props.style).flexWrap).toBe('wrap');
    for (const label of ['All', 'Pending', 'Accepted', 'Declined']) {
      expect(screen.getByText(label).props.maxFontSizeMultiplier).toBe(maxFontMultiplier);
    }
  });
});
