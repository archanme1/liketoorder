import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import {
  SellerAppError,
  autocompletePlaces,
  createMyBusiness,
  getMyBusiness,
  mapFunctionError,
  mapSellerError,
  resolvePlace,
  setSellerMode,
  updateMyBusiness,
} from '../api';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const mocked = supabase as unknown as {
  rpc: jest.Mock;
  from: jest.Mock;
  functions: { invoke: jest.Mock };
};

const view = {
  id: 'b1',
  type: 'restaurant',
  name: "Joe's Pizza",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  map_lat: 43.65,
  map_lng: -79.38,
  public_address: '1 Main St',
  is_listed: true,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '1 Main St, Toronto, ON', lat: 43.65, lng: -79.38 },
};

function pgError(code: string | undefined, message: string, details: string | null = '') {
  return { code, message, details, hint: '' };
}

function httpError(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new FunctionsHttpError(new Response(text, { status }));
}

async function caught(promise: Promise<unknown>): Promise<SellerAppError> {
  try {
    await promise;
  } catch (e) {
    return e as SellerAppError;
  }
  throw new Error('expected rejection');
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('SellerAppError', () => {
  it('carries only its code', () => {
    const error = new SellerAppError('rate_limited');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('rate_limited');
    expect(error.message).toBe('rate_limited');
  });
});

describe('getMyBusiness', () => {
  it('calls get_my_business with no arguments (it never takes a business id)', async () => {
    mocked.rpc.mockResolvedValue({ data: view, error: null });
    await getMyBusiness();
    expect(mocked.rpc).toHaveBeenCalledTimes(1);
    expect(mocked.rpc.mock.calls[0]).toEqual(['get_my_business']);
  });

  it('returns the parsed owner view', async () => {
    mocked.rpc.mockResolvedValue({ data: view, error: null });
    await expect(getMyBusiness()).resolves.toEqual(view);
  });

  it('returns null when the user has no business', async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMyBusiness()).resolves.toBeNull();
  });

  it('maps an RPC error', async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: pgError('XX000', 'boom') });
    const err = await caught(getMyBusiness());
    expect(err).toBeInstanceOf(SellerAppError);
    expect(err.code).toBe('unknown');
  });

  it('throws unknown when the payload has the wrong shape', async () => {
    mocked.rpc.mockResolvedValue({ data: { id: 'b1' }, error: null });
    const err = await caught(getMyBusiness());
    expect(err.code).toBe('unknown');
  });
});

describe('createMyBusiness', () => {
  it('calls create_my_business with the p_ arguments only, and returns the id', async () => {
    mocked.rpc.mockResolvedValue({ data: 'new-id', error: null });
    const id = await createMyBusiness({
      type: 'restaurant',
      name: 'Joe',
      cuisine_code: 'IT',
      accepts_table_requests: true,
    });
    expect(id).toBe('new-id');
    expect(mocked.rpc).toHaveBeenCalledWith('create_my_business', {
      p_type: 'restaurant',
      p_name: 'Joe',
      p_cuisine_code: 'IT',
      p_accepts_table_requests: true,
    });
  });

  it('never sends coordinates, an address or an owner', async () => {
    mocked.rpc.mockResolvedValue({ data: 'new-id', error: null });
    await createMyBusiness({
      type: 'restaurant',
      name: 'Joe',
      cuisine_code: 'IT',
      accepts_table_requests: false,
    });
    const args = mocked.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual([
      'p_accepts_table_requests',
      'p_cuisine_code',
      'p_name',
      'p_type',
    ]);
  });

  it('sends false for table requests on a homemade business', async () => {
    mocked.rpc.mockResolvedValue({ data: 'new-id', error: null });
    await createMyBusiness({
      type: 'homemade',
      name: 'Gran',
      cuisine_code: 'IT',
      accepts_table_requests: true,
    });
    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({
      p_type: 'homemade',
      p_accepts_table_requests: false,
    });
  });

  it.each([
    ['already_has_business', 'already_has_business'],
    ['profile_incomplete', 'profile_incomplete'],
    ['tables_restaurant_only', 'invalid_input'],
  ])('maps the raised %s to %s', async (raised, expected) => {
    mocked.rpc.mockResolvedValue({ data: null, error: pgError('P0001', raised) });
    const err = await caught(
      createMyBusiness({
        type: 'restaurant',
        name: 'Joe',
        cuisine_code: 'IT',
        accepts_table_requests: false,
      }),
    );
    expect(err.code).toBe(expected);
  });
});

