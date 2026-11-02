import { useLocalSearchParams } from 'expo-router';

import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm';

export default function ResetPasswordScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  return (
    <AuthScreen title="Reset password">
      <ResetPasswordForm email={email} />
    </AuthScreen>
  );
}
