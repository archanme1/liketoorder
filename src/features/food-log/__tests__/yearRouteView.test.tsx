import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';

// The app's shared client, not an own QueryClient: the real router renders app/_layout.tsx, which
// provides this one (as in yearRoute.test.tsx). It is cleared before and after.
import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';

import { activityJson, CUISINES_WITH_NEUTRAL, cuisineDaysJson } from '../__fixtures__/foodLog';

// Spec 15: /food-log/year?view=cuisine opens Your year in the Cuisine view; any other value, or
// none, opens Activity. Real app/ routes, supabase mocked (the yearRoute.test.tsx pattern).

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
      table === 'cuisines'
        ? { data: CUISINES_WITH_NEUTRAL, error: null }
        : { data: profile, error: null };
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
    if (name === 'get_my_food_log_cuisine_days') {
      return { data: cuisineDaysJson({}, 53), error: null };
    }
    if (name === 'list_my_food_logs_on') return { data: { items: [] }, error: null };
    return { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } };
  });
}

function rpcNames(): string[] {
  return mocked.rpc.mock.calls.map(([name]) => name as string);
}

describe('/food-log/year and its view param', () => {
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

  it('?view=cuisine opens Your year in the Cuisine view', async () => {
    await renderRouter('./app', { initialUrl: '/food-log/year?view=cuisine' });
    expect(await screen.findByText('Cuisines, last 53 weeks, 10 uploads')).toBeTruthy();
    expect(screen).toHavePathname('/food-log/year');
    expect(screen.getByRole('radio', { name: 'Cuisine, selected', selected: true })).toBeTruthy();
    await waitFor(() =>
      expect(mocked.rpc).toHaveBeenCalledWith('get_my_food_log_cuisine_days', {
        p_time_zone: 'UTC',
        p_weeks: 53,
      }),
    );
  });

  it.each([
    ['a bad view param', '/food-log/year?view=bogus'],
    ['no view param', '/food-log/year'],
  ])('%s opens Activity and sends no cuisine request', async (_name, initialUrl) => {
    await renderRouter('./app', { initialUrl });
    expect(await screen.findByRole('summary')).toHaveTextContent(
      'Activity, last 53 weeks, 10 uploads',
    );
    expect(screen.getByRole('radio', { name: 'Activity, selected', selected: true })).toBeTruthy();
    expect(rpcNames()).toContain('get_my_food_log_activity');
    expect(rpcNames()).not.toContain('get_my_food_log_cuisine_days');
  });
});
