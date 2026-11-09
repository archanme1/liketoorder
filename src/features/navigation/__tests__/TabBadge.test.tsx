import { cleanup, render, screen } from '@testing-library/react-native';

import { BADGE_CAP, TabBadge, formatBadge, spokenBadge } from '../components/TabBadge';

afterEach(cleanup);

describe('formatBadge', () => {
  it.each([
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [250, '99+'],
  ])('shows %s as %s', (count, text) => {
    expect(formatBadge(count)).toBe(text);
  });

  it('shows nothing for zero, a negative or an unknown count', () => {
    expect(formatBadge(0)).toBeNull();
    expect(formatBadge(-1)).toBeNull();
    expect(formatBadge(undefined)).toBeNull();
  });
});

describe('spokenBadge', () => {
  it('says the number in words with "new", and never "confirmed" or "accepted"', () => {
    expect(spokenBadge(3)).toBe('3 new');
    expect(spokenBadge(BADGE_CAP + 1)).toBe('more than 99 new');
    expect(spokenBadge(0)).toBeNull();
    expect(spokenBadge(undefined)).toBeNull();
  });
});

describe('TabBadge', () => {
  it('draws the number, hidden from the screen reader so it is not read twice', async () => {
    await render(<TabBadge count={3} />);
    const badge = screen.getByTestId('tab-badge', { includeHiddenElements: true });
    expect(badge.props.accessibilityElementsHidden).toBe(true);
    expect(badge.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getByText('3', { includeHiddenElements: true })).toBeTruthy();
  });

  it('draws 99+ for a big number', async () => {
    await render(<TabBadge count={400} />);
    expect(screen.getByText('99+', { includeHiddenElements: true })).toBeTruthy();
  });

  it('draws nothing for zero or an unknown count', async () => {
    await render(<TabBadge count={0} />);
    expect(screen.queryByTestId('tab-badge', { includeHiddenElements: true })).toBeNull();
    await render(<TabBadge count={undefined} />);
    expect(screen.queryByTestId('tab-badge', { includeHiddenElements: true })).toBeNull();
  });
});
