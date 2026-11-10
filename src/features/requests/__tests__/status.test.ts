import { REQUEST_STATUSES } from '../schema';
import { clockOffset, msUntilExpiry, STATUS_INFO, statusSentence } from '../status';

describe('status wording', () => {
  it('has a word and an icon for every status', () => {
    for (const status of REQUEST_STATUSES) {
      expect(STATUS_INFO[status].label.length).toBeGreaterThan(0);
      expect(STATUS_INFO[status].icon).toMatch(/-outline$/);
    }
    expect(STATUS_INFO.no_show.label).toBe('No-show');
    expect(STATUS_INFO.expired.label).toBe('Expired');
  });

  it('never reads as confirmed while pending', () => {
    const pending = [STATUS_INFO.pending.label, statusSentence('pending', "Joe's", 'pickup')].join(' ');
    expect(pending).toBe("Waiting Waiting for Joe's to respond");
    expect(pending).not.toMatch(/confirm|book|on its way|accepted/i);
  });

  it('has a sentence for every status', () => {
    for (const status of REQUEST_STATUSES) {
      expect(statusSentence(status, 'Joe', 'pickup')).toBeTruthy();
    }
  });
});

describe('clockOffset / msUntilExpiry', () => {
  const server = '2026-11-08T17:00:00Z';
  const serverMs = Date.parse(server);
  const hour = 3_600_000;

  it('is how far the phone is ahead of the server', () => {
    expect(clockOffset(server, serverMs + 5 * hour)).toBe(5 * hour);
    expect(clockOffset(server, serverMs - 5 * hour)).toBe(-5 * hour);
  });

  it.each([5 * hour, -5 * hour, 0])(
    'waits the same real time until expiry with the phone %i ms off',
    (skew) => {
      const expires = '2026-11-08T17:30:00Z';
      const deviceNow = serverMs + skew;
      const offset = clockOffset(server, deviceNow);
      expect(msUntilExpiry(expires, offset, deviceNow)).toBe(30 * 60_000);
    },
  );

  it('is never negative', () => {
    expect(msUntilExpiry('2026-11-08T16:00:00Z', 0, serverMs)).toBe(0);
  });
});
