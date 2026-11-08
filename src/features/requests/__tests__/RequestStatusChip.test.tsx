import Ionicons from '@expo/vector-icons/Ionicons';
import { render, screen } from '@testing-library/react-native';

import { RequestStatusChip } from '../components/RequestStatusChip';
import { REQUEST_STATUSES } from '../schema';
import { STATUS_INFO } from '../status';

describe('RequestStatusChip', () => {
  it.each(REQUEST_STATUSES)('shows %s as a word with a real icon', async (status) => {
    await render(<RequestStatusChip status={status} />);
    const { label, icon } = STATUS_INFO[status];
    expect(screen.getByText(label)).toBeOnTheScreen();
    expect(screen.getByLabelText(`Status: ${label}`)).toBeOnTheScreen();
    expect(Object.keys(Ionicons.glyphMap)).toContain(icon);
  });

  it('never says confirmed, booked or accepted for a pending request', async () => {
    await render(<RequestStatusChip status="pending" />);
    expect(screen.getByText('Waiting')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/confirm|booked|accepted|on its way/i);
  });

  it('says Expired and No-show in words', async () => {
    await render(<RequestStatusChip status="expired" />);
    expect(screen.getByText('Expired')).toBeOnTheScreen();
    expect(screen.queryByText(/No response/)).not.toBeOnTheScreen();
    await render(<RequestStatusChip status="no_show" />);
    expect(screen.getByText('No-show')).toBeOnTheScreen();
  });
});
