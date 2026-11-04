import { launchImageLibraryAsync } from 'expo-image-picker';

import { MediaError } from './errors';

/**
 * One photo from the library (v1.md §3: one photo per upload). No camera, so no camera permission.
 * `exif: false` keeps the metadata out of the JS result; the file itself is cleaned by prepareImage.
 * Returns the asset URI, or null when the user cancels.
 */
export async function pickImage(): Promise<string | null> {
  let result;
  try {
    result = await launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      allowsEditing: false,
      exif: false,
      quality: 1,
    });
  } catch {
    throw new MediaError('unknown');
  }
  if (result.canceled) return null;
  return result.assets[0]?.uri ?? null;
}
