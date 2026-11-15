import { File } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';
import { getCalendars } from 'expo-localization';

import { MediaError } from '@/features/media/errors';
import { stripJpegMetadata } from '@/features/media/jpegMetadata';
import { supabase } from '@/lib/supabase';

import { FoodLogAppError } from '../api';
import { phoneTimeZone, runFoodLogCleanup, uploadFoodLog } from '../uploadFoodLog';

// A faithful fake of the parts of supabase-js this flow uses. Storage records the bytes it gets
// and, like the real bucket, refuses an overwrite; finish refuses a reservation whose file is not
// there. The real prepareImage and media api run on top of the jest.setup.ts picker,
// manipulator and file-system fakes.
const mockRpc = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockLog: string[] = [];
const mockStore = new Map<string, Uint8Array>();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => mockRpc(name, args),
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: ArrayBuffer, options: unknown) =>
          mockUpload(bucket, path, body, options),
        remove: (paths: string[]) => mockRemove(bucket, paths),
      }),
    },
  },
}));

const RESERVATION = { id: 'log-1', path: 'u1/log-1.jpg' };
const LOG = {
  id: 'log-1',
  cuisine_code: 'IT',
  description: 'Pasta',
  is_public: true,
  local_date: '2026-11-14',
  created_at: '2026-11-14T12:00:00+00:00',
  path: 'u1/log-1.jpg',
  is_mine: true,
};
const INPUT = {
  sourceUri: 'file:///picker/original-with-gps.jpg',
  cuisineCode: 'IT',
  description: 'Pasta',
  isPublic: true,
};
const MANIPULATED_URI = 'file:///mock/manipulated.jpg';
const LIMIT = 2097152;

function seg(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}
const ascii = (text: string) => Array.from(text).map((c) => c.charCodeAt(0));
const DQT = seg(0xdb, new Array(65).fill(1));

/** A JPEG with an Exif block (carrying "GPS"), a DQT, a little image data and EOI. */
function jpegWithExif(fill: number): Uint8Array<ArrayBuffer> {
  const exif = seg(0xe1, [...ascii('Exif'), 0, 0, ...ascii('GPS 51.5N 0.1W')]);
  return new Uint8Array([
    0xff,
    0xd8,
    ...exif,
    ...DQT,
    0xff,
    0xda,
    0x00,
    0x02,
    fill,
    fill,
    0xff,
    0xd9,
  ]);
}

/** A clean JPEG padded to `size` bytes. */
function cleanJpeg(size: number): Uint8Array<ArrayBuffer> {
  const head = [0xff, 0xd8, ...DQT, 0xff, 0xda, 0x00, 0x02];
  const bytes = new Uint8Array(size);
  bytes.set(head);
  bytes.set([0xff, 0xd9], size - 2);
  return bytes;
}

/** Whether the bytes hold this ASCII text anywhere. */
function containsAscii(bytes: Uint8Array | undefined, text: string): boolean {
  const needle = ascii(text);
  const haystack = Array.from(bytes ?? []);
  return haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b));
}

const PICKED_BYTES = jpegWithExif(0x11);
const ENCODED_BYTES = jpegWithExif(0x22);
let encodedBytes: Uint8Array<ArrayBuffer> = ENCODED_BYTES;

function serverError(code: string) {
  return { data: null, error: { code: 'P0001', message: code, details: null } };
}

function rpcNames(): string[] {
  return mockRpc.mock.calls.map(([name]) => name as string);
}

