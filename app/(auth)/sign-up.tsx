import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { SignUpForm } from '@/features/auth/components/SignUpForm';

export default function SignUpScreen() {
  return (
    <AuthScreen title="Create account" subtitle="One account for ordering and, later, selling.">
      <SignUpForm />
    </AuthScreen>
  );
}
