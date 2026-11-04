import { MediaError } from './errors';

// Walks a JPEG's marker segments from SOI to SOS (where the image data starts) and refuses any
// segment that can carry hidden metadata. EXIF and XMP (where phones put GPS) live in APP1, IPTC in
// APP13, comments in COM. Re-encoding should already have dropped them; this proves it on the
// actual bytes before upload.

export type JpegSegment = {
  /** The marker byte after 0xFF, e.g. 0xE1 for APP1. */
  marker: number;
  /** Readable name, e.g. "APP1" or "DQT". */
  name: string;
  /** For APPn segments: the leading ASCII identifier, e.g. "Exif", "JFIF", "ICC_PROFILE". */
  id?: string;
};

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;
const APP0 = 0xe0;
const APP2 = 0xe2;
const APP14 = 0xee;

// Each allowed APPn must also carry its expected identifier, so e.g. an MPF block (which can hold a
// second image with its own EXIF) in APP2 is refused.
const ALLOWED_APP_IDS: Record<number, string> = {
  [APP0]: 'JFIF',
  [APP2]: 'ICC_PROFILE',
  [APP14]: 'Adobe',
};

function markerName(marker: number): string {
  if (marker >= 0xe0 && marker <= 0xef) return `APP${marker - 0xe0}`;
  if (marker >= 0xd0 && marker <= 0xd7) return `RST${marker - 0xd0}`;
  const names: Record<number, string> = {
    0xc4: 'DHT',
    0xcc: 'DAC',
    0xdb: 'DQT',
    0xdd: 'DRI',
    0xdc: 'DNL',
    [SOS]: 'SOS',
    [COM]: 'COM',
  };
  if (names[marker]) return names[marker];
  if (marker >= 0xc0 && marker <= 0xcf) return `SOF${marker - 0xc0}`;
  return `0x${marker.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** The ASCII identifier at the start of an APPn payload (up to the first NUL, max 16 chars). */
function appIdentifier(bytes: Uint8Array, start: number, end: number): string {
  let id = '';
  for (let i = start; i < end && i < start + 16; i += 1) {
    const byte = bytes[i];
    if (byte === 0) break;
    id += String.fromCharCode(byte);
  }
  return id;
}

/** A segment plus where it sits: `start` is its 0xFF marker byte, `end` is one past its payload. */
type LocatedSegment = JpegSegment & { start: number; end: number };

function walkSegments(bytes: Uint8Array): LocatedSegment[] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new MediaError('not_an_image');
  }
  const segments: LocatedSegment[] = [];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new MediaError('not_an_image');
    // Any number of 0xFF fill bytes may precede a marker.
    while (i < bytes.length && bytes[i] === 0xff) i += 1;
    if (i >= bytes.length) break;
    const start = i - 1;
    const marker = bytes[i];
    i += 1;

    // Standalone markers (no length field).
    if (marker === SOI || marker === EOI || marker === 0x00) throw new MediaError('not_an_image');
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, name: markerName(marker), start, end: i });
      continue;
    }

    if (i + 2 > bytes.length) throw new MediaError('not_an_image');
    const length = (bytes[i] << 8) | bytes[i + 1];
    const end = i + length;
    if (length < 2 || end > bytes.length) throw new MediaError('not_an_image');

    const segment: LocatedSegment = { marker, name: markerName(marker), start, end };
    if (marker >= 0xe0 && marker <= 0xef) segment.id = appIdentifier(bytes, i + 2, end);
    segments.push(segment);

    if (marker === SOS) return segments;
    i = end;
  }
  // Ran out of bytes before the image data started.
  throw new MediaError('not_an_image');
}

/**
 * Every marker segment from SOI up to and including SOS. Throws `not_an_image` for anything that
 * isn't a well-formed JPEG header.
 */
export function readJpegSegments(bytes: Uint8Array): JpegSegment[] {
  return walkSegments(bytes).map(({ marker, name, id }) =>
    id === undefined ? { marker, name } : { marker, name, id },
  );
}

/**
 * Index one past the first EOI after `from`. Entropy-coded data byte-stuffs 0xFF as FF 00, so the
 * first FF D9 after SOS is the image's real end; anything after it (e.g. an iPhone MPF block's
 * extra images, which can carry their own EXIF) isn't part of this image.
 */
function endOfImage(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === EOI) return i + 2;
  }
  throw new MediaError('not_an_image');
}

/**
 * Removes hidden metadata from a JPEG without re-encoding (Decision 29): keeps SOI, the image
 * structure segments (APP0 JFIF, APP2 ICC_PROFILE, APP14 Adobe, DQT, DHT, SOFn, DRI and the other
 * non-APPn markers), drops every other APPn (EXIF/XMP in APP1, IPTC in APP13, MPF in APP2, …) and
 * COM, then copies the image data from SOS through the first EOI byte for byte. Malformed or
 * truncated input throws `not_an_image`. The result still goes through assertNoHiddenMetadata.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const segments = walkSegments(bytes);
  const sos = segments[segments.length - 1];
  const imageEnd = endOfImage(bytes, sos.end);

  const kept = segments.slice(0, -1).filter(isAllowed);
  const headerLength = kept.reduce((sum, s) => sum + (s.end - s.start), 2);
  const out = new Uint8Array(headerLength + (imageEnd - sos.start));
  out[0] = 0xff;
  out[1] = SOI;
  let offset = 2;
  for (const segment of kept) {
    out.set(bytes.subarray(segment.start, segment.end), offset);
    offset += segment.end - segment.start;
  }
  out.set(bytes.subarray(sos.start, imageEnd), offset);
  return out;
}

const EXIF_ORIENTATION_TAG = 0x0112;

/**
 * The EXIF Orientation (1–8) in the first APP1 Exif segment, or null when there is none or it
 * can't be read. Used to know whether stripping EXIF could change how a photo is displayed.
 */
export function readExifOrientation(bytes: Uint8Array): number | null {
  let segments: LocatedSegment[];
  try {
    segments = walkSegments(bytes);
  } catch {
    return null;
  }
  const exif = segments.find((s) => s.marker === 0xe1 && s.id === 'Exif');
  if (!exif) return null;

  // Payload: 2-byte length, "Exif\0\0", then a TIFF header.
  const tiff = exif.start + 4 + 6;
  const end = exif.end;
  if (tiff + 8 > end) return null;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49; // "II"
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d; // "MM"
  if (!little && !big) return null;
  const u16 = (at: number) =>
    little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
  const u32 = (at: number) =>
    little
      ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) + bytes[at + 3] * 0x1000000
      : bytes[at] * 0x1000000 + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]);
  if (u16(tiff + 2) !== 0x2a) return null;

  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > end) return null;
  const count = u16(ifd0);
  for (let n = 0; n < count; n += 1) {
    const entry = ifd0 + 2 + n * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === EXIF_ORIENTATION_TAG) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function isAllowed(segment: JpegSegment): boolean {
  if (segment.marker === COM) return false;
  if (segment.marker >= 0xe0 && segment.marker <= 0xef) {
    const expected = ALLOWED_APP_IDS[segment.marker];
    return expected !== undefined && segment.id === expected;
  }
  return true;
}

/**
 * Throws `metadata_present` (with the marker name) if any segment before the image data could carry
 * hidden metadata, or `not_an_image` if the bytes aren't a valid JPEG. Allowed: APP0 (JFIF),
 * APP2 (ICC colour profile), APP14 (Adobe) and the image segments.
 */
export function assertNoHiddenMetadata(bytes: Uint8Array): void {
  for (const segment of readJpegSegments(bytes)) {
    if (!isAllowed(segment)) {
      const label = segment.id ? `${segment.name} (${segment.id})` : segment.name;
      throw new MediaError('metadata_present', label);
    }
  }
}
