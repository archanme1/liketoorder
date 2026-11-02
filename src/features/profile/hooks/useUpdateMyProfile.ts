import { useMutation, useQueryClient } from '@tanstack/react-query';

import { updateMyProfile, type Profile, type ProfileAppError, type ProfilePatch } from '../api';

import { myProfileKey } from './useMyProfile';
import { profileKey } from './useProfile';

export function useUpdateMyProfile() {
  const queryClient = useQueryClient();

  return useMutation<Profile, ProfileAppError, ProfilePatch>({
    mutationFn: (patch) => updateMyProfile(patch),
    onSuccess: (profile) => {
      // Write the saved row straight into the cache so the route guard and home update
      // immediately, then refetch in the background.
      queryClient.setQueryData(myProfileKey, profile);
      queryClient.setQueryData(profileKey(profile.id), profile);
      void queryClient.invalidateQueries({ queryKey: myProfileKey });
      void queryClient.invalidateQueries({ queryKey: profileKey(profile.id) });
    },
  });
}
