import { cleanup, render, screen } from '@testing-library/react-native';

import { RequestRow } from '../components/RequestRow';
import { SellerRequestRow } from '../components/SellerRequestRow';

import { makeRequest } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';
import { makeSellerTableRequest, makeTableRequest } from '../__fixtures__/tableRequests';

afterEach(async () => {
  await cleanup();
});

const zone = { timeZone: 'America/Toronto', locale: 'en-US' };
const noop = jest.fn();
const labelOf = () => screen.getByRole('button').props.accessibilityLabel as string;

describe('the customer row speaks its kind first', () => {
  it('a pickup row starts with "Pickup"', async () => {
    await render(<RequestRow request={makeRequest()} onPress={noop} {...zone} />);
    expect(labelOf()).toMatch(/^Pickup\. Joe's Pizza\. Status: Waiting\./);
  });

  it('a table row starts with "Table", then the restaurant, the party and the table time', async () => {
    await render(<RequestRow request={makeTableRequest()} onPress={noop} {...zone} />);
    expect(labelOf()).toBe(
      "Table. Luigi's. Status: Waiting. Waiting for Luigi's to respond. Party of 4. Table Sun, Nov 8, 7:00 PM",
    );
  });

  it('the kind is read from the request, not passed in, and is no longer a separate value', async () => {
    await render(<RequestRow request={makeTableRequest()} onPress={noop} {...zone} />);
    expect(screen.getByRole('button').props.accessibilityValue?.text).toBeUndefined();
  });

  it('a pending table request never reads as accepted or confirmed', async () => {
    await render(<RequestRow request={makeTableRequest()} onPress={noop} {...zone} />);
    expect(labelOf()).not.toMatch(/accepted|confirm|book/i);
  });

  it('a completed table request says so in table words', async () => {
    await render(
      <RequestRow
        request={makeTableRequest({ status: 'completed', display_status: 'completed' })}
        onPress={noop}
        {...zone}
      />,
    );
    expect(labelOf()).toContain('Table visit completed');
    expect(labelOf()).not.toContain('Pickup');
  });
});

describe('the seller row speaks its kind first', () => {
  it('a pickup row starts with "Pickup"', async () => {
    await render(<SellerRequestRow request={makeSellerRequest()} onPress={noop} {...zone} />);
    expect(labelOf()).toMatch(/^Pickup\. Request from Sam Rivera\./);
  });

  it('a table row starts with "Table" and names the party and the table time', async () => {
    await render(<SellerRequestRow request={makeSellerTableRequest()} onPress={noop} {...zone} />);
    expect(labelOf()).toBe(
      'Table. Request from Sam Rivera. Status: Waiting. Waiting for your answer. Party of 4. Table Sun, Nov 8, 7:00 PM',
    );
    expect(labelOf()).not.toMatch(/accepted|confirm|book/i);
  });

  it('a table row says when the customer has arrived', async () => {
    await render(
      <SellerRequestRow
        request={makeSellerTableRequest({
          status: 'accepted',
          display_status: 'accepted',
          arrived_at: '2026-11-08T23:30:00+00:00',
        })}
        onPress={noop}
        {...zone}
      />,
    );
    expect(labelOf()).toContain('Customer has arrived');
    expect(screen.getByText('Customer has arrived')).toBeOnTheScreen();
  });

  it('a declined table row shows the table reason', async () => {
    await render(
      <SellerRequestRow
        request={makeSellerTableRequest({
          status: 'declined',
          display_status: 'declined',
          decline_reason: 'fully_booked',
        })}
        onPress={noop}
        {...zone}
      />,
    );
    expect(labelOf()).toContain('Declined: Fully booked');
  });
});
