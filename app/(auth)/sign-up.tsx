import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { SignUpForm } from '@/features/auth/components/SignUpForm';
import { useCloseAuth } from '@/features/auth/hooks/useCloseAuth';

export default function SignUpScreen() {
  const close = useCloseAuth();
  return (
    <AuthScreen
      title="Create account"
      subtitle="One account for ordering and, later, selling."
      onClose={close}
    >
      <SignUpForm />
    </AuthScreen>
  );
}
