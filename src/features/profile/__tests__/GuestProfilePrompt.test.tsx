import { fireEvent, render, screen } from '@testing-library/react-native';

import { GuestProfilePrompt } from '../components/GuestProfilePrompt';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

describe('GuestProfilePrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the Profile header and the sign-in copy', async () => {
    await render(<GuestProfilePrompt />);
    expect(screen.getByRole('header', { name: 'Profile' })).toBeTruthy();
    expect(
      screen.getByText('Sign in to see your profile, and later to send requests and log food.'),
    ).toBeTruthy();
  });

  it('"Sign in" opens the sign-in screen', async () => {
    await render(<GuestProfilePrompt />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
  });

  it('"Create account" opens the sign-up screen', async () => {
    await render(<GuestProfilePrompt />);
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-up');
  });

  it('exposes both buttons with accessibility labels', async () => {
    await render(<GuestProfilePrompt />);
    expect(screen.getByLabelText('Sign in')).toBeTruthy();
    expect(screen.getByLabelText('Create account')).toBeTruthy();
  });

  it('makes no navigation until a button is pressed', async () => {
    await render(<GuestProfilePrompt />);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
