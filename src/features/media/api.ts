import { supabase } from '@/lib/supabase';

import { MAX_UPLOAD_BYTES } from './constants';
import { MediaError } from './errors';

// All Storage calls in the app. Never logs paths, signed URLs or bytes.

function mapStorageError(error: unknown, fallback: 'upload_failed' | 'unknown'): MediaError {
  const message =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/network|fetch/i.test(message)) return new MediaError('network');
  return new MediaError(fallback);
}

// supabase-js uploads an ArrayBuffer body on React Native (Blob from bytes isn't supported there).
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Uploads JPEG bytes at a server-reserved path. Never overwrites (upsert false). */
export async function uploadToBucket(
  bucket: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new MediaError('too_large');
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, toArrayBuffer(bytes), { contentType: 'image/jpeg', upsert: false });
  if (error) throw mapStorageError(error, 'upload_failed');
}

/** Removes files. Storage policies only allow files whose row is already gone. */
export async function removeFromBucket(bucket: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove([...paths]);
  if (error) throw mapStorageError(error, 'unknown');
}

/**
 * Signed URLs for many paths in one request. A path the server refuses (not readable by this
 * user any more) maps to null.
 */
export async function signedUrls(
  bucket: string,
  paths: readonly string[],
  ttlSeconds: number,
): Promise<Record<string, string | null>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls([...paths], ttlSeconds);
  if (error) throw mapStorageError(error, 'unknown');
  const urls: Record<string, string | null> = Object.fromEntries(paths.map((p) => [p, null]));
  for (const entry of data ?? []) {
    if (entry.path && !entry.error && entry.signedUrl) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}
