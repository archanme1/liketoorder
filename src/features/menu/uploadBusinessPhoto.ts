import { removeFromBucket, uploadToBucket } from '@/features/media/api';
import { MediaError } from '@/features/media/errors';
import { prepareImage } from '@/features/media/prepareImage';

import {
  beginPhotoUpload,
  claimPhotoCleanup,
  deleteBusinessPhoto,
  finishPhotoUpload,
  MenuAppError,
} from './api';
import { MEDIA_BUCKET } from './photos';
import type { BusinessPhoto, PhotoKind } from './schema';

let cleanupInFlight: Promise<void> | null = null;

/**
 * Drains the storage cleanup outbox (Decision 6): claim → remove → claim. The server decides
 * which files are gone; a failed removal stays queued for the next run. Never throws. Calls made
 * while a run is in progress share it.
 */
export function runPhotoCleanup(): Promise<void> {
  cleanupInFlight ??= (async () => {
    try {
      const paths = await claimPhotoCleanup();
      if (paths.length === 0) return;
      try {
        await removeFromBucket(MEDIA_BUCKET, paths);
      } catch {
        // Stays queued; retried on the next run.
      }
      await claimPhotoCleanup();
    } catch {
      // Best effort: the next screen open or delete runs it again.
    }
  })().finally(() => {
    cleanupInFlight = null;
  });
  return cleanupInFlight;
}

async function reserve(kind: PhotoKind, menuItemId?: string) {
  try {
    return await beginPhotoUpload(kind, menuItemId);
  } catch (error) {
    if (!(error instanceof MenuAppError) || error.code !== 'cleanup_required') throw error;
    // Decision 25: too many queued files still in storage. Clean up, then retry once; a second
    // cleanup_required reaches the screen as an error with retry.
    await runPhotoCleanup();
    return beginPhotoUpload(kind, menuItemId);
  }
}

export type UploadBusinessPhotoInput = {
  /** The picked photo. Only read by prepareImage; never uploaded. */
  sourceUri: string;
  kind: PhotoKind;
  menuItemId?: string;
};

/**
 * prepareImage → beginPhotoUpload → uploadToBucket → finishPhotoUpload.
 *
 * Only the prepared bytes are uploaded: resized, re-encoded, stripped of metadata and checked
 * (Decision 29). The picker's file and the encoder's file are never sent. Preparing happens
 * before the reservation, so a photo that can't be cleaned reserves and uploads nothing.
 */
export async function uploadBusinessPhoto({
  sourceUri,
  kind,
  menuItemId,
}: UploadBusinessPhotoInput): Promise<BusinessPhoto> {
  const prepared = await prepareImage(sourceUri);
  const reservation = await reserve(kind, menuItemId);

  let photo: BusinessPhoto;
  try {
    await uploadToBucket(MEDIA_BUCKET, reservation.path, prepared.bytes);
    photo = await finishPhotoUpload(reservation.photo_id);
  } catch (error) {
    // Free the slot at once (gallery/menu reservations count toward the limit), then clean up any
    // file that did reach Storage. Row first, file later.
    try {
      await deleteBusinessPhoto(reservation.photo_id);
    } catch {
      // The 1-hour expiry is the backstop.
    }
    await runPhotoCleanup();
    if (error instanceof MediaError || error instanceof MenuAppError) throw error;
    throw new MediaError('upload_failed');
  }

  // A cover or item photo replaced the previous one, whose file is now queued.
  if (kind === 'cover' || kind === 'item') await runPhotoCleanup();
  return photo;
}
