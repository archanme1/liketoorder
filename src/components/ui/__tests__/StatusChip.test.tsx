import { render, screen } from '@testing-library/react-native';

import { StatusChip } from '@/components/ui';

describe('StatusChip', () => {
  it('shows the word and an icon', async () => {
    await render(<StatusChip label="Waiting" tone="warning" icon="time-outline" />);
    expect(screen.getByText('Waiting')).toBeOnTheScreen();
    expect(screen.getByLabelText('Status: Waiting')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).toContain('"name":"time-outline"');
  });

  it('is one text element for screen readers, with the word in its label', async () => {
    await render(<StatusChip label="Declined" tone="danger" icon="close-circle-outline" />);
    const chip = screen.getByLabelText('Status: Declined');
    expect(chip.props.accessible).toBe(true);
    expect(chip.props.accessibilityRole).toBe('text');
  });

  it.each(['warning', 'success', 'danger', 'muted', 'info'] as const)(
    'carries the word whatever the %s tone',
    async (tone) => {
      await render(<StatusChip label="Something" tone={tone} icon="ban-outline" />);
      expect(screen.getByText('Something')).toBeOnTheScreen();
    },
  );
});
