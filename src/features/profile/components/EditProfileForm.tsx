import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { View } from 'react-native';

import { Banner, Button, EmptyState, ErrorState, Skeleton, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { Profile } from '../api';
import { applyProfileError } from '../formErrors';
import { useMyProfile } from '../hooks/useMyProfile';
import { useUpdateMyProfile } from '../hooks/useUpdateMyProfile';
import { profileErrorMessage } from '../messages';
import {
  BIO_MAX,
  CITY_MAX,
  editProfileSchema,
  USERNAME_HINT,
  type EditProfileValues,
} from '../schema';

const FIELDS = ['display_name', 'username', 'bio', 'city'] as const;

export function EditProfileForm() {
  const { space, size } = useTheme();
  const query = useMyProfile();

  if (query.isPending) {
    return (
      <View accessible accessibilityLabel="Loading profile" style={{ gap: space.lg }}>
        {FIELDS.map((field) => (
          <Skeleton key={field} height={size.touch} />
        ))}
      </View>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={profileErrorMessage(query.error.code)}
        onRetry={() => void query.refetch()}
        retrying={query.isRefetching}
      />
    );
  }
  if (!query.data) {
    return (
      <EmptyState
        message="We couldn’t find your profile."
        actionLabel="Try again"
        onAction={() => void query.refetch()}
      />
    );
  }
  return <EditProfileFields profile={query.data} />;
}

function EditProfileFields({ profile }: { profile: Profile }) {
  const { space } = useTheme();
  const router = useRouter();
  const update = useUpdateMyProfile();
  const [banner, setBanner] = useState<string | null>(null);
  const { control, handleSubmit, setError } = useForm<EditProfileValues>({
    resolver: zodResolver(editProfileSchema),
    defaultValues: {
      display_name: profile.display_name ?? '',
      username: profile.username ?? '',
      bio: profile.bio,
      city: profile.city,
    },
  });
  const bioLength = useWatch({ control, name: 'bio' }).length;
  // Opened from a deep link there is nothing to go back to, so fall back to home.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const onSubmit = handleSubmit((values) => {
    setBanner(null);
    update.mutate(values, {
      onSuccess: close,
      onError: (error) => setBanner(applyProfileError(error, setError, FIELDS)),
    });
  });

  return (
    <View style={{ gap: space.lg }}>
      {banner ? <Banner message={banner} /> : null}
      <Controller
        control={control}
        name="display_name"
        render={({ field, fieldState }) => (
          <TextField
            label="Display name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            autoComplete="name"
            textContentType="name"
          />
        )}
      />
      <Controller
        control={control}
        name="username"
        render={({ field, fieldState }) => (
          <TextField
            label="Username"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            hint={USERNAME_HINT}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
          />
        )}
      />
      <Controller
        control={control}
        name="bio"
        render={({ field, fieldState }) => (
          <TextField
            label="Bio"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            hint={`${bioLength}/${BIO_MAX}`}
            multiline
            maxLength={BIO_MAX}
          />
        )}
      />
      <Controller
        control={control}
        name="city"
        render={({ field, fieldState }) => (
          <TextField
            label="City"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            maxLength={CITY_MAX}
            autoComplete="postal-address-locality"
            textContentType="addressCity"
          />
        )}
      />
      <Button title="Save" onPress={onSubmit} loading={update.isPending} />
      <Button
        title="Cancel"
        variant="secondary"
        accessibilityHint="Discards your changes"
        onPress={close}
        disabled={update.isPending}
      />
    </View>
  );
}
