import { useContext } from 'react';

import { AuthContext, type AuthContextValue } from '../components/AuthProvider';

export function useSession(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useSession must be used inside AuthProvider');
  return value;
}
