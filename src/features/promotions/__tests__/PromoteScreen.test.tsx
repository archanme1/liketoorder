import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Alert } from 'react-native';

import { useSession } from '@/features/auth/hooks/useSession';
import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';
import { supabase } from '@/lib/supabase';

import {
  createFakeServer,
  PROMOTION_ID,
  storedRow,
  type FakeServer,
} from '../__fixtures__/promotion';
import { PromoteScreen } from '../components/PromoteScreen';
import { formatPromotionPrice, offerLine, phoneLocale, statusText } from '../format';
import { PAYMENT_NOTE, promotionErrorMessage } from '../messages';
import { promotionSchema } from '../schema';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/features/auth/hooks/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/features/navigation/hooks/useIsSeller', () => ({ useIsSeller: () => true }));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;
const mockedBusiness = jest.mocked(getMyBusiness);

const BUSINESS: MyBusiness = {
  id: 'b1',
  type: 'restaurant',
  name: 'Pho Corner',
  cuisine_code: 'VN',
  accepts_table_requests: true,
  map_lat: 43.9,
  map_lng: -78.86,
  public_address: '1 Main St, Oshawa, ON',
  is_listed: true,
  currency_code: 'CAD',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '1 Main St, Oshawa, ON', lat: 43.9, lng: -78.86 },
};

let client: QueryClient;
let server: FakeServer;
let alertSpy: jest.SpyInstance;
let announce: jest.SpyInstance;

