import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { StyleSheet } from 'react-native';

import { HomemadeDisclaimer } from '../components/HomemadeDisclaimer';
import {
  HOMEMADE_DISCLAIMER_BODY,
  HOMEMADE_DISCLAIMER_HINT,
  HOMEMADE_DISCLAIMER_LABEL,
  HOMEMADE_DISCLAIMER_TITLE,
} from '../homemadeText';

const row = () => screen.getByTestId('homemade-disclaimer');

describe('the food-safety row: collapsed', () => {
  it('shows only the title and the info icon; the note is not on screen', async () => {
    await render(<HomemadeDisclaimer />);
    expect(screen.getByText(HOMEMADE_DISCLAIMER_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText(HOMEMADE_DISCLAIMER_BODY)).toBeNull();
    expect(JSON.stringify(screen.toJSON())).toContain('information-circle-outline');
  });

  it('is one button, the whole row, at least 44 points tall', async () => {
    await render(<HomemadeDisclaimer />);
    expect(row()).toHaveProp('accessibilityRole', 'button');
    expect(StyleSheet.flatten(row().props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('says the whole warning to a screen reader even before it is opened', async () => {
    await render(<HomemadeDisclaimer />);
    expect(row()).toHaveProp('accessibilityLabel', HOMEMADE_DISCLAIMER_LABEL);
    expect(HOMEMADE_DISCLAIMER_LABEL).toContain(HOMEMADE_DISCLAIMER_BODY);
    expect(HOMEMADE_DISCLAIMER_LABEL).toMatch(/^About food safety and allergies\./);
    expect(row()).toHaveProp('accessibilityHint', HOMEMADE_DISCLAIMER_HINT);
  });

  it('exposes the collapsed state', async () => {
    await render(<HomemadeDisclaimer />);
    expect(row()).toHaveProp('accessibilityState', { expanded: false });
  });

  it('stays collapsed at the largest text size (no auto-expand)', async () => {
    jest
      .spyOn(ReactNative, 'useWindowDimensions')
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 3.1 });
    await render(<HomemadeDisclaimer />);
    expect(screen.queryByText(HOMEMADE_DISCLAIMER_BODY)).toBeNull();
    expect(row()).toHaveProp('accessibilityState', { expanded: false });
    jest.restoreAllMocks();
  });
});

describe('the food-safety row: opening and closing', () => {
  it('opens inline on a tap, and closes on the next', async () => {
    await render(<HomemadeDisclaimer />);
    await fireEvent.press(row());
    expect(screen.getByText(HOMEMADE_DISCLAIMER_BODY)).toBeOnTheScreen();
    expect(row()).toHaveProp('accessibilityState', { expanded: true });
    await fireEvent.press(row());
    expect(screen.queryByText(HOMEMADE_DISCLAIMER_BODY)).toBeNull();
    expect(row()).toHaveProp('accessibilityState', { expanded: false });
  });

  it('lets the title and the note scale with the text size and never truncates them', async () => {
    await render(<HomemadeDisclaimer />);
    await fireEvent.press(row());
    for (const node of [
      screen.getByText(HOMEMADE_DISCLAIMER_TITLE),
      screen.getByText(HOMEMADE_DISCLAIMER_BODY),
    ]) {
      expect(node.props.maxFontSizeMultiplier).toBeUndefined();
      expect(node.props.numberOfLines).toBeUndefined();
    }
  });

  it('uses the one placeholder wording constant (spec 18 owns the final text)', async () => {
    expect(HOMEMADE_DISCLAIMER_TITLE).toBe('Food safety and allergies');
    expect(HOMEMADE_DISCLAIMER_BODY).toBe(
      "Homemade food isn't inspected. Ask the cook about ingredients and allergies before you order.",
    );
    await render(<HomemadeDisclaimer />);
    await fireEvent.press(row());
    expect(screen.getByText(HOMEMADE_DISCLAIMER_BODY)).toBeOnTheScreen();
  });
});
