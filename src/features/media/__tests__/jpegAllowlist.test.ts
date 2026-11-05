import { MediaError } from '../errors';
import { assertNoHiddenMetadata, stripJpegMetadata } from '../jpegMetadata';

// The app's tsconfig loads no Node types, so the Node calls are typed here (as in
// stripJpegMetadata.test.ts). __dirname is set by jest's module wrapper.
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
const DATA2 = [0x21, 0x43, 0xff, 0x00, 0x65, 0x87];

const JFIF = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const ICC = segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9, 9]);
const EXIF = segment(0xe1, [...ascii('Exif'), 0, 0, 1, 2, 3, 4]);
const XMP = segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, 60, 60]);
const COM = segment(0xfe, ascii('secret-comment'));
const APP13 = segment(0xed, [...ascii('Photoshop 3.0'), 0, 1, 2, 3]);
const DQT = segment(0xdb, new Array(65).fill(1));
const SOF0 = segment(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
const SOF2 = segment(0xc2, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
const DHT = segment(0xc4, [0, ...new Array(16).fill(0), 1, 2, 3]);
const DRI = segment(0xdd, [0, 2]);

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

function expectCode(fn: () => void, code: string) {
  const error = catchError(fn);
  expect(error).toBeInstanceOf(MediaError);
  expect((error as MediaError).code).toBe(code);
}

function expectNotAnImageBoth(bytes: Uint8Array) {
  expectCode(() => stripJpegMetadata(bytes), 'not_an_image');
  expectCode(() => assertNoHiddenMetadata(bytes), 'not_an_image');
}

function list(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}

function indexOfSeq(bytes: Uint8Array, seq: number[], from = 0): number {
  for (let i = from; i + seq.length <= bytes.length; i += 1) {
    if (seq.every((b, k) => bytes[i + k] === b)) return i;
  }
  return -1;
}

function firstSos(bytes: Uint8Array): number {
  const i = indexOfSeq(bytes, [0xff, 0xda]);
  if (i < 0) throw new Error('no SOS');
  return i;
}

/** SOS..first EOI of the input (FF D9 cannot occur in entropy data, where FF is stuffed). */
function sosThroughEoi(bytes: Uint8Array): number[] {
  const start = firstSos(bytes);
  const eoi = indexOfSeq(bytes, EOI, start);
  return list(bytes.slice(start, eoi + 2));
}

function endsWithEoi(bytes: Uint8Array): boolean {
  return bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

describe('allowlist: inputs accepted by both functions and kept by the strip', () => {
  it.each(['clean.jpg', 'progressive.jpg', 'restart.jpg'])(
    'fixture %s passes the check and keeps SOS..EOI, ending in EOI',
    (name) => {
      const input = fixture(name);

      expect(() => assertNoHiddenMetadata(input)).not.toThrow();
      const out = stripJpegMetadata(input);

      expect(() => assertNoHiddenMetadata(out)).not.toThrow();
      expect(endsWithEoi(out)).toBe(true);
      expect(list(out.slice(firstSos(out)))).toEqual(sosThroughEoi(input));
    },
  );

  it.each(['clean.jpg', 'progressive.jpg', 'restart.jpg'])(
    'strip is idempotent for fixture %s',
    (name) => {
      const once = stripJpegMetadata(fixture(name));
      expect(list(stripJpegMetadata(once))).toEqual(list(once));
    },
  );

  it('keeps a hand-built baseline JPEG unchanged', () => {
    const input = jpeg(SOI, JFIF, DQT, SOF0, DHT, SOS, DATA, EOI);
    expect(() => assertNoHiddenMetadata(input)).not.toThrow();
    expect(list(stripJpegMetadata(input))).toEqual(list(input));
  });

  it('keeps a hand-built progressive (two scan) JPEG unchanged', () => {
    const input = jpeg(SOI, JFIF, DQT, SOF2, DHT, SOS, DATA, DHT, SOS, DATA2, EOI);
    expect(() => assertNoHiddenMetadata(input)).not.toThrow();
    const out = stripJpegMetadata(input);
    expect(list(out)).toEqual(list(input));
    expect(list(stripJpegMetadata(out))).toEqual(list(out));
  });

  it('keeps a hand-built ICC_PROFILE (APP2) JPEG unchanged', () => {
    const input = jpeg(SOI, JFIF, ICC, DQT, SOF0, DHT, SOS, DATA, EOI);
    expect(() => assertNoHiddenMetadata(input)).not.toThrow();
    const out = stripJpegMetadata(input);
    expect(list(out)).toEqual(list(input));
    expect(endsWithEoi(out)).toBe(true);
  });

  it('keeps an APP14 (Adobe) segment', () => {
    const adobe = segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
    const input = jpeg(SOI, JFIF, adobe, DQT, SOF0, DHT, SOS, DATA, EOI);
    expect(() => assertNoHiddenMetadata(input)).not.toThrow();
    expect(list(stripJpegMetadata(input))).toEqual(list(input));
  });
});

describe('allowlist: restart markers and stuffing are entropy data, not segments', () => {
  // Entropy bytes that look like markers: FF 00 stuffing, RST0..RST7 and FF D3 on its own.
  const RST_DATA = [
    0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33, 0xff, 0xd1, 0x44, 0xff, 0xd2, 0xff, 0x00, 0x55, 0xff,
    0xd3, 0x66, 0xff, 0xd4, 0x77, 0xff, 0xd5, 0x88, 0xff, 0xd6, 0x99, 0xff, 0xd7, 0xff, 0x00,
  ];

  it('accepts and keeps RST0-RST7 and FF 00 byte for byte (single scan, DRI)', () => {
    const input = jpeg(SOI, JFIF, DQT, SOF0, DHT, DRI, SOS, RST_DATA, EOI);

    expect(() => assertNoHiddenMetadata(input)).not.toThrow();
    expect(list(stripJpegMetadata(input))).toEqual(list(input));
  });

  it('keeps restart markers in both scans of a multi-scan JPEG while dropping metadata between them', () => {
    const input = jpeg(SOI, DQT, SOF2, DHT, DRI, SOS, RST_DATA, EXIF, DHT, SOS, RST_DATA, EOI);
    const expected = jpeg(SOI, DQT, SOF2, DHT, DRI, SOS, RST_DATA, DHT, SOS, RST_DATA, EOI);

    expectCode(() => assertNoHiddenMetadata(input), 'metadata_present');
    expect(list(stripJpegMetadata(input))).toEqual(list(expected));
  });

  it('does not read a FF D3 inside entropy data as a reserved or unknown marker', () => {
    const input = jpeg(SOI, DQT, SOF0, SOS, [0x01, 0xff, 0xd3, 0x02, 0xff, 0x00], EOI);
    expect(() => assertNoHiddenMetadata(input)).not.toThrow();
    expect(list(stripJpegMetadata(input))).toEqual(list(input));
  });
});

describe('allowlist: metadata between scans', () => {
  const cases: [string, number[], number[]][] = [
    ['APP1 Exif', EXIF, ascii('Exif')],
    ['APP1 XMP', XMP, ascii('xap')],
    ['COM', COM, ascii('secret-comment')],
    ['APP13', APP13, ascii('Photoshop')],
  ];

  it.each(cases)('%s between two scans is dropped by the strip', (_name, seg, needle) => {
    const input = jpeg(SOI, JFIF, DQT, SOF2, DHT, SOS, DATA, seg, DHT, SOS, DATA2, EOI);
    const expected = jpeg(SOI, JFIF, DQT, SOF2, DHT, SOS, DATA, DHT, SOS, DATA2, EOI);

    const out = stripJpegMetadata(input);

    expect(indexOfSeq(out, needle)).toBe(-1);
    expect(list(out)).toEqual(list(expected));
    expect(() => assertNoHiddenMetadata(out)).not.toThrow();
    expect(list(stripJpegMetadata(out))).toEqual(list(out));
  });

  it.each(cases)('%s between two scans is rejected by the check as metadata_present', (_n, seg) => {
    const input = jpeg(SOI, JFIF, DQT, SOF2, DHT, SOS, DATA, seg, DHT, SOS, DATA2, EOI);
    expectCode(() => assertNoHiddenMetadata(input), 'metadata_present');
  });

  it('drops metadata between the second and third scan too', () => {
    const input = jpeg(SOI, DQT, SOF2, SOS, DATA, SOS, DATA2, COM, EXIF, SOS, DATA, EOI);
    const expected = jpeg(SOI, DQT, SOF2, SOS, DATA, SOS, DATA2, SOS, DATA, EOI);

    expectCode(() => assertNoHiddenMetadata(input), 'metadata_present');
    expect(list(stripJpegMetadata(input))).toEqual(list(expected));
  });

  it('fixture progressive-app1-between-scans.jpg: the check rejects it', () => {
    expectCode(
      () => assertNoHiddenMetadata(fixture('progressive-app1-between-scans.jpg')),
      'metadata_present',
    );
  });

  it('fixture progressive-app1-between-scans.jpg: the strip drops the Exif and keeps the rest', () => {
    const input = fixture('progressive-app1-between-scans.jpg');
    const exifAt = indexOfSeq(input, ascii('Exif')) - 4; // FF E1 len len "Exif"
    expect(exifAt).toBeGreaterThan(firstSos(input));
    expect([input[exifAt], input[exifAt + 1]]).toEqual([0xff, 0xe1]);
    const segLength = 2 + ((input[exifAt + 2] << 8) | input[exifAt + 3]);

    const out = stripJpegMetadata(input);

    expect(indexOfSeq(out, ascii('Exif'))).toBe(-1);
    expect(() => assertNoHiddenMetadata(out)).not.toThrow();
    expect(endsWithEoi(out)).toBe(true);
    const without = new Uint8Array([...input.slice(0, exifAt), ...input.slice(exifAt + segLength)]);
    const firstEoiEnd = indexOfSeq(without, EOI, exifAt) + 2;
    expect(list(out)).toEqual(list(without.slice(0, firstEoiEnd)));
    expect(list(stripJpegMetadata(out))).toEqual(list(out));
  });
});

describe('allowlist: reserved and unknown markers are refused with not_an_image', () => {
  // [name, bytes of the offending marker]. TEM and a stray SOI have no length field.
  const offenders: [string, number[]][] = [
    ['reserved 0x02', segment(0x02, [1, 2, 3])],
    ['reserved 0xBF', segment(0xbf, [1, 2, 3])],
    ['JPG 0xC8', segment(0xc8, [1, 2, 3])],
    ['JPGn 0xF0', segment(0xf0, [1, 2, 3])],
    ['JPGn 0xFD', segment(0xfd, [1, 2, 3])],
    ['TEM 0x01', [0xff, 0x01]],
    ['stray SOI', [0xff, 0xd8]],
  ];

  it.each(offenders)('%s in the header is refused by both', (_name, marker) => {
    expectNotAnImageBoth(jpeg(SOI, JFIF, marker, DQT, SOF0, DHT, SOS, DATA, EOI));
  });

  it.each(offenders)('%s between scans is refused by both', (_name, marker) => {
    expectNotAnImageBoth(jpeg(SOI, JFIF, DQT, SOF2, DHT, SOS, DATA, marker, DHT, SOS, DATA2, EOI));
  });
});

describe('allowlist: malformed lengths and trailing bytes', () => {
  it('a segment length that overruns the data between scans is not_an_image for both', () => {
    // APP1 claims 0xFFFF bytes but the file ends well before that.
    const overrun = [0xff, 0xe1, 0xff, 0xff, ...ascii('Exif'), 0, 0];
    expectNotAnImageBoth(jpeg(SOI, DQT, SOF2, SOS, DATA, overrun, SOS, DATA2, EOI));
  });

  it('a COM length that overruns the data between scans is not_an_image for both', () => {
    const overrun = [0xff, 0xfe, 0x7f, 0xff, 1, 2, 3];
    expectNotAnImageBoth(jpeg(SOI, DQT, SOF2, SOS, DATA, overrun, SOS, DATA2, EOI));
  });

  it('bytes after the first EOI are ignored by the check', () => {
    const input = jpeg(SOI, JFIF, DQT, SOF0, DHT, SOS, DATA, EOI, [0xff, 0xd8], EXIF, COM, EOI);
    expect(() => assertNoHiddenMetadata(input)).not.toThrow();
  });

  it('bytes after the first EOI are dropped by the strip', () => {
    const base = jpeg(SOI, JFIF, DQT, SOF0, DHT, SOS, DATA, EOI);
    const input = jpeg(Array.from(base), [0xff, 0xd8], EXIF, COM, EOI, [0x99, 0x98]);

    const out = stripJpegMetadata(input);

    expect(list(out)).toEqual(list(base));
    expect(endsWithEoi(out)).toBe(true);
  });

  it('bytes after the first EOI of a multi-scan JPEG are dropped by the strip', () => {
    const base = jpeg(SOI, DQT, SOF2, SOS, DATA, SOS, DATA2, EOI);
    const input = jpeg(Array.from(base), EXIF, [0x00, 0x01]);
    expect(list(stripJpegMetadata(input))).toEqual(list(base));
  });
});
