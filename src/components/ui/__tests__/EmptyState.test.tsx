import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyState } from '@/components/ui';

describe('EmptyState', () => {
  it('renders the message and no button when no action is given', async () => {
    await render(<EmptyState message="Nothing here yet" />);
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the action button and calls the handler when pressed', async () => {
    const onAction = jest.fn();
    await render(
      <EmptyState message="Nothing here yet" actionLabel="Add a dish" onAction={onAction} />,
    );
    const button = screen.getByRole('button', { name: 'Add a dish' });
    expect(button).toBeTruthy();
    await fireEvent.press(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
