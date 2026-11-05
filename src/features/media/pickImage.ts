import { launchImageLibraryAsync } from 'expo-image-picker';

import { MediaError } from './errors';
import { rememberPickedSize } from './pickedSize';

/**
 * One photo from the library (v1.md §3: one photo per upload). No camera, so no camera permission.
 * `exif: false` keeps the metadata out of the JS result; the file itself is cleaned by prepareImage.
 * Returns the asset URI, or null when the user cancels. The asset's pixel size is remembered so
 * prepareImage doesn't have to decode the original to read it.
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
  const asset = result.assets[0];
  if (!asset?.uri) return null;
  rememberPickedSize(asset.uri, asset.width, asset.height);
  return asset.uri;
}
