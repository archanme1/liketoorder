import { TABLE_WINDOW } from '../time';

import { PickupTimePicker } from './PickupTimePicker';

type TableTimePickerProps = Omit<Parameters<typeof PickupTimePicker>[0], 'kind' | 'offeredTimes'>;

/**
 * The same platform calendar and time picker as for a pickup, offering table times from 30 minutes
 * to 30 days ahead, and always showing the chosen time with its zone name ("7:00 pm EST").
 */
export function TableTimePicker(props: TableTimePickerProps) {
  return <PickupTimePicker {...props} kind="table" offeredTimes={TABLE_WINDOW} />;
}
