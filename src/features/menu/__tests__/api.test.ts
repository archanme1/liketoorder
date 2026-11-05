import { supabase } from '@/lib/supabase';

import {
  MenuAppError,
  beginPhotoUpload,
  claimPhotoCleanup,
  createMenuItem,
  deleteBusinessPhoto,
  deleteMenuItem,
  finishPhotoUpload,
  getCurrencies,
  getMenu,
  mapMenuError,
  moveMenuItem,
  setMenuCurrency,
  updateMenuItem,
  type MenuErrorCode,
} from '../api';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

const mocked = supabase as unknown as { rpc: jest.Mock; from: jest.Mock };

type Result = { data: unknown; error: unknown };

type Builder = {
  select: jest.Mock;
  eq: jest.Mock;
  order: jest.Mock;
  then: (
    resolve: (value: Result) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

function builder(result: Result): Builder {
  const b: Builder = {
    select: jest.fn(() => b),
    eq: jest.fn(() => b),
    order: jest.fn(() => b),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return b;
}

const ok = (data: unknown = null): Result => ({ data, error: null });
const pgError = (code: string, message: string): Result => ({
  data: null,
  error: { code, message, details: null, hint: null },
});

beforeEach(() => {
  mocked.rpc.mockReset();
  mocked.from.mockReset();
});

describe('rpc names and arguments', () => {
  it('setMenuCurrency calls set_menu_currency with p_code', async () => {
    mocked.rpc.mockResolvedValue(ok());
    await setMenuCurrency('CAD');
    expect(mocked.rpc).toHaveBeenCalledWith('set_menu_currency', { p_code: 'CAD' });
  });

  it('createMenuItem calls create_menu_item and returns the new id', async () => {
    mocked.rpc.mockResolvedValue(ok('item-1'));
    const id = await createMenuItem({
      name: 'Pizza',
      description: 'Wood fired',
      price_minor: 1250,
      is_available: true,
    });
    expect(id).toBe('item-1');
    expect(mocked.rpc).toHaveBeenCalledWith('create_menu_item', {
      p_name: 'Pizza',
      p_description: 'Wood fired',
      p_price_minor: 1250,
      p_is_available: true,
    });
  });

  it('createMenuItem sends null for no description and no price', async () => {
    mocked.rpc.mockResolvedValue(ok('item-2'));
    await createMenuItem({
      name: 'Water',
      description: null,
      price_minor: null,
      is_available: false,
    });
    expect(mocked.rpc).toHaveBeenCalledWith('create_menu_item', {
      p_name: 'Water',
      p_description: null,
      p_price_minor: null,
      p_is_available: false,
    });
  });

  it('updateMenuItem calls update_menu_item with the item id and every field', async () => {
    mocked.rpc.mockResolvedValue(ok());
    await updateMenuItem('item-1', {
      name: 'Pizza',
      description: null,
      price_minor: 900,
      is_available: false,
    });
    expect(mocked.rpc).toHaveBeenCalledWith('update_menu_item', {
      p_item_id: 'item-1',
      p_name: 'Pizza',
      p_description: null,
      p_price_minor: 900,
      p_is_available: false,
    });
  });

  it.each(['up', 'down'] as const)('moveMenuItem sends direction %s', async (direction) => {
    mocked.rpc.mockResolvedValue(ok());
    await moveMenuItem('item-1', direction);
    expect(mocked.rpc).toHaveBeenCalledWith('move_menu_item', {
      p_item_id: 'item-1',
      p_direction: direction,
    });
  });

  it('deleteMenuItem calls delete_menu_item', async () => {
    mocked.rpc.mockResolvedValue(ok());
    await deleteMenuItem('item-1');
    expect(mocked.rpc).toHaveBeenCalledWith('delete_menu_item', { p_item_id: 'item-1' });
  });

  it('beginPhotoUpload for an item sends the kind and the item id', async () => {
    mocked.rpc.mockResolvedValue(ok({ photo_id: 'ph-1', path: 'b1/ph-1.jpg' }));
    const reservation = await beginPhotoUpload('item', 'item-1');
    expect(reservation).toEqual({ photo_id: 'ph-1', path: 'b1/ph-1.jpg' });
    expect(mocked.rpc).toHaveBeenCalledWith('begin_photo_upload', {
      p_kind: 'item',
      p_menu_item_id: 'item-1',
    });
  });

  it.each(['cover', 'gallery', 'menu'] as const)(
    'beginPhotoUpload for %s sends no item id',
    async (kind) => {
      mocked.rpc.mockResolvedValue(ok({ photo_id: 'ph-1', path: 'b1/ph-1.jpg' }));
      await beginPhotoUpload(kind);
      const [name, args] = mocked.rpc.mock.calls[0] as [string, Record<string, unknown>];
      expect(name).toBe('begin_photo_upload');
      expect(args.p_kind).toBe(kind);
      expect(args.p_menu_item_id ?? null).toBeNull();
    },
  );

  it('finishPhotoUpload calls finish_photo_upload and returns the photo', async () => {
    const photo = {
      id: 'ph-1',
      business_id: 'b1',
      kind: 'gallery',
      menu_item_id: null,
      path: 'b1/ph-1.jpg',
      position: 1,
    };
    mocked.rpc.mockResolvedValue(ok(photo));
    await expect(finishPhotoUpload('ph-1')).resolves.toEqual(photo);
    expect(mocked.rpc).toHaveBeenCalledWith('finish_photo_upload', { p_photo_id: 'ph-1' });
  });

  it('deleteBusinessPhoto calls delete_business_photo', async () => {
    mocked.rpc.mockResolvedValue(ok());
    await deleteBusinessPhoto('ph-1');
    expect(mocked.rpc).toHaveBeenCalledWith('delete_business_photo', { p_photo_id: 'ph-1' });
  });

  it('claimPhotoCleanup calls claim_photo_cleanup and returns the paths', async () => {
    mocked.rpc.mockResolvedValue(ok(['b1/a.jpg', 'b1/b.jpg']));
    await expect(claimPhotoCleanup()).resolves.toEqual(['b1/a.jpg', 'b1/b.jpg']);
    expect(mocked.rpc.mock.calls[0][0]).toBe('claim_photo_cleanup');
  });

  it('claimPhotoCleanup returns an empty list when nothing is queued', async () => {
    mocked.rpc.mockResolvedValue(ok([]));
    await expect(claimPhotoCleanup()).resolves.toEqual([]);
  });
});

describe('reads', () => {
  it('getCurrencies reads the currencies table', async () => {
    const rows = [
      { code: 'CAD', name: 'Canadian dollar', minor_units: 2 },
      { code: 'JPY', name: 'Japanese yen', minor_units: 0 },
    ];
    mocked.from.mockReturnValue(builder(ok(rows)));
    await expect(getCurrencies()).resolves.toEqual(rows);
    expect(mocked.from).toHaveBeenCalledWith('currencies');
  });

  it('getMenu reads the business items ordered by position, plus its photos', async () => {
    const items = [
      {
        id: 'i1',
        business_id: 'b1',
        name: 'Pizza',
        description: null,
        price_minor: 1250,
        is_available: true,
        position: 1,
      },
    ];
    const photos = [
      {
        id: 'p1',
        business_id: 'b1',
        kind: 'cover',
        menu_item_id: null,
        path: 'b1/p1.jpg',
        position: null,
      },
    ];
    const itemsBuilder = builder(ok(items));
    const photosBuilder = builder(ok(photos));
    mocked.from.mockImplementation((table: string) =>
      table === 'menu_items' ? itemsBuilder : photosBuilder,
    );

    const menu = await getMenu('b1');

    expect(menu.items).toEqual(items);
    expect(menu.photos).toEqual(photos);
    expect(mocked.from).toHaveBeenCalledWith('menu_items');
    expect(mocked.from).toHaveBeenCalledWith('business_photos');
    expect(itemsBuilder.eq).toHaveBeenCalledWith('business_id', 'b1');
    expect(photosBuilder.eq).toHaveBeenCalledWith('business_id', 'b1');
    expect(itemsBuilder.order.mock.calls[0][0]).toBe('position');
  });

  it('getMenu maps a failing items query', async () => {
    mocked.from.mockImplementation((table: string) =>
      table === 'menu_items' ? builder(pgError('42501', 'denied')) : builder(ok([])),
    );
    await expect(getMenu('b1')).rejects.toMatchObject({ code: 'unknown' });
  });

  it('getMenu maps a failing photos query', async () => {
    mocked.from.mockImplementation((table: string) =>
      table === 'business_photos' ? builder(pgError('P0001', 'no_business')) : builder(ok([])),
    );
    await expect(getMenu('b1')).rejects.toMatchObject({ code: 'no_business' });
  });
});

describe('errors from the rpc wrappers are MenuAppError', () => {
  it('rejects with the mapped code, not the raw database error', async () => {
    mocked.rpc.mockResolvedValue(pgError('P0001', 'item_limit'));
    const error = await createMenuItem({
      name: 'x',
      description: null,
      price_minor: null,
      is_available: true,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MenuAppError);
    expect((error as MenuAppError).code).toBe('item_limit');
  });

  it.each([
    ['set_menu_currency', () => setMenuCurrency('CAD')],
    [
      'update_menu_item',
      () =>
        updateMenuItem('i', {
          name: 'x',
          description: null,
          price_minor: null,
          is_available: true,
        }),
    ],
    ['move_menu_item', () => moveMenuItem('i', 'up')],
    ['delete_menu_item', () => deleteMenuItem('i')],
    ['begin_photo_upload', () => beginPhotoUpload('gallery')],
    ['finish_photo_upload', () => finishPhotoUpload('p')],
    ['delete_business_photo', () => deleteBusinessPhoto('p')],
    ['claim_photo_cleanup', () => claimPhotoCleanup()],
  ])('%s maps a P0001 not_found', async (_name, call) => {
    mocked.rpc.mockResolvedValue(pgError('P0001', 'not_found'));
    await expect(call()).rejects.toMatchObject({ name: 'MenuAppError', code: 'not_found' });
  });
});

describe('mapMenuError', () => {
  const p0001: MenuErrorCode[] = [
    'no_business',
    'item_limit',
    'photo_limit',
    'currency_required',
    'prices_exist',
    'not_found',
    'upload_missing',
    'invalid_input',
    'cleanup_required',
  ];

  it.each(p0001)('maps the P0001 message %s to the same code', (code) => {
    const mapped = mapMenuError({ code: 'P0001', message: code });
    expect(mapped).toBeInstanceOf(MenuAppError);
    expect(mapped.code).toBe(code);
  });

  it.each(['23514', '23503', '22P02'])('maps %s to invalid_input', (code) => {
    expect(mapMenuError({ code, message: 'violates constraint' }).code).toBe('invalid_input');
  });

  it('maps a network failure to network', () => {
    expect(mapMenuError({ message: 'Network request failed' }).code).toBe('network');
    expect(mapMenuError(new TypeError('Failed to fetch')).code).toBe('network');
  });

  it('maps an unknown P0001 message to unknown', () => {
    expect(mapMenuError({ code: 'P0001', message: 'something else' }).code).toBe('unknown');
  });

  it('maps other database codes to unknown', () => {
    expect(mapMenuError({ code: '42501', message: 'permission denied' }).code).toBe('unknown');
  });

  it('maps non-errors to unknown', () => {
    expect(mapMenuError(null).code).toBe('unknown');
    expect(mapMenuError(undefined).code).toBe('unknown');
    expect(mapMenuError('boom').code).toBe('unknown');
  });

  it('passes a MenuAppError through unchanged', () => {
    const original = new MenuAppError('prices_exist');
    expect(mapMenuError(original)).toBe(original);
  });

  it('handles a null details field without throwing', () => {
    expect(() => mapMenuError({ code: '', message: 'x', details: null })).not.toThrow();
  });

  it('carries only the code, never the upstream message', () => {
    const mapped = mapMenuError({ code: '23514', message: 'row (secret name) violates check' });
    expect(mapped.message).not.toContain('secret');
  });
});
