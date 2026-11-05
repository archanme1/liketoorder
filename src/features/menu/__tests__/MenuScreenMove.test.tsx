import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { AccessibilityInfo } from 'react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { signedUrls } from '@/features/media/api';
import * as profileApi from '@/features/profile/api';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';
import { supabase } from '@/lib/supabase';

import { MenuAppError, claimPhotoCleanup, getCurrencies, getMenu, moveMenuItem } from '../api';
import { MenuScreen } from '../components/MenuScreen';
import type { Currency, Menu, MenuItem } from '../schema';

// Spec 06 Decision 31: the move is announced only after the server accepts it; a rejected move
// rolls back, shows the banner and announces the failure.

const testClients: QueryClient[] = [];
afterEach(async () => {
  await cleanup();
  testClients.splice(0).forEach((client) => client.clear());
});

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: () => null,
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() } },
}));
jest.mock('@/features/profile/api', () => ({
  ...jest.requireActual('@/features/profile/api'),
  getMyProfile: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMenu: jest.fn(),
  getCurrencies: jest.fn(),
  setMenuCurrency: jest.fn(),
  createMenuItem: jest.fn(),
  updateMenuItem: jest.fn(),
  moveMenuItem: jest.fn(),
  deleteMenuItem: jest.fn(),
  beginPhotoUpload: jest.fn(),
  finishPhotoUpload: jest.fn(),
  deleteBusinessPhoto: jest.fn(),
  claimPhotoCleanup: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  signedUrls: jest.fn(),
  uploadToBucket: jest.fn(),
  removeFromBucket: jest.fn(),
}));
jest.mock('@/features/media/pickImage', () => ({ pickImage: jest.fn() }));
jest.mock('@/features/media/prepareImage', () => ({ prepareImage: jest.fn() }));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const mockedBusiness = getMyBusiness as unknown as jest.Mock;
const mockedProfile = profileApi.getMyProfile as unknown as jest.Mock;
const mockedMenu = getMenu as unknown as jest.Mock;
const mockedCurrencies = getCurrencies as unknown as jest.Mock;
const mockedMove = moveMenuItem as unknown as jest.Mock;
const mockedClaim = claimPhotoCleanup as unknown as jest.Mock;
const mockedSignedUrls = signedUrls as unknown as jest.Mock;
const mockedLocales = getLocales as unknown as jest.Mock;

const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };
const profile: profileApi.Profile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan Me',
  bio: '',
  city: '',
  is_seller: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const restaurant: MyBusiness = {
  id: 'b1',
  type: 'restaurant',
  name: "Joe's Pizza",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  map_lat: 43.65,
  map_lng: -79.38,
  public_address: '1 Main St, Toronto, ON',
  is_listed: true,
  currency_code: 'CAD',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '1 Main St, Toronto, ON', lat: 43.65, lng: -79.38 },
};
const CURRENCIES: Currency[] = [{ code: 'CAD', name: 'Canadian dollar', minor_units: 2 }];

function item(id: string, name: string, position: number, extra: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    business_id: 'b1',
    name,
    description: null,
    price_minor: null,
    is_available: true,
    position,
    ...extra,
  };
}

const threeItems: Menu = {
  items: [item('i1', 'Pizza', 1), item('i2', 'Pasta', 2), item('i3', 'Salad', 3)],
  photos: [],
};
const pizzaMoved: Menu = {
  items: [
    { ...threeItems.items[1], position: 1 },
    { ...threeItems.items[0], position: 2 },
    threeItems.items[2],
  ],
  photos: [],
};

async function renderScreen() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  testClients.push(client);
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MenuScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

function listOrder(): string[] {
  return screen
    .getAllByRole('switch')
    .map((sw) => String(sw.props.accessibilityLabel).replace(/ available$/, ''));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// All the text under a rendered node, whether it is a Text itself or a container of Texts.
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const props = (node as { props?: { children?: unknown } }).props;
  return textOf(props?.children);
}

const movedCalls = () =>
  announce.mock.calls.filter(([message]) => /moved to position/i.test(String(message)));

