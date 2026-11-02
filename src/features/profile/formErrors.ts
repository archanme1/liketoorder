import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import type { ProfileAppError } from './api';
import { INVALID_FIELD_MESSAGE, profileErrorMessage, USERNAME_TAKEN } from './messages';

/**
 * Puts field-level server errors on their field. Returns the banner message for anything
 * that isn't tied to a field, or null when the error was shown inline.
 */
export function applyProfileError<T extends FieldValues>(
  error: ProfileAppError,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (error.code === 'username_taken' && fields.includes('username' as Path<T>)) {
    setError('username' as Path<T>, { message: USERNAME_TAKEN });
    return null;
  }
  if (error.code === 'invalid_field' && error.field && fields.includes(error.field as Path<T>)) {
    setError(error.field as Path<T>, { message: INVALID_FIELD_MESSAGE });
    return null;
  }
  return profileErrorMessage(error.code);
}