beforeEach(() => {
  mockLog.length = 0;
  mockStore.clear();
  encodedBytes = ENCODED_BYTES;
  jest.spyOn(File.prototype, 'bytes').mockImplementation(async function (this: File) {
    return this.uri === MANIPULATED_URI ? encodedBytes : PICKED_BYTES;
  });
  jest
    .mocked(getCalendars)
    .mockReturnValue([
      { calendar: 'gregory', timeZone: 'UTC', uses24hourClock: false, firstWeekday: 1 },
    ] as ReturnType<typeof getCalendars>);

  mockRpc.mockReset().mockImplementation(async (name: string) => {
    mockLog.push(name);
    switch (name) {
      case 'begin_food_log_upload':
        return { data: RESERVATION, error: null };
      case 'finish_food_log_upload':
        return mockStore.has(`food-logs/${RESERVATION.path}`)
          ? { data: LOG, error: null }
          : serverError('upload_missing');
      case 'claim_food_log_cleanup':
        return { data: [], error: null };
      default:
        return { data: null, error: null };
    }
  });
  mockUpload
    .mockReset()
    .mockImplementation(
      async (bucket: string, path: string, body: ArrayBuffer, options?: { upsert?: boolean }) => {
        mockLog.push('upload');
        const key = `${bucket}/${path}`;
        if (options?.upsert !== false) {
          return { data: null, error: { message: 'the fake refuses upsert' } };
        }
        if (mockStore.has(key)) return { data: null, error: { message: 'already exists' } };
        mockStore.set(key, new Uint8Array(body.slice(0)));
        return { data: { path }, error: null };
      },
    );
  mockRemove.mockReset().mockImplementation(async (bucket: string, paths: string[]) => {
    mockLog.push('remove');
    for (const path of paths) mockStore.delete(`${bucket}/${path}`);
    return { data: [], error: null };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest
    .mocked(getCalendars)
    .mockReturnValue([
      { calendar: 'gregory', timeZone: 'UTC', uses24hourClock: false, firstWeekday: 1 },
    ] as ReturnType<typeof getCalendars>);
});

describe('the Storage fake', () => {
  it('refuses upsert: true, as an overwrite would be', async () => {
    const result = await supabase.storage
      .from('food-logs')
      .upload('u1/x.jpg', new ArrayBuffer(1), { upsert: true });
    expect(result.error).not.toBeNull();
  });
});

describe('uploadFoodLog: the happy path', () => {
  it('prepares, then begins, uploads and finishes, in that order', async () => {
    await expect(uploadFoodLog(INPUT)).resolves.toEqual(LOG);
    expect(mockLog).toEqual(['begin_food_log_upload', 'upload', 'finish_food_log_upload']);
    const manipulate = jest.mocked(ImageManipulator.manipulate);
    // The manipulator fake is shared by the file; its last call is this test's prepareImage.
    expect(manipulate.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mockRpc.mock.invocationCallOrder[0],
    );
  });

  it("uploads only prepareImage's stripped bytes, never the picked file", async () => {
    await uploadFoodLog(INPUT);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [bucket, path, , options] = mockUpload.mock.calls[0];
    expect(bucket).toBe('food-logs');
    expect(path).toBe(RESERVATION.path);
    expect(options).toEqual({ contentType: 'image/jpeg', upsert: false });

    const stored = mockStore.get('food-logs/u1/log-1.jpg');
    expect(stored).toEqual(stripJpegMetadata(ENCODED_BYTES));
    expect(stored).not.toEqual(PICKED_BYTES);
    expect(containsAscii(PICKED_BYTES, 'GPS')).toBe(true); // the check can see it
    expect(containsAscii(stored, 'GPS')).toBe(false);
    expect(containsAscii(stored, 'Exif')).toBe(false);
  });

  it("sends the phone's zone from getCalendars, and no date or time", async () => {
    jest.mocked(getCalendars).mockReturnValue([
      {
        calendar: 'gregory',
        timeZone: 'Pacific/Kiritimati',
        uses24hourClock: false,
        firstWeekday: 1,
      },
    ] as ReturnType<typeof getCalendars>);
    await uploadFoodLog(INPUT);
    const [, args] = mockRpc.mock.calls[0];
    expect(args).toEqual({
      p_cuisine_code: 'IT',
      p_description: 'Pasta',
      p_is_public: true,
      p_time_zone: 'Pacific/Kiritimati',
    });
  });

  it('falls back to the Intl zone when the calendar has none', () => {
    jest
      .mocked(getCalendars)
      .mockReturnValue([
        { calendar: 'gregory', timeZone: null, uses24hourClock: false, firstWeekday: 1 },
      ] as ReturnType<typeof getCalendars>);
    expect(phoneTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  });
});

describe('uploadFoodLog: a bad photo uses no daily start', () => {
  it('a photo too large even at the lower quality never calls begin', async () => {
    encodedBytes = cleanJpeg(LIMIT + 1);
    await expect(uploadFoodLog(INPUT)).rejects.toEqual(new MediaError('too_large'));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('a file that is not an image never calls begin', async () => {
    encodedBytes = new Uint8Array([1, 2, 3, 4]);
    await expect(uploadFoodLog(INPUT)).rejects.toEqual(new MediaError('not_an_image'));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('uploadFoodLog: failures after begin', () => {
  it('an upload failure deletes the pending log, then runs the cleanup', async () => {
    mockUpload.mockResolvedValueOnce({ data: null, error: { message: 'storage down' } });
    await expect(uploadFoodLog(INPUT)).rejects.toEqual(new MediaError('upload_failed'));
    expect(rpcNames()).toEqual([
      'begin_food_log_upload',
      'delete_food_log',
      'claim_food_log_cleanup',
    ]);
    expect(mockRpc).toHaveBeenCalledWith('delete_food_log', { p_id: 'log-1' });
  });

  it('a finish failure deletes the pending log and removes the uploaded file', async () => {
    const original = mockRpc.getMockImplementation();
    let claims = 0;
    mockRpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'finish_food_log_upload') return serverError('upload_missing');
      if (name === 'claim_food_log_cleanup') {
        claims += 1;
        return { data: claims === 1 ? [RESERVATION.path] : [], error: null };
      }
      return original?.(name, args);
    });
    await expect(uploadFoodLog(INPUT)).rejects.toEqual(new FoodLogAppError('upload_missing'));
    expect(rpcNames()).toEqual([
      'begin_food_log_upload',
      'finish_food_log_upload',
      'delete_food_log',
      'claim_food_log_cleanup',
      'claim_food_log_cleanup',
    ]);
    expect(mockRemove).toHaveBeenCalledWith('food-logs', [RESERVATION.path]);
    expect(mockStore.size).toBe(0);
  });
});

describe('uploadFoodLog: cleanup_required', () => {
  it('runs the cleanup and retries begin once', async () => {
    const original = mockRpc.getMockImplementation();
    let begins = 0;
    let claims = 0;
    mockRpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'begin_food_log_upload') {
        begins += 1;
        if (begins === 1) return serverError('cleanup_required');
      }
      if (name === 'claim_food_log_cleanup') {
        claims += 1;
        return { data: claims === 1 ? ['u1/old.jpg'] : [], error: null };
      }
      return original?.(name, args);
    });
    await expect(uploadFoodLog(INPUT)).resolves.toEqual(LOG);
    expect(rpcNames()).toEqual([
      'begin_food_log_upload',
      'claim_food_log_cleanup',
      'claim_food_log_cleanup',
      'begin_food_log_upload',
      'finish_food_log_upload',
    ]);
    expect(mockRemove).toHaveBeenCalledWith('food-logs', ['u1/old.jpg']);
  });

  it('a second cleanup_required reaches the caller (no loop)', async () => {
    const original = mockRpc.getMockImplementation();
    mockRpc.mockImplementation(async (name: string, args: unknown) =>
      name === 'begin_food_log_upload' ? serverError('cleanup_required') : original?.(name, args),
    );
    await expect(uploadFoodLog(INPUT)).rejects.toEqual(new FoodLogAppError('cleanup_required'));
    expect(rpcNames().filter((name) => name === 'begin_food_log_upload')).toHaveLength(2);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('runFoodLogCleanup', () => {
  it('two calls at once share one run; a later call starts a new one', async () => {
    const original = mockRpc.getMockImplementation();
    let claims = 0;
    mockRpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'claim_food_log_cleanup') {
        claims += 1;
        return { data: claims === 1 ? ['u1/old.jpg'] : [], error: null };
      }
      return original?.(name, args);
    });
    const first = runFoodLogCleanup();
    const second = runFoodLogCleanup();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    // One run: claim, remove, claim.
    expect(rpcNames()).toEqual(['claim_food_log_cleanup', 'claim_food_log_cleanup']);
    expect(mockRemove).toHaveBeenCalledTimes(1);

    const third = runFoodLogCleanup();
    expect(third).not.toBe(first);
    await third;
    expect(rpcNames()).toHaveLength(3);
  });

  it('a failed removal still finishes quietly and claims again', async () => {
    const original = mockRpc.getMockImplementation();
    mockRpc.mockImplementation(async (name: string, args: unknown) =>
      name === 'claim_food_log_cleanup'
        ? { data: ['u1/old.jpg'], error: null }
        : original?.(name, args),
    );
    mockRemove.mockImplementation(async () => {
      mockLog.push('remove');
      return { data: null, error: { message: 'storage is down' } };
    });
    await expect(runFoodLogCleanup()).resolves.toBeUndefined();
    expect(mockRemove).toHaveBeenCalledWith('food-logs', ['u1/old.jpg']);
    expect(rpcNames()).toEqual(['claim_food_log_cleanup', 'claim_food_log_cleanup']);
    expect(mockRemove.mock.invocationCallOrder[0]).toBeLessThan(
      mockRpc.mock.invocationCallOrder[1],
    );
  });

  it('a failed claim finishes quietly too', async () => {
    mockRpc.mockImplementation(async () => ({
      data: null,
      error: { code: '', message: 'TypeError: Network request failed', details: null },
    }));
    await expect(runFoodLogCleanup()).resolves.toBeUndefined();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
