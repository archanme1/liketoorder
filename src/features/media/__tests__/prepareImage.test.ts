import { File } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';

import { MediaError } from '../errors';
import { assertNoHiddenMetadata, readJpegSegments } from '../jpegMetadata';
import { prepareImage } from '../prepareImage';

type Resize = { width?: number; height?: number };
type SaveOptions = { compress: number; format: string };

const LIMIT = 2097152;

function seg(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const EXIF_SEG = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]);
const PHOTOSHOP_SEG = seg(0xed, [...Array.from('Photoshop 3.0').map((c) => c.charCodeAt(0)), 0, 1]);

/** A valid clean JPEG (SOI, DQT, SOS, zero data, EOI), padded to exactly `size` bytes. */
function cleanJpeg(size = 64): Uint8Array {
  const head = [0xff, 0xd8, ...seg(0xdb, new Array(65).fill(1)), 0xff, 0xda, 0x00, 0x02];
  const bytes = new Uint8Array(Math.max(size, head.length + 2));
  bytes.set(head);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

/** A JPEG whose header carries the given metadata segments before DQT. Small image data + EOI. */
function jpegWithSegments(...extra: number[][]): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...extra.flat(),
    ...seg(0xdb, new Array(65).fill(1)),
    0xff,
    0xda,
    0x00,
    0x02,
    1,
    2,
    3,
    0xff,
    0xd9,
  ]);
}

function jpegWithExif(): Uint8Array {
  return jpegWithSegments(EXIF_SEG, PHOTOSHOP_SEG);
}

/** A JPEG that is over the 2 MB limit only because of many large APP1 blocks. */
function jpegBloatedByApp1(): Uint8Array {
  const blocks: number[][] = [];
  let total = 0;
  while (total <= LIMIT) {
    blocks.push(seg(0xe1, new Array(60_000).fill(7)));
    total += 60_004;
  }
  return jpegWithSegments(...blocks);
}

function markersOf(bytes: Uint8Array): number[] {
  return readJpegSegments(bytes).map((s) => s.marker);
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
    // Nothing to strip in a clean JPEG, so the stripped bytes equal the file bytes.
    expect(Array.from(result.bytes)).toEqual(Array.from(out));
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('returns the stripped bytes, not the raw bytes of the encoder file', async () => {
    mockManipulator(4000, 3000);
    const raw = jpegWithExif();
    bytesSpy.mockResolvedValue(raw);

    const result = await prepareImage('file:///picker/a.jpg');

    expect(result.bytes).not.toBe(raw);
    expect(result.bytes.byteLength).toBeLessThan(raw.byteLength);
    expect(markersOf(raw)).toEqual(expect.arrayContaining([0xe1, 0xed]));
    expect(markersOf(result.bytes)).not.toContain(0xe1);
    expect(markersOf(result.bytes)).not.toContain(0xed);
  });

  it('measures the 2 MB limit on the stripped bytes, so a bloated APP1 does not force a re-encode', async () => {
    const h = mockManipulator(4000, 3000);
    const raw = jpegBloatedByApp1();
    expect(raw.byteLength).toBeGreaterThan(LIMIT);
    bytesSpy.mockResolvedValue(raw);

    const result = await prepareImage('file:///picker/a.jpg');

    expect(h.saves.map((s) => s.compress)).toEqual([0.8]);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(LIMIT);
    expect(markersOf(result.bytes)).not.toContain(0xe1);
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
  it('succeeds when the encoder output carries EXIF and APP13, and returns bytes without them', async () => {
    mockManipulator(4000, 3000);
    bytesSpy.mockResolvedValue(jpegWithExif());

    const result = await prepareImage('file:///picker/a.jpg');

    expect(markersOf(result.bytes)).not.toContain(0xe1);
    expect(markersOf(result.bytes)).not.toContain(0xed);
    expect(() => assertNoHiddenMetadata(result.bytes)).not.toThrow();
  });

  it('strips the retry output too', async () => {
    const h = mockManipulator(4000, 3000);
    bytesSpy.mockImplementation(async () =>
      h.saves[h.saves.length - 1].compress === 0.8 ? cleanJpeg(LIMIT + 1) : jpegWithExif(),
    );

    const result = await prepareImage('file:///picker/a.jpg');

    expect(h.saves.map((s) => s.compress)).toEqual([0.8, 0.6]);
    expect(markersOf(result.bytes)).not.toContain(0xe1);
    expect(() => assertNoHiddenMetadata(result.bytes)).not.toThrow();
  });

  it('rejects output bytes that are not a JPEG', async () => {
    mockManipulator(4000, 3000);
    bytesSpy.mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));

    const error = await prepareImage('file:///picker/a.jpg').catch((e) => e);

    expect(error).toBeInstanceOf(MediaError);
    expect((error as MediaError).code).toBe('not_an_image');
  });
});
