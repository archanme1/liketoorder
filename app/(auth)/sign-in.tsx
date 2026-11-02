import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { SignInForm } from '@/features/auth/components/SignInForm';

export default function SignInScreen() {
  return (
    <AuthScreen title="Sign in" subtitle="Welcome back to LikeToOrder.">
      <SignInForm />
    </AuthScreen>
  );
}
