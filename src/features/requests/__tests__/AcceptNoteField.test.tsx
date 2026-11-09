import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { AcceptNoteField } from '../components/AcceptNoteField';

afterEach(cleanup);

const HINT = "Your address is shared automatically after you accept, so don't type it here";

describe('AcceptNoteField', () => {
  it('is an optional note box with a counter in words', async () => {
    await render(<AcceptNoteField value="" onChange={jest.fn()} homemade={false} />);
    expect(screen.getByLabelText('Note for the customer (optional)')).toBeOnTheScreen();
    expect(screen.getByText('0 of 200')).toBeOnTheScreen();
  });

  it('counts what was typed', async () => {
    await render(
      <AcceptNoteField value="Please bring a bag" onChange={jest.fn()} homemade={false} />,
    );
    expect(screen.getByText('18 of 200')).toBeOnTheScreen();
  });

  it('reports typing', async () => {
    const onChange = jest.fn();
    await render(<AcceptNoteField value="" onChange={onChange} homemade={false} />);
    await fireEvent.changeText(screen.getByLabelText('Note for the customer (optional)'), 'Hi');
    expect(onChange).toHaveBeenCalledWith('Hi');
  });

  it('tells a homemade cook not to type the address', async () => {
    await render(<AcceptNoteField value="" onChange={jest.fn()} homemade />);
    expect(screen.getByText(HINT)).toBeOnTheScreen();
  });

  it('says nothing about an address for a restaurant', async () => {
    await render(<AcceptNoteField value="" onChange={jest.fn()} homemade={false} />);
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.queryByText(/address/i)).toBeNull();
  });

  it('says so when the note is over 200 characters', async () => {
    await render(<AcceptNoteField value={'x'.repeat(201)} onChange={jest.fn()} homemade={false} />);
    expect(screen.getByText('201 of 200')).toBeOnTheScreen();
    expect(screen.getByText(/Shorten your note to 200 characters/)).toBeOnTheScreen();
  });
});
