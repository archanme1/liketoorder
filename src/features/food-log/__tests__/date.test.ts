import { formatLocalDate } from '../date';

describe('formatLocalDate', () => {
  it('formats the stored calendar date', () => {
    expect(formatLocalDate('2026-11-14', 'en-US')).toBe('Sat, Nov 14, 2026');
  });

  it('never moves the day, whatever the phone zone', () => {
    // The phone zone is the process zone here; formatting in UTC from the date parts ignores it.
    const original = Intl.DateTimeFormat;
    const spy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation((locale, options) =>
        original(locale, { timeZone: 'Pacific/Kiritimati', ...options }),
      );
    try {
      expect(formatLocalDate('2026-11-14', 'en-US')).toBe('Sat, Nov 14, 2026');
      expect(formatLocalDate('2026-01-01', 'en-US')).toBe('Thu, Jan 1, 2026');
    } finally {
      spy.mockRestore();
    }
  });
});