let announce: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockedBusiness.mockReset();
  mockedBusiness.mockResolvedValue(restaurant);
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  mockedMenu.mockReset();
  mockedMenu.mockResolvedValue(threeItems);
  mockedCurrencies.mockReset();
  mockedCurrencies.mockResolvedValue(CURRENCIES);
  mockedMove.mockReset();
  mockedMove.mockResolvedValue(undefined);
  mockedClaim.mockReset();
  mockedClaim.mockResolvedValue([]);
  mockedSignedUrls.mockReset();
  mockedSignedUrls.mockImplementation(async (_b: string, paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed.test/${p}`])),
  );
  mockedLocales.mockReturnValue([
    { languageTag: 'en-US', languageCode: 'en', currencyCode: 'USD' },
  ]);
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

afterEach(() => {
  announce.mockRestore();
});

describe('MenuScreen: move announcement (Decision 31)', () => {
  it('announces "<name> moved to position k of n" only after the server accepted the move', async () => {
    const pending = deferred<void>();
    mockedMove.mockReturnValue(pending.promise);
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });

    await fireEvent.press(screen.getByRole('button', { name: 'Move Pizza down' }));
    expect(mockedMove).toHaveBeenCalledWith('i1', 'down');
    await waitFor(() => expect(listOrder()).toEqual(['Pasta', 'Pizza', 'Salad']));
    // The server has not answered: nothing is announced yet.
    expect(movedCalls()).toHaveLength(0);

    mockedMenu.mockResolvedValue(pizzaMoved);
    await act(async () => {
      pending.resolve();
    });

    await waitFor(() => expect(announce).toHaveBeenCalledWith('Pizza moved to position 2 of 3'));
    expect(movedCalls()).toHaveLength(1);
  });

  it('on a rejected move: no "moved" announcement, shows the banner, announces the failure, restores the order', async () => {
    const pending = deferred<void>();
    mockedMove.mockReturnValue(pending.promise);
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });

    await fireEvent.press(screen.getByRole('button', { name: 'Move Pizza down' }));
    await waitFor(() => expect(listOrder()).toEqual(['Pasta', 'Pizza', 'Salad']));
    expect(movedCalls()).toHaveLength(0);

    await act(async () => {
      pending.reject(new MenuAppError('network'));
    });

    const banner = await screen.findByRole('alert');
    // The banner starts with a warning glyph that isn't part of the message.
    const bannerText = textOf(banner).replace(/^[^\p{L}\p{N}]+/u, '').trim();
    expect(bannerText.length).toBeGreaterThan(0);

    await waitFor(() => expect(listOrder()).toEqual(['Pizza', 'Pasta', 'Salad']));
    expect(movedCalls()).toHaveLength(0);
    await waitFor(() =>
      expect(announce.mock.calls.some(([message]) => String(message).includes(bannerText))).toBe(
        true,
      ),
    );
    expect(screen.getByRole('button', { name: 'Move Pizza up' })).toBeDisabled();
  });
});

describe('MenuScreen: disabled end buttons', () => {
  it('has the first Move up and the last Move down disabled, and their onPress does not move anything', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    const firstUp = screen.getByRole('button', { name: 'Move Pizza up' });
    const lastDown = screen.getByRole('button', { name: 'Move Salad down' });
    expect(firstUp.props.accessibilityState).toMatchObject({ disabled: true });
    expect(lastDown.props.accessibilityState).toMatchObject({ disabled: true });

    // The host has no onPress, so activate through its onClick (a screen reader's double tap).
    await act(async () => {
      firstUp.props.onClick({ stopPropagation: () => {}, nativeEvent: {} });
      lastDown.props.onClick({ stopPropagation: () => {}, nativeEvent: {} });
    });
    await fireEvent.press(firstUp);
    await fireEvent.press(lastDown);

    expect(mockedMove).not.toHaveBeenCalled();
    expect(movedCalls()).toHaveLength(0);
  });
});

describe('MenuScreen: accessible names', () => {
  it('gives every switch and every button a non-empty accessibility name', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    for (const sw of switches) {
      expect(String(sw.props.accessibilityLabel ?? '').trim().length).toBeGreaterThan(0);
    }
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(String(button.props.accessibilityLabel ?? '').trim().length).toBeGreaterThan(0);
    }
  });
});
