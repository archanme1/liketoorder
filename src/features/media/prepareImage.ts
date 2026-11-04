import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import { JPEG_QUALITY, JPEG_RETRY_QUALITY, MAX_LONG_EDGE_PX, MAX_UPLOAD_BYTES } from './constants';
import { MediaError } from './errors';
import { assertNoHiddenMetadata } from './jpegMetadata';

export type PreparedImage = {
  uri: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
};

export type PrepareImageOptions = {
  maxLongEdge?: number;
  quality?: number;
  retryQuality?: number;
  maxBytes?: number;
};

/** The resize that keeps the long edge at most `maxLongEdge`, or null when no resize is needed. */
export function resizeFor(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= maxLongEdge) return null;
  return width >= height ? { width: maxLongEdge } : { height: maxLongEdge };
}

async function encode(image: ImageRef, quality: number) {
  const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });
  const bytes = await new File(saved.uri).bytes();
  // On the output bytes, every time: no code path uploads unchecked bytes.
  assertNoHiddenMetadata(bytes);
  return { saved, bytes };
}

/**
 * Resizes (never upscales) and re-encodes a photo as JPEG, which writes a new file without the
 * source's EXIF/XMP/IPTC, then proves it on the bytes. Uploads always send the returned bytes,
 * never the picker's original file.
 */
export async function prepareImage(
  uri: string,
  opts: PrepareImageOptions = {},
): Promise<PreparedImage> {
  const {
    maxLongEdge = MAX_LONG_EDGE_PX,
    quality = JPEG_QUALITY,
    retryQuality = JPEG_RETRY_QUALITY,
    maxBytes = MAX_UPLOAD_BYTES,
  } = opts;

  let source: ImageRef | undefined;
  let image: ImageRef | undefined;
  try {
    source = await ImageManipulator.manipulate(uri).renderAsync();
    const context = ImageManipulator.manipulate(uri);
    const resize = resizeFor(source.width, source.height, maxLongEdge);
    if (resize) context.resize(resize);
    image = await context.renderAsync();

    let { saved, bytes } = await encode(image, quality);
    if (bytes.byteLength > maxBytes) {
      ({ saved, bytes } = await encode(image, retryQuality));
      if (bytes.byteLength > maxBytes) throw new MediaError('too_large');
    }
    return {
      uri: saved.uri,
      bytes,
      width: saved.width,
      height: saved.height,
      mimeType: 'image/jpeg',
    };
  } catch (error) {
    if (error instanceof MediaError) throw error;
    // The manipulator couldn't decode it (not an image, or a format the phone can't read).
    throw new MediaError('not_an_image');
  } finally {
    source?.release();
    image?.release();
  }
}
