import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { supabase } from '@/lib/supabase';

import { createFakeServer, NOW, pgError, type FakeServer } from '../__fixtures__/promotion';
import { PromoteForm } from '../components/PromoteForm';
import { promotionErrorMessage } from '../messages';
import { CATEGORY_REQUIRED, HEADLINE_MESSAGES } from '../schema';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;
const cp = (...points: number[]) => String.fromCodePoint(...points);
// The field-error prefix (U+26A0).
const WARNING = cp(0x26a0);

let client: QueryClient;
let server: FakeServer;
let announce: jest.SpyInstance;
const onSent = jest.fn();
const onError = jest.fn();

beforeEach(() => {
  server = createFakeServer();
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => server.rpc(name, args));
  announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  jest.restoreAllMocks();
  resetModuleMocks('@/lib/supabase');
});

async function renderForm() {
  client = new QueryClient(testClientOptions());
  await render(
    <QueryClientProvider client={client}>
      <PromoteForm
        onSent={onSent}
        onError={onError}
        now={NOW}
        timeZone="America/Toronto"
        locale="en-CA"
      />
    </QueryClientProvider>,
  );
}

const headline = () => screen.getByLabelText('Headline');
const requests = () => rpc.mock.calls.filter(([name]) => name === 'request_promotion');
const send = () => fireEvent.press(screen.getByRole('button', { name: 'Send request' }));

describe('PromoteForm: category', () => {
  it('offers the three categories in plain words, none chosen', async () => {
    await renderForm();
    for (const name of ['New on the menu', 'Special offer', 'Featured']) {
      expect(screen.getByRole('radio', { name })).toBeTruthy();
    }
    expect(
      screen.queryByRole('radio', { name: /^(New on the menu|Special offer|Featured), selected$/ }),
    ).toBeNull();
  });

  it('asks for a category and sends nothing without one', async () => {
    await renderForm();
    await fireEvent.changeText(headline(), 'Fresh tacos');
    await send();
    expect(await screen.findByText(`${WARNING} ${CATEGORY_REQUIRED}`)).toBeTruthy();
    expect(requests()).toHaveLength(0);
  });

  it('marks the chosen category with a word, not colour alone', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Featured' }));
    const chosen = screen.getByRole('radio', { name: 'Featured, selected' });
    expect(chosen.props.accessibilityState).toEqual({ selected: true });
  });
});

describe('PromoteForm: headline', () => {
  it('counts characters live: "5/60", spoken "5 of 60 characters"', async () => {
    await renderForm();
    expect(screen.getByLabelText('0 of 60 characters')).toBeTruthy();
    await fireEvent.changeText(headline(), '  Tacos  ');
    expect(screen.getByText('5/60')).toBeTruthy();
    expect(screen.getByLabelText('5 of 60 characters')).toBeTruthy();
  });

  it('says Too long in words over 60', async () => {
    await renderForm();
    await fireEvent.changeText(headline(), 'a'.repeat(61));
    expect(screen.getByText('61/60 Too long')).toBeTruthy();
    expect(screen.getByLabelText('61 of 60 characters, too long')).toBeTruthy();
  });

  it('counts an emoji as one character, as the server does', async () => {
    await renderForm();
    await fireEvent.changeText(headline(), 'Taco ' + cp(0x1f32e));
    expect(screen.getByText('6/60')).toBeTruthy();
  });

  it('announces politely only at the thresholds', async () => {
    await renderForm();
    await fireEvent.changeText(headline(), 'a'.repeat(20));
    expect(announce).not.toHaveBeenCalled();
    await fireEvent.changeText(headline(), 'a'.repeat(50));
    expect(announce).toHaveBeenLastCalledWith('10 characters left');
    await fireEvent.changeText(headline(), 'a'.repeat(60));
    expect(announce).toHaveBeenLastCalledWith('60 characters, the limit');
    await fireEvent.changeText(headline(), 'a'.repeat(61));
    expect(announce).toHaveBeenLastCalledWith('Headline too long');
    await fireEvent.changeText(headline(), 'a'.repeat(62));
    expect(announce).toHaveBeenCalledTimes(3);
  });

  it('keeps a pasted two-line text on one line', async () => {
    await renderForm();
    await fireEvent.changeText(headline(), 'Fresh tacos' + cp(0x0d, 0x0a) + 'every day');
    expect(headline().props.value).toBe('Fresh tacos every day');
  });

  it.each([
    ['an email', 'Write to tacos@example.com', HEADLINE_MESSAGES.contact],
    ['a phone number', 'Call 416 555 0199', HEADLINE_MESSAGES.contact],
    ['a combined emoji', 'Meet our ' + cp(0x1f469, 0x200d, 0x1f373), HEADLINE_MESSAGES.joiner],
    ['a hidden character', 'Taco' + cp(0x200b) + 'night', HEADLINE_MESSAGES.hidden],
    ['61 characters', 'a'.repeat(61), HEADLINE_MESSAGES.too_long],
    ['nothing', '   ', HEADLINE_MESSAGES.empty],
  ])('refuses %s before sending', async (_name, text, message) => {
    await renderForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Featured' }));
    await fireEvent.changeText(headline(), text);
    await send();
    expect(await screen.findByText(`${WARNING} ${message}`)).toBeTruthy();
    expect(requests()).toHaveLength(0);
  });

  it('sends the trimmed headline', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Featured' }));
    await fireEvent.changeText(headline(), '  Fresh tacos  ');
    await send();
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(requests()[0][1].p_headline).toBe('Fresh tacos');
  });
});

