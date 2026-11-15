import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';
import { pickImage } from '@/features/media/pickImage';
import { FoodLogProfileRow } from '@/features/profile/components/FoodLogProfileRow';
import { size } from '@/theme/tokens';

import { CUISINES, foodLog, testClientOptions } from '../__fixtures__/foodLog';
import { claimFoodLogCleanup, FoodLogAppError, getFoodLog, listMyFoodLogs } from '../api';
import { FoodLogDetailScreen } from '../components/FoodLogDetailScreen';
import { FoodLogFormScreen } from '../components/FoodLogFormScreen';
import { FoodLogListScreen } from '../components/FoodLogListScreen';
import { FOOD_LOG_NOT_FOUND } from '../messages';

// Every touchable on the food log screens has a role and a label, and a target of at least 44 pt;
// the Public switch states its value as words.

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyFoodLogs: jest.fn(),
  getFoodLog: jest.fn(),
  claimFoodLogCleanup: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  signedUrls: jest.fn(),
  uploadToBucket: jest.fn(),
  removeFromBucket: jest.fn(),
}));
jest.mock('@/features/media/pickImage', () => ({ pickImage: jest.fn() }));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));

// The native iOS switch is 31 pt tall; its hitSlop must bring the target to 44 pt.
const NATIVE_SWITCH_HEIGHT = 31;

type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: (HostNode | string)[];
};

function hostNodes(node: HostNode): HostNode[] {
  const children = node.children.filter((c): c is HostNode => typeof c !== 'string');
  return [node, ...children.flatMap(hostNodes)];
}

/** The host views a Pressable renders (they carry Pressability's responder handlers). */
function touchables(): HostNode[] {
  return hostNodes(screen.root as unknown as HostNode).filter(
    (node) => typeof node.props.onResponderRelease === 'function',
  );
}

function heightOf(node: HostNode): number {
  const own = StyleSheet.flatten(node.props.style as never) ?? {};
  const first = node.children.find((c): c is HostNode => typeof c !== 'string');
  const inner = first ? (StyleSheet.flatten(first.props.style as never) ?? {}) : {};
  const values = [own.minHeight, own.height, inner.minHeight, inner.height].filter(
    (v): v is number => typeof v === 'number',
  );
  return Math.max(0, ...values);
}

function expectAccessibleTouchables(screenName: string) {
  const found = touchables();
  expect(found.length).toBeGreaterThan(0);
  for (const node of found) {
    const label = node.props.accessibilityLabel;
    const role = node.props.accessibilityRole;
    const where = `${screenName}: ${String(label)}`;
    expect({ where, role: typeof role === 'string' && role.length > 0 }).toEqual({
      where,
      role: true,
    });
    expect({ where, label: typeof label === 'string' && label.trim().length > 0 }).toEqual({
      where,
      label: true,
    });
    expect({ where, tallEnough: heightOf(node) >= size.touch }).toEqual({
      where,
      tallEnough: true,
    });
  }
}

let client: QueryClient;

async function renderWithClient(ui: ReactElement) {
  client = new QueryClient(testClientOptions());
  client.setQueryDefaults(['cuisines'], { gcTime: Infinity });
  client.setQueryData(['cuisines'], CUISINES);
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.mocked(listCuisines).mockResolvedValue(CUISINES);
  jest.mocked(claimFoodLogCleanup).mockResolvedValue([]);
  jest.mocked(pickImage).mockResolvedValue('file:///picker/photo.jpg');
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
    );
});

afterEach(async () => {
  await cleanup();
  client?.clear();
  jest.clearAllMocks();
});

describe('food log accessibility', () => {
  it('the list: Add photo and every row', async () => {
    jest.mocked(listMyFoodLogs).mockResolvedValue({
      items: [foodLog(1), foodLog(2, { is_public: false })],
      next_cursor: null,
    });
    await renderWithClient(<FoodLogListScreen />);
    await screen.findByRole('button', { name: /Meal 2\. Private$/ });
    expectAccessibleTouchables('list');
  });

  it('the empty list', async () => {
    jest.mocked(listMyFoodLogs).mockResolvedValue({ items: [], next_cursor: null });
    await renderWithClient(<FoodLogListScreen />);
    await screen.findByText('No food photos yet. Add your first one.');
    expectAccessibleTouchables('empty list');
  });

  it('the add form, before and after choosing a photo', async () => {
    await renderWithClient(<FoodLogFormScreen mode="create" />);
    expectAccessibleTouchables('add form');
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await screen.findByLabelText('Chosen photo');
    expectAccessibleTouchables('add form with photo');
  });

  it('the edit form', async () => {
    jest.mocked(getFoodLog).mockResolvedValue(foodLog(1));
    await renderWithClient(<FoodLogFormScreen mode="edit" id={foodLog(1).id} />);
    await screen.findByDisplayValue('Meal 1');
    expectAccessibleTouchables('edit form');
  });

  it('the detail page', async () => {
    jest.mocked(getFoodLog).mockResolvedValue(foodLog(1));
    await renderWithClient(<FoodLogDetailScreen id={foodLog(1).id} />);
    await screen.findByRole('button', { name: 'Delete this photo' });
    expectAccessibleTouchables('detail');
  });

  it('the not-found state', async () => {
    jest.mocked(getFoodLog).mockRejectedValue(new FoodLogAppError('not_found'));
    await renderWithClient(<FoodLogDetailScreen id={foodLog(9).id} />);
    await screen.findByText(FOOD_LOG_NOT_FOUND);
    expectAccessibleTouchables('not found');
  });

  it('the Profile row', async () => {
    await render(<FoodLogProfileRow />);
    expectAccessibleTouchables('profile row');
  });

  it('the Public switch: labelled, its state as words and a 44 pt target', async () => {
    await renderWithClient(<FoodLogFormScreen mode="create" />);
    const toggle = screen.getByRole('switch', { name: 'Public' });
    expect(toggle.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(screen.getByText('On', { includeHiddenElements: true })).toBeTruthy();
    expect(toggle.props.accessibilityHint).toBe('Anyone signed in can see this');
    const slop = toggle.props.hitSlop as { top: number; bottom: number };
    expect(NATIVE_SWITCH_HEIGHT + slop.top + slop.bottom).toBeGreaterThanOrEqual(size.touch);

    await fireEvent(toggle, 'valueChange', false);
    const off = screen.getByRole('switch', { name: 'Public' });
    expect(off.props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    expect(screen.getByText('Off', { includeHiddenElements: true })).toBeTruthy();
    expect(off.props.accessibilityHint).toBe('Only you can see this');
  });
});
