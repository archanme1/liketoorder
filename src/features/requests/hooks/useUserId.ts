import { useContext } from 'react';

import { AuthContext } from '@/features/auth/components/AuthProvider';

/** The signed-in user's id, or undefined (guest, or no AuthProvider above). Never throws. */
export function useUserId(): string | undefined {
  return useContext(AuthContext)?.session?.user.id;
}
