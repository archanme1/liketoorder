import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import * as api from '../api';
import { SignInForm } from '../components/SignInForm';
import { SIGN_IN_FAILED } from '../messages';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), signIn: jest.fn() }));

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
      <SignInForm />
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
}

describe('SignInForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.signIn.mockResolvedValue(undefined);
  });

  it('renders the fields and actions with accessibility labels', async () => {
    await renderForm();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    for (const name of ['Sign in', 'Forgot password?', 'Create an account']) {
      const button = screen.getByRole('button', { name });
      expect(button.props.accessibilityLabel).toBeTruthy();
    }
  });

  it('configures the email and password fields for password managers', async () => {
    await renderForm();
    const email = screen.getByLabelText('Email');
    expect(email.props.keyboardType).toBe('email-address');
    expect(email.props.autoCapitalize).toBe('none');
    const password = screen.getByLabelText('Password');
    expect(password.props.secureTextEntry).toBe(true);
    expect(password.props.autoComplete).toBe('password');
    expect(password.props.textContentType).toBeTruthy();
  });

  it('shows inline errors and does not call the api when empty', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
    expect(mockedApi.signIn).not.toHaveBeenCalled();
  });

  it('rejects an invalid email without calling the api', async () => {
    await renderForm();
    await fillAndSubmit('not-an-email', 'whatever1');
    expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
    expect(mockedApi.signIn).not.toHaveBeenCalled();
  });

  it('submits the trimmed, lowercased email and the password', async () => {
    await renderForm();
    await fillAndSubmit('  Archan@Example.com ', 'Secret123');
    await screen.findByRole('button', { name: 'Sign in' });
    expect(mockedApi.signIn).toHaveBeenCalledWith('archan@example.com', 'Secret123');
  });

  it('shows the generic message in a banner for invalid credentials', async () => {
    mockedApi.signIn.mockRejectedValue(
      realApi.mapAuthError(new AuthApiError('bad', 400, 'invalid_credentials')),
    );
    await renderForm();
    await fillAndSubmit('a@b.com', 'Secret123');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(rx(SIGN_IN_FAILED))).toBeTruthy();
  });

  it('shows a banner for any other error', async () => {
    mockedApi.signIn.mockRejectedValue(
      realApi.mapAuthError(new AuthRetryableFetchError('offline', 0)),
    );
    await renderForm();
    await fillAndSubmit('a@b.com', 'Secret123');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('routes an unconfirmed email to verify-email without a banner', async () => {
    mockedApi.signIn.mockRejectedValue(
      realApi.mapAuthError(new AuthApiError('unconfirmed', 400, 'email_not_confirmed')),
    );
    await renderForm();
    await fillAndSubmit('  A@B.com ', 'Secret123');
    await screen.findByRole('button', { name: 'Sign in' });
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/verify-email',
      params: { email: 'a@b.com' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('navigates to forgot-password and sign-up', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/forgot-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Create an account' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-up');
  });
});
