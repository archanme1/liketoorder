import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';

// The app's shared client, not an own QueryClient: the real router renders app/_layout.tsx, which
// provides this one (review Q5; as in sellerRouting.test.tsx). It is cleared before and after.
import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';

import { activityJson, CUISINES } from '../__fixtures__/foodLog';
import { FOOD_LOG_NOT_FOUND } from '../messages';

// Real app/ routes, supabase mocked (the sellerRouting.test.tsx pattern). /food-log/year is a
// static route next to the dynamic /food-log/[id]: it must open the year screen and never the
// detail screen asking for a log whose id is "year".

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: jest.fn(),
      signOut: jest.fn(async () => ({ error: null })),
    },
    from: jest.fn(),
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

const mocked = supabase as unknown as {
  auth: { getSession: jest.Mock };
  from: jest.Mock;
  rpc: jest.Mock;
};

const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1', email: 'a@b.com' } };
const profile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan Me',
  bio: '',
  city: '',
  is_seller: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

type Result = { data: unknown; error: unknown };
type Builder = {
  select: () => Builder;
  eq: () => Builder;
  order: () => Builder;
  maybeSingle: () => Promise<Result>;
  then: (resolve: (value: Result) => unknown) => Promise<unknown>;
};

function mockDatabase() {
  mocked.from.mockImplementation((table: string) => {
    const result: Result =
      table === 'cuisines' ? { data: CUISINES, error: null } : { data: profile, error: null };
    const builder: Builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      maybeSingle: async () => result,
      then: (resolve) => Promise.resolve(result).then(resolve),
    };
    return builder;
  });
  mocked.rpc.mockImplementation(async (name: string) => {
    if (name === 'get_my_food_log_activity') return { data: activityJson({}, 53), error: null };
    if (name === 'list_my_food_logs_on') return { data: { items: [] }, error: null };
    // get_food_log included: a log id "year" is not a uuid, so the server says 22P02.
    return { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } };
  });
}

describe('/food-log/year', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    queryClient.clear();
    await AsyncStorage.clear();
    mocked.auth.getSession.mockResolvedValue({ data: { session } });
    mockDatabase();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('opens the year screen, never the detail screen for an id "year"', async () => {
    await renderRouter('./app', { initialUrl: '/food-log/year' });
    expect(await screen.findByRole('summary')).toHaveTextContent(
      'Activity, last 53 weeks, 10 uploads',
    );
    expect(screen).toHavePathname('/food-log/year');
    // The native stack header ("Your year") is not rendered under jest; the Simulator run checks
    // it. The year screen is the one ActivitySection without "View full year".
    expect(screen.queryByRole('button', { name: 'View full year' })).toBeNull();

    await waitFor(() =>
      expect(mocked.rpc).toHaveBeenCalledWith('get_my_food_log_activity', {
        p_time_zone: 'UTC',
        p_weeks: 53,
      }),
    );
    expect(mocked.rpc.mock.calls.map(([name]) => name)).not.toContain('get_food_log');
    expect(mocked.rpc).not.toHaveBeenCalledWith(expect.anything(), { p_id: 'year' });
    expect(screen.queryByText(FOOD_LOG_NOT_FOUND)).toBeNull();
  });
});
