import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { EditProfileForm } from '@/features/profile/components/EditProfileForm';

export default function EditProfileScreen() {
  return (
    <AuthScreen title="Edit profile">
      <EditProfileForm />
    </AuthScreen>
  );
}
