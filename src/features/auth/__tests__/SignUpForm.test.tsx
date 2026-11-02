import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import * as api from '../api';
import { SignUpForm } from '../components/SignUpForm';
import { PASSWORD_HINT } from '../schema';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), signUp: jest.fn() }));

const realApi = jest.requireActual<typeof import('../api')>('../api');
const mockedApi = jest.mocked(api);

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
      <SignUpForm />
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(email: string, password: string, confirm: string = password) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
  await fireEvent.changeText(screen.getByLabelText('Confirm password'), confirm);
  await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
}

describe('SignUpForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.signUp.mockResolvedValue(undefined);
  });

  it('renders the fields, the live password hint and the submit button', async () => {
    await renderForm();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm password')).toBeTruthy();
    expect(screen.getByText(PASSWORD_HINT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account' }).props.accessibilityLabel).toBe(
      'Create account',
    );
  });

  it('configures fields for password managers', async () => {
    await renderForm();
    const email = screen.getByLabelText('Email');
    expect(email.props.keyboardType).toBe('email-address');
    expect(email.props.autoCapitalize).toBe('none');
    for (const label of ['Password', 'Confirm password']) {
      const input = screen.getByLabelText(label);
      expect(input.props.secureTextEntry).toBe(true);
      expect(input.props.autoComplete).toBe('new-password');
      expect(input.props.textContentType).toBeTruthy();
    }
  });

  it.each([
    ['too short', 'abc1234', 'abc1234'],
    ['letters only', 'abcdefgh', 'abcdefgh'],
    ['digits only', '12345678', '12345678'],
    ['mismatched confirmation', 'abcdefg1', 'abcdefg2'],
  ])('rejects %s without calling the api', async (_name, password, confirm) => {
    await renderForm();
    await fillAndSubmit('a@b.com', password, confirm);
    expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
    expect(mockedApi.signUp).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('rejects an invalid email', async () => {
    await renderForm();
    await fillAndSubmit('nope', 'abcdefg1');
    expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
    expect(mockedApi.signUp).not.toHaveBeenCalled();
  });

  it('signs up and goes to verify-email with the normalised email', async () => {
    await renderForm();
    await fillAndSubmit(' New@User.com ', 'abcdefg1');
    await screen.findByRole('button', { name: 'Create account' });
    expect(mockedApi.signUp).toHaveBeenCalledWith('new@user.com', 'abcdefg1');
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/verify-email',
      params: { email: 'new@user.com' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats an existing-email result (api resolves) exactly like a new email', async () => {
    // api.signUp resolves void for both; the UI must show no banner and route identically.
    await renderForm();
    await fillAndSubmit('taken@user.com', 'abcdefg1');
    await screen.findByRole('button', { name: 'Create account' });
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/verify-email',
      params: { email: 'taken@user.com' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    // Copy that would reveal the email exists (the static "I already have an account" link is fine).
    expect(
      screen.queryByText(/already (registered|exists|in use)|exists|registered|taken/i),
    ).toBeNull();
  });

  it('renders identical text and navigation for a new email and an existing-email response', async () => {
    // Goes through the real api.signUp so the Supabase responses themselves are compared.
    mockedApi.signUp.mockImplementation(realApi.signUp);
    const supabaseSignUp = jest.fn();
    (supabase.auth as unknown as Record<string, unknown>).signUp = supabaseSignUp;

    const responses = {
      newEmail: {
        data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null },
        error: null,
      },
      // With confirmations on, Supabase obfuscates an existing email: a user with no identities.
      existingEmail: { data: { user: { id: 'u2', identities: [] }, session: null }, error: null },
    };

    const results: { text: string; pushes: unknown[] }[] = [];
    for (const response of Object.values(responses)) {
      jest.clearAllMocks();
      supabaseSignUp.mockResolvedValue(response);
      await renderForm();
      await fillAndSubmit('same@user.com', 'abcdefg1');
      await screen.findByRole('button', { name: 'Create account' });
      results.push({
        text: JSON.stringify(screen.toJSON()),
        pushes: mockRouter.push.mock.calls,
      });
      await screen.unmount();
    }

    expect(supabaseSignUp).toHaveBeenCalledTimes(1);
    expect(results[0].pushes).toEqual([
      [{ pathname: '/verify-email', params: { email: 'same@user.com' } }],
    ]);
    expect(results[1].pushes).toEqual(results[0].pushes);
    expect(results[1].text).toBe(results[0].text);
  });

  it('shows weak_password as a field error, not a banner, and does not navigate', async () => {
    mockedApi.signUp.mockRejectedValue(
      realApi.mapAuthError(new AuthApiError('weak', 422, 'weak_password')),
    );
    await renderForm();
    await fillAndSubmit('a@b.com', 'abcdefg1');
    expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('shows other errors in a banner', async () => {
    mockedApi.signUp.mockRejectedValue(
      realApi.mapAuthError(new AuthRetryableFetchError('offline', 0)),
    );
    await renderForm();
    await fillAndSubmit('a@b.com', 'abcdefg1');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
