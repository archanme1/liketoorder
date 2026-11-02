import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useRequestPasswordReset } from '../hooks/useRequestPasswordReset';
import { authErrorMessage, RESET_CODE_SENT } from '../messages';
import { forgotPasswordSchema, type ForgotPasswordValues } from '../schema';

export function ForgotPasswordForm() {
  const { space } = useTheme();
  const router = useRouter();
  const request = useRequestPasswordReset();
  const { control, handleSubmit } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit((values) => request.mutate(values));

  // Only a network failure is shown; every other outcome gets the same neutral message.
  const serverError = request.error ? authErrorMessage(request.error.code) : null;

  return (
    <View style={{ gap: space.lg }}>
      {serverError ? <Banner message={serverError} /> : null}
      {request.isSuccess ? <Banner tone="info" message={RESET_CODE_SENT} /> : null}
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <TextField
            label="Email"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            onSubmitEditing={() => onSubmit()}
          />
        )}
      />
      {request.isSuccess && request.variables ? (
        <Button
          title="Enter code"
          onPress={() =>
            router.push({
              pathname: '/reset-password',
              params: { email: request.variables.email },
            })
          }
        />
      ) : (
        <Button title="Send reset code" onPress={onSubmit} loading={request.isPending} />
      )}
      <Button title="Back to sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
    </View>
  );
}
