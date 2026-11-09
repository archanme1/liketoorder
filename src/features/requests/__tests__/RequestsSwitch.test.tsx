import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { RequestsSwitch } from '../components/RequestsSwitch';

afterEach(cleanup);

const setup = async (props: Partial<React.ComponentProps<typeof RequestsSwitch>> = {}) => {
  const onChange = jest.fn();
  const view = await render(
    <RequestsSwitch
      value="received"
      onChange={onChange}
      receivedCount={3}
      sentCount={undefined}
      {...props}
    />,
  );
  return { onChange, view };
};

describe('RequestsSwitch', () => {
  it('is a radio group with two radios, the selected one spoken as selected', async () => {
    await setup();
    expect(screen.getByLabelText('Requests').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Received, 3 need you, selected' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Sent' })).not.toBeSelected();
  });

  it('puts the number in the label for Sent too', async () => {
    await setup({ value: 'sent', receivedCount: undefined, sentCount: 2 });
    expect(screen.getByRole('radio', { name: 'Sent, 2 updated, selected' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Received' })).toBeOnTheScreen();
  });

  it('shows the number as text, and nothing for zero or an unknown count', async () => {
    await setup({ receivedCount: 3, sentCount: 0 });
    expect(screen.getByTestId('switch-count-received')).toHaveTextContent('3');
    expect(screen.queryByTestId('switch-count-sent')).toBeNull();
  });

  it('caps the visible number at 99+', async () => {
    await setup({ receivedCount: 150 });
    expect(screen.getByTestId('switch-count-received')).toHaveTextContent('99+');
  });

  it('shows exactly one check mark, on the selected side (not colour alone)', async () => {
    await setup();
    const marks = JSON.stringify(screen.toJSON()).match(/"name":"checkmark"/g) ?? [];
    expect(marks).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /^Received/ })).toBeSelected();
  });

  it('has targets of at least 44 pt', async () => {
    await setup();
    for (const radio of screen.getAllByRole('radio')) {
      expect(StyleSheet.flatten(radio.props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('calls onChange with the side that was pressed', async () => {
    const { onChange } = await setup();
    await fireEvent.press(screen.getByRole('radio', { name: 'Sent' }));
    expect(onChange).toHaveBeenCalledWith('sent');
  });
});
