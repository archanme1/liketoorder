import { File } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';

import { MediaError } from '../errors';
import { prepareImage } from '../prepareImage';

type Resize = { width?: number; height?: number };
type SaveOptions = { compress: number; format: string };

const LIMIT = 2097152;

function seg(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/** A valid clean JPEG header (SOI, DQT, SOS), padded after SOS to `size` bytes. */
function cleanJpeg(size = 64): Uint8Array {
  const head = [0xff, 0xd8, ...seg(0xdb, new Array(65).fill(1)), 0xff, 0xda, 0x00, 0x02];
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head);
  return bytes;
}

function jpegWithExif(): Uint8Array {
  const head = [
    0xff,
    0xd8,
    ...seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]),
    ...seg(0xdb, new Array(65).fill(1)),
    0xff,
    0xda,
    0x00,
    0x02,
  ];
  return new Uint8Array(head);
}

type Harness = {
  resizes: Resize[];
  saves: SaveOptions[];
  released: jest.Mock;
};

/**
 * Fakes the manipulator for a source of `srcW` x `srcH`. Contexts that were resized render at the
 * scaled size; others render at the source size. Records every resize and every saveAsync call.
 */
function mockManipulator(srcW: number, srcH: number): Harness {
  const harness: Harness = { resizes: [], saves: [], released: jest.fn() };
  jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
    let w = srcW;
    let h = srcH;
    const context: { resize: jest.Mock; renderAsync: jest.Mock; reset: jest.Mock } = {
      resize: jest.fn((size: Resize) => {
        harness.resizes.push(size);
        if (size.width !== undefined) {
          h = Math.round((srcH * size.width) / srcW);
          w = size.width;
        } else if (size.height !== undefined) {
          w = Math.round((srcW * size.height) / srcH);
          h = size.height;
        }
        return context;
      }),
      renderAsync: jest.fn(async () => {
        const width = w;
        const height = h;
        return {
          width,
          height,
          saveAsync: jest.fn(async (options: SaveOptions) => {
            harness.saves.push(options);
            return { uri: 'file:///mock/out.jpg', width, height };
          }),
          release: harness.released,
        };
      }),
      reset: jest.fn(() => context),
    };
    return context as unknown as ReturnType<typeof ImageManipulator.manipulate>;
  });
  return harness;
}

let bytesSpy: jest.SpyInstance;

beforeEach(() => {
  bytesSpy = jest.spyOn(File.prototype, 'bytes');
});

afterEach(() => {
  bytesSpy.mockRestore();
  jest.mocked(ImageManipulator.manipulate).mockReset();
});

