import { supabase } from '@/lib/supabase';

import { myPromotionJson, NETWORK_ERROR, pgError, promotionJson } from '../__fixtures__/promotion';
import {
  cancelMyPromotion,
  fetchMyPromotion,
  mapPromotionError,
  PromotionAppError,
  requestPromotion,
  type PromotionErrorCode,
} from '../api';
import { checkHeadline } from '../text';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const mocked = supabase as unknown as { rpc: jest.Mock };
const ANSWER = myPromotionJson(promotionJson('requested'));
const REQUEST = {
  category: 'special_offer' as const,
  headline: 'Two bowls of pho for the price of one',
  preferredStart: '2026-11-22',
};

function resolves(data: unknown) {
  mocked.rpc.mockResolvedValueOnce({ data, error: null });
}

function fails(error: unknown) {
  mocked.rpc.mockResolvedValueOnce({ data: null, error });
}

async function codeOf(promise: Promise<unknown>): Promise<PromotionErrorCode | 'resolved'> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    if (error instanceof PromotionAppError) return error.code;
    throw error;
  }
}

beforeEach(() => mocked.rpc.mockReset());

describe('the RPC calls', () => {
  it('fetch calls get_my_promotion with no arguments and returns the parsed answer', async () => {
    resolves(ANSWER);
    await expect(fetchMyPromotion()).resolves.toEqual(ANSWER);
    expect(mocked.rpc).toHaveBeenCalledWith('get_my_promotion');
  });

  it('request sends exactly the category, headline and preferred day', async () => {
    resolves(ANSWER);
    await expect(requestPromotion(REQUEST)).resolves.toEqual(ANSWER);
    expect(mocked.rpc).toHaveBeenCalledWith('request_promotion', {
      p_category: 'special_offer',
      p_headline: 'Two bowls of pho for the price of one',
      p_preferred_start: '2026-11-22',
    });
  });

  it('request sends "as soon as possible" as null', async () => {
    resolves(ANSWER);
    await requestPromotion({ ...REQUEST, preferredStart: null });
    expect(mocked.rpc.mock.calls[0][1].p_preferred_start).toBeNull();
  });

  it('sends the trimmed headline that checkHeadline returns', async () => {
    const check = checkHeadline('  Two bowls of pho  ');
    if (!check.ok) throw new Error('expected a valid headline');
    resolves(ANSWER);
    await requestPromotion({ ...REQUEST, headline: check.value });
    expect(mocked.rpc.mock.calls[0][1].p_headline).toBe('Two bowls of pho');
  });

  it('cancel sends only the promotion id', async () => {
    resolves(myPromotionJson(promotionJson('cancelled')));
    await cancelMyPromotion('00000000-0000-4000-8000-000000001601');
    expect(mocked.rpc).toHaveBeenCalledWith('cancel_my_promotion', {
      p_promotion_id: '00000000-0000-4000-8000-000000001601',
    });
  });

  it.each([
    ['an extra key', { ...ANSWER, price: 1 }],
    ['a stored status', myPromotionJson(promotionJson('active', { state: 'approved' }))],
    ['null', null],
  ])('turns an answer with %s into "unknown"', async (_name, data) => {
    resolves(data);
    expect(await codeOf(fetchMyPromotion())).toBe('unknown');
  });
});

describe('mapPromotionError: every error the migration raises', () => {
  it.each([
    'not_authenticated',
    'not_eligible',
    'not_configured',
    'already_open',
    'too_many_requests',
    'invalid_headline',
    'invalid_category',
    'invalid_start',
    'not_found',
    'not_cancellable',
    'contact_support',
  ] as const)('maps %s', async (code) => {
    fails(pgError(code));
    expect(await codeOf(requestPromotion(REQUEST))).toBe(code);
  });

  it('maps a malformed uuid (22P02) to not_found', () => {
    expect(
      mapPromotionError({ code: '22P02', message: 'invalid input syntax for type uuid' }).code,
    ).toBe('not_found');
  });

  it('maps a lost connection to network', async () => {
    fails(NETWORK_ERROR);
    expect(await codeOf(cancelMyPromotion('x'))).toBe('network');
  });

  it('maps anything else to unknown, never trusting inherited keys', () => {
    expect(mapPromotionError(pgError('constructor')).code).toBe('unknown');
    expect(mapPromotionError(pgError('toString')).code).toBe('unknown');
    expect(mapPromotionError(pgError('overlap')).code).toBe('unknown');
    expect(mapPromotionError({ code: '57014', message: 'canceling statement' }).code).toBe(
      'unknown',
    );
    expect(mapPromotionError({ code: '', message: 'Too Many Requests', details: null }).code).toBe(
      'unknown',
    );
    expect(mapPromotionError(null).code).toBe('unknown');
    expect(mapPromotionError('boom').code).toBe('unknown');
  });

  it('keeps only the code, never the server text', () => {
    const error = mapPromotionError({ code: '', message: 'fetch failed: tacos@example.com' });
    expect(error.code).toBe('network');
    expect(error.message).toBe('network');
  });

  it('passes a PromotionAppError through', () => {
    const error = new PromotionAppError('already_open');
    expect(mapPromotionError(error)).toBe(error);
  });
});
