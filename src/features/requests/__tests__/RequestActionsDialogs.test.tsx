import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { RequestAppError, respondToRequest } from '../api';
import { RequestActions } from '../components/RequestActions';
import type { SellerRequest } from '../schema';

import { REQUEST_ID } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  respondToRequest: jest.fn(),
  markRequestOutcome: jest.fn(),
}));

const respondMock = jest.mocked(respondToRequest);
const TZ = { timeZone: 'UTC', locale: 'en-US' };
const homemadeRequest = () =>
  makeSellerRequest({ business_type: 'homemade', business_name: 'Nonna Rosa' });

let client: QueryClient;
async function renderActions(request: SellerRequest = makeSellerRequest()) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const tree = (current: SellerRequest) => (
    <QueryClientProvider client={client}>
      <RequestActions request={current} pickupPassed={false} {...TZ} />
    </QueryClientProvider>
  );
  const view = await render(tree(request));
  return { rerender: (next: SellerRequest) => view.rerender(tree(next)) };
}

beforeEach(() => {
  jest.clearAllMocks();
  respondMock.mockReset();
  respondMock.mockImplementation(async (_id, decision) =>
    makeSellerRequest({ status: decision, display_status: decision }),
  );
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

const confirmButton = (name: RegExp) => screen.getByRole('button', { name });
const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean } } }) =>
  el.props.accessibilityState?.disabled === true;
const open = async (action: 'Accept' | 'Decline') =>
  fireEvent.press(await screen.findByRole('button', { name: new RegExp(`^${action} request`) }));

describe('Accept: the optional note', () => {
  it('opens a dialog with the note box, and hides the action buttons behind it', async () => {
    await renderActions();
    await open('Accept');
    expect(screen.getByText('Accept this request?')).toBeOnTheScreen();
    expect(screen.getByLabelText('Note for the customer (optional)')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Accept request/ })).toBeNull();
    expect(respondMock).not.toHaveBeenCalled();
  });

  it('sends no note for an empty box (the plain two-argument call)', async () => {
    await renderActions();
    await open('Accept');
    await fireEvent.press(confirmButton(/^Yes, accept request/));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock.mock.calls[0]).toEqual([REQUEST_ID, 'accepted']);
  });

  it('sends a blank note (spaces only) as none', async () => {
    await renderActions();
    await open('Accept');
    await fireEvent.changeText(screen.getByLabelText('Note for the customer (optional)'), '   ');
    await fireEvent.press(confirmButton(/^Yes, accept request/));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock.mock.calls[0]).toEqual([REQUEST_ID, 'accepted']);
  });

  it('sends the note, trimmed', async () => {
    await renderActions();
    await open('Accept');
    await fireEvent.changeText(
      screen.getByLabelText('Note for the customer (optional)'),
      '  Please bring a bag ',
    );
    await fireEvent.press(confirmButton(/^Yes, accept request/));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock.mock.calls[0]).toEqual([
      REQUEST_ID,
      'accepted',
      { note: 'Please bring a bag' },
    ]);
  });

  it('keeps Confirm off while the note is over 200 characters', async () => {
    await renderActions();
    await open('Accept');
    await fireEvent.changeText(
      screen.getByLabelText('Note for the customer (optional)'),
      'x'.repeat(201),
    );
    expect(isDisabled(confirmButton(/^Yes, accept request/))).toBe(true);
    await fireEvent.changeText(
      screen.getByLabelText('Note for the customer (optional)'),
      'x'.repeat(200),
    );
    expect(isDisabled(confirmButton(/^Yes, accept request/))).toBe(false);
  });

  it('says the exact address will be shown, and not to type it, for a homemade cook only', async () => {
    await renderActions(homemadeRequest());
    await open('Accept');
    expect(screen.getByText(/Your exact address will be shown to the customer/)).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Your address is shared automatically after you accept, so don't type it here",
      ),
    ).toBeOnTheScreen();
  });

  it('says nothing about an address for a restaurant', async () => {
    await renderActions();
    await open('Accept');
    expect(screen.queryByText(/address/i)).toBeNull();
  });

  it('closes with Go back and sends nothing', async () => {
    await renderActions();
    await open('Accept');
    await fireEvent.press(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByText('Accept this request?')).toBeNull();
    expect(screen.getByRole('button', { name: /^Accept request/ })).toBeOnTheScreen();
    expect(respondMock).not.toHaveBeenCalled();
  });
});

