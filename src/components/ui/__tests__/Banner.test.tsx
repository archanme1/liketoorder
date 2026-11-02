import { render, screen } from '@testing-library/react-native';

import { Banner } from '@/components/ui';

describe('Banner', () => {
  it('renders the message', async () => {
    await render(<Banner message="Something broke" />);
    expect(screen.getByText(/Something broke/)).toBeTruthy();
  });

  it('exposes the alert role', async () => {
    await render(<Banner message="Something broke" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('defaults to the error tone with a non-color warning prefix', async () => {
    await render(<Banner message="Something broke" />);
    expect(screen.getByText(/⚠/)).toBeTruthy();
  });

  it('uses a check prefix for success', async () => {
    await render(<Banner message="Saved" tone="success" />);
    expect(screen.getByText(/✓/)).toBeTruthy();
    expect(screen.queryByText(/⚠/)).toBeNull();
  });

  it('uses an info prefix for info', async () => {
    await render(<Banner message="FYI" tone="info" />);
    expect(screen.getByText(/ℹ/)).toBeTruthy();
    expect(screen.queryByText(/⚠/)).toBeNull();
  });
});