beforeEach(() => {
  jest.mocked(useSession).mockReturnValue({
    session: { user: { id: 'u1' } },
    isRecovering: false,
  } as unknown as ReturnType<typeof useSession>);
  mockedBusiness.mockResolvedValue(BUSINESS);
  server = createFakeServer();
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => server.rpc(name, args));
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
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

const calls = (name: string) => rpc.mock.calls.filter(([called]) => called === name);
// The status sentence the screen should show for a stored row.
const status = (state: Parameters<typeof storedRow>[0]) =>
  statusText(promotionSchema.parse(storedRowJson(state)));

// The answer the fake gives for one stored row, through the same schema the app uses.
function storedRowJson(state: Parameters<typeof storedRow>[0]) {
  const row = storedRow(state);
  return {
    id: row.id,
    category: row.category,
    headline: row.headline,
    preferred_start: row.preferred_start,
    state,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    reject_reason: row.reject_reason,
    price_cents: 2500,
    currency_code: 'CAD',
    length_days: 7,
    created_at: row.created_at,
  };
}

/** Presses one button of the last Alert.alert dialog. */
async function pressAlertButton(text: string) {
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  const button = buttons.find((b) => b.text === text);
  if (!button) throw new Error(`No "${text}" button`);
  await act(async () => {
    button.onPress?.();
  });
}

async function fillAndSend(headline = 'Fresh tacos every day') {
  await fireEvent.press(screen.getByRole('radio', { name: 'Featured' }));
  await fireEvent.changeText(screen.getByLabelText('Headline'), headline);
  await fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
}

describe('PromoteScreen: the four screen states', () => {
  it('shows the loading skeleton while the promotion loads', async () => {
    rpc.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(await screen.findByLabelText('Loading your promotion')).toBeTruthy();
  });

  it('shows the error with Try again, which loads the screen', async () => {
    server.failNext();
    await renderScreen();
    expect(await screen.findByText(promotionErrorMessage('network'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Send request' })).toBeTruthy();
    expect(calls('get_my_promotion')).toHaveLength(2);
  });

  it('sends a user with no business to onboarding', async () => {
    mockedBusiness.mockResolvedValue(null);
    await renderScreen();
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/seller/onboarding'));
  });
});

describe('PromoteScreen: no campaign yet', () => {
  it('invites with what it does, the price and length from the server, and the form', async () => {
    await renderScreen();
    expect(await screen.findByRole('header', { name: 'Promote your business' })).toBeTruthy();
    expect(screen.getByText(/larger flag on the map and a card in the Offers list/)).toBeTruthy();
    expect(
      screen.getByText(offerLine(formatPromotionPrice(2500, 'CAD', phoneLocale()), 7)),
    ).toBeTruthy();
    expect(screen.getByText(PAYMENT_NOTE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('says promotions are not available yet when there is no price, with no form', async () => {
    server.settings = null;
    await renderScreen();
    expect(await screen.findByText("Promotions aren't available yet.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });

  it('explains a business that cannot be promoted, and Back to Manage goes back', async () => {
    server.eligible = false;
    await renderScreen();
    expect(await screen.findByText(promotionErrorMessage('not_eligible'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to Manage' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('sends a request and shows it as waiting, never as approved', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: 'Send request' });
    await fillAndSend();
    expect(await screen.findByText(status('requested'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
    expect(screen.getByText('Request sent')).toBeTruthy();
    expect(announce).toHaveBeenCalledWith('Request sent');
    expect(screen.queryByText(/approved|promoted until/i)).toBeNull();
    expect(calls('request_promotion')[0][1]).toEqual({
      p_category: 'featured',
      p_headline: 'Fresh tacos every day',
      p_preferred_start: null,
    });
  });

  it('shows already_open and moves to the real state when a request was sent elsewhere', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: 'Send request' });
    server.rows.push(storedRow('requested')); // sent from another phone meanwhile
    await fillAndSend();
    expect(await screen.findByText(promotionErrorMessage('already_open'))).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Cancel request' })).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(promotionErrorMessage('already_open'));
  });

  it('shows a lost connection and keeps the form filled', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: 'Send request' });
    server.failNext();
    await fillAndSend('Keep this text');
    expect(await screen.findByText(promotionErrorMessage('network'))).toBeTruthy();
    expect(screen.getByLabelText('Headline').props.value).toBe('Keep this text');
  });
});

describe('PromoteScreen: waiting, scheduled and running campaigns', () => {
  it('shows a waiting request with its price snapshot and Cancel request', async () => {
    server.rows.push(storedRow('requested'));
    await renderScreen();
    expect(await screen.findByText(status('requested'))).toBeTruthy();
    expect(screen.getByText('Special offer')).toBeTruthy();
    expect(screen.getByText('Two bowls of pho for the price of one')).toBeTruthy();
    expect(screen.getByText('Preferred start: As soon as possible')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Promote again' })).toBeNull();
  });

  it('asks before cancelling a request; Keep request does nothing', async () => {
    server.rows.push(storedRow('requested'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    expect(alertSpy).toHaveBeenCalledWith(
      'Cancel this request?',
      "We won't review it.",
      expect.any(Array),
    );
    await pressAlertButton('Keep request');
    expect(calls('cancel_my_promotion')).toHaveLength(0);
    expect(screen.getByText(status('requested'))).toBeTruthy();
  });

  it('cancels a request after the confirmation and shows Cancelled with Promote again', async () => {
    server.rows.push(storedRow('requested'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    await pressAlertButton('Cancel request');
    expect(await screen.findByText('Cancelled.')).toBeTruthy();
    expect(calls('cancel_my_promotion')[0][1]).toEqual({ p_promotion_id: PROMOTION_ID });
    expect(screen.getByRole('button', { name: 'Promote again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
    expect(announce).toHaveBeenCalledWith('Request cancelled');
  });

  it('shows a scheduled campaign and asks before cancelling it', async () => {
    server.rows.push(storedRow('scheduled'));
    await renderScreen();
    expect(await screen.findByText(status('scheduled'))).toBeTruthy();
    expect(status('scheduled')).toMatch(/^Starts on .+, ends on .+\.$/);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel promotion' }));
    expect(alertSpy).toHaveBeenCalledWith(
      'Cancel this promotion?',
      "It won't start.",
      expect.any(Array),
    );
    await pressAlertButton('Keep promotion');
    expect(calls('cancel_my_promotion')).toHaveLength(0);
  });

  it('stops a running campaign after the confirmation', async () => {
    server.rows.push(storedRow('active'));
    await renderScreen();
    expect(await screen.findByText(status('active'))).toBeTruthy();
    expect(status('active')).toMatch(/^Promoted until .+\.$/);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel promotion' }));
    expect(alertSpy).toHaveBeenCalledWith(
      'Stop your promotion now?',
      'It ends at once. Refunds are handled outside the app.',
      expect.any(Array),
    );
    await pressAlertButton('Cancel promotion');
    expect(await screen.findByText('Cancelled.')).toBeTruthy();
    expect(announce).toHaveBeenCalledWith('Promotion cancelled');
  });

  it('shows not_found and refreshes when the campaign is gone', async () => {
    server.rows.push(storedRow('requested'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    server.rows.splice(0);
    await pressAlertButton('Cancel request');
    expect(await screen.findByText(promotionErrorMessage('not_found'))).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Send request' })).toBeTruthy();
  });

  it('shows not_cancellable and refreshes when it was cancelled elsewhere', async () => {
    server.rows.push(storedRow('active'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel promotion' }));
    server.rows[0].status = 'cancelled';
    await pressAlertButton('Cancel promotion');
    expect(await screen.findByText(promotionErrorMessage('not_cancellable'))).toBeTruthy();
    expect(await screen.findByText('Cancelled.')).toBeTruthy();
  });
});

describe('PromoteScreen: ended, rejected and cancelled campaigns', () => {
  it.each(['ended', 'rejected', 'cancelled'] as const)(
    'shows a %s campaign with Promote again, which opens the form, and Not now closes it',
    async (state) => {
      server.rows.push(storedRow(state));
      await renderScreen();
      expect(await screen.findByText(status(state))).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();

      await fireEvent.press(screen.getByRole('button', { name: 'Promote again' }));
      expect(screen.getByRole('button', { name: 'Send request' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Promote again' })).toBeNull();

      await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
      expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Promote again' })).toBeTruthy();
    },
  );

  it('words an ended campaign with its end day', async () => {
    server.rows.push(storedRow('ended'));
    await renderScreen();
    expect(await screen.findByText(/^Ended on .+\.$/)).toBeTruthy();
  });

  it('gives the reason for a rejection', async () => {
    server.rows.push(storedRow('rejected'));
    await renderScreen();
    expect(
      await screen.findByText(
        "Not approved: the headline can't be used. You can send a new request with another one.",
      ),
    ).toBeTruthy();
  });

  it('sends a new request after Promote again, replacing the old state', async () => {
    server.rows.push(storedRow('ended'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Promote again' }));
    await fillAndSend();
    expect(await screen.findByText(status('requested'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Promote again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('shows the not-configured message after Promote again when there is no price', async () => {
    server.rows.push(storedRow('ended'));
    server.settings = null;
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Promote again' }));
    expect(screen.getByText("Promotions aren't available yet.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });
});
