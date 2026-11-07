import { render, screen } from '@testing-library/react-native';

import { TAB_LABEL_MAX_FONT_MULTIPLIER, TabLabel } from '../components/TabLabel';

describe('TabLabel', () => {
  it('caps its growth with the system text size at 1.3, focused or not', async () => {
    expect(TAB_LABEL_MAX_FONT_MULTIPLIER).toBe(1.3);
    const { rerender } = await render(<TabLabel label="Restaurants" focused />);
    expect(screen.getByText('Restaurants').props.maxFontSizeMultiplier).toBe(1.3);
    await rerender(<TabLabel label="Restaurants" focused={false} />);
    expect(screen.getByText('Restaurants').props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('still shows the label as text, bold when focused', async () => {
    await render(<TabLabel label="Homemade" focused />);
    expect(screen.getByText('Homemade')).toBeTruthy();
  });
});
