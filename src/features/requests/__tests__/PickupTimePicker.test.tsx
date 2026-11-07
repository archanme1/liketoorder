import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

import { PickupTimePicker } from '../components/PickupTimePicker';
import { earliestPickup, formatDateTime, latestPickup } from '../time';

const AUCKLAND = { timeZone: 'Pacific/Auckland', locale: 'en-US' };
// 01:00 on 8 November in Auckland (still 7 November in UTC).
const NOW = new Date('2026-11-07T12:00:00Z');
const EARLIEST = earliestPickup(NOW); // 12:30Z = 01:30 on 8 November in Auckland
const LATEST = latestPickup(NOW);
const iso = (date: Date) => date.toISOString();

const open = jest.mocked(DateTimePickerAndroid.open);
const lastDialog = () => open.mock.calls[open.mock.calls.length - 1][0];
const picked = (date: Date) => ({ nativeEvent: { timestamp: date.getTime(), utcOffset: 0 } });
const control = () => screen.getByTestId('datetimepicker-datetime');

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  open.mockReset();
});

describe('iOS: one inline calendar and time control', () => {
  it('starts with no time chosen and no calendar', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    expect(screen.getByText('No pickup time chosen yet.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Choose pickup time' })).toBeOnTheScreen();
    expect(screen.queryByTestId('datetimepicker-datetime')).not.toBeOnTheScreen();
  });

  it('opening it selects the earliest time and shows the control with the right limits', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={null} onChange={onChange} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(iso(onChange.mock.calls[0][0])).toBe(iso(EARLIEST));
    expect(onChange.mock.calls[0][1]).toBeNull();

    const props = control().props;
    expect(props.mode).toBe('datetime');
    expect(props.display).toBe('inline');
    expect(props.minuteInterval).toBe(15);
    expect(iso(props.minimumDate)).toBe(iso(EARLIEST)); // now + 15 minutes, rounded up
    expect(iso(props.maximumDate)).toBe(iso(LATEST)); // now + 7 days
    expect(iso(props.value)).toBe(iso(EARLIEST));
    expect(props.timeZoneName).toBe('Pacific/Auckland');
    expect(props.locale).toBe('en-US');
  });

  it("leaves the native picker on the phone's own zone unless a zone was given", async () => {
    await render(
      <PickupTimePicker now={NOW} value={EARLIEST} onChange={jest.fn()} locale="en-US" />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Change pickup time' }));
    expect(control().props.timeZoneName).toBeUndefined();
  });

  it('shows the chosen time in the zone, and can hide the calendar', async () => {
    await render(
      <PickupTimePicker
        now={NOW}
        value={new Date('2026-11-08T05:00:00Z')}
        onChange={jest.fn()}
        {...AUCKLAND}
      />,
    );
    expect(screen.getByText('Pickup: Sun, Nov 8, 6:00 PM')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Change pickup time' }));
    expect(control()).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Hide pickup calendar' }));
    expect(screen.queryByTestId('datetimepicker-datetime')).not.toBeOnTheScreen();
  });

  it('reports a chosen time as an instant, snapped to a quarter hour', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={EARLIEST} onChange={onChange} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Change pickup time' }));
    onChange.mockClear();
    await act(async () =>
      control().props.onValueChange(picked(new Date()), new Date('2026-11-08T05:07:00Z')),
    );
    expect(iso(onChange.mock.calls[0][0])).toBe('2026-11-08T05:00:00.000Z');
    expect(onChange.mock.calls[0][1]).toBeNull();
  });

  it('keeps a time the control let through if it is too soon or too far, and says which', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={EARLIEST} onChange={onChange} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Change pickup time' }));
    onChange.mockClear();
    await act(async () =>
      control().props.onValueChange(picked(new Date()), new Date('2026-11-07T12:00:00Z')),
    );
    expect(iso(onChange.mock.calls[0][0])).toBe(iso(EARLIEST));
    expect(onChange.mock.calls[0][1]).toBe('too_soon');
    await act(async () =>
      control().props.onValueChange(picked(new Date()), new Date(LATEST.getTime() + 3_600_000)),
    );
    expect(iso(onChange.mock.calls[1][0])).toBe(iso(LATEST));
    expect(onChange.mock.calls[1][1]).toBe('too_far');
  });

  it('has 44 pt targets and roles', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    const button = screen.getByRole('button', { name: 'Choose pickup time' });
    const flat = Object.assign({}, ...[button.props.style].flat(Infinity).filter(Boolean));
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
  });
});

