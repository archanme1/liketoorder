import { cleanup, render, screen } from '@testing-library/react-native';

import { ActivityStats } from '../components/ActivityStats';

afterEach(async () => {
  await cleanup();
});

describe('ActivityStats', () => {
  it('shows each stat as text and speaks it as one element', async () => {
    await render(
      <ActivityStats
        stats={[
          { label: 'Current streak', value: '4', spokenLabel: 'Current streak, 4 days' },
          { label: 'Cuisines tried', value: '6', spokenLabel: 'Cuisines tried, 6' },
        ]}
      />,
    );
    const streak = screen.getByLabelText('Current streak, 4 days');
    expect(streak.props.accessible).toBe(true);
    expect(streak).toHaveTextContent('4Current streak');
    expect(screen.getByLabelText('Cuisines tried, 6')).toHaveTextContent('6Cuisines tried');
  });
});