describe('setSellerMode', () => {
  it.each([true, false])('calls set_seller_mode with p_on = %s', async (on) => {
    mocked.rpc.mockResolvedValue({ data: null, error: null });
    await setSellerMode(on);
    expect(mocked.rpc).toHaveBeenCalledWith('set_seller_mode', { p_on: on });
  });

  it('maps no_business', async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: pgError('P0001', 'no_business') });
    const err = await caught(setSellerMode(true));
    expect(err.code).toBe('no_business');
  });
});

describe('updateMyBusiness', () => {
  function updateChain(result: { data: unknown; error: unknown }) {
    const b = {
      update: jest.fn(),
      eq: jest.fn(),
      select: jest.fn(),
    };
    b.update.mockImplementation(() => b);
    b.eq.mockImplementation(() => b);
    b.select.mockImplementation(() => Promise.resolve(result));
    return b;
  }

  it('updates the businesses table filtered by id, then reads the owner view', async () => {
    const b = updateChain({ data: [{ id: 'b1' }], error: null });
    mocked.from.mockReturnValue(b);
    mocked.rpc.mockResolvedValue({ data: { ...view, name: 'New' }, error: null });

    const result = await updateMyBusiness('b1', { name: 'New' });

    expect(mocked.from).toHaveBeenCalledWith('businesses');
    expect(b.eq).toHaveBeenCalledWith('id', 'b1');
    expect(mocked.rpc).toHaveBeenCalledWith('get_my_business');
    expect(result.name).toBe('New');
  });

  it('sends exactly the three editable columns', async () => {
    const b = updateChain({ data: [{ id: 'b1' }], error: null });
    mocked.from.mockReturnValue(b);
    mocked.rpc.mockResolvedValue({ data: view, error: null });

    await updateMyBusiness('b1', {
      name: 'N',
      cuisine_code: 'FR',
      accepts_table_requests: false,
    });

    const sent = b.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['accepts_table_requests', 'cuisine_code', 'name']);
    expect(sent).toEqual({ name: 'N', cuisine_code: 'FR', accepts_table_requests: false });
  });

  it('never sends type, is_listed, coordinates, address or owner even if the patch has them', async () => {
    const b = updateChain({ data: [{ id: 'b1' }], error: null });
    mocked.from.mockReturnValue(b);
    mocked.rpc.mockResolvedValue({ data: view, error: null });

    const dirty = {
      name: 'N',
      cuisine_code: 'FR',
      accepts_table_requests: true,
      type: 'homemade',
      is_listed: false,
      map_lat: 1,
      map_lng: 2,
      public_address: 'secret street',
      owner_id: 'someone-else',
      id: 'other',
      created_at: 'x',
      updated_at: 'y',
    };
    await updateMyBusiness('b1', dirty as never);

    const sent = b.update.mock.calls[0][0] as Record<string, unknown>;
    for (const forbidden of [
      'type',
      'is_listed',
      'map_lat',
      'map_lng',
      'public_address',
      'owner_id',
      'id',
      'created_at',
      'updated_at',
    ]) {
      expect(sent).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(sent).sort()).toEqual(['accepts_table_requests', 'cuisine_code', 'name']);
  });

  it('sends only the fields that are in the patch', async () => {
    const b = updateChain({ data: [{ id: 'b1' }], error: null });
    mocked.from.mockReturnValue(b);
    mocked.rpc.mockResolvedValue({ data: view, error: null });

    await updateMyBusiness('b1', { name: 'Only name' });

    expect(Object.keys(b.update.mock.calls[0][0] as object)).toEqual(['name']);
  });

  it('throws no_business when no row was updated', async () => {
    const b = updateChain({ data: [], error: null });
    mocked.from.mockReturnValue(b);
    const err = await caught(updateMyBusiness('b1', { name: 'N' }));
    expect(err.code).toBe('no_business');
  });

  it.each(['23514', '23503'])('maps constraint error %s to invalid_input', async (code) => {
    const b = updateChain({ data: null, error: pgError(code, 'violates constraint') });
    mocked.from.mockReturnValue(b);
    const err = await caught(updateMyBusiness('b1', { name: 'N' }));
    expect(err.code).toBe('invalid_input');
  });
});

