import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm';

export default function ForgotPasswordScreen() {
  return (
    <AuthScreen title="Reset password" subtitle="We’ll email you a 6-digit code.">
      <ForgotPasswordForm />
    </AuthScreen>
  );
}
