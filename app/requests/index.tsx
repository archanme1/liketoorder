import { useRouter } from 'expo-router';

import { MyRequestsScreen } from '@/features/requests/components/MyRequestsScreen';

// My requests (signed-in, profile-complete: the root layout's `app` guard).
export default function MyRequestsRoute() {
  const router = useRouter();
  return (
    <MyRequestsScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
      onOpen={(request) => router.push({ pathname: '/requests/[id]', params: { id: request.id } })}
      onFindPlace={() => router.replace('/restaurants')}
    />
  );
}
