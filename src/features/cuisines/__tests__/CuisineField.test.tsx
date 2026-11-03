import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { listCuisines } from '../api';
import { CuisineField } from '../components/CuisineField';
import type { Cuisine } from '../schema';

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listCuisines: jest.fn(),
}));

const mockedList = listCuisines as unknown as jest.Mock;

const italy: Cuisine = {
  code: 'IT',
  kind: 'country',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 100,
};
const france: Cuisine = {
  code: 'FR',
  kind: 'country',
  name: 'France',
  flag: '🇫🇷',
  icon: null,
  sort_order: 120,
};
const catalog = [italy, france];

const HEADER = 'Choose a cuisine';

function chosenCode(arg: unknown): unknown {
  return arg && typeof arg === 'object' && 'code' in arg ? (arg as { code: unknown }).code : arg;
}

async function renderField(props: { value?: string; error?: string; label?: string } = {}) {
  const onChange = jest.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <CuisineField
        value={props.value ?? ''}
        onChange={onChange}
        error={props.error}
        label={props.label}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

async function openList() {
  await fireEvent.press(screen.getByLabelText(/^Cuisine:/));
  expect(await screen.findByText(HEADER)).toBeTruthy();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedList.mockResolvedValue(catalog);
});

describe('CuisineField button', () => {
  it('says "Cuisine: Not chosen" when nothing is picked, and is a button', async () => {
    await renderField();
    const button = screen.getByLabelText('Cuisine: Not chosen');
    expect(button).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cuisine: Not chosen' })).toBeTruthy();
  });

  it('says the chosen cuisine name', async () => {
    await renderField({ value: 'IT' });
    expect(await screen.findByLabelText('Cuisine: Italy')).toBeTruthy();
  });

  it('shows the error text it is given', async () => {
    await renderField({ error: 'Pick a cuisine' });
    expect(screen.getByText('⚠ Pick a cuisine')).toBeTruthy();
  });

  it('starts closed', async () => {
    await renderField();
    expect(screen.queryByText(HEADER)).toBeNull();
    expect(screen.queryByLabelText('Close cuisine list')).toBeNull();
  });
});

describe('CuisineField modal', () => {
  it('opens a modal with the header and the cuisine picker', async () => {
    await renderField();
    await openList();
    expect(screen.getByLabelText('Search cuisines')).toBeTruthy();
    expect(await screen.findByRole('radio', { name: 'Italy' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'France' })).toBeTruthy();
  });

  it('marks the modal content with accessibilityViewIsModal', async () => {
    await renderField();
    await openList();
    const modalViews = screen.container.queryAll(
      (node) => node.props.accessibilityViewIsModal === true,
    );
    expect(modalViews.length).toBeGreaterThanOrEqual(1);
    expect(modalViews[0].props.accessibilityViewIsModal).toBe(true);
  });

  it('gives the close button the label "Close cuisine list" and closes on press', async () => {
    await renderField();
    await openList();
    const close = screen.getByRole('button', { name: 'Close cuisine list' });
    expect(close).toBeTruthy();
    await fireEvent.press(close);
    expect(screen.queryByText(HEADER)).toBeNull();
    expect(screen.queryByLabelText('Close cuisine list')).toBeNull();
  });

  it('closes on Android Back (the Modal onRequestClose)', async () => {
    const onChange = await renderField();
    await openList();
    const modals = screen.container.queryAll(
      (node) => typeof node.props.onRequestClose === 'function',
    );
    expect(modals.length).toBeGreaterThanOrEqual(1);
    const modal = modals[0];
    expect(typeof modal.props.onRequestClose).toBe('function');
    await act(async () => {
      modal.props.onRequestClose();
    });
    expect(screen.queryByText(HEADER)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closing without a pick does not call onChange', async () => {
    const onChange = await renderField();
    await openList();
    await fireEvent.press(screen.getByRole('button', { name: 'Close cuisine list' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange with the picked cuisine and closes', async () => {
    const onChange = await renderField();
    await openList();
    await fireEvent.press(await screen.findByRole('radio', { name: 'France' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(chosenCode(onChange.mock.calls[0][0])).toBe('FR');
    expect(screen.queryByText(HEADER)).toBeNull();
  });

  it('can be opened again after closing', async () => {
    await renderField();
    await openList();
    await fireEvent.press(screen.getByRole('button', { name: 'Close cuisine list' }));
    expect(screen.queryByText(HEADER)).toBeNull();
    await openList();
    expect(screen.getByText(HEADER)).toBeTruthy();
  });

  it('shows the current choice as checked when it opens', async () => {
    await renderField({ value: 'IT' });
    await screen.findByLabelText('Cuisine: Italy');
    await openList();
    expect(await screen.findByRole('radio', { name: 'Italy' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'France' })).not.toBeChecked();
  });
});
