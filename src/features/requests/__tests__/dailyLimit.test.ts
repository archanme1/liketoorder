import { mapRequestError } from '../api';
import { requestErrorMessage } from '../messages';

// Spec 12 (Decision 6): at most 30 requests a day across all places; the server refuses the 31st
// with daily_limit.
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

describe('daily_limit', () => {
  it('keeps the server code', () => {
    expect(mapRequestError({ code: 'P0001', message: 'daily_limit' }).code).toBe('daily_limit');
  });

  it('says what happened in plain words, without blaming one place', () => {
    expect(requestErrorMessage('daily_limit')).toBe(
      "You've sent a lot of requests today. Try again tomorrow.",
    );
  });
});
