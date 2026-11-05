import { MediaError } from '../errors';
import { assertNoHiddenMetadata } from '../jpegMetadata';

// The app's tsconfig loads no Node types, so the Node calls are typed here (as in
// src/lib/__tests__/supabaseConfig.test.ts). __dirname is set by jest's module wrapper.
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
const DQT = segment(0xdb, new Array(65).fill(1));
const SOS = [0xff, 0xda, 0x00, 0x02];

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

function expectRejected(bytes: Uint8Array, code: 'metadata_present' | 'not_an_image') {
  const error = catchError(() => assertNoHiddenMetadata(bytes));
  expect(error).toBeInstanceOf(MediaError);
  expect((error as MediaError).code).toBe(code);
}

const JFIF = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const ICC = segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9, 9]);
const ADOBE = segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]);

describe('assertNoHiddenMetadata: committed fixtures', () => {
  it('accepts the clean fixture (no APPn segments)', () => {
    expect(() => assertNoHiddenMetadata(fixture('clean.jpg'))).not.toThrow();
  });

  it('rejects the EXIF-with-GPS fixture as metadata_present', () => {
    expectRejected(fixture('exif-gps.jpg'), 'metadata_present');
  });

  it('rejects the XMP-with-GPS fixture (no EXIF) as metadata_present', () => {
    expectRejected(fixture('xmp-gps.jpg'), 'metadata_present');
  });

  it('names the blocking segment on the error for the EXIF fixture', () => {
    const error = catchError(() => assertNoHiddenMetadata(fixture('exif-gps.jpg')));
    expect((error as MediaError).marker).toMatch(/APP1/);
  });
});

describe('assertNoHiddenMetadata: hand-built segments', () => {
  it('accepts JFIF (APP0) + ICC (APP2) + Adobe (APP14) ending in SOS', () => {
    expect(() => assertNoHiddenMetadata(jpeg(SOI, JFIF, ICC, ADOBE, DQT, SOS))).not.toThrow();
  });

  it('accepts each allowed segment on its own', () => {
    expect(() => assertNoHiddenMetadata(jpeg(SOI, JFIF, DQT, SOS))).not.toThrow();
    expect(() => assertNoHiddenMetadata(jpeg(SOI, ICC, DQT, SOS))).not.toThrow();
    expect(() => assertNoHiddenMetadata(jpeg(SOI, ADOBE, DQT, SOS))).not.toThrow();
  });

  it('rejects an APP1 Exif segment', () => {
    const exif = segment(0xe1, [...ascii('Exif'), 0, 0, 1, 2, 3, 4]);
    expectRejected(jpeg(SOI, exif, DQT, SOS), 'metadata_present');
  });

  it('rejects an APP1 XMP segment', () => {
    const xmp = segment(0xe1, [
      ...ascii('http://ns.adobe.com/xap/1.0/'),
      0,
      ...ascii('<x:xmpmeta/>'),
    ]);
    expectRejected(jpeg(SOI, xmp, DQT, SOS), 'metadata_present');
  });

  it('rejects an APP13 (IPTC / Photoshop) segment', () => {
    const iptc = segment(0xed, [...ascii('Photoshop 3.0'), 0, 1, 2, 3]);
    expectRejected(jpeg(SOI, iptc, DQT, SOS), 'metadata_present');
  });

  it('rejects a COM comment segment', () => {
    const comment = segment(0xfe, ascii('taken at 12 Main Street'));
    expectRejected(jpeg(SOI, comment, DQT, SOS), 'metadata_present');
  });

  it.each([
    ['APP3', 0xe3],
    ['APP4', 0xe4],
    ['APP12', 0xec],
    ['APP15', 0xef],
  ])('rejects another APPn segment (%s)', (_name, marker) => {
    expectRejected(jpeg(SOI, segment(marker, [1, 2, 3, 4]), DQT, SOS), 'metadata_present');
  });

  it('rejects hidden metadata that comes after allowed segments', () => {
    const exif = segment(0xe1, [...ascii('Exif'), 0, 0, 1, 2]);
    expectRejected(jpeg(SOI, JFIF, ICC, ADOBE, exif, DQT, SOS), 'metadata_present');
  });

  it('rejects a comment placed after the quantisation table', () => {
    expectRejected(jpeg(SOI, JFIF, DQT, segment(0xfe, ascii('hi')), SOS), 'metadata_present');
  });
});

describe('assertNoHiddenMetadata: not a valid JPEG', () => {
  it('rejects PNG bytes as not_an_image', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expectRejected(png, 'not_an_image');
  });

  it('rejects arbitrary text bytes as not_an_image', () => {
    expectRejected(new Uint8Array(ascii('hello, this is not a photo')), 'not_an_image');
  });

  it('rejects empty input as not_an_image', () => {
    expectRejected(new Uint8Array([]), 'not_an_image');
  });

  it('rejects a single byte as not_an_image', () => {
    expectRejected(new Uint8Array([0xff]), 'not_an_image');
  });

  it('rejects a file that never reaches SOS (truncated after SOI + DQT)', () => {
    expectRejected(jpeg(SOI, DQT), 'not_an_image');
  });

  it('rejects a segment whose declared length runs past the end of the data', () => {
    const truncated = jpeg(SOI, [0xff, 0xe0, 0x00, 0x40, ...ascii('JFIF'), 0]);
    expectRejected(truncated, 'not_an_image');
  });

  it('rejects SOI alone', () => {
    expectRejected(jpeg(SOI), 'not_an_image');
  });
});
