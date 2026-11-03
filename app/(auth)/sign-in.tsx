import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { SignInForm } from '@/features/auth/components/SignInForm';
import { useCloseAuth } from '@/features/auth/hooks/useCloseAuth';

export default function SignInScreen() {
  const close = useCloseAuth();
  return (
    <AuthScreen title="Sign in" subtitle="Welcome back to LikeToOrder." onClose={close}>
      <SignInForm />
    </AuthScreen>
  );
}
