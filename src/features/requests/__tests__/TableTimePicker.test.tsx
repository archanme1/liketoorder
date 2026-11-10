import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { TableTimePicker } from '../components/TableTimePicker';

const NOW = new Date('2026-11-08T17:00:00Z');
// 2026-11-09 00:00 UTC: 7:00 PM EST in Toronto, 1:00 PM NZDT in Auckland.
const VALUE = new Date('2026-11-09T00:00:00Z');

afterEach(async () => {
  await cleanup();
});

describe('TableTimePicker', () => {
  it('starts with no time, and says so in words', async () => {
    await render(<TableTimePicker now={NOW} value={null} onChange={jest.fn()} />);
    expect(screen.getByText('No table time chosen yet.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Choose table time' })).toBeOnTheScreen();
  });

  it('shows the chosen time with its zone name, in the zone it was given', async () => {
    await render(
      <TableTimePicker
        now={NOW}
        value={VALUE}
        onChange={jest.fn()}
        timeZone="America/Toronto"
        locale="en-US"
      />,
    );
    expect(screen.getByText('Table time: Sun, Nov 8, 7:00 PM EST')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Change table time' })).toBeOnTheScreen();
  });

  it('the same instant in another zone shows that zone', async () => {
    await render(
      <TableTimePicker
        now={NOW}
        value={VALUE}
        onChange={jest.fn()}
        timeZone="Pacific/Auckland"
        locale="en-US"
      />,
    );
    expect(screen.getByText(/^Table time: Mon, Nov 9, 1:00 PM \S+$/)).toBeOnTheScreen();
    expect(screen.queryByText(/EST/)).not.toBeOnTheScreen();
  });

  it('offers times from 30 minutes to 30 days ahead, not the pickup window', async () => {
    await render(
      <TableTimePicker now={NOW} value={null} onChange={jest.fn()} timeZone="America/Toronto" />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Choose table time' }));
    const control = screen.getByTestId('datetimepicker-datetime');
    expect((control.props.minimumDate as Date).toISOString()).toBe('2026-11-08T17:45:00.000Z');
    expect((control.props.maximumDate as Date).toISOString()).toBe('2026-12-08T17:00:00.000Z');
  });

  it('Done chooses the earliest allowed time; Cancel keeps what was there', async () => {
    const onChange = jest.fn();
    await render(<TableTimePicker now={NOW} value={null} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose table time' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Cancel, keep the current table time' }),
    );
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose table time' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Done, use this table time' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [value, problem] = onChange.mock.calls[0];
    expect((value as Date).toISOString()).toBe('2026-11-08T17:45:00.000Z');
    expect(problem).toBeNull();
  });

  it('a time the control gives that is too soon is moved to the earliest, and says so', async () => {
    const onChange = jest.fn();
    await render(<TableTimePicker now={NOW} value={null} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose table time' }));
    await fireEvent(
      screen.getByTestId('datetimepicker-datetime'),
      'valueChange',
      {},
      new Date('2026-11-08T17:10:00Z'),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Done, use this table time' }));
    const [value, problem] = onChange.mock.calls[0];
    expect((value as Date).toISOString()).toBe('2026-11-08T17:45:00.000Z');
    expect(problem).toBe('too_soon');
  });
});
