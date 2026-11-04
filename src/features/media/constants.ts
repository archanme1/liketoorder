// Spec 06 "Image size" (Decision 14). The byte limit matches the business-media bucket's
// file_size_limit and the check in finish_photo_upload().
export const MAX_LONG_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.8;
export const JPEG_RETRY_QUALITY = 0.6;
export const MAX_UPLOAD_BYTES = 2_097_152;

// Signed URLs (Decision 15): 1-hour links, refreshed before they expire and never reused after.
export const SIGNED_URL_TTL_SECONDS = 3600;
export const SIGNED_URL_STALE_MS = 50 * 60 * 1000;
export const SIGNED_URL_GC_MS = 55 * 60 * 1000;