describe('Android: the date dialog, then the time dialog', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  it('opens the date dialog first, limited to the window', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    expect(open).toHaveBeenCalledTimes(1);
    const dialog = lastDialog();
    expect(dialog.mode).toBe('date');
    expect(iso(dialog.minimumDate as Date)).toBe(iso(EARLIEST));
    expect(iso(dialog.maximumDate as Date)).toBe(iso(LATEST));
    expect(dialog.timeZoneName).toBe('Pacific/Auckland');
    expect(screen.queryByTestId('datetimepicker-datetime')).not.toBeOnTheScreen();
  });

  it('then the time dialog in 15-minute steps, on the picked day with the time already chosen', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={null} onChange={onChange} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    // The person picks 10 November. Whatever time of day the dialog hands back is ignored: the
    // time already chosen (here the earliest, 01:30) is kept on the new day.
    await act(async () =>
      lastDialog().onValueChange?.(picked(new Date()), new Date('2026-11-10T00:10:00Z')),
    );
    expect(open).toHaveBeenCalledTimes(2);
    const timeDialog = lastDialog();
    expect(timeDialog.mode).toBe('time');
    expect(timeDialog.minuteInterval).toBe(15);
    expect(timeDialog.timeZoneName).toBe('Pacific/Auckland');
    expect(formatDateTime(timeDialog.value as Date, AUCKLAND)).toBe('Tue, Nov 10, 1:30 AM');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('joins the picked day and the picked time into one instant (UTC), snapped', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={null} onChange={onChange} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    await act(async () =>
      lastDialog().onValueChange?.(picked(new Date()), new Date('2026-11-09T12:00:00Z')),
    ); // 10 Nov local
    // 18:07 on the Auckland clock, on whatever day the time dialog reports.
    await act(async () =>
      lastDialog().onValueChange?.(picked(new Date()), new Date('2026-11-01T05:07:00Z')),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(iso(onChange.mock.calls[0][0])).toBe('2026-11-10T05:00:00.000Z'); // 10 Nov, 18:00 NZDT
    expect(onChange.mock.calls[0][1]).toBeNull();
  });

  it('the time dialog ignores minimum and maximum, so a too-early time is clamped and flagged', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={null} onChange={onChange} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    await act(async () => lastDialog().onValueChange?.(picked(new Date()), EARLIEST)); // same day
    // 00:15 on the same local day, earlier than the earliest allowed time of 01:30.
    await act(async () =>
      lastDialog().onValueChange?.(picked(new Date()), new Date('2026-11-07T11:15:00Z')),
    );
    expect(iso(onChange.mock.calls[0][0])).toBe(iso(EARLIEST));
    expect(onChange.mock.calls[0][1]).toBe('too_soon');
  });

  it('shows "Change pickup time" once a time is set, and starts the dialogs from it', async () => {
    const value = new Date('2026-11-08T05:00:00Z'); // 6:00 PM on 8 November, Auckland
    await render(<PickupTimePicker now={NOW} value={value} onChange={jest.fn()} {...AUCKLAND} />);
    expect(screen.getByText('Pickup: Sun, Nov 8, 6:00 PM')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Change pickup time' }));
    expect(iso(lastDialog().value as Date)).toBe(iso(value));
  });

  it('does nothing when the dialog is dismissed', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={null} onChange={onChange} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
