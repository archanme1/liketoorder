import { useSession } from '@/features/auth/hooks/useSession';
import { GuestProfilePrompt } from '@/features/profile/components/GuestProfilePrompt';
import { ProfileScreen } from '@/features/profile/components/ProfileScreen';

// Public tab: guests see the sign-in prompt, signed-in users their profile.
export default function ProfileTab() {
  const { session } = useSession();
  return session ? <ProfileScreen /> : <GuestProfilePrompt />;
}
