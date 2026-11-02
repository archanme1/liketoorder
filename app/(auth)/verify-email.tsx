import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Text } from '@/components/ui';
import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { VerifyEmailForm } from '@/features/auth/components/VerifyEmailForm';

export default function VerifyEmailScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();

  return (
    <AuthScreen title="Check your email">
      {email ? (
        <VerifyEmailForm email={email} />
      ) : (
        <>
          <Text>We couldn’t tell which email to confirm. Sign in to get a new code.</Text>
          <Button title="Go to sign in" onPress={() => router.replace('/sign-in')} />
        </>
      )}
    </AuthScreen>
  );
}
