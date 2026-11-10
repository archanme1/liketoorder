import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { makeRequest } from '../__fixtures__/requests';
import { makeTableRequest } from '../__fixtures__/tableRequests';
import { RequestRow } from '../components/RequestRow';

afterEach(async () => {
  await cleanup();
});

const zone = { timeZone: 'America/Toronto', locale: 'en-US' };

describe('a table request on the Sent list', () => {
  it('shows the kind, the party and the table time, not a pickup', async () => {
    await render(<RequestRow request={makeTableRequest()} onPress={jest.fn()} {...zone} />);
    // The small kind word is hidden from the screen reader on purpose (the row speaks it).
    expect(screen.getByText('Table', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('Party of 4')).toBeOnTheScreen();
    expect(screen.getByText('Table Sun, Nov 8, 7:00 PM')).toBeOnTheScreen();
    expect(screen.queryByText(/^Pickup/)).not.toBeOnTheScreen();
  });

  it('a pickup row still reads as a pickup', async () => {
    await render(<RequestRow request={makeRequest()} onPress={jest.fn()} {...zone} />);
    expect(screen.getByText('Pickup', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText('Table', { includeHiddenElements: true })).not.toBeOnTheScreen();
  });

  it('is one button that opens the request and is never worded as accepted while pending', async () => {
    const onPress = jest.fn();
    const request = makeTableRequest();
    await render(<RequestRow request={request} onPress={onPress} {...zone} />);
    const row = screen.getByRole('button', { name: /Luigi's/ });
    expect(row.props.accessibilityLabel).not.toMatch(/confirm|booked|accepted/i);
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledWith(request);
  });

  it('says the server status as a word, Declined with the table reason', async () => {
    await render(
      <RequestRow
        request={makeTableRequest({
          status: 'declined',
          display_status: 'declined',
          decline_reason: 'fully_booked',
        })}
        onPress={jest.fn()}
        {...zone}
      />,
    );
    expect(screen.getByLabelText('Status: Declined')).toBeOnTheScreen();
    expect(screen.getByText('Declined: Fully booked')).toBeOnTheScreen();
  });
});
