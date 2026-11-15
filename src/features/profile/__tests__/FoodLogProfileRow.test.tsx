import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { FoodLogProfileRow } from '../components/FoodLogProfileRow';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});

describe('FoodLogProfileRow', () => {
  it('is a labelled button of at least 44 pt that opens /food-log', async () => {
    await render(<FoodLogProfileRow />);
    const row = screen.getByRole('button', { name: 'Food log' });
    expect(row.props.accessibilityHint).toBe('Opens your food photos.');
    await fireEvent.press(row);
    expect(mockRouter.push).toHaveBeenCalledWith('/food-log');
  });
});
