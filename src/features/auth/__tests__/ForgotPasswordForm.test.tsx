import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AuthRetryableFetchError } from '@supabase/supabase-js';

import * as api from '../api';
import { ForgotPasswordForm } from '../components/ForgotPasswordForm';
import { RESET_CODE_SENT } from '../messages';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), requestPasswordReset: jest.fn() }));

const realApi = jest.requireActual<typeof import('../api')>('../api');
const mockedApi = jest.mocked(api);

const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

async function renderForm() {
  const client = new QueryClient({
    // gcTime Infinity: no cache-cleanup timers left running after a test.
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <ForgotPasswordForm />
    </QueryClientProvider>,
  );
}

async function submit(email: string) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.press(screen.getByRole('button', { name: 'Send reset code' }));
}

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.requestPasswordReset.mockResolvedValue(undefined);
  });

  it('renders the email field and the submit button', async () => {
    await renderForm();
    const email = screen.getByLabelText('Email');
    expect(email.props.keyboardType).toBe('email-address');
    expect(email.props.autoCapitalize).toBe('none');
    expect(screen.getByRole('button', { name: 'Send reset code' }).props.accessibilityLabel).toBe(
      'Send reset code',
    );
    expect(screen.queryByText(rx(RESET_CODE_SENT))).toBeNull();
  });

  it('rejects an invalid email without calling the api', async () => {
    await renderForm();
    await submit('nope');
    expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
    expect(mockedApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('requests the reset with the normalised email and shows the neutral message', async () => {
    await renderForm();
    await submit(' Me@Example.com ');
    expect(await screen.findByText(rx(RESET_CODE_SENT))).toBeTruthy();
    expect(mockedApi.requestPasswordReset).toHaveBeenCalledWith('me@example.com');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows the identical message for a registered and an unregistered email', async () => {
    // The api resolves void either way, so the UI can only ever show one outcome.
    await renderForm();
    await submit('registered@example.com');
    const first = (await screen.findByText(rx(RESET_CODE_SENT))).props.children;
    await screen.unmount();

    await renderForm();
    await submit('nobody@example.com');
    const second = (await screen.findByText(rx(RESET_CODE_SENT))).props.children;
    expect(second).toEqual(first);
  });

  it('offers "Enter code" which opens reset-password with the email', async () => {
    await renderForm();
    await submit('me@example.com');
    await fireEvent.press(await screen.findByRole('button', { name: 'Enter code' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/reset-password',
      params: { email: 'me@example.com' },
    });
  });

  it('shows an error banner, not the neutral message, on a network error', async () => {
    mockedApi.requestPasswordReset.mockRejectedValue(
      realApi.mapAuthError(new AuthRetryableFetchError('offline', 0)),
    );
    await renderForm();
    await submit('me@example.com');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(rx(RESET_CODE_SENT))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enter code' })).toBeNull();
  });
});