describe('Decline: the reason', () => {
  it('opens the picker with nothing chosen, and Confirm off with a spoken reason', async () => {
    await renderActions();
    await open('Decline');
    expect(screen.getByText('Decline this request?')).toBeOnTheScreen();
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    const confirm = confirmButton(/^Yes, decline request/);
    expect(isDisabled(confirm)).toBe(true);
    expect(confirm.props.accessibilityHint).toBe('Choose a reason first');
    expect(screen.getByText('Choose a reason first')).toBeOnTheScreen();
    expect(screen.queryByText(/address/i)).toBeNull();
  });

  it('does not send a decline without a reason, even if Confirm is pressed', async () => {
    await renderActions();
    await open('Decline');
    await fireEvent.press(confirmButton(/^Yes, decline request/));
    expect(respondMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Sold out', 'sold_out'],
    ['Closed at that time', 'closed_then'],
    ['Too busy right now', 'too_busy'],
    ["Can't prepare this order", 'cannot_prepare'],
    ["Pickup time doesn't work", 'time_not_possible'],
  ])('sends the code alone for "%s"', async (label, code) => {
    await renderActions();
    await open('Decline');
    await fireEvent.press(screen.getByRole('radio', { name: label }));
    const confirm = confirmButton(/^Yes, decline request/);
    expect(isDisabled(confirm)).toBe(false);
    await fireEvent.press(confirm);
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock.mock.calls[0]).toEqual([REQUEST_ID, 'declined', { declineReason: code }]);
  });

  it("needs the seller's own words for Other (1 to 200 characters)", async () => {
    await renderActions();
    await open('Decline');
    await fireEvent.press(screen.getByRole('radio', { name: 'Other' }));
    expect(isDisabled(confirmButton(/^Yes, decline request/))).toBe(true);
    expect(screen.getByText('Write your reason first')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Your reason'), '   ');
    expect(isDisabled(confirmButton(/^Yes, decline request/))).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Your reason'), 'x'.repeat(201));
    expect(isDisabled(confirmButton(/^Yes, decline request/))).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Your reason'), 'Oven broke');
    const confirm = confirmButton(/^Yes, decline request/);
    expect(isDisabled(confirm)).toBe(false);
    await fireEvent.press(confirm);
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock.mock.calls[0]).toEqual([
      REQUEST_ID,
      'declined',
      { declineReason: 'other', note: 'Oven broke' },
    ]);
  });

  it('sends no words with a fixed reason chosen after typing for Other', async () => {
    await renderActions();
    await open('Decline');
    await fireEvent.press(screen.getByRole('radio', { name: 'Other' }));
    await fireEvent.changeText(screen.getByLabelText('Your reason'), 'Oven broke');
    await fireEvent.press(screen.getByRole('radio', { name: 'Sold out' }));
    await fireEvent.press(confirmButton(/^Yes, decline request/));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock.mock.calls[0]).toEqual([
      REQUEST_ID,
      'declined',
      { declineReason: 'sold_out' },
    ]);
  });

  it('has rows of at least 44 pt and a Confirm that can be reached by scrolling', async () => {
    await renderActions();
    await open('Decline');
    for (const radio of screen.getAllByRole('radio')) {
      expect(StyleSheet.flatten(radio.props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
    // The dialog scrolls and keeps taps working while the keyboard is open.
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).toContain('"keyboardShouldPersistTaps":"handled"');
    expect(tree).toContain('"automaticallyAdjustKeyboardInsets":true');
  });
});

describe('while an answer is sent', () => {
  it('sends one decision for a double tap, and turns every button off with progress', async () => {
    let finish: (r: SellerRequest) => void = () => undefined;
    respondMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await renderActions();
    await open('Decline');
    await fireEvent.press(screen.getByRole('radio', { name: 'Sold out' }));
    try {
      const confirm = confirmButton(/^Yes, decline request/);
      await fireEvent.press(confirm);
      await fireEvent.press(confirmButton(/^Yes, decline request/));
      expect(respondMock).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(confirmButton(/^Yes, decline request/).props.accessibilityState).toEqual(
          expect.objectContaining({ disabled: true, busy: true }),
        ),
      );
      expect(isDisabled(screen.getByRole('button', { name: 'Go back' }))).toBe(true);
    } finally {
      await act(async () =>
        finish(makeSellerRequest({ status: 'declined', display_status: 'declined' })),
      );
    }
  });

  it('keeps the dialog open with the typed words when the server says the text is wrong', async () => {
    respondMock.mockRejectedValueOnce(new RequestAppError('invalid_text'));
    await renderActions();
    await open('Accept');
    await fireEvent.changeText(screen.getByLabelText('Note for the customer (optional)'), 'Hello');
    await fireEvent.press(confirmButton(/^Yes, accept request/));
    expect(await screen.findByText(/characters we can't send/)).toBeOnTheScreen();
    expect(screen.getByText('Accept this request?')).toBeOnTheScreen();
    expect(screen.getByLabelText('Note for the customer (optional)').props.value).toBe('Hello');
    // Fix it and send again.
    await fireEvent.changeText(screen.getByLabelText('Note for the customer (optional)'), 'Hello!');
    await fireEvent.press(confirmButton(/^Yes, accept request/));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(2));
    expect(respondMock.mock.calls[1]).toEqual([REQUEST_ID, 'accepted', { note: 'Hello!' }]);
  });

  it('keeps the dialog open and the chosen reason on decline_reason_required', async () => {
    respondMock.mockRejectedValueOnce(new RequestAppError('decline_reason_required'));
    await renderActions();
    await open('Decline');
    await fireEvent.press(screen.getByRole('radio', { name: 'Too busy right now' }));
    await fireEvent.press(confirmButton(/^Yes, decline request/));
    expect(await screen.findByText(/Choose a reason before declining/)).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Too busy right now, selected' })).toBeOnTheScreen();
  });

  it('closes the dialog on another error and shows it as a banner, with the actions back', async () => {
    respondMock.mockRejectedValueOnce(new RequestAppError('network'));
    await renderActions();
    await open('Accept');
    await fireEvent.press(confirmButton(/^Yes, accept request/));
    expect(await screen.findByText(/Nothing was changed/)).toBeOnTheScreen();
    expect(screen.queryByText('Accept this request?')).toBeNull();
    expect(screen.getByRole('button', { name: /^Accept request/ })).toBeOnTheScreen();
  });

  it('does not lose what was typed when the request is re-read meanwhile', async () => {
    const { rerender } = await renderActions();
    await open('Decline');
    await fireEvent.press(screen.getByRole('radio', { name: 'Other' }));
    await fireEvent.changeText(screen.getByLabelText('Your reason'), 'Oven broke');
    await rerender(makeSellerRequest({ customer_name: 'Sam Rivera' }));
    expect(screen.getByLabelText('Your reason').props.value).toBe('Oven broke');
    expect(screen.getByRole('radio', { name: 'Other, selected' })).toBeOnTheScreen();
  });
});

describe('the other actions are unchanged', () => {
  it('marking completed still uses the short inline confirm', async () => {
    const accepted = makeSellerRequest({ status: 'accepted', display_status: 'accepted' });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(
      <QueryClientProvider client={client}>
        <RequestActions request={accepted} pickupPassed {...TZ} />
      </QueryClientProvider>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: /^Mark completed/ }));
    expect(screen.getByText('Mark as completed?')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Note for the customer (optional)')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
