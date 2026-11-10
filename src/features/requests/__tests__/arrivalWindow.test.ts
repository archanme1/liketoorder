import { arrivalWindowAt } from '../hooks/useArrivalWindow';

const TABLE_AT = '2026-11-09T00:00:00Z';
const at = new Date(TABLE_AT).getTime();
const HOUR = 3_600_000;

describe('arrivalWindowAt (server time against the table time)', () => {
  it('is open exactly 2 hours before, and closed one second earlier', () => {
    expect(arrivalWindowAt(TABLE_AT, at - 2 * HOUR)).toBe('open');
    expect(arrivalWindowAt(TABLE_AT, at - 2 * HOUR - 1_000)).toBe('before');
  });

  it('is open exactly 4 hours after, and closed one second later', () => {
    expect(arrivalWindowAt(TABLE_AT, at + 4 * HOUR)).toBe('open');
    expect(arrivalWindowAt(TABLE_AT, at + 4 * HOUR + 1_000)).toBe('after');
  });

  it('is open at the table time itself', () => {
    expect(arrivalWindowAt(TABLE_AT, at)).toBe('open');
  });
});
