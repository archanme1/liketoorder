import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { DeclineReasonPicker } from '../components/DeclineReasonPicker';
import type { DeclineReason } from '../schema';

afterEach(cleanup);

const LABELS = [
  'Sold out',
  'Closed at that time',
  'Too busy right now',
  "Can't prepare this order",
  "Pickup time doesn't work",
  'Other',
];

function Harness({
  onReason = jest.fn(),
  onText = jest.fn(),
  start = null as DeclineReason | null,
}) {
  const [reason, setReason] = useState<DeclineReason | null>(start);
  const [text, setText] = useState('');
  return (
    <DeclineReasonPicker
      reason={reason}
      onReasonChange={(next) => {
        onReason(next);
        setReason(next);
      }}
      text={text}
      onTextChange={(next) => {
        onText(next);
        setText(next);
      }}
    />
  );
}

describe('DeclineReasonPicker', () => {
  it('lists the six reasons in order as radios, and nothing is selected at first', async () => {
    await render(<Harness />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.props.accessibilityLabel)).toEqual(LABELS);
    for (const radio of radios) expect(radio).not.toBeSelected();
    expect(screen.queryByText(/, selected/)).toBeNull();
  });

  it('is a labelled radio group with a heading', async () => {
    await render(<Harness />);
    expect(screen.getByLabelText('Reason for declining').props.accessibilityRole).toBe(
      'radiogroup',
    );
    expect(screen.getByRole('header', { name: 'Why are you declining?' })).toBeOnTheScreen();
  });

  it('has rows of at least 44 pt', async () => {
    await render(<Harness />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(StyleSheet.flatten(radio.props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('speaks the chosen row as selected and marks it with a check mark, not colour alone', async () => {
    const onReason = jest.fn();
    await render(<Harness onReason={onReason} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Too busy right now' }));
    expect(onReason).toHaveBeenCalledWith('too_busy');
    const chosen = screen.getByRole('radio', { name: 'Too busy right now, selected' });
    expect(chosen).toBeSelected();
    expect(
      screen.getAllByRole('radio').filter((r) => r.props.accessibilityState.selected),
    ).toHaveLength(1);
    expect(JSON.stringify(screen.toJSON()).match(/"name":"checkmark"/g)).toHaveLength(1);
  });

  it('shows the written-reason box only for Other, with a counter in words', async () => {
    const onText = jest.fn();
    await render(<Harness onText={onText} />);
    expect(screen.queryByLabelText('Your reason')).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Sold out' }));
    expect(screen.queryByLabelText('Your reason')).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Other' }));
    const box = screen.getByLabelText('Your reason');
    expect(screen.getByText('0 of 200')).toBeOnTheScreen();
    await fireEvent.changeText(box, 'Oven broke');
    expect(onText).toHaveBeenCalledWith('Oven broke');
    expect(screen.getByText('10 of 200')).toBeOnTheScreen();
  });

  it('says so when the reason is over 200 characters', async () => {
    await render(<Harness start="other" />);
    await fireEvent.changeText(screen.getByLabelText('Your reason'), 'x'.repeat(201));
    expect(screen.getByText('201 of 200')).toBeOnTheScreen();
    expect(screen.getByText(/Shorten your reason to 200 characters/)).toBeOnTheScreen();
  });
});
