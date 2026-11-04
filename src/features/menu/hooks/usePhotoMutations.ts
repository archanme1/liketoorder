import { useMutation, useQueryClient } from '@tanstack/react-query';

import { pickImage } from '@/features/media/pickImage';

import { deleteBusinessPhoto } from '../api';
import type { BusinessPhoto, PhotoKind } from '../schema';
import { runPhotoCleanup, uploadBusinessPhoto } from '../uploadBusinessPhoto';

import { menuKey } from './useMyMenu';

export type PhotoTarget = { kind: PhotoKind; menuItemId?: string };

/**
 * Picks one library photo and uploads it (prepare → reserve → upload → finish). Resolves null when
 * the seller cancels the picker. `sourceUri` skips the picker (a photo chosen earlier, e.g. on the
 * new-item form before the item existed).
 */
export function useUploadBusinessPhoto(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation<BusinessPhoto | null, Error, PhotoTarget & { sourceUri?: string }>({
    mutationFn: async ({ kind, menuItemId, sourceUri }) => {
      const uri = sourceUri ?? (await pickImage());
      if (!uri) return null;
      return uploadBusinessPhoto({ sourceUri: uri, kind, menuItemId });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: menuKey(businessId) }),
  });
}

/** Deletes a photo row, then removes its file (row first, file later). */
export function useDeleteBusinessPhoto(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: deleteBusinessPhoto,
    onSuccess: () => {
      void runPhotoCleanup();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: menuKey(businessId) }),
  });
}
