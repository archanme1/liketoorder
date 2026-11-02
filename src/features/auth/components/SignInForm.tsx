import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useSignIn } from '../hooks/useSignIn';
import { authErrorMessage } from '../messages';
import { signInSchema, type SignInValues } from '../schema';

export function SignInForm() {
  const { space } = useTheme();
  const router = useRouter();
  const signIn = useSignIn();
  const { control, handleSubmit } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit((values) => {
    signIn.mutate(values, {
      onError: (error) => {
        // The one exception to generic errors: an unconfirmed account goes to the code screen.
        if (error.code === 'email_not_confirmed') {
          signIn.reset();
          router.push({ pathname: '/verify-email', params: { email: values.email } });
        }
      },
    });
  });

  const serverError =
    signIn.error && signIn.error.code !== 'email_not_confirmed'
      ? authErrorMessage(signIn.error.code)
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
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            textContentType="password"
            onSubmitEditing={() => onSubmit()}
          />
        )}
      />
      <Button title="Sign in" onPress={onSubmit} loading={signIn.isPending} />
      <Button
        title="Forgot password?"
        variant="ghost"
        onPress={() => router.push('/forgot-password')}
      />
      <Button
        title="Create an account"
        variant="secondary"
        onPress={() => router.push('/sign-up')}
      />
    </View>
  );
}
