import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { useState } from 'react';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { AccessibilityInfo, Dimensions, Platform } from 'react-native';

import { useReduceMotion } from '@/lib/useReduceMotion';

import { PickupTimePicker, pickerDisplay } from '../components/PickupTimePicker';
import { earliestPickup, formatDateTime, latestPickup } from '../time';

const AUCKLAND = { timeZone: 'Pacific/Auckland', locale: 'en-US' };
// 01:00 on 8 November in Auckland (still 7 November in UTC).
const NOW = new Date('2026-11-07T12:00:00Z');
const EARLIEST = earliestPickup(NOW); // 12:30Z = 01:30 on 8 November in Auckland
const LATEST = latestPickup(NOW);
const iso = (date: Date) => date.toISOString();

jest.mock('@/lib/useReduceMotion', () => ({ useReduceMotion: jest.fn(() => false) }));

// The jest default text scale is 2 (the spinner); the tests run at 1 unless they say otherwise.
const mockFontScale = (fontScale: number) =>
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });

const open = jest.mocked(DateTimePickerAndroid.open);
const lastDialog = () => open.mock.calls[open.mock.calls.length - 1][0];
const picked = (date: Date) => ({ nativeEvent: { timestamp: date.getTime(), utcOffset: 0 } });
const control = () => screen.getByTestId('datetimepicker-datetime');

beforeEach(() => {
  mockFontScale(1);
  jest.mocked(useReduceMotion).mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  open.mockReset();
});