describe('PromoteForm: preferred start', () => {
  it('offers As soon as possible (chosen) and the 14 days from tomorrow, spoken in full', async () => {
    await renderForm();
    expect(screen.getByLabelText('Preferred start').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'As soon as possible, selected' })).toBeTruthy();
    // NOW is Friday 20 Nov in Toronto: tomorrow is Saturday 21 Nov, the last is Friday 4 Dec.
    expect(screen.getByRole('radio', { name: 'Saturday, November 21' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Friday, December 4' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Friday, November 20' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Saturday, December 5' })).toBeNull();
    expect(screen.getByText('Sat, Nov 21')).toBeTruthy();
    expect(screen.getByText("We'll confirm the exact dates after payment.")).toBeTruthy();
  });

  it('sends null for As soon as possible', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Special offer' }));
    await fireEvent.changeText(headline(), 'Fresh tacos');
    await send();
    await waitFor(() => expect(requests()).toHaveLength(1));
    expect(requests()[0][1]).toEqual({
      p_category: 'special_offer',
      p_headline: 'Fresh tacos',
      p_preferred_start: null,
    });
  });

  it('sends the chosen calendar day', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'New on the menu' }));
    await fireEvent.changeText(headline(), 'Fresh tacos');
    await fireEvent.press(screen.getByRole('radio', { name: 'Saturday, November 21' }));
    await send();
    await waitFor(() => expect(requests()).toHaveLength(1));
    expect(requests()[0][1].p_preferred_start).toBe('2026-11-21');
  });
});

describe('PromoteForm: when the server still refuses', () => {
  async function fillAndSend() {
    await renderForm();
    await fireEvent.press(screen.getByRole('radio', { name: 'Featured' }));
    await fireEvent.changeText(headline(), 'Fresh tacos');
    await fireEvent.press(screen.getByRole('radio', { name: 'Saturday, November 21' }));
    await send();
  }

  it('puts invalid_headline on the headline field and keeps the text', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: pgError('invalid_headline') });
    await fillAndSend();
    expect(
      await screen.findByText(`${WARNING} ${promotionErrorMessage('invalid_headline')}`),
    ).toBeTruthy();
    expect(headline().props.value).toBe('Fresh tacos');
    expect(onError).toHaveBeenCalledWith('invalid_headline');
    expect(onSent).not.toHaveBeenCalled();
  });

  it('puts invalid_category on the category group', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: pgError('invalid_category') });
    await fillAndSend();
    expect(
      await screen.findByText(`${WARNING} ${promotionErrorMessage('invalid_category')}`),
    ).toBeTruthy();
    expect(onError).toHaveBeenCalledWith('invalid_category');
  });

  it('moves the start back to As soon as possible on invalid_start', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: pgError('invalid_start') });
    await fillAndSend();
    await waitFor(() => expect(onError).toHaveBeenCalledWith('invalid_start'));
    expect(screen.getByRole('radio', { name: 'As soon as possible, selected' })).toBeTruthy();
  });

  it('passes too_many_requests to the screen without touching the fields', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: pgError('too_many_requests') });
    await fillAndSend();
    await waitFor(() => expect(onError).toHaveBeenCalledWith('too_many_requests'));
    expect(headline().props.value).toBe('Fresh tacos');
    expect(screen.getByRole('radio', { name: 'Saturday, November 21, selected' })).toBeTruthy();
  });
});
