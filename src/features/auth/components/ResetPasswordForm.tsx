import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner, Button, Text, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useSession } from '../hooks/useSession';
import { useSignOut } from '../hooks/useSignOut';
import { useUpdatePassword } from '../hooks/useUpdatePassword';
import { useVerifyResetCode } from '../hooks/useVerifyResetCode';
import { authErrorMessage, RESET_CODE_SENT } from '../messages';
import {
  PASSWORD_HINT,
  resetCodeSchema,
  resetPasswordSchema,
  type ResetCodeValues,
  type ResetPasswordValues,
} from '../schema';

type ResetPasswordFormProps = {
  /** From the forgot-password screen; absent after a relaunch mid-recovery. */
  email?: string;
};

// The step comes from isRecovering (not local state) so a relaunch mid-recovery
// lands straight on the new-password step.
export function ResetPasswordForm({ email }: ResetPasswordFormProps) {
  const { isRecovering } = useSession();
  if (isRecovering) return <NewPasswordStep />;
  return <CodeStep email={email} />;
}

function CodeStep({ email }: { email?: string }) {
  const { space } = useTheme();
  const router = useRouter();
  const verify = useVerifyResetCode();
  const { control, handleSubmit, setError } = useForm<ResetCodeValues>({
    resolver: zodResolver(resetCodeSchema),
    defaultValues: { code: '' },
  });

  if (!email) {
    return (
      <View style={{ gap: space.lg }}>
        <Text>Start again to get a new reset code.</Text>
        <Button title="Reset password" onPress={() => router.replace('/forgot-password')} />
      </View>
    );
  }

  const onSubmit = handleSubmit(({ code }) => {
    verify.mutate(
      { email, code },
      {
        onError: (error) => {
          if (error.code === 'invalid_code') {
            setError('code', { message: authErrorMessage('invalid_code') });
          }
        },
      },
    );
  });

  const serverError =
    verify.error && verify.error.code !== 'invalid_code'
      ? authErrorMessage(verify.error.code)
      : null;

  return (
    <View style={{ gap: space.lg }}>
      <Text color="textMuted">{RESET_CODE_SENT}</Text>
      {serverError ? <Banner message={serverError} /> : null}
      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <TextField
            label="Reset code"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            onSubmitEditing={() => onSubmit()}
          />
        )}
      />
      <Button title="Verify" onPress={onSubmit} loading={verify.isPending} />
      <Button title="Back to sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
    </View>
  );
}

function NewPasswordStep() {
  const { space } = useTheme();
  const router = useRouter();
  // Both succeed by clearing isRecovering, which unmounts this step, so navigation goes in the
  // hook-level onSuccess (a mutate() callback would be dropped).
  // Saving: the guard also redirects to the Profile tab; this carries the notice for the banner.
  const update = useUpdatePassword({
    onSuccess: () =>
      router.replace({ pathname: '/profile', params: { notice: 'password-updated' } }),
  });
  // Cancel: guests can still reach reset-password, so leave it for the guest prompt.
  const signOut = useSignOut({ onSuccess: () => router.replace('/profile') });
  const { control, handleSubmit, setError } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(({ password }) => {
    update.mutate(
      { password },
      {
        onError: (error) => {
          if (error.code === 'weak_password') {
            setError('password', { message: authErrorMessage('weak_password') });
          }
        },
      },
    );
  });

  const serverError =
    update.error && update.error.code !== 'weak_password'
      ? authErrorMessage(update.error.code)
      : signOut.error
        ? authErrorMessage(signOut.error.code)
        : null;

  return (
    <View style={{ gap: space.lg }}>
      <Text>Choose a new password for your account.</Text>
      {serverError ? <Banner message={serverError} /> : null}
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <TextField
            label="New password"
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
            label="Confirm new password"
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
      <Button title="Save password" onPress={onSubmit} loading={update.isPending} />
      <Button
        title="Cancel"
        variant="secondary"
        accessibilityHint="Signs you out without changing your password"
        onPress={() => signOut.mutate()}
        loading={signOut.isPending}
        disabled={update.isPending}
      />
    </View>
  );
}
