import { MediaError } from '../errors';
import {
  assertNoHiddenMetadata,
  readExifOrientation,
  readJpegSegments,
  stripJpegMetadata,
} from '../jpegMetadata';

// The app's tsconfig loads no Node types, so the Node calls are typed here (as in
// jpegMetadata.test.ts). __dirname is set by jest's module wrapper.
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readFileSync } = require('fs') as { readFileSync: (path: string) => Uint8Array };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require('path') as { join: (...segments: string[]) => string };

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
}

function ascii(text: string): number[] {
  return Array.from(text).map((c) => c.charCodeAt(0));
}

/** A JPEG segment: FF <marker> <2-byte length incl. itself> <payload>. */
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const SOS = [0xff, 0xda, 0x00, 0x02];
// Entropy-coded data, including a stuffed FF 00 that must be copied untouched.
const DATA = [0x12, 0x34, 0xff, 0x00, 0x56, 0x78, 0x9a];

const JFIF = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const ICC = segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9, 9]);
const MPF = segment(0xe2, [...ascii('MPF'), 0, 1, 2, 3, 4, 5]);
const EXIF = segment(0xe1, [...ascii('Exif'), 0, 0, 1, 2, 3, 4]);
const XMP = segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, 60, 60]);
const PHOTOSHOP = segment(0xed, [...ascii('Photoshop 3.0'), 0, 1, 2, 3]);
const APP5 = segment(0xe5, [...ascii('Other'), 0, 1, 2]);
const COM = segment(0xfe, ascii('a comment'));
const DQT = segment(0xdb, new Array(65).fill(1));
const SOF = segment(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
const DHT = segment(0xc4, [0, ...new Array(16).fill(0), 1, 2, 3]);

function jpeg(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

function catchError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectNotAnImage(bytes: Uint8Array) {
  const error = catchError(() => stripJpegMetadata(bytes));
  expect(error).toBeInstanceOf(MediaError);
  expect((error as MediaError).code).toBe('not_an_image');
}

function markers(bytes: Uint8Array): number[] {
  return readJpegSegments(bytes).map((s) => s.marker);
}

/** Index of the SOS marker, found by walking the segment lengths from SOI. */
function sosOffset(bytes: Uint8Array): number {
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('bad test jpeg');
    if (bytes[i + 1] === 0xda) return i;
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  throw new Error('no SOS');
}

function endsWith(bytes: Uint8Array, tail: Uint8Array): boolean {
  if (tail.length > bytes.length) return false;
  const start = bytes.length - tail.length;
  return tail.every((b, i) => bytes[start + i] === b);
}

const BASE = [SOI, JFIF, DQT, SOF, DHT, SOS, DATA, EOI];

describe('stripJpegMetadata: committed fixtures', () => {
  it.each(['exif-gps.jpg', 'xmp-gps.jpg'])(
    'gives bytes that pass assertNoHiddenMetadata for %s',
    (name) => {
      const input = fixture(name);
      expect(() => assertNoHiddenMetadata(input)).toThrow();

      const out = stripJpegMetadata(input);

      expect(() => assertNoHiddenMetadata(out)).not.toThrow();
      expect(markers(out)).not.toContain(0xe1);
    },
  );

  it.each(['exif-gps.jpg', 'xmp-gps.jpg', 'clean.jpg'])(
    'keeps the bytes from SOS through EOI identical for %s',
    (name) => {
      const input = fixture(name);
      const out = stripJpegMetadata(input);

      const inStart = sosOffset(input);
      const outStart = sosOffset(out);
      // Input's SOS..first EOI (FF D9 cannot occur inside entropy data, where FF is stuffed).
      let eoi = inStart;
      while (!(input[eoi] === 0xff && input[eoi + 1] === 0xd9)) eoi += 1;
      const inTail = input.slice(inStart, eoi + 2);
      const outTail = out.slice(outStart);
      expect(Array.from(outTail)).toEqual(Array.from(inTail));
    },
  );

  it('starts with FF D8, ends with FF D9, and keeps SOF, DQT and DHT', () => {
    const out = stripJpegMetadata(fixture('exif-gps.jpg'));

    expect(Array.from(out.slice(0, 2))).toEqual(SOI);
    expect(Array.from(out.slice(-2))).toEqual(EOI);
    const found = markers(out);
    expect(found).toContain(0xdb);
    expect(found).toContain(0xc4);
    expect(found.some((m) => m === 0xc0 || m === 0xc1 || m === 0xc2)).toBe(true);
  });

  it('is smaller than the input when metadata is removed', () => {
    const input = fixture('exif-gps.jpg');
    expect(stripJpegMetadata(input).length).toBeLessThan(input.length);
  });
});

describe('stripJpegMetadata: segment rules on hand-built JPEGs', () => {
  it('keeps JFIF (APP0) and ICC_PROFILE (APP2)', () => {
    const out = stripJpegMetadata(jpeg(SOI, JFIF, ICC, DQT, SOF, DHT, SOS, DATA, EOI));

    const segments = readJpegSegments(out);
    expect(segments.map((s) => s.marker)).toEqual(expect.arrayContaining([0xe0, 0xe2]));
    expect(segments.find((s) => s.marker === 0xe2)?.id).toBe('ICC_PROFILE');
    expect(() => assertNoHiddenMetadata(out)).not.toThrow();
  });

  it('keeps SOF, DQT and DHT', () => {
    const out = stripJpegMetadata(jpeg(...BASE));
    const found = markers(out);
    expect(found).toEqual(expect.arrayContaining([0xc0, 0xdb, 0xc4]));
  });

  it('drops APP1 Exif and APP1 XMP', () => {
    const out = stripJpegMetadata(jpeg(SOI, JFIF, EXIF, XMP, DQT, SOF, DHT, SOS, DATA, EOI));
    expect(markers(out)).not.toContain(0xe1);
  });

  it('drops APP13 Photoshop 3.0', () => {
    const out = stripJpegMetadata(jpeg(SOI, JFIF, PHOTOSHOP, DQT, SOF, DHT, SOS, DATA, EOI));
    expect(markers(out)).not.toContain(0xed);
  });

  it('drops another APPn', () => {
    const out = stripJpegMetadata(jpeg(SOI, JFIF, APP5, DQT, SOF, DHT, SOS, DATA, EOI));
    expect(markers(out)).not.toContain(0xe5);
  });

  it('drops COM', () => {
    const out = stripJpegMetadata(jpeg(SOI, JFIF, COM, DQT, SOF, DHT, SOS, DATA, EOI));
    expect(markers(out)).not.toContain(0xfe);
  });

  it('drops an APP2 MPF segment but keeps the APP2 ICC_PROFILE next to it', () => {
    const out = stripJpegMetadata(jpeg(SOI, JFIF, MPF, ICC, DQT, SOF, DHT, SOS, DATA, EOI));

    const app2 = readJpegSegments(out).filter((s) => s.marker === 0xe2);
    expect(app2).toHaveLength(1);
    expect(app2[0].id).toBe('ICC_PROFILE');
    expect(() => assertNoHiddenMetadata(out)).not.toThrow();
  });

  it('passes the strict check when every kind of metadata segment is present together', () => {
    const out = stripJpegMetadata(
      jpeg(SOI, JFIF, EXIF, XMP, MPF, ICC, PHOTOSHOP, APP5, COM, DQT, SOF, DHT, SOS, DATA, EOI),
    );
    expect(() => assertNoHiddenMetadata(out)).not.toThrow();
  });

  it('copies SOS through EOI byte for byte, including stuffed FF 00 bytes', () => {
    const out = stripJpegMetadata(jpeg(SOI, EXIF, JFIF, DQT, SOF, DHT, SOS, DATA, EOI));

    expect(endsWith(out, new Uint8Array([...SOS, ...DATA, ...EOI]))).toBe(true);
  });

  it('starts with FF D8 and ends with FF D9', () => {
    const out = stripJpegMetadata(jpeg(SOI, EXIF, DQT, SOF, DHT, SOS, DATA, EOI));
    expect(Array.from(out.slice(0, 2))).toEqual(SOI);
    expect(Array.from(out.slice(-2))).toEqual(EOI);
  });

  it('drops bytes after the first EOI', () => {
    const trailer = [...EOI.slice(0, 0), 0xff, 0xd8, ...EXIF, 0x01, 0x02, ...EOI, 0x99];
    const out = stripJpegMetadata(jpeg(SOI, JFIF, DQT, SOF, DHT, SOS, DATA, EOI, trailer));

    expect(Array.from(out)).toEqual([
      ...SOI,
      ...JFIF,
      ...DQT,
      ...SOF,
      ...DHT,
      ...SOS,
      ...DATA,
      ...EOI,
    ]);
  });

  it('leaves a JPEG that has nothing to strip unchanged', () => {
    const input = jpeg(...BASE);
    expect(Array.from(stripJpegMetadata(input))).toEqual(Array.from(input));
  });

  it('is idempotent: stripping twice gives the same bytes', () => {
    const once = stripJpegMetadata(
      jpeg(SOI, JFIF, EXIF, XMP, MPF, ICC, PHOTOSHOP, COM, DQT, SOF, DHT, SOS, DATA, EOI),
    );
    const twice = stripJpegMetadata(once);
    expect(Array.from(twice)).toEqual(Array.from(once));
  });

  it('is idempotent on a real fixture', () => {
    const once = stripJpegMetadata(fixture('exif-gps.jpg'));
    expect(Array.from(stripJpegMetadata(once))).toEqual(Array.from(once));
  });

  it('does not modify its input', () => {
    const input = jpeg(SOI, EXIF, DQT, SOF, DHT, SOS, DATA, EOI);
    const copy = Array.from(input);
    stripJpegMetadata(input);
    expect(Array.from(input)).toEqual(copy);
  });
});

describe('stripJpegMetadata: invalid input', () => {
  it('rejects non-JPEG bytes as not_an_image', () => {
    expectNotAnImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('rejects empty input as not_an_image', () => {
    expectNotAnImage(new Uint8Array([]));
  });

  it('rejects a header cut short in the middle of a segment', () => {
    expectNotAnImage(jpeg(SOI, JFIF, DQT.slice(0, 20)));
  });

  it('rejects input that ends before SOS', () => {
    expectNotAnImage(jpeg(SOI, JFIF, DQT, SOF, DHT));
  });

  it('rejects input that has SOS but no EOI', () => {
    expectNotAnImage(jpeg(SOI, JFIF, DQT, SOF, DHT, SOS, DATA));
  });

  it('rejects input that is only SOI', () => {
    expectNotAnImage(jpeg(SOI));
  });
});

/** A little- or big-endian Exif APP1 whose IFD0 holds one Orientation entry. */
function exifWithOrientation(value: number, endian: 'II' | 'MM'): number[] {
  const le = endian === 'II';
  const u16 = (n: number) => (le ? [n & 0xff, (n >> 8) & 0xff] : [(n >> 8) & 0xff, n & 0xff]);
  const u32 = (n: number) =>
    le
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
      : [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const tiff = [
    ...ascii(endian),
    ...u16(42),
    ...u32(8),
    ...u16(1), // one entry
    ...u16(0x0112), // Orientation
    ...u16(3), // SHORT
    ...u32(1),
    ...u16(value),
    0,
    0,
    ...u32(0), // no next IFD
  ];
  return segment(0xe1, [...ascii('Exif'), 0, 0, ...tiff]);
}

describe('readExifOrientation', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('reads %i from a little-endian (II) Exif', (value) => {
    const bytes = jpeg(SOI, exifWithOrientation(value, 'II'), DQT, SOF, DHT, SOS, DATA, EOI);
    expect(readExifOrientation(bytes)).toBe(value);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('reads %i from a big-endian (MM) Exif', (value) => {
    const bytes = jpeg(SOI, exifWithOrientation(value, 'MM'), DQT, SOF, DHT, SOS, DATA, EOI);
    expect(readExifOrientation(bytes)).toBe(value);
  });

  it('finds the Exif segment when JFIF comes first', () => {
    const bytes = jpeg(SOI, JFIF, exifWithOrientation(6, 'MM'), DQT, SOF, SOS, DATA, EOI);
    expect(readExifOrientation(bytes)).toBe(6);
  });

  it('returns null when there is no Exif', () => {
    expect(readExifOrientation(jpeg(...BASE))).toBeNull();
  });

  it('returns null when the only APP1 is XMP', () => {
    expect(readExifOrientation(jpeg(SOI, XMP, DQT, SOF, DHT, SOS, DATA, EOI))).toBeNull();
  });

  it('returns null for the XMP-GPS fixture and the clean fixture', () => {
    expect(readExifOrientation(fixture('xmp-gps.jpg'))).toBeNull();
    expect(readExifOrientation(fixture('clean.jpg'))).toBeNull();
  });

  it('returns null when the Exif TIFF block is truncated', () => {
    const truncated = segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii('II'), 42, 0, 8, 0]);
    expect(readExifOrientation(jpeg(SOI, truncated, DQT, SOF, SOS, DATA, EOI))).toBeNull();
  });

  it('returns null when the byte-order mark is invalid', () => {
    const good = exifWithOrientation(6, 'II');
    const bad = good.slice();
    // Header is FF E1 len len "Exif" 0 0, then the byte-order mark.
    bad[10] = 0x58;
    bad[11] = 0x58;
    expect(readExifOrientation(jpeg(SOI, bad, DQT, SOF, SOS, DATA, EOI))).toBeNull();
  });

  it('returns null when the IFD offset points outside the segment', () => {
    const bad = segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii('II'), 42, 0, 0xff, 0xff, 0, 0]);
    expect(readExifOrientation(jpeg(SOI, bad, DQT, SOF, SOS, DATA, EOI))).toBeNull();
  });

  it('returns null for non-JPEG bytes', () => {
    expect(readExifOrientation(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
