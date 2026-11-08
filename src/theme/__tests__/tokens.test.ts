import { colors, scrim, theme } from '@/theme/tokens';

// WCAG 2.x relative luminance of a #RRGGBB color.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('theme tokens', () => {
  it('computes known contrast ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('gives primaryText on primary at least 4.5:1 contrast (WCAG AA)', () => {
    expect(colors.primaryText).toBe('#FFFFFF');
    expect(contrastRatio(colors.primaryText, colors.primary)).toBeGreaterThanOrEqual(4.5);
  });

  // Secondary and ghost buttons draw primary text on the page background.
  it('gives primary on bg at least 4.5:1 contrast (WCAG AA)', () => {
    expect(colors.bg).toBe('#FFFDF9');
    expect(contrastRatio(colors.primary, colors.bg)).toBeGreaterThanOrEqual(4.5);
  });

  // The modal backdrop dims the page without hiding it, and a card on it keeps its contrast.
  it('has a translucent scrim for modal dialogs, exposed on the theme', () => {
    expect(theme.scrim).toBe(scrim);
    const alpha = Number(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\s*\)/.exec(scrim)?.[1]);
    expect(alpha).toBeGreaterThanOrEqual(0.2);
    expect(alpha).toBeLessThanOrEqual(0.6);
    expect(contrastRatio(colors.text, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
