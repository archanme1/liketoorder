import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { resetLegacyStatusMemoryForTests } from '@/features/requests/legacyStatusMemory';

import { AuthProvider } from '../components/AuthProvider';

// Spec 12: the Requests badge moved to the server, so AuthProvider removes the old per-phone
// memory (liketoorder.requests.seen.v1.*) once when the app starts.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
  },
}));

let client: QueryClient;
beforeEach(async () => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  resetLegacyStatusMemoryForTests();
  await AsyncStorage.clear();
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('AuthProvider and the old badge memory', () => {
  it('removes the old keys once at start, and leaves other keys alone', async () => {
    await AsyncStorage.multiSet([
      ['liketoorder.requests.seen.v1.user-1', '[]'],
      ['liketoorder.auth.isRecovering', '0'],
    ]);
    await render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Text>app</Text>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(async () =>
      expect(await AsyncStorage.getItem('liketoorder.requests.seen.v1.user-1')).toBeNull(),
    );
    expect(await AsyncStorage.getItem('liketoorder.auth.isRecovering')).toBe('0');
  });
});
