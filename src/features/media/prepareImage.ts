import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import { JPEG_QUALITY, JPEG_RETRY_QUALITY, MAX_LONG_EDGE_PX, MAX_UPLOAD_BYTES } from './constants';
import { MediaError } from './errors';
import { assertNoHiddenMetadata, stripJpegMetadata } from './jpegMetadata';
import { pickedSizeOf } from './pickedSize';

export type PreparedImage = {
  /** The encoder's local file, for on-phone preview only. It may still hold metadata: never upload it. */
  uri: string;
  /** The stripped, checked bytes. The only thing that is ever uploaded. */
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
  // The phone's encoder can still write its own APP1 (Exif) and APP13 (Photoshop) blocks (seen on
  // iOS), so the segments are stripped without re-encoding (Decision 29), then the strict check
  // runs on the stripped bytes, every time: no code path uploads unchecked bytes.
  const bytes = stripJpegMetadata(await new File(saved.uri).bytes());
  assertNoHiddenMetadata(bytes);
  return { saved, bytes };
}

/**
 * Resizes (never upscales), re-encodes as JPEG, strips any metadata segments the encoder wrote and
 * proves it on the bytes. Uploads always send the returned bytes, never the picker's original
 * file or the encoder's file. The 2 MB limit is measured on the stripped bytes.
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
    // The picker's size spares a full decode of the original (Decision 33); without it, render once
    // to read the size.
    let size = pickedSizeOf(uri);
    if (!size) {
      source = await ImageManipulator.manipulate(uri).renderAsync();
      size = { width: source.width, height: source.height };
    }
    const render = async (from: { width: number; height: number }) => {
      const context = ImageManipulator.manipulate(uri);
      const resize = resizeFor(from.width, from.height, maxLongEdge);
      if (resize) context.resize(resize);
      return context.renderAsync();
    };
    image = await render(size);
    // A reported size can be wrong (e.g. an unrotated size for a rotated photo). The rendered size
    // is the truth, and the long-edge limit must hold, so render again from it.
    if (Math.max(image.width, image.height) > maxLongEdge) {
      const rendered = { width: image.width, height: image.height };
      image.release();
      image = await render(rendered);
    }

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
