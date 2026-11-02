import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { applyProfileError } from '../formErrors';
import { useUpdateMyProfile } from '../hooks/useUpdateMyProfile';
import { setupProfileSchema, USERNAME_HINT, type SetupProfileValues } from '../schema';

const FIELDS = ['display_name', 'username'] as const;

// Shown once after the first confirmed sign-in. Success needs no navigation: the saved
// username completes the profile and the route guard switches to home.
export function SetupProfileForm() {
  const { space } = useTheme();
  const update = useUpdateMyProfile();
  const [banner, setBanner] = useState<string | null>(null);
  const { control, handleSubmit, setError } = useForm<SetupProfileValues>({
    resolver: zodResolver(setupProfileSchema),
    defaultValues: { display_name: '', username: '' },
  });

  const onSubmit = handleSubmit((values) => {
    setBanner(null);
    update.mutate(values, {
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
            autoComplete="username-new"
            textContentType="username"
            onSubmitEditing={() => onSubmit()}
          />
        )}
      />
      <Button title="Continue" onPress={onSubmit} loading={update.isPending} />
    </View>
  );
}
