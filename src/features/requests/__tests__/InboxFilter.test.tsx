import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { InboxFilter } from '../components/InboxFilter';

afterEach(async () => {
  await cleanup();
});

describe('InboxFilter', () => {
  it('has two radio options inside a labelled group', async () => {
    await render(<InboxFilter value="waiting" onChange={jest.fn()} />);
    expect(screen.getByLabelText('Show requests').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('says which one is selected as a word, not colour alone', async () => {
    await render(<InboxFilter value="waiting" onChange={jest.fn()} />);
    expect(screen.getByRole('radio', { name: 'Waiting, selected' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'All' })).toBeOnTheScreen();
    expect(
      screen.getByRole('radio', { name: 'Waiting, selected' }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByRole('radio', { name: 'All' }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
  });

  it('the selected option moves with the value', async () => {
    await render(<InboxFilter value="all" onChange={jest.fn()} />);
    expect(screen.getByRole('radio', { name: 'All, selected' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Waiting' })).toBeOnTheScreen();
  });

  it('reports the tapped option', async () => {
    const onChange = jest.fn();
    await render(<InboxFilter value="waiting" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('every option is at least 44 pt tall and wraps instead of clipping', async () => {
    await render(<InboxFilter value="waiting" onChange={jest.fn()} />);
    for (const radio of screen.getAllByRole('radio')) {
      const style = radio.props.style;
      const flat = Array.isArray(style) ? Object.assign({}, ...style.flat()) : style;
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
      expect(flat.height).toBeUndefined();
    }
    const groupStyle = screen.getByLabelText('Show requests').props.style;
    const group = Array.isArray(groupStyle) ? Object.assign({}, ...groupStyle.flat()) : groupStyle;
    expect(group.flexWrap).toBe('wrap');
  });
});
