import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner, Button, Text, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useResendEmailCode } from '../hooks/useResendEmailCode';
import { useVerifyEmailCode } from '../hooks/useVerifyEmailCode';
import { authErrorMessage, RESEND_DONE, VERIFY_EMAIL_HINT } from '../messages';
import { verifyEmailSchema, type VerifyEmailValues } from '../schema';

// Matches [auth.email] max_frequency = "60s" in supabase/config.toml.
export const RESEND_COOLDOWN_SECONDS = 60;

type VerifyEmailFormProps = {
  email: string;
};

export function VerifyEmailForm({ email }: VerifyEmailFormProps) {
  const { space } = useTheme();
  const router = useRouter();
  const verify = useVerifyEmailCode();
  const resend = useResendEmailCode();
  // A code was just sent when this screen opens, so the cooldown starts immediately.
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS);
  const { control, handleSubmit, setError } = useForm<VerifyEmailValues>({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: { code: '' },
  });

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // Success needs no navigation: the SIGNED_IN event switches the route guards.
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

  const onResend = () => {
    resend.mutate({ email }, { onSuccess: () => setSecondsLeft(RESEND_COOLDOWN_SECONDS) });
  };

  const verifyError =
    verify.error && verify.error.code !== 'invalid_code'
      ? authErrorMessage(verify.error.code)
      : null;
  const resendError = resend.error ? authErrorMessage(resend.error.code) : null;
  const coolingDown = secondsLeft > 0;

  return (
    <View style={{ gap: space.lg }}>
      <Text>{`We sent a 6-digit code to ${email}. Enter it below to confirm your email.`}</Text>
      {verifyError ? <Banner message={verifyError} /> : null}
      {resendError ? <Banner message={resendError} /> : null}
      {resend.isSuccess && !resendError ? <Banner tone="info" message={RESEND_DONE} /> : null}
      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <TextField
            label="Confirmation code"
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
      <Button title="Confirm" onPress={onSubmit} loading={verify.isPending} />
      <Button
        title={coolingDown ? `Resend code in ${secondsLeft}s` : 'Resend code'}
        accessibilityLabel={
          coolingDown ? `Resend code, available in ${secondsLeft} seconds` : 'Resend code'
        }
        variant="secondary"
        onPress={onResend}
        disabled={coolingDown}
        loading={resend.isPending}
      />
      <Text color="textMuted">{VERIFY_EMAIL_HINT}</Text>
      <View style={{ gap: space.xs }}>
        <Button title="Sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
        <Button
          title="Reset password"
          variant="ghost"
          onPress={() => router.replace('/forgot-password')}
        />
      </View>
    </View>
  );
}