describe('autocompletePlaces', () => {
  const suggestions = [{ placeId: 'p1', primaryText: '1 Main St', secondaryText: 'Toronto, ON' }];

  it('invokes places-autocomplete with exactly { input, sessionToken }', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: { suggestions }, error: null });
    await autocompletePlaces('1 Main', 'token-1');
    expect(mocked.functions.invoke).toHaveBeenCalledTimes(1);
    const [name, options] = mocked.functions.invoke.mock.calls[0];
    expect(name).toBe('places-autocomplete');
    expect(options.body).toEqual({ input: '1 Main', sessionToken: 'token-1' });
    expect(Object.keys(options.body).sort()).toEqual(['input', 'sessionToken']);
  });

  it('passes the abort signal through', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: { suggestions }, error: null });
    const controller = new AbortController();
    await autocompletePlaces('1 Main', 'token-1', controller.signal);
    expect(mocked.functions.invoke.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('returns the suggestions', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: { suggestions }, error: null });
    await expect(autocompletePlaces('1 Main', 'token-1')).resolves.toEqual(suggestions);
  });

  it('returns an empty list when there are no matches', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: { suggestions: [] }, error: null });
    await expect(autocompletePlaces('zzzzz', 'token-1')).resolves.toEqual([]);
  });

  it('throws unknown on a malformed response', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: { nope: true }, error: null });
    const err = await caught(autocompletePlaces('1 Main', 'token-1'));
    expect(err.code).toBe('unknown');
  });

  it('maps a 429 to rate_limited', async () => {
    mocked.functions.invoke.mockResolvedValue({
      data: null,
      error: httpError(429, { error: { code: 'rate_limited' } }),
    });
    const err = await caught(autocompletePlaces('1 Main', 'token-1'));
    expect(err).toBeInstanceOf(SellerAppError);
    expect(err.code).toBe('rate_limited');
  });

  it('maps a network failure to network', async () => {
    mocked.functions.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('Network request failed')),
    });
    const err = await caught(autocompletePlaces('1 Main', 'token-1'));
    expect(err.code).toBe('network');
  });
});

describe('resolvePlace', () => {
  it('invokes places-resolve with exactly { placeId, sessionToken }', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: view, error: null });
    await resolvePlace('place-1', 'token-1');
    expect(mocked.functions.invoke).toHaveBeenCalledTimes(1);
    const [name, options] = mocked.functions.invoke.mock.calls[0];
    expect(name).toBe('places-resolve');
    expect(options.body).toEqual({ placeId: 'place-1', sessionToken: 'token-1' });
    expect(Object.keys(options.body).sort()).toEqual(['placeId', 'sessionToken']);
  });

  it('never sends an owner, coordinates or an address', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: view, error: null });
    await resolvePlace('place-1', 'token-1');
    const body = mocked.functions.invoke.mock.calls[0][1].body as Record<string, unknown>;
    for (const key of ['owner_id', 'userId', 'lat', 'lng', 'address', 'formatted_address']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('returns the owner view', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: view, error: null });
    await expect(resolvePlace('place-1', 'token-1')).resolves.toEqual(view);
  });

  it('throws unknown on a malformed owner view', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: { id: 'x' }, error: null });
    const err = await caught(resolvePlace('place-1', 'token-1'));
    expect(err.code).toBe('unknown');
  });

  it.each([
    [400, 'invalid_input', 'invalid_input'],
    [403, 'profile_incomplete', 'profile_incomplete'],
    [404, 'no_business', 'no_business'],
    [422, 'not_a_place', 'not_a_place'],
    [429, 'rate_limited', 'rate_limited'],
    [502, 'upstream_error', 'unknown'],
  ])('maps status %s (%s) to %s', async (status, bodyCode, expected) => {
    mocked.functions.invoke.mockResolvedValue({
      data: null,
      error: httpError(status, { error: { code: bodyCode } }),
    });
    const err = await caught(resolvePlace('place-1', 'token-1'));
    expect(err.code).toBe(expected);
  });
});

