import { getCalendars } from 'expo-localization';

import { removeFromBucket, uploadToBucket } from '@/features/media/api';
import { MediaError } from '@/features/media/errors';
import { prepareImage } from '@/features/media/prepareImage';

import {
  beginFoodLogUpload,
  claimFoodLogCleanup,
  deleteFoodLog,
  finishFoodLogUpload,
  FoodLogAppError,
  type FoodLogFields,
} from './api';
import type { FoodLog } from './schema';
import { FOOD_LOG_BUCKET } from './shared';

/** The phone's IANA zone. The server turns it into the local date; no date or time is sent. */
export function phoneTimeZone(): string {
  return getCalendars()[0]?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

let cleanupInFlight: Promise<void> | null = null;

/**
 * Drains the food log cleanup outbox: claim, remove, claim. The server decides which files are
 * gone; a failed removal stays queued for the next run. Never throws. Calls made while a run is in
 * progress share it.
 *
 * A path queued after a shared run's first claim (a delete during a run) is not in that run; it
 * stays queued for the next one (the next list open, delete or failed upload).
 */
export function runFoodLogCleanup(): Promise<void> {
  cleanupInFlight ??= (async () => {
    try {
      const paths = await claimFoodLogCleanup();
      if (paths.length === 0) return;
      try {
        await removeFromBucket(FOOD_LOG_BUCKET, paths);
      } catch {
        // Stays queued; retried on the next run.
      }
      await claimFoodLogCleanup();
    } catch {
      // Best effort: the next list open or delete runs it again.
    }
  })().finally(() => {
    cleanupInFlight = null;
  });
  return cleanupInFlight;
}

async function reserve(fields: FoodLogFields, timeZone: string) {
  try {
    return await beginFoodLogUpload(fields, timeZone);
  } catch (error) {
    if (!(error instanceof FoodLogAppError) || error.code !== 'cleanup_required') throw error;
    // Too many queued files still in storage. Clean up, then retry once; a second
    // cleanup_required reaches the form as an error.
    await runFoodLogCleanup();
    return beginFoodLogUpload(fields, timeZone);
  }
}

export type UploadFoodLogInput = FoodLogFields & {
  /** The picked photo. Only read by prepareImage; never uploaded. */
  sourceUri: string;
};

/**
 * prepareImage -> beginFoodLogUpload -> uploadToBucket -> finishFoodLogUpload.
 *
 * Only the prepared bytes are uploaded: resized, re-encoded, stripped of metadata and checked.
 * Preparing happens before begin, so a photo that can't be cleaned uses no daily start.
 */
export async function uploadFoodLog({
  sourceUri,
  ...fields
}: UploadFoodLogInput): Promise<FoodLog> {
  const prepared = await prepareImage(sourceUri);
  const reservation = await reserve(fields, phoneTimeZone());

  try {
    await uploadToBucket(FOOD_LOG_BUCKET, reservation.path, prepared.bytes);
    return await finishFoodLogUpload(reservation.id);
  } catch (error) {
    // Free the pending slot at once, then clean up any file that did reach Storage. Row first,
    // file later.
    try {
      await deleteFoodLog(reservation.id);
    } catch {
      // The 1-hour expiry is the backstop.
    }
    await runFoodLogCleanup();
    if (error instanceof MediaError || error instanceof FoodLogAppError) throw error;
    throw new MediaError('upload_failed');
  }
}