describe('prepareImage: resizing', () => {
  it('asks for a long edge of exactly 1600 px on a larger landscape image', async () => {
    const h = mockManipulator(4000, 3000);
    bytesSpy.mockResolvedValue(cleanJpeg());

    const result = await prepareImage('file:///picker/big.jpg');

    expect(h.resizes).toEqual([{ width: 1600 }]);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1200);
  });

  it('asks for a long edge of exactly 1600 px on a larger portrait image', async () => {
    const h = mockManipulator(3000, 4000);
    bytesSpy.mockResolvedValue(cleanJpeg());

    const result = await prepareImage('file:///picker/tall.jpg');

    expect(h.resizes).toEqual([{ height: 1600 }]);
    expect(result.height).toBe(1600);
    expect(result.width).toBe(1200);
  });

  it('does not resize a smaller image and never upscales', async () => {
    const h = mockManipulator(800, 600);
    bytesSpy.mockResolvedValue(cleanJpeg());

    const result = await prepareImage('file:///picker/small.jpg');

    expect(h.resizes).toEqual([]);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('leaves an image whose long edge is exactly 1600 px alone', async () => {
    const h = mockManipulator(1600, 900);
    bytesSpy.mockResolvedValue(cleanJpeg());

    await prepareImage('file:///picker/exact.jpg');

    expect(h.resizes).toEqual([]);
  });

  it('keeps the aspect ratio of the resized output', async () => {
    mockManipulator(4032, 3024);
    bytesSpy.mockResolvedValue(cleanJpeg());

    const result = await prepareImage('file:///picker/phone.jpg');

    expect(result.width).toBe(1600);
    expect(result.width / result.height).toBeCloseTo(4032 / 3024, 2);
  });
});

describe('prepareImage: encoding', () => {
  it('encodes JPEG at quality 0.8', async () => {
    const h = mockManipulator(4000, 3000);
    bytesSpy.mockResolvedValue(cleanJpeg());

    await prepareImage('file:///picker/a.jpg');

    expect(h.saves).toHaveLength(1);
    expect(h.saves[0].compress).toBe(0.8);
    expect(String(h.saves[0].format).toLowerCase()).toBe('jpeg');
  });

  it('returns the output file uri, the bytes read from it, and image/jpeg', async () => {
    mockManipulator(4000, 3000);
    const out = cleanJpeg(200);
    const readUris: string[] = [];
    bytesSpy.mockImplementation(async function (this: File) {
      readUris.push(this.uri);
      return out;
    });

    const result = await prepareImage('file:///picker/a.jpg');

    expect(readUris).toContain('file:///mock/out.jpg');
    expect(readUris).not.toContain('file:///picker/a.jpg');
    expect(result.uri).toBe('file:///mock/out.jpg');
    expect(result.bytes).toBe(out);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('does not re-encode when the output is within 2 097 152 bytes', async () => {
    const h = mockManipulator(4000, 3000);
    bytesSpy.mockResolvedValue(cleanJpeg(LIMIT));

    await prepareImage('file:///picker/a.jpg');

    expect(h.saves.map((s) => s.compress)).toEqual([0.8]);
  });

  it('re-encodes once at 0.6 when the 0.8 output is over 2 097 152 bytes', async () => {
    const h = mockManipulator(4000, 3000);
    bytesSpy.mockImplementation(async () =>
      h.saves[h.saves.length - 1].compress === 0.8 ? cleanJpeg(LIMIT + 1) : cleanJpeg(500_000),
    );

    const result = await prepareImage('file:///picker/a.jpg');

    expect(h.saves.map((s) => s.compress)).toEqual([0.8, 0.6]);
    expect(result.bytes.byteLength).toBe(500_000);
  });

  it('fails with too_large when the 0.6 output is still over the limit', async () => {
    const h = mockManipulator(4000, 3000);
    bytesSpy.mockResolvedValue(cleanJpeg(LIMIT + 1));

    const error = await prepareImage('file:///picker/a.jpg').catch((e) => e);

    expect(error).toBeInstanceOf(MediaError);
    expect((error as MediaError).code).toBe('too_large');
    expect(h.saves.map((s) => s.compress)).toEqual([0.8, 0.6]);
  });
});

describe('prepareImage: metadata check on the output bytes', () => {
  it('throws metadata_present when the output still carries EXIF', async () => {
    mockManipulator(4000, 3000);
    bytesSpy.mockResolvedValue(jpegWithExif());

    const error = await prepareImage('file:///picker/a.jpg').catch((e) => e);

    expect(error).toBeInstanceOf(MediaError);
    expect((error as MediaError).code).toBe('metadata_present');
  });

  it('checks the retry output too', async () => {
    const h = mockManipulator(4000, 3000);
    bytesSpy.mockImplementation(async () =>
      h.saves[h.saves.length - 1].compress === 0.8 ? cleanJpeg(LIMIT + 1) : jpegWithExif(),
    );

    const error = await prepareImage('file:///picker/a.jpg').catch((e) => e);

    expect((error as MediaError).code).toBe('metadata_present');
  });

  it('rejects output bytes that are not a JPEG', async () => {
    mockManipulator(4000, 3000);
    bytesSpy.mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));

    const error = await prepareImage('file:///picker/a.jpg').catch((e) => e);

    expect(error).toBeInstanceOf(MediaError);
    expect((error as MediaError).code).toBe('not_an_image');
  });
});
