import { MediaError } from './errors';

// Walks a JPEG's marker segments from SOI to EOI, across every scan, and refuses any segment that
// can carry hidden metadata. EXIF and XMP (where phones put GPS) live in APP1, IPTC in APP13,
// comments in COM. Only an allowlist of image-structure markers passes (Decision 29); re-encoding
// should already have dropped the rest, and this proves it on the actual bytes before upload.

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

/** The header up to the first SOS, then every marker segment found between scans, up to the first EOI. */
type ImageWalk = {
  /** Header segments before the first SOS. */
  header: LocatedSegment[];
  sos: LocatedSegment;
  /** Segments after the first SOS (further scans' SOS, DHT, DRI, APPn, COM, …), in order. */
  between: LocatedSegment[];
  /** One past the first EOI, or null when the data ends without one. */
  imageEnd: number | null;
};

/**
 * Walks the whole image. Entropy-coded data is skipped byte by byte: FF 00 is a stuffed 0xFF, FF D0–D7
 * are restart markers, and any other marker is a segment between scans (progressive and multi-scan
 * JPEGs put DHT, DRI and, in a hostile file, APPn or COM there). The first EOI ends the image.
 */
function walkImage(bytes: Uint8Array): ImageWalk {
  const headerAndSos = walkSegments(bytes);
  const sos = headerAndSos[headerAndSos.length - 1];
  const between: LocatedSegment[] = [];
  let imageEnd: number | null = null;
  let i = sos.end;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < bytes.length && bytes[j] === 0xff) j += 1; // fill bytes
    if (j >= bytes.length) break;
    const marker = bytes[j];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = j + 1;
      continue;
    }
    if (marker === EOI) {
      imageEnd = j + 1;
      break;
    }
    if (marker === SOI) throw new MediaError('not_an_image');
    const start = j - 1;
    if (marker === 0x01) {
      between.push({ marker, name: markerName(marker), start, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (j + 3 > bytes.length) throw new MediaError('not_an_image');
    const length = (bytes[j + 1] << 8) | bytes[j + 2];
    const end = j + 1 + length;
    if (length < 2 || end > bytes.length) throw new MediaError('not_an_image');
    const segment: LocatedSegment = { marker, name: markerName(marker), start, end };
    if (marker >= 0xe0 && marker <= 0xef) segment.id = appIdentifier(bytes, j + 3, end);
    between.push(segment);
    i = end;
  }
  return { header: headerAndSos.slice(0, -1), sos, between, imageEnd };
}

/**
 * Every marker segment from SOI up to and including the first SOS. Throws `not_an_image` for anything that
 * isn't a well-formed JPEG header.
 */
export function readJpegSegments(bytes: Uint8Array): JpegSegment[] {
  return walkSegments(bytes).map(({ marker, name, id }) =>
    id === undefined ? { marker, name } : { marker, name, id },
  );
}

/**
 * Removes hidden metadata from a JPEG without re-encoding (Decision 29): keeps SOI, the allowlisted
 * image-structure segments (APP0 JFIF, APP2 ICC_PROFILE, APP14 Adobe, DQT, DHT, DAC, SOFn, DRI, DNL,
 * SOS and restart markers), drops every other APPn (EXIF/XMP in APP1, IPTC in APP13, MPF in APP2, …)
 * and COM wherever they sit, including between the scans of a progressive JPEG, then copies the image
 * data through the first EOI byte for byte. Anything after that EOI (e.g. an MPF block's extra
 * images) is dropped. Malformed or truncated input, no EOI, or any marker outside the allowlist
 * throws `not_an_image`. The result still goes through assertNoHiddenMetadata.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const { header, sos, between, imageEnd } = walkImage(bytes);
  if (imageEnd === null) throw new MediaError('not_an_image');

  const keptHeader: LocatedSegment[] = [];
  for (const segment of header) {
    const verdict = classify(segment);
    if (verdict === 'refuse') throw new MediaError('not_an_image');
    if (verdict === 'keep') keptHeader.push(segment);
  }
  const dropped: LocatedSegment[] = [];
  for (const segment of between) {
    const verdict = classify(segment);
    if (verdict === 'refuse') throw new MediaError('not_an_image');
    if (verdict === 'drop') dropped.push(segment);
  }

  const size = (s: { start: number; end: number }) => s.end - s.start;
  const headerLength = keptHeader.reduce((sum, s) => sum + size(s), 2);
  const droppedLength = dropped.reduce((sum, s) => sum + size(s), 0);
  const out = new Uint8Array(headerLength + (imageEnd - sos.start) - droppedLength);
  out[0] = 0xff;
  out[1] = SOI;
  let offset = 2;
  const copy = (from: number, to: number) => {
    out.set(bytes.subarray(from, to), offset);
    offset += to - from;
  };
  for (const segment of keptHeader) copy(segment.start, segment.end);
  let from = sos.start;
  for (const segment of dropped) {
    copy(from, segment.start);
    from = segment.end;
  }
  copy(from, imageEnd);
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

type Verdict = 'keep' | 'drop' | 'refuse';

function isSof(marker: number): boolean {
  // SOF0–SOF15, except 0xC4 (DHT), 0xC8 (JPG, reserved) and 0xCC (DAC).
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * An allowlist. `keep`: image structure (SOFn, DHT, DAC, DQT, DRI, DNL, SOS, restart markers) and the
 * three APPn segments with their expected identifier. `drop`: APPn with another identifier or number,
 * and COM, which is where hidden metadata lives. `refuse`: everything else (reserved, JPGn, TEM, …).
 */
function classify(segment: JpegSegment): Verdict {
  const { marker } = segment;
  if (marker >= 0xe0 && marker <= 0xef) {
    const expected = ALLOWED_APP_IDS[marker];
    return expected !== undefined && segment.id === expected ? 'keep' : 'drop';
  }
  if (marker === COM) return 'drop';
  if (isSof(marker)) return 'keep';
  if (marker >= 0xd0 && marker <= 0xd7) return 'keep';
  return STRUCTURE_MARKERS.has(marker) ? 'keep' : 'refuse';
}

const STRUCTURE_MARKERS = new Set([0xc4, 0xcc, 0xdb, 0xdc, 0xdd, SOS]);

/**
 * Throws `metadata_present` (with the marker name) if any segment, before the image data or between
 * scans, could carry hidden metadata; `not_an_image` if the bytes aren't a valid JPEG or contain a
 * marker outside the allowlist. Allowed: APP0 (JFIF), APP2 (ICC colour profile), APP14 (Adobe) and
 * the image-structure segments. Bytes that end without an EOI are checked as far as they go (the
 * strip, which requires an EOI, runs first in prepareImage).
 */
export function assertNoHiddenMetadata(bytes: Uint8Array): void {
  const { header, sos, between } = walkImage(bytes);
  for (const segment of [...header, sos, ...between]) {
    const verdict = classify(segment);
    if (verdict === 'refuse') throw new MediaError('not_an_image');
    if (verdict === 'drop') {
      const label = segment.id ? `${segment.name} (${segment.id})` : segment.name;
      throw new MediaError('metadata_present', label);
    }
  }
}
