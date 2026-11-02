import { useQuery } from '@tanstack/react-query';

import { getMyProfile, type Profile, type ProfileAppError } from '../api';

export const myProfileKey = ['profile', 'me'] as const;

export function useMyProfile({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<Profile | null, ProfileAppError>({
    queryKey: myProfileKey,
    queryFn: getMyProfile,
    enabled,
  });
}
