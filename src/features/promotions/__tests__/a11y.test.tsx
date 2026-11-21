import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, Animated, LayoutAnimation, StyleSheet } from 'react-native';

import { useSession } from '@/features/auth/hooks/useSession';
import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';
import { supabase } from '@/lib/supabase';
import { size } from '@/theme/tokens';

import { createFakeServer, storedRow, type FakeServer } from '../__fixtures__/promotion';
import { PromoteScreen } from '../components/PromoteScreen';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Redirect: () => null,
}));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/features/auth/hooks/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/features/navigation/hooks/useIsSeller', () => ({ useIsSeller: () => true }));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;

const BUSINESS: MyBusiness = {
  id: 'b1',
  type: 'homemade',
  name: 'Home Kitchen',
  cuisine_code: 'VN',
  accepts_table_requests: false,
  map_lat: 43.9,
  map_lng: -78.86,
  public_address: null,
  is_listed: true,
  currency_code: 'CAD',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '9 Elm Rd, Oshawa, ON', lat: 43.9, lng: -78.86 },
};

let client: QueryClient;
let server: FakeServer;
let animations: jest.SpyInstance[];

beforeEach(() => {
  jest.mocked(useSession).mockReturnValue({
    session: { user: { id: 'u1' } },
    isRecovering: false,
  } as unknown as ReturnType<typeof useSession>);
  jest.mocked(getMyBusiness).mockResolvedValue(BUSINESS);
  server = createFakeServer();
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => server.rpc(name, args));
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  animations = [
    jest.spyOn(LayoutAnimation, 'configureNext'),
    jest.spyOn(Animated, 'timing'),
    jest.spyOn(Animated, 'spring'),
    jest.spyOn(Animated, 'loop'),
  ];
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  jest.restoreAllMocks();
  resetModuleMocks('@/lib/supabase', '@/features/auth/hooks/useSession', '@/features/sellers/api');
});

async function renderScreen() {
  client = new QueryClient(testClientOptions());
  await render(
    <QueryClientProvider client={client}>
      <PromoteScreen />
    </QueryClientProvider>,
  );
}

const minHeight = (element: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(element.props.style as never) as { minHeight?: number } | undefined)
    ?.minHeight ?? 0;

describe('Promote screen accessibility', () => {
  it('gives every button and choice a label, a role and a 44 pt target', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: 'Send request' });
    const targets = [...screen.getAllByRole('button'), ...screen.getAllByRole('radio')];
    expect(targets.length).toBeGreaterThan(15);
    for (const target of targets) {
      expect(target.props.accessibilityLabel).toEqual(expect.any(String));
      expect(minHeight(target)).toBeGreaterThanOrEqual(size.touch);
    }
  });

  it('marks each choice selected or not for screen readers', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: 'Send request' });
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.props.accessibilityState).toEqual({ selected: expect.any(Boolean) });
    }
  });

  it('has a header', async () => {
    await renderScreen();
    expect(await screen.findByRole('header', { name: 'Promote your business' })).toBeTruthy();
  });

  it('reads the status card as one element, all in words', async () => {
    server.rows.push(storedRow('active'));
    await renderScreen();
    const card = await screen.findByLabelText(
      /^Promoted until .+\. Special offer\. Headline: Two bowls of pho for the price of one\.$/,
    );
    expect(card.props.accessible).toBe(true);
  });

  it('reads a waiting request with its price and preferred start', async () => {
    server.rows.push(storedRow('requested'));
    await renderScreen();
    expect(
      await screen.findByLabelText(
        /^Waiting for review\. We'll contact you about payment\. Special offer\. Headline: .+\. CAD.25\.00 for 7 days\. Preferred start: As soon as possible\.$/,
      ),
    ).toBeTruthy();
  });

  it('announces errors as alerts', async () => {
    server.rows.push(storedRow('active'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel promotion' }));
    server.failNext();
    const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? [];
    await act(async () => {
      buttons.find((b) => b.text === 'Cancel promotion')?.onPress?.();
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      "Can't reach LikeToOrder. Check your connection and try again.",
    );
  });

  it('never animates (Reduce Motion needs nothing to switch off)', async () => {
    server.rows.push(storedRow('ended'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Promote again' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Featured' }));
    await fireEvent.changeText(screen.getByLabelText('Headline'), 'a'.repeat(61));
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    for (const spy of animations) expect(spy).not.toHaveBeenCalled();
  });
});
