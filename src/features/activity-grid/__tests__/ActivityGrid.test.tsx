import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors, size, stroke } from '@/theme/tokens';

import { ActivityGrid, type ActivityCell } from '../components/ActivityGrid';
import { buildWeeks } from '../grid';

// The grid is generic: the caller passes every label. These tests pass their own words, so they
// prove the grid speaks what it is given and adds nothing about uploads.

const TODAY = '2026-11-12'; // a Thursday
const WEEKS = buildWeeks('2026-11-01', TODAY);
const LEGEND = { less: 'Fewer', more: 'Lots', spoken: 'Legend from few to lots' };

function cellsFor(levels: Record<string, ActivityCell['level']>): Record<string, ActivityCell> {
  const cells: Record<string, ActivityCell> = {};
  for (const date of WEEKS.flat()) {
    if (date > TODAY) continue;
    const level = levels[date] ?? 0;
    cells[date] = {
      level,
      label: `Day ${date} at level ${level}${date === TODAY ? ', today' : ''}`,
    };
  }
  return cells;
}

const CELLS = cellsFor({ '2026-11-10': 1, '2026-11-11': 3 });

async function renderGrid(selectedDate: string | null = null, onSelectDate = jest.fn()) {
  await render(
    <ActivityGrid
      weeks={WEEKS}
      cells={CELLS}
      today={TODAY}
      selectedDate={selectedDate}
      onSelectDate={onSelectDate}
      summaryLabel="Summary words"
      legendLabels={LEGEND}
      locale="en-US"
    />,
  );
  return onSelectDate;
}

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

afterEach(async () => {
  await cleanup();
});

describe('ActivityGrid', () => {
  it('gives every day up to today a button with its passed label and selected state', async () => {
    await renderGrid('2026-11-11');
    for (const [date, cell] of Object.entries(CELLS)) {
      const button = screen.getByRole('button', { name: cell.label });
      expect(button.props.accessibilityState).toEqual({ selected: date === '2026-11-11' });
    }
    expect(screen.getAllByRole('button')).toHaveLength(Object.keys(CELLS).length);
  });

  it('leaves the days after today out (padding, not buttons)', async () => {
    await renderGrid();
    expect(screen.queryByTestId('activity-cell-2026-11-13')).toBeNull();
    expect(screen.queryByTestId('activity-cell-2026-11-14')).toBeNull();
  });

  it('says today in the label, and the selected day in the state, not only by a border', async () => {
    await renderGrid('2026-11-10');
    expect(screen.getByRole('button', { name: 'Day 2026-11-12 at level 0, today' })).toBeTruthy();
    expect(screen.getByRole('button', { selected: true }).props.accessibilityLabel).toBe(
      'Day 2026-11-10 at level 1',
    );
    expect(styleOf('activity-cell-2026-11-10')).toMatchObject({
      borderWidth: stroke.selected,
      borderColor: colors.text,
    });
    expect(styleOf('activity-cell-2026-11-12')).toMatchObject({ borderColor: colors.primary });
  });

  it('speaks the legend and the summary', async () => {
    await renderGrid();
    expect(screen.getByLabelText('Legend from few to lots')).toBeTruthy();
    expect(screen.getByRole('summary')).toHaveTextContent('Summary words');
  });

  it('shades by level and outlines empty squares in gridOutline', async () => {
    await renderGrid();
    expect(styleOf('activity-cell-2026-11-09')).toMatchObject({
      backgroundColor: colors.grid0,
      borderColor: colors.gridOutline,
    });
    expect(styleOf('activity-cell-2026-11-10')).toMatchObject({ backgroundColor: colors.grid1 });
    expect(styleOf('activity-cell-2026-11-11')).toMatchObject({ backgroundColor: colors.grid3 });
    expect(styleOf('activity-cell-2026-11-11').borderColor).toBeUndefined();
  });

  it('draws 14 pt squares (the documented exception to the 44 pt rule)', async () => {
    await renderGrid();
    expect(styleOf('activity-cell-2026-11-09')).toMatchObject({
      width: size.gridCell,
      height: size.gridCell,
    });
  });

  it('hands the pressed date back', async () => {
    const onSelectDate = await renderGrid();
    await fireEvent.press(screen.getByTestId('activity-cell-2026-11-10'));
    expect(onSelectDate).toHaveBeenCalledWith('2026-11-10');
  });

  it('hides the month names from screen readers', async () => {
    await renderGrid();
    expect(screen.queryByText('Nov')).toBeNull();
    expect(screen.getByText('Nov', { includeHiddenElements: true })).toBeTruthy();
  });
});