describe('iOS: a button opens a dialog with one calendar and time control', () => {
  const dialog = () => screen.getByTestId('pickup-time-dialog');
  const choose = async (name = 'Choose pickup time') =>
    fireEvent.press(screen.getByRole('button', { name }));
  const drag = async (date: Date) =>
    act(async () => control().props.onValueChange(picked(new Date()), date));

  it('starts with no time chosen and no dialog', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    expect(screen.getByText('No pickup time chosen yet.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Choose pickup time' })).toBeOnTheScreen();
    expect(screen.queryByTestId('pickup-time-dialog')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('datetimepicker-datetime')).not.toBeOnTheScreen();
  });

  it('opening it chooses nothing yet, and shows the control with the right limits', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={null} onChange={onChange} {...AUCKLAND} />);
    await choose();
    expect(onChange).not.toHaveBeenCalled();
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

  it("starts from the time already chosen, and leaves the native picker on the phone's own zone unless a zone was given", async () => {
    const value = new Date('2026-11-08T05:00:00Z');
    await render(<PickupTimePicker now={NOW} value={value} onChange={jest.fn()} locale="en-US" />);
    await choose('Change pickup time');
    expect(iso(control().props.value)).toBe(iso(value));
    expect(control().props.timeZoneName).toBeUndefined();
  });

  it("the chosen time is a value, not a heading (VoiceOver's heading list stays for sections)", async () => {
    await render(
      <PickupTimePicker
        now={NOW}
        value={new Date('2026-11-08T05:00:00Z')}
        onChange={jest.fn()}
        {...AUCKLAND}
      />,
    );
    expect(screen.queryByRole('header', { name: /Pickup:/ })).not.toBeOnTheScreen();
    expect(screen.getByText('Pickup: Sun, Nov 8, 6:00 PM')).toBeOnTheScreen();
  });

  it('shows the chosen time in the zone, as text', async () => {
    await render(
      <PickupTimePicker
        now={NOW}
        value={new Date('2026-11-08T05:00:00Z')}
        onChange={jest.fn()}
        {...AUCKLAND}
      />,
    );
    expect(screen.getByText('Pickup: Sun, Nov 8, 6:00 PM')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Change pickup time' })).toBeOnTheScreen();
  });

  it('dragging the control changes the draft, not the choice', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={EARLIEST} onChange={onChange} {...AUCKLAND} />);
    await choose('Change pickup time');
    await drag(new Date('2026-11-08T05:00:00Z'));
    expect(onChange).not.toHaveBeenCalled();
    expect(within(dialog()).getByText('Selected: Sun, Nov 8, 6:00 PM')).toBeOnTheScreen();
  });

  it('Done applies the draft as an instant, snapped to a quarter hour, and closes', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={EARLIEST} onChange={onChange} {...AUCKLAND} />);
    await choose('Change pickup time');
    await drag(new Date('2026-11-08T05:07:00Z'));
    await fireEvent.press(screen.getByRole('button', { name: 'Done, use this pickup time' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(iso(onChange.mock.calls[0][0])).toBe('2026-11-08T05:00:00.000Z');
    expect(onChange.mock.calls[0][1]).toBeNull();
    expect(screen.queryByTestId('pickup-time-dialog')).not.toBeOnTheScreen();
  });

  it('Done without touching the control chooses the earliest time (an explicit tap)', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={null} onChange={onChange} {...AUCKLAND} />);
    await choose();
    await fireEvent.press(screen.getByRole('button', { name: 'Done, use this pickup time' }));
    expect(iso(onChange.mock.calls[0][0])).toBe(iso(EARLIEST));
  });

  it('Done keeps a time the control let through if it is too soon or too far, and says which', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={EARLIEST} onChange={onChange} {...AUCKLAND} />);
    await choose('Change pickup time');
    await drag(new Date('2026-11-07T12:00:00Z'));
    await fireEvent.press(screen.getByRole('button', { name: 'Done, use this pickup time' }));
    expect(iso(onChange.mock.calls[0][0])).toBe(iso(EARLIEST));
    expect(onChange.mock.calls[0][1]).toBe('too_soon');
    await choose('Change pickup time');
    await drag(new Date(LATEST.getTime() + 3_600_000));
    await fireEvent.press(screen.getByRole('button', { name: 'Done, use this pickup time' }));
    expect(iso(onChange.mock.calls[1][0])).toBe(iso(LATEST));
    expect(onChange.mock.calls[1][1]).toBe('too_far');
  });

  it('Cancel discards the draft and closes; reopening starts from the original', async () => {
    const onChange = jest.fn();
    const value = new Date('2026-11-08T05:00:00Z');
    await render(<PickupTimePicker now={NOW} value={value} onChange={onChange} {...AUCKLAND} />);
    await choose('Change pickup time');
    await drag(new Date('2026-11-09T05:00:00Z'));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Cancel, keep the current pickup time' }),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pickup-time-dialog')).not.toBeOnTheScreen();
    await choose('Change pickup time');
    expect(iso(control().props.value)).toBe(iso(value));
  });

  it('the backdrop discards too', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={EARLIEST} onChange={onChange} {...AUCKLAND} />);
    await choose('Change pickup time');
    await drag(new Date('2026-11-08T05:00:00Z'));
    await fireEvent.press(
      screen.getByTestId('pickup-time-backdrop', { includeHiddenElements: true }),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pickup-time-dialog')).not.toBeOnTheScreen();
  });

  it('the system back request discards too', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={EARLIEST} onChange={onChange} {...AUCKLAND} />);
    await choose('Change pickup time');
    await drag(new Date('2026-11-08T05:00:00Z'));
    await act(async () => screen.getByTestId('pickup-time-modal').props.onRequestClose());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pickup-time-dialog')).not.toBeOnTheScreen();
  });

  it('is a modal dialog: Cancel and Done are 44 pt buttons outside the scrolling control', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    await choose();
    expect(dialog().props.accessibilityViewIsModal).toBe(true);
    const scroll = screen.getByTestId('pickup-time-scroll');
    expect(within(scroll).getByTestId('datetimepicker-datetime')).toBeOnTheScreen();
    for (const name of ['Cancel, keep the current pickup time', 'Done, use this pickup time']) {
      const button = screen.getByRole('button', { name });
      expect(within(scroll).queryByRole('button', { name })).not.toBeOnTheScreen();
      expect(
        within(screen.getByTestId('pickup-time-footer')).getByRole('button', { name }),
      ).toBeOnTheScreen();
      const flat = Object.assign({}, ...[button.props.style].flat(Infinity).filter(Boolean));
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
      expect(flat.height).toBeUndefined();
    }
    const footer = Object.assign(
      {},
      ...[screen.getByTestId('pickup-time-footer').props.style].flat(Infinity),
    );
    expect(footer.flexWrap).toBe('wrap');
  });

  it('moves focus to the dialog title when it appears', async () => {
    const send = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => undefined);
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    await choose();
    await act(async () => screen.getByTestId('pickup-time-modal').props.onShow());
    expect(send).toHaveBeenCalledWith(expect.anything(), 'focus');
  });

  it('fades in, or does not animate at all with Reduce Motion', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    await choose();
    expect(screen.getByTestId('pickup-time-modal').props.animationType).toBe('fade');
    await cleanup();
    jest.mocked(useReduceMotion).mockReturnValue(true);
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    await choose();
    expect(screen.getByTestId('pickup-time-modal').props.animationType).toBe('none');
  });

  it('is tall enough to scroll but never taller than the screen', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    await choose();
    const flat = Object.assign({}, ...[dialog().props.style].flat(Infinity).filter(Boolean));
    expect(flat.maxHeight).toBeGreaterThan(0);
    expect(flat.maxHeight).toBeLessThan(844);
    expect(flat.height).toBeUndefined();
  });

  it.each([
    [1, 'inline'],
    [1.99, 'inline'],
    [2, 'spinner'],
    [3.1, 'spinner'],
  ])('at text scale %s the control is %s', async (fontScale, display) => {
    mockFontScale(fontScale);
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    await choose();
    expect(control().props.display).toBe(display);
    expect(pickerDisplay(fontScale)).toBe(display);
  });
});

