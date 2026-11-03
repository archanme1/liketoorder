import { supabase } from '@/lib/supabase';

import * as api from '../api';
import { CuisineAppError, listCuisines, mapCuisineError } from '../api';

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockedFrom = supabase.from as unknown as jest.Mock;

const italy = {
  code: 'IT',
  kind: 'country',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 100,
};
const other = {
  code: 'other',
  kind: 'neutral',
  name: 'Other',
  flag: null,
  icon: 'ellipsis-horizontal-circle-outline',
  sort_order: 999,
};

type Result = { data: unknown; error: unknown };

function builder(result: Result) {
  const calls: string[] = [];
  const b = {
    select: jest.fn(),
    order: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  };
  b.select.mockImplementation(() => {
    calls.push('select');
    return b;
  });
  // First order() chains, the last one resolves (awaited query).
  let orderCount = 0;
  b.order.mockImplementation((column: string) => {
    calls.push(`order:${column}`);
    orderCount += 1;
    return orderCount >= 2 ? Promise.resolve(result) : b;
  });
  return { b, calls };
}

function pgError(code: string | undefined, message: string, details = '') {
  return { code, message, details, hint: '' };
}

async function caught(promise: Promise<unknown>): Promise<CuisineAppError> {
  try {
    await promise;
  } catch (e) {
    return e as CuisineAppError;
  }
  throw new Error('expected rejection');
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listCuisines', () => {
  it('reads the cuisines table with the column list, ordered by sort_order then name', async () => {
    const { b, calls } = builder({ data: [italy], error: null });
    mockedFrom.mockReturnValue(b);

    await listCuisines();

    expect(mockedFrom).toHaveBeenCalledWith('cuisines');
    expect(b.select).toHaveBeenCalledWith('code, kind, name, flag, icon, sort_order');
    expect(calls).toEqual(['select', 'order:sort_order', 'order:name']);
  });

  it('returns parsed rows', async () => {
    const { b } = builder({ data: [italy, other], error: null });
    mockedFrom.mockReturnValue(b);
    await expect(listCuisines()).resolves.toEqual([italy, other]);
  });

  it('returns an empty list when there are no rows', async () => {
    const { b } = builder({ data: [], error: null });
    mockedFrom.mockReturnValue(b);
    await expect(listCuisines()).resolves.toEqual([]);
  });

  it('falls back to the default icon for an unknown neutral icon', async () => {
    const { b } = builder({ data: [{ ...other, icon: 'does-not-exist' }], error: null });
    mockedFrom.mockReturnValue(b);
    const rows = await listCuisines();
    expect(rows[0].icon).toBe('ellipsis-horizontal-circle-outline');
  });

  it('throws invalid_data on a malformed row (country with no flag)', async () => {
    const { b } = builder({ data: [{ ...italy, flag: null }], error: null });
    mockedFrom.mockReturnValue(b);
    const err = await caught(listCuisines());
    expect(err).toBeInstanceOf(CuisineAppError);
    expect(err.code).toBe('invalid_data');
  });

  it.each(['Network request failed', 'Failed to fetch'])(
    'maps a network error (%s) to network',
    async (message) => {
      const { b } = builder({ data: null, error: pgError(undefined, message) });
      mockedFrom.mockReturnValue(b);
      const err = await caught(listCuisines());
      expect(err).toBeInstanceOf(CuisineAppError);
      expect(err.code).toBe('network');
    },
  );

  it.each(['XX000', '42501'])('maps Postgres error %s to unknown', async (code) => {
    const { b } = builder({ data: null, error: pgError(code, 'boom') });
    mockedFrom.mockReturnValue(b);
    const err = await caught(listCuisines());
    expect(err).toBeInstanceOf(CuisineAppError);
    expect(err.code).toBe('unknown');
  });

  it('makes no insert, update, upsert or delete call', async () => {
    const { b } = builder({ data: [italy], error: null });
    mockedFrom.mockReturnValue(b);
    await listCuisines();
    expect(b.insert).not.toHaveBeenCalled();
    expect(b.update).not.toHaveBeenCalled();
    expect(b.upsert).not.toHaveBeenCalled();
    expect(b.delete).not.toHaveBeenCalled();
  });

  it('module exports no write function', () => {
    const names = Object.keys(api);
    expect(
      names.filter((n) => /^(create|insert|update|upsert|delete|remove|add|set)/i.test(n)),
    ).toEqual([]);
  });
});

describe('mapCuisineError', () => {
  it('passes a CuisineAppError through unchanged', () => {
    const original = new CuisineAppError('invalid_data');
    expect(mapCuisineError(original)).toBe(original);
  });

  it('maps null to unknown', () => {
    expect(mapCuisineError(null).code).toBe('unknown');
  });

  it('maps undefined and non-objects to unknown', () => {
    expect(mapCuisineError(undefined).code).toBe('unknown');
    expect(mapCuisineError('oops').code).toBe('unknown');
  });

  it('maps a codeless network message to network', () => {
    expect(mapCuisineError(pgError(undefined, 'Network request failed')).code).toBe('network');
    expect(mapCuisineError(pgError(undefined, 'Failed to fetch')).code).toBe('network');
  });

  it('maps a Postgres error to unknown', () => {
    expect(mapCuisineError(pgError('42501', 'permission denied')).code).toBe('unknown');
    expect(mapCuisineError(pgError('XX000', 'internal')).code).toBe('unknown');
  });

  it('returns a CuisineAppError instance', () => {
    expect(mapCuisineError({})).toBeInstanceOf(CuisineAppError);
  });
});
