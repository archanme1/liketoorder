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

/**
 * Every marker segment from SOI up to and including SOS. Throws `not_an_image` for anything that
 * isn't a well-formed JPEG header.
 */
export function readJpegSegments(bytes: Uint8Array): JpegSegment[] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new MediaError('not_an_image');
  }
  const segments: JpegSegment[] = [];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new MediaError('not_an_image');
    // Any number of 0xFF fill bytes may precede a marker.
    while (i < bytes.length && bytes[i] === 0xff) i += 1;
    if (i >= bytes.length) break;
    const marker = bytes[i];
    i += 1;

    // Standalone markers (no length field).
    if (marker === SOI || marker === EOI || marker === 0x00) throw new MediaError('not_an_image');
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, name: markerName(marker) });
      continue;
    }

    if (i + 2 > bytes.length) throw new MediaError('not_an_image');
    const length = (bytes[i] << 8) | bytes[i + 1];
    const end = i + length;
    if (length < 2 || end > bytes.length) throw new MediaError('not_an_image');

    const segment: JpegSegment = { marker, name: markerName(marker) };
    if (marker >= 0xe0 && marker <= 0xef) segment.id = appIdentifier(bytes, i + 2, end);
    segments.push(segment);

    if (marker === SOS) return segments;
    i = end;
  }
  // Ran out of bytes before the image data started.
  throw new MediaError('not_an_image');
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
