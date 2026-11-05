export type MediaErrorCode =
  | 'cancelled'
  | 'too_large'
  | 'metadata_present'
  | 'not_an_image'
  | 'upload_failed'
  | 'network'
  | 'unknown';

// Carries only a code (and, for metadata_present, the marker name such as "APP1"). Never a URI,
// path, signed URL or image bytes, so nothing about the photo ends up in logs or error output.
export class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly marker?: string;

  constructor(code: MediaErrorCode, marker?: string) {
    super(code);
    this.name = 'MediaError';
    this.code = code;
    this.marker = marker;
  }
}

export function mediaErrorMessage(code: MediaErrorCode): string {
  switch (code) {
    case 'cancelled':
      return 'No photo was chosen.';
    case 'too_large':
      return 'That photo is too large, even after resizing. Try another one.';
    case 'metadata_present':
      return 'We couldn’t remove the hidden details from that photo, so it wasn’t uploaded. Try another one.';
    case 'not_an_image':
      return 'That file isn’t a photo we can use. Try another one.';
    case 'upload_failed':
      return 'The photo didn’t upload. Please try again.';
    case 'network':
      return 'Can’t reach LikeToOrder. Check your connection and try again.';
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}