describe('mapSellerError', () => {
  it('passes a SellerAppError through unchanged', () => {
    const original = new SellerAppError('no_business');
    expect(mapSellerError(original)).toBe(original);
  });

  it.each([
    ['already_has_business', 'already_has_business'],
    ['no_business', 'no_business'],
    ['profile_incomplete', 'profile_incomplete'],
    ['tables_restaurant_only', 'invalid_input'],
  ])('maps P0001 "%s" to %s', (message, expected) => {
    expect(mapSellerError(pgError('P0001', message)).code).toBe(expected);
  });

  it('maps an unrecognised P0001 message to unknown', () => {
    expect(mapSellerError(pgError('P0001', 'something_else')).code).toBe('unknown');
  });

  it.each(['23514', '23503'])('maps constraint error %s to invalid_input', (code) => {
    expect(mapSellerError(pgError(code, 'violates check constraint')).code).toBe('invalid_input');
  });

  it('maps a codeless network message to network', () => {
    expect(mapSellerError(pgError(undefined, 'Network request failed')).code).toBe('network');
    expect(mapSellerError(pgError(undefined, 'Failed to fetch')).code).toBe('network');
  });

  it('copes with null details', () => {
    expect(mapSellerError(pgError('XX000', 'boom', null)).code).toBe('unknown');
  });

  it('maps a FunctionsFetchError to network', () => {
    expect(mapSellerError(new FunctionsFetchError(new Error('x'))).code).toBe('network');
  });

  it('maps a FunctionsRelayError to network', () => {
    expect(mapSellerError(new FunctionsRelayError(new Error('x'))).code).toBe('network');
  });

  it.each([null, undefined, 'oops', 42])('maps %p to unknown', (value) => {
    expect(mapSellerError(value).code).toBe('unknown');
  });

  it('maps another Postgres error to unknown', () => {
    expect(mapSellerError(pgError('42501', 'permission denied')).code).toBe('unknown');
  });

  it('always returns a SellerAppError whose message is its code', () => {
    const err = mapSellerError(pgError('P0001', 'no_business'));
    expect(err).toBeInstanceOf(SellerAppError);
    expect(err.message).toBe('no_business');
  });
});

describe('mapFunctionError', () => {
  it.each([
    [400, 'invalid_input', 'invalid_input'],
    [403, 'profile_incomplete', 'profile_incomplete'],
    [404, 'no_business', 'no_business'],
    [422, 'not_a_place', 'not_a_place'],
    [429, 'rate_limited', 'rate_limited'],
    [502, 'upstream_error', 'unknown'],
  ])('maps status %s with code "%s" to %s', async (status, code, expected) => {
    const err = await mapFunctionError(httpError(status, { error: { code } }));
    expect(err).toBeInstanceOf(SellerAppError);
    expect(err.code).toBe(expected);
  });

  it('maps a 429 with an unreadable body to rate_limited', async () => {
    const err = await mapFunctionError(httpError(429, '<html>Too Many Requests</html>'));
    expect(err.code).toBe('rate_limited');
  });

  it('maps a 429 with an empty body to rate_limited', async () => {
    const err = await mapFunctionError(httpError(429, ''));
    expect(err.code).toBe('rate_limited');
  });

  it('maps an unreadable body on another status to unknown', async () => {
    const err = await mapFunctionError(httpError(500, 'not json at all'));
    expect(err.code).toBe('unknown');
  });

  it('maps an unknown body code to unknown', async () => {
    const err = await mapFunctionError(httpError(500, { error: { code: 'mystery' } }));
    expect(err.code).toBe('unknown');
  });

  it('maps a body with no error object to unknown', async () => {
    const err = await mapFunctionError(httpError(500, { ok: false }));
    expect(err.code).toBe('unknown');
  });

  it('maps an HTTP error whose context is not a Response to unknown', async () => {
    const err = await mapFunctionError(new FunctionsHttpError({ status: 400 }));
    expect(err.code).toBe('unknown');
  });

  it('maps a FunctionsFetchError to network', async () => {
    const err = await mapFunctionError(new FunctionsFetchError(new TypeError('Failed to fetch')));
    expect(err.code).toBe('network');
  });

  it('maps a FunctionsRelayError to network', async () => {
    const err = await mapFunctionError(new FunctionsRelayError(new Error('relay')));
    expect(err.code).toBe('network');
  });

  it('falls back to mapSellerError for other errors', async () => {
    expect((await mapFunctionError(pgError('23514', 'x'))).code).toBe('invalid_input');
    expect((await mapFunctionError(null)).code).toBe('unknown');
  });
});
