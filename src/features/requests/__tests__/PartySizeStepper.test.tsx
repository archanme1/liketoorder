import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { PartySizeStepper } from '../components/PartySizeStepper';

function Harness({ start, disabled = false }: { start: number; disabled?: boolean }) {
  const [size, setSize] = useState(start);
  return <PartySizeStepper size={size} onChange={setSize} disabled={disabled} />;
}

afterEach(async () => {
  await cleanup();
});

describe('PartySizeStepper', () => {
  it('speaks the count as a party and the buttons as words', async () => {
    await render(<Harness start={4} />);
    expect(screen.getByLabelText('Party of 4')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Fewer people, now 4 people' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'More people, now 4 people' })).toBeOnTheScreen();
  });

  it('goes up and down by one', async () => {
    await render(<Harness start={4} />);
    await fireEvent.press(screen.getByRole('button', { name: /^More people/ }));
    expect(screen.getByLabelText('Party of 5')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /^Fewer people/ }));
    await fireEvent.press(screen.getByRole('button', { name: /^Fewer people/ }));
    expect(screen.getByLabelText('Party of 3')).toBeOnTheScreen();
  });

  it('stops at 1: the decrease button is off and says "1 person"', async () => {
    await render(<Harness start={1} />);
    const less = screen.getByRole('button', { name: 'Fewer people, now 1 person' });
    expect(less).toBeDisabled();
    await fireEvent.press(less);
    expect(screen.getByLabelText('Party of 1')).toBeOnTheScreen();
  });

  it('stops at 20: the increase button is off', async () => {
    await render(<Harness start={20} />);
    const more = screen.getByRole('button', { name: 'More people, now 20 people' });
    expect(more).toBeDisabled();
    await fireEvent.press(more);
    expect(screen.getByLabelText('Party of 20')).toBeOnTheScreen();
  });

  it('is read-only while disabled', async () => {
    await render(<Harness start={4} disabled />);
    expect(screen.getByRole('button', { name: /^Fewer people/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^More people/ })).toBeDisabled();
  });
});
