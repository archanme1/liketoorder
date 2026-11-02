import { useQuery } from '@tanstack/react-query';

import { getProfile, type Profile, type ProfileAppError } from '../api';

export function profileKey(id: string) {
  return ['profile', id] as const;
}

export function useProfile(id: string) {
  return useQuery<Profile | null, ProfileAppError>({
    queryKey: profileKey(id),
    queryFn: () => getProfile(id),
  });
}
