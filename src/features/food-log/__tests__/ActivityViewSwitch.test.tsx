import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { size, weight } from '@/theme/tokens';

import { ActivityViewSwitch } from '../components/ActivityViewSwitch';

afterEach(async () => {
  await cleanup();
});

describe('ActivityViewSwitch (spec 15)', () => {
  it('is a radio group of Activity and Cuisine, Activity selected by default', async () => {
    await render(<ActivityViewSwitch value="activity" onChange={jest.fn()} />);
    // The group itself is not one focusable element (as in RequestsSwitch), so it is found by label.
    expect(screen.getByLabelText('Grid view').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'Activity, selected', selected: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Cuisine', selected: false })).toBeTruthy();
  });

  it('says the selected view as a word, with a check mark and bold text, never colour alone', async () => {
    await render(<ActivityViewSwitch value="cuisine" onChange={jest.fn()} />);
    expect(screen.getByRole('radio', { name: 'Cuisine, selected', selected: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Activity', selected: false })).toBeTruthy();
    expect(
      screen.getByTestId('activity-view-check-cuisine', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('activity-view-check-activity', { includeHiddenElements: true }),
    ).toBeNull();
    expect(StyleSheet.flatten(screen.getByText('Cuisine').props.style)).toMatchObject({
      fontWeight: weight.semibold,
    });
    expect(StyleSheet.flatten(screen.getByText('Activity').props.style)?.fontWeight).not.toBe(
      weight.semibold,
    );
  });

  it('calls onChange with the pressed view', async () => {
    const onChange = jest.fn();
    await render(<ActivityViewSwitch value="activity" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Cuisine' }));
    expect(onChange).toHaveBeenCalledWith('cuisine');
  });

  it('each option is at least 44 pt', async () => {
    await render(<ActivityViewSwitch value="activity" onChange={jest.fn()} />);
    for (const id of ['activity-view-activity', 'activity-view-cuisine']) {
      const style = StyleSheet.flatten(screen.getByTestId(id).props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(size.touch);
      expect(style.minWidth).toBeGreaterThanOrEqual(size.touch);
    }
  });
});
