import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { ROW_TITLE_MAX_FONT_MULTIPLIER, SellerRequestRow } from '../components/SellerRequestRow';

import { makeSellerRequest } from '../__fixtures__/sellerRequests';

afterEach(async () => {
  await cleanup();
});

const NZ = { timeZone: 'Pacific/Auckland', locale: 'en-NZ' };

async function renderRow(over = {}, onPress = jest.fn()) {
  const request = makeSellerRequest(over);
  await render(<SellerRequestRow request={request} onPress={onPress} {...NZ} />);
  return { request, onPress };
}

describe('SellerRequestRow', () => {
  it('is one button that speaks who, the status word, the sentence, the order and the pickup time', async () => {
    await renderRow({ pickup_at: '2026-11-08T18:00:00+00:00' });
    const row = screen.getByRole('button');
    expect(row.props.accessibilityLabel).toBe(
      'Pickup. Request from Sam Rivera. Status: Waiting. Waiting for your answer. 2 items. Pickup Mon, 9 Nov, 7:00 am',
    );
    expect(row.props.accessibilityHint).toBe('Opens the request');
  });

  it('shows the customer name, the status as a word, and the pickup time in the given zone', async () => {
    await renderRow();
    expect(screen.getByText('Sam Rivera')).toBeOnTheScreen();
    expect(screen.getByText('Waiting')).toBeOnTheScreen();
    expect(screen.getByText('Waiting for your answer')).toBeOnTheScreen();
    expect(screen.getByText(/^Pickup .*7:00/)).toBeOnTheScreen();
  });

  it('opens the request with the request itself', async () => {
    const { request, onPress } = await renderRow();
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledWith(request);
  });

  it('falls back to "Customer" when the profile has no name', async () => {
    await renderRow({ customer_name: null });
    expect(screen.getByText('Customer')).toBeOnTheScreen();
    expect(screen.getByRole('button').props.accessibilityLabel).toMatch(
      /^Pickup\. Request from Customer\./,
    );
  });

  it('shows the written order when there are no items', async () => {
    await renderRow({ items: null, order_text: 'Two portions of jollof rice' });
    expect(screen.getByText('Two portions of jollof rice')).toBeOnTheScreen();
  });

  it("shows the server's display_status, never the stored status: a pending request past its expiry is Expired", async () => {
    await renderRow({ status: 'pending', display_status: 'expired' });
    expect(screen.getByText('Expired')).toBeOnTheScreen();
    expect(screen.queryByText('Waiting')).not.toBeOnTheScreen();
    const label = screen.getByRole('button').props.accessibilityLabel as string;
    expect(label).toContain('Status: Expired');
    expect(label).not.toContain('Waiting');
  });

  it.each(['pending', 'declined', 'expired', 'cancelled'] as const)(
    'a %s request is never described as accepted or confirmed, in the text or in the spoken label',
    async (status) => {
      await renderRow({ status, display_status: status });
      const label = screen.getByRole('button').props.accessibilityLabel as string;
      expect(label).not.toMatch(/accepted|confirm|book/i);
      expect(screen.queryByText(/accepted|confirm|book/i)).not.toBeOnTheScreen();
    },
  );

  it('an accepted request says the seller accepted it', async () => {
    await renderRow({ status: 'accepted', display_status: 'accepted' });
    expect(screen.getByText('You accepted this request')).toBeOnTheScreen();
    expect(screen.getByText('Accepted')).toBeOnTheScreen();
  });

  it('caps the title at 1.6 times for large text, and lets the row grow instead of clipping', async () => {
    await renderRow({ customer_name: 'A very long customer name that keeps going and going' });
    const title = screen.getByText(/A very long customer name/);
    expect(title.props.maxFontSizeMultiplier).toBe(ROW_TITLE_MAX_FONT_MULTIPLIER);
    expect(ROW_TITLE_MAX_FONT_MULTIPLIER).toBe(1.6);
    const style = screen.getByRole('button').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.flat()) : style;
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    expect(flat.height).toBeUndefined();
  });

  it('is memoized, so a poll re-renders only the rows that changed', () => {
    expect((SellerRequestRow as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });
});
