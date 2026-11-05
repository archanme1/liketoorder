import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { MenuAppError, getCurrencies } from '../api';
import { CurrencyList, CurrencyPicker, currencyLabel } from '../components/CurrencyPicker';
import type { Currency } from '../schema';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getCurrencies: jest.fn(),
}));

const mockedCurrencies = getCurrencies as unknown as jest.Mock;

const CURRENCIES: Currency[] = [
  { code: 'CAD', name: 'Canadian dollar', minor_units: 2 },
  { code: 'EUR', name: 'Euro', minor_units: 2 },
  { code: 'JPY', name: 'Japanese yen', minor_units: 0 },
  { code: 'KWD', name: 'Kuwaiti dinar', minor_units: 3 },
  { code: 'USD', name: 'US dollar', minor_units: 2 },
];

async function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedCurrencies.mockReset();
  mockedCurrencies.mockResolvedValue(CURRENCIES);
});

describe('currencyLabel', () => {
  it('reads "Canadian dollar (CAD)"', () => {
    expect(currencyLabel(CURRENCIES[0])).toBe('Canadian dollar (CAD)');
  });
});

describe('CurrencyPicker states', () => {
  it('shows a loading skeleton while the list loads', async () => {
    mockedCurrencies.mockReturnValue(new Promise(() => {}));
    await renderWithClient(
      <CurrencyPicker visible value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    expect(screen.getByLabelText(/loading/i)).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('shows an error with a retry that reloads the list', async () => {
    mockedCurrencies.mockRejectedValueOnce(new MenuAppError('network'));
    await renderWithClient(
      <CurrencyPicker visible value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: 'Canadian dollar, CAD' })).toBeTruthy();
    expect(mockedCurrencies).toHaveBeenCalledTimes(2);
  });

  it('shows no rows when the list is empty', async () => {
    mockedCurrencies.mockResolvedValue([]);
    await renderWithClient(
      <CurrencyPicker visible value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    await screen.findByLabelText(/search/i);
    expect(mockedCurrencies).toHaveBeenCalled();
    expect(await screen.findByText(/no currencies/i)).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('lists every currency as a radio on success', async () => {
    await renderWithClient(
      <CurrencyPicker visible value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    expect(await screen.findAllByRole('radio')).toHaveLength(CURRENCIES.length);
  });

  it('renders nothing when not visible', async () => {
    await renderWithClient(
      <CurrencyPicker visible={false} value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('CurrencyPicker accessibility', () => {
  it('names each row "<Name>, <CODE>" and marks only the selected one checked', async () => {
    await renderWithClient(
      <CurrencyPicker visible value="CAD" onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    const cad = await screen.findByRole('radio', { name: 'Canadian dollar, CAD' });
    expect(cad).toBeChecked();
    expect(cad.props.accessibilityState).toMatchObject({ checked: true });
    for (const name of ['Euro, EUR', 'Japanese yen, JPY', 'Kuwaiti dinar, KWD', 'US dollar, USD']) {
      const row = screen.getByRole('radio', { name });
      expect(row).not.toBeChecked();
      expect(row.props.accessibilityState).toMatchObject({ checked: false });
    }
  });

  it('has no selection when the value is null (nothing suggested)', async () => {
    await renderWithClient(
      <CurrencyPicker visible value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    const rows = await screen.findAllByRole('radio');
    for (const row of rows) expect(row).not.toBeChecked();
  });

  it('has no selection when the value is a code that is not in the list', async () => {
    await renderWithClient(
      <CurrencyPicker visible value="ZZZ" onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    const rows = await screen.findAllByRole('radio');
    for (const row of rows) expect(row).not.toBeChecked();
  });

  it('has a labelled Close button', async () => {
    const onClose = jest.fn();
    await renderWithClient(
      <CurrencyPicker visible value={null} onSelect={jest.fn()} onClose={onClose} />,
    );
    await screen.findAllByRole('radio');
    await fireEvent.press(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CurrencyPicker behaviour', () => {
  it('calls onSelect with the code of the pressed row', async () => {
    const onSelect = jest.fn();
    await renderWithClient(
      <CurrencyPicker visible value="CAD" onSelect={onSelect} onClose={jest.fn()} />,
    );
    await fireEvent.press(await screen.findByRole('radio', { name: 'Japanese yen, JPY' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('JPY');
  });

  it('filters by name, ignoring case', async () => {
    await renderWithClient(
      <CurrencyPicker visible value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    await screen.findAllByRole('radio');
    await fireEvent.changeText(screen.getByLabelText(/search/i), 'DOLLAR');
    expect(screen.getAllByRole('radio').map((row) => row.props.accessibilityLabel)).toEqual([
      'Canadian dollar, CAD',
      'US dollar, USD',
    ]);
  });

  it('filters by code', async () => {
    await renderWithClient(
      <CurrencyPicker visible value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    await screen.findAllByRole('radio');
    await fireEvent.changeText(screen.getByLabelText(/search/i), 'jpy');
    const rows = screen.getAllByRole('radio');
    expect(rows).toHaveLength(1);
    expect(rows[0].props.accessibilityLabel).toBe('Japanese yen, JPY');
  });

  it('shows the empty message when nothing matches', async () => {
    await renderWithClient(
      <CurrencyPicker visible value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    await screen.findAllByRole('radio');
    await fireEvent.changeText(screen.getByLabelText(/search/i), 'zzzz');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText(/no currencies/i)).toBeTruthy();
  });
});

describe('CurrencyList', () => {
  it('works on its own: pre-selects the value and reports a change', async () => {
    const onChange = jest.fn();
    await renderWithClient(<CurrencyList value="EUR" onChange={onChange} />);
    expect(await screen.findByRole('radio', { name: 'Euro, EUR' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Kuwaiti dinar, KWD' }));
    expect(onChange).toHaveBeenCalledWith('KWD');
  });
});
