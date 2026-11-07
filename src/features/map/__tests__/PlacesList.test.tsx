import { fireEvent, render, screen } from '@testing-library/react-native';

import { PlacesList } from '../components/PlacesList';
import type { Pin } from '../schema';

function makePin(i: number): Pin {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Place ${String(i).padStart(3, '0')}`,
    cuisine_code: 'ca',
    lat: 43,
    lng: -79,
  } as Pin;
}

const style = { padding: 0 };
const noCuisines = new Map();

describe('PlacesList', () => {
  it('does not mount all 500 rows at once', async () => {
    const pins = Array.from({ length: 500 }, (_, i) => makePin(i));
    await render(
      <PlacesList
        pins={pins}
        cuisineByCode={noCuisines}
        onSelect={jest.fn()}
        contentContainerStyle={style}
      />,
    );
    const rows = screen.getAllByRole('button');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
  });

  it('lists the rows by name and picks a restaurant', async () => {
    const onSelect = jest.fn();
    const pins = [makePin(2), makePin(0), makePin(1)];
    await render(
      <PlacesList
        pins={pins}
        cuisineByCode={noCuisines}
        onSelect={onSelect}
        contentContainerStyle={style}
      />,
    );
    const names = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel as string);
    expect(names[0]).toContain('Place 000');
    expect(names[2]).toContain('Place 002');
    await fireEvent.press(screen.getAllByRole('button')[1]);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Place 001' }));
  });

  it('sorts once for the same pins, not on every render', async () => {
    const pins = [makePin(2), makePin(0), makePin(1)];
    const onSelect = jest.fn();
    const view = await render(
      <PlacesList
        pins={pins}
        cuisineByCode={noCuisines}
        onSelect={onSelect}
        contentContainerStyle={style}
      />,
    );
    const sort = jest.spyOn(Array.prototype, 'sort');
    await view.rerender(
      <PlacesList
        pins={pins}
        cuisineByCode={noCuisines}
        onSelect={onSelect}
        contentContainerStyle={{ padding: 1 }}
      />,
    );
    expect(sort).not.toHaveBeenCalled();
    sort.mockRestore();
  });

  it('says so when there is nothing to list', async () => {
    await render(
      <PlacesList
        pins={[]}
        cuisineByCode={noCuisines}
        onSelect={jest.fn()}
        contentContainerStyle={style}
      />,
    );
    expect(screen.getByText(/No restaurants shown here/)).toBeOnTheScreen();
  });
});
