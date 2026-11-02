import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useSignUp } from '../hooks/useSignUp';
import { authErrorMessage } from '../messages';
import { PASSWORD_HINT, signUpSchema, type SignUpValues } from '../schema';

export function SignUpForm() {
  const { space } = useTheme();
  const router = useRouter();
  const signUp = useSignUp();
  const { control, handleSubmit, setError } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit((values) => {
    signUp.mutate(
      { email: values.email, password: values.password },
      {
        // Same destination for new and already-registered emails (api.signUp makes them identical).
        onSuccess: () =>
          router.push({ pathname: '/verify-email', params: { email: values.email } }),
        onError: (error) => {
          if (error.code === 'weak_password') {
            setError('password', { message: authErrorMessage('weak_password') });
          }
        },
      },
    );
  });

  const serverError =
    signUp.error && signUp.error.code !== 'weak_password'
      ? authErrorMessage(signUp.error.code)
      : null;

  return (
    <View style={{ gap: space.lg }}>
      {serverError ? <Banner message={serverError} /> : null}
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
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <TextField
            label="Password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            hint={PASSWORD_HINT}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
          />
        )}
      />
      <Controller
        control={control}
        name="confirmPassword"
        render={({ field, fieldState }) => (
          <TextField
            label="Confirm password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={() => onSubmit()}
          />
        )}
      />
      <Button title="Create account" onPress={onSubmit} loading={signUp.isPending} />
      <Button
        title="I already have an account"
        variant="ghost"
        onPress={() => router.replace('/sign-in')}
      />
    </View>
  );
}
