import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';

import { PickupTimePicker } from '../components/PickupTimePicker';
import { buildPickupDays, formatTime } from '../time';

const AUCKLAND = { timeZone: 'Pacific/Auckland', locale: 'en-US' };
// 01:00 on 8 November in Auckland (still 7 November in UTC).
const NOW = new Date('2026-11-07T12:00:00Z');

afterEach(async () => {
  await cleanup();
});

describe('PickupTimePicker', () => {
  it('shows days from the zone, starting with Today', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    expect(screen.getByRole('button', { name: 'Sunday, November 8' })).toBeOnTheScreen();
    expect(screen.getByText('Today')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Monday, November 9' })).toBeOnTheScreen();
    // The first day is the local Nov 8, not the UTC Nov 7.
    expect(screen.queryByRole('button', { name: 'Saturday, November 7' })).not.toBeOnTheScreen();
  });

  it('lists the earliest local times for the first day', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    expect(screen.getByRole('button', { name: 'Sunday, November 8, 1:30 AM' })).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Sunday, November 8, 1:15 AM' }),
    ).not.toBeOnTheScreen();
  });

  it("picking a day shows that day's times", async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Monday, November 9' }));
    expect(screen.getByRole('button', { name: 'Monday, November 9, 12:00 AM' })).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Sunday, November 8, 1:30 AM' }),
    ).not.toBeOnTheScreen();
  });

  it('reports the chosen slot as an instant (UTC)', async () => {
    const onChange = jest.fn();
    await render(<PickupTimePicker now={NOW} value={null} onChange={onChange} {...AUCKLAND} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sunday, November 8, 1:30 AM' }));
    const chosen: Date = onChange.mock.calls[0][0];
    expect(chosen.toISOString()).toBe('2026-11-07T12:30:00.000Z'); // 01:30 in Auckland
  });

  it('exposes the selected day and time with state, plus a check mark, not colour alone', async () => {
    const days = buildPickupDays(NOW, AUCKLAND);
    const value = days[0].slots[1];
    await render(<PickupTimePicker now={NOW} value={value} onChange={jest.fn()} {...AUCKLAND} />);
    const time = screen.getByRole('button', {
      name: `Sunday, November 8, ${formatTime(value, AUCKLAND)}`,
    });
    expect(time.props.accessibilityState).toEqual({ selected: true });
    expect(within(time).getByText(formatTime(value, AUCKLAND))).toBeOnTheScreen();
    // A check mark on the chosen day and the chosen time: selection is never colour alone.
    expect(JSON.stringify(screen.toJSON()).match(/"name":"checkmark"/g)).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Sunday, November 8' }).props.accessibilityState,
    ).toEqual({ selected: true });
    expect(
      screen.getByRole('button', { name: 'Sunday, November 8, 1:30 AM' }).props.accessibilityState,
    ).toEqual({ selected: false });
  });

  it('keeps the day of an already chosen time', async () => {
    const days = buildPickupDays(NOW, AUCKLAND);
    const value = days[2].slots[4];
    await render(<PickupTimePicker now={NOW} value={value} onChange={jest.fn()} {...AUCKLAND} />);
    expect(
      screen.getByRole('button', { name: days[2].spokenLabel }).props.accessibilityState,
    ).toEqual({ selected: true });
  });

  it('offers no time sooner than 15 minutes from now', async () => {
    const now = new Date('2026-11-07T12:20:00Z'); // 01:20 Auckland: earliest is 01:45
    await render(<PickupTimePicker now={now} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    expect(
      screen.queryByRole('button', { name: 'Sunday, November 8, 1:30 AM' }),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sunday, November 8, 1:45 AM' })).toBeOnTheScreen();
  });

  it('offers about eight days at most (today plus 7 days)', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    const days = screen
      .getAllByRole('button')
      .filter((button) => /^\w+day, \w+ \d+$/.test(button.props.accessibilityLabel ?? ''));
    expect(days.length).toBeLessThanOrEqual(9);
    expect(days.length).toBeGreaterThanOrEqual(7);
  });

  it('has touch targets of at least 44 points', async () => {
    await render(<PickupTimePicker now={NOW} value={null} onChange={jest.fn()} {...AUCKLAND} />);
    for (const button of screen.getAllByRole('button')) {
      const flat = Object.assign({}, ...[button.props.style].flat(Infinity).filter(Boolean));
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    }
  });
});
