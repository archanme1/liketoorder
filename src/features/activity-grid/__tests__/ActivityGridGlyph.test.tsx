import { cleanup, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { ActivityGrid, type ActivityCell } from '../components/ActivityGrid';
import { buildWeeks } from '../grid';

// Spec 15: the generic grid takes an optional glyph per square and an optional legend in place of
// the intensity one. It stays generic: these tests pass plain glyphs and words of their own.

const TODAY = '2026-11-12'; // a Thursday
const WEEKS = buildWeeks('2026-11-01', TODAY);
const LEGEND = { less: 'Fewer', more: 'Lots', spoken: 'Legend from few to lots' };
const GLYPH_TEXT = 'G';

function cells(withGlyph: boolean): Record<string, ActivityCell> {
  const result: Record<string, ActivityCell> = {};
  for (const date of WEEKS.flat()) {
    if (date > TODAY) continue;
    result[date] = { level: 0, label: `Day ${date}` };
  }
  // Level 3 on purpose: a glyph square must not show the intensity colour behind it.
  result['2026-11-11'] = {
    level: 3,
    label: 'Day 2026-11-11 with a glyph',
    glyph: withGlyph ? <Text>{GLYPH_TEXT}</Text> : undefined,
  };
  return result;
}

const CUSTOM_LEGEND = (
  <View testID="custom-legend" accessible accessibilityLabel="Custom legend words" />
);

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

afterEach(async () => {
  await cleanup();
});

describe('ActivityGrid with glyphs (spec 15)', () => {
  it('draws a passed glyph in its square, hidden from screen readers; the square speaks its label', async () => {
    await render(
      <ActivityGrid
        weeks={WEEKS}
        cells={cells(true)}
        today={TODAY}
        selectedDate={null}
        onSelectDate={jest.fn()}
        summaryLabel="Summary words"
        legend={CUSTOM_LEGEND}
        locale="en-US"
      />,
    );
    // Drawn...
    expect(screen.getByText(GLYPH_TEXT, { includeHiddenElements: true })).toBeTruthy();
    expect(
      screen.getByTestId('activity-glyph-2026-11-11', { includeHiddenElements: true }),
    ).toBeTruthy();
    // ...but never reached by a screen reader.
    expect(screen.queryByText(GLYPH_TEXT, { includeHiddenElements: false })).toBeNull();
    expect(screen.getByRole('button', { name: 'Day 2026-11-11 with a glyph' })).toBeTruthy();
  });

  it('gives a glyph square no intensity colour: grid0 with the outline', async () => {
    await render(
      <ActivityGrid
        weeks={WEEKS}
        cells={cells(true)}
        today={TODAY}
        selectedDate={null}
        onSelectDate={jest.fn()}
        summaryLabel="Summary words"
        legend={CUSTOM_LEGEND}
      />,
    );
    expect(styleOf('activity-cell-2026-11-11')).toMatchObject({
      backgroundColor: colors.grid0,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.gridOutline,
    });
  });

  it('shows a passed legend in place of the intensity legend', async () => {
    await render(
      <ActivityGrid
        weeks={WEEKS}
        cells={cells(true)}
        today={TODAY}
        selectedDate={null}
        onSelectDate={jest.fn()}
        summaryLabel="Summary words"
        legend={CUSTOM_LEGEND}
      />,
    );
    expect(screen.getByLabelText('Custom legend words')).toBeTruthy();
    expect(screen.queryByLabelText(LEGEND.spoken)).toBeNull();
    expect(
      screen.queryByTestId('activity-legend-samples', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it("without a glyph or a legend it draws spec 14's grid: shaded squares and the intensity legend", async () => {
    await render(
      <ActivityGrid
        weeks={WEEKS}
        cells={cells(false)}
        today={TODAY}
        selectedDate={null}
        onSelectDate={jest.fn()}
        summaryLabel="Summary words"
        legendLabels={LEGEND}
      />,
    );
    expect(
      screen.queryByTestId('activity-glyph-2026-11-11', { includeHiddenElements: true }),
    ).toBeNull();
    expect(styleOf('activity-cell-2026-11-11')).toMatchObject({ backgroundColor: colors.grid3 });
    expect(screen.getByLabelText(LEGEND.spoken)).toBeTruthy();
    expect(
      screen.getByTestId('activity-legend-samples', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByTestId('custom-legend')).toBeNull();
  });
});
