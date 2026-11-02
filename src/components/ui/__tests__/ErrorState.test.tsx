import { fireEvent, render, screen } from '@testing-library/react-native';

import { ErrorState } from '@/components/ui';

const RETRY = /retry|try again/i;

describe('ErrorState', () => {
  it('shows the message', async () => {
    await render(<ErrorState message="Could not load sellers" onRetry={jest.fn()} />);
    expect(screen.getByText('Could not load sellers')).toBeTruthy();
  });

  it('renders a Retry button with button role and a label', async () => {
    await render(<ErrorState message="Boom" onRetry={jest.fn()} />);
    const retry = screen.getByLabelText(RETRY);
    expect(retry.props.accessibilityRole).toBe('button');
    expect(retry.props.accessibilityLabel).toMatch(RETRY);
  });

  it('calls onRetry when Retry is pressed', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState message="Boom" onRetry={onRetry} />);
    await fireEvent.press(screen.getByRole('button', { name: RETRY }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
