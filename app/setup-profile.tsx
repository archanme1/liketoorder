import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { SetupProfileForm } from '@/features/profile/components/SetupProfileForm';

export default function SetupProfileScreen() {
  return (
    <AuthScreen title="Set up your profile" subtitle="This is how other people will see you.">
      <SetupProfileForm />
    </AuthScreen>
  );
}
