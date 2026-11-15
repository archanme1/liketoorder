import { MediaError } from '@/features/media/errors';

import { FoodLogAppError, type FoodLogErrorCode } from '../api';
import { foodLogErrorMessage, foodLogFlowMessage } from '../messages';

const CODES: FoodLogErrorCode[] = [
  'profile_incomplete',
  'invalid_input',
  'invalid_text',
  'contact_info',
  'invalid_time_zone',
  'too_many_pending',
  'daily_limit',
  'cleanup_required',
  'not_found',
  'upload_missing',
  'network',
  'unknown',
];

describe('food log messages', () => {
  it.each(CODES)('has a message for %s', (code) => {
    expect(foodLogErrorMessage(code)).toMatch(/\w/);
  });

  it('uses the spec text for the daily limit', () => {
    expect(foodLogErrorMessage('daily_limit')).toBe(
      "You've added a lot of photos today. Try again tomorrow.",
    );
  });

  it('gives media and food log errors their own messages', () => {
    expect(foodLogFlowMessage(new MediaError('too_large'))).toMatch(/too large/);
    expect(foodLogFlowMessage(new FoodLogAppError('daily_limit'))).toMatch(/tomorrow/);
    expect(foodLogFlowMessage(new Error('x'))).toBe(foodLogErrorMessage('unknown'));
  });
});