// A form left open: when the picker opens it asks the parent for the time now, and offers times
// from that moment, not from when the form was first shown.
describe('opening the picker uses the time now', () => {
  const LATER = new Date(NOW.getTime() + 40 * 60_000);

  function Harness({ onChange }: { onChange: jest.Mock }) {
    const [now, setNow] = useState(NOW);
    return (
      <PickupTimePicker
        now={now}
        value={null}
        onChange={onChange}
        onOpen={() => {
          setNow(LATER);
          return LATER;
        }}
        {...AUCKLAND}
      />
    );
  }

  it('iOS: the control starts from the fresh earliest time, and Done chooses it', async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    expect(iso(control().props.minimumDate)).toBe(iso(earliestPickup(LATER)));
    expect(iso(control().props.maximumDate)).toBe(iso(latestPickup(LATER)));
    expect(iso(control().props.minimumDate)).not.toBe(iso(EARLIEST));
    await fireEvent.press(screen.getByRole('button', { name: 'Done, use this pickup time' }));
    expect(iso(onChange.mock.calls[0][0])).toBe(iso(earliestPickup(LATER)));
    expect(onChange.mock.calls[0][1]).toBeNull();
  });

  it('Android: the date dialog uses the fresh limits, and the answer is checked against them', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    expect(iso(lastDialog().minimumDate as Date)).toBe(iso(earliestPickup(LATER)));
    expect(iso(lastDialog().maximumDate as Date)).toBe(iso(latestPickup(LATER)));
    await act(async () => lastDialog().onValueChange?.(picked(new Date()), earliestPickup(LATER)));
    // 01:30, fine at the first-shown time but now too early: the fresh time says so.
    await act(async () => lastDialog().onValueChange?.(picked(new Date()), EARLIEST));
    expect(iso(onChange.mock.calls[0][0])).toBe(iso(earliestPickup(LATER)));
    expect(onChange.mock.calls[0][1]).toBe('too_soon');
  });

  it('works without onOpen too (the time given is used)', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={null} onChange={onChange} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    expect(iso(control().props.minimumDate)).toBe(iso(EARLIEST));
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
