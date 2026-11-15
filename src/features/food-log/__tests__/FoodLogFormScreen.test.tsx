import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls, uploadToBucket } from '@/features/media/api';
import { pickImage } from '@/features/media/pickImage';
import { prepareImage } from '@/features/media/prepareImage';

import { CUISINES, foodLog, testClientOptions } from '../__fixtures__/foodLog';
import {
  beginFoodLogUpload,
  claimFoodLogCleanup,
  FoodLogAppError,
  finishFoodLogUpload,
  getFoodLog,
  updateFoodLog,
} from '../api';
import { FoodLogFormScreen, type FoodLogFormScreenProps } from '../components/FoodLogFormScreen';
import { DESCRIPTION_HINT, FOOD_LOG_NOT_FOUND } from '../messages';
import { DESCRIPTION_CONTACT, DESCRIPTION_HIDDEN } from '../schema';

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
  beginFoodLogUpload: jest.fn(),
  finishFoodLogUpload: jest.fn(),
  updateFoodLog: jest.fn(),
  deleteFoodLog: jest.fn(),
  getFoodLog: jest.fn(),
  claimFoodLogCleanup: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  signedUrls: jest.fn(),
  uploadToBucket: jest.fn(),
  removeFromBucket: jest.fn(),
}));
jest.mock('@/features/media/pickImage', () => ({ pickImage: jest.fn() }));
jest.mock('@/features/media/prepareImage', () => ({ prepareImage: jest.fn() }));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));

const mockedBegin = jest.mocked(beginFoodLogUpload);
const mockedFinish = jest.mocked(finishFoodLogUpload);
const mockedUpdate = jest.mocked(updateFoodLog);
const mockedGet = jest.mocked(getFoodLog);
const mockedClaim = jest.mocked(claimFoodLogCleanup);
const mockedSigned = jest.mocked(signedUrls);
const mockedUpload = jest.mocked(uploadToBucket);
const mockedPick = jest.mocked(pickImage);
const mockedPrepare = jest.mocked(prepareImage);
const mockedCuisines = jest.mocked(listCuisines);

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const PICKED = 'file:///picker/photo.jpg';
const LOG = foodLog(1);

let client: QueryClient;

async function renderForm(props: FoodLogFormScreenProps = { mode: 'create' }) {
  client = new QueryClient(testClientOptions());
  client.setQueryDefaults(['cuisines'], { gcTime: Infinity });
  client.setQueryData(['cuisines'], CUISINES);
  return render(
    <QueryClientProvider client={client}>
      <FoodLogFormScreen {...props} />
    </QueryClientProvider>,
  );
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save' });
}

async function choosePhotoAndCuisine() {
  await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
  await screen.findByLabelText('Chosen photo');
  await fireEvent.press(screen.getByRole('button', { name: 'Cuisine: Not chosen' }));
  await fireEvent.press(await screen.findByRole('radio', { name: 'Italy' }));
  await screen.findByRole('button', { name: 'Cuisine: Italy' });
}

beforeEach(() => {
  mockedCuisines.mockResolvedValue(CUISINES);
  mockedPick.mockResolvedValue(PICKED);
  mockedPrepare.mockResolvedValue({
    uri: 'file:///encoder/out.jpg',
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    width: 1200,
    height: 1200,
    mimeType: 'image/jpeg',
  });
  mockedBegin.mockResolvedValue({ id: LOG.id, path: LOG.path });
  mockedUpload.mockResolvedValue(undefined);
  mockedFinish.mockResolvedValue(LOG);
  mockedClaim.mockResolvedValue([]);
  mockedSigned.mockImplementation(async (_bucket, paths) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
  );
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
});

describe('FoodLogFormScreen, create', () => {
  it('keeps Save disabled with a reason until a photo and a cuisine are chosen', async () => {
    await renderForm();
    expect(saveButton()).toBeDisabled();
    expect(saveButton().props.accessibilityHint).toBe('Choose a photo first.');
    expect(screen.getByText('Choose a photo first.', { includeHiddenElements: true })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await waitFor(() =>
      expect(saveButton().props.accessibilityHint).toBe('Choose a cuisine first.'),
    );
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Cuisine: Not chosen' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Italy' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.queryByText(/first\.$/, { includeHiddenElements: true })).toBeNull();
  });

  it('a cancelled pick changes nothing', async () => {
    mockedPick.mockResolvedValue(null);
    await renderForm();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    expect(screen.queryByLabelText('Chosen photo')).toBeNull();
    expect(saveButton().props.accessibilityHint).toBe('Choose a photo first.');
  });

  it('shows the counter, the hint and the Public switch on by default', async () => {
    await renderForm();
    expect(screen.getByText('0/280')).toBeOnTheScreen();
    expect(screen.getByText(DESCRIPTION_HINT)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Description'), 'Pasta ' + cp(127859));
    expect(screen.getByText('7/280')).toBeOnTheScreen();
    expect(screen.getByLabelText('7 of 280 characters')).toBeOnTheScreen();
    // The value text is shown, and spoken as the switch's hint (LabelledSwitch); the state is
    // also shown as the word On or Off.
    const publicSwitch = () => screen.getByRole('switch', { name: 'Public' });
    expect(publicSwitch()).toBeChecked();
    expect(publicSwitch().props.accessibilityHint).toBe('Anyone signed in can see this');
    expect(
      screen.getByText('Anyone signed in can see this', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByText('On', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent(publicSwitch(), 'valueChange', false);
    expect(publicSwitch()).not.toBeChecked();
    expect(publicSwitch().props.accessibilityHint).toBe('Only you can see this');
    expect(screen.getByText('Off', { includeHiddenElements: true })).toBeTruthy();
  });

  it('saves: prepare, begin with the zone, upload, finish, then back to the list', async () => {
    await renderForm();
    await choosePhotoAndCuisine();
    await fireEvent.changeText(screen.getByLabelText('Description'), '  Pasta  ');
    await fireEvent(screen.getByRole('switch', { name: 'Public' }), 'valueChange', false);
    await fireEvent.press(saveButton());
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockedPrepare).toHaveBeenCalledWith(PICKED);
    expect(mockedBegin).toHaveBeenCalledWith(
      { cuisineCode: 'IT', description: 'Pasta', isPublic: false },
      'UTC',
    );
    expect(mockedUpload).toHaveBeenCalledWith('food-logs', LOG.path, expect.any(Uint8Array));
    expect(mockedFinish).toHaveBeenCalledWith(LOG.id);
  });

  it('sends Windows line ends and tabs normalized', async () => {
    await renderForm();
    await choosePhotoAndCuisine();
    await fireEvent.changeText(
      screen.getByLabelText('Description'),
      'one' + cp(13, 10) + 'two' + cp(9) + 'three',
    );
    await fireEvent.press(saveButton());
    await waitFor(() => expect(mockedBegin).toHaveBeenCalled());
    expect(mockedBegin.mock.calls[0][0].description).toBe('one' + cp(10) + 'two three');
  });

  it('starts one upload for two taps on Save', async () => {
    // begin stays open while the second tap lands, then finishes so nothing is left running.
    let finishBegin: (value: { id: string; path: string }) => void = () => {};
    mockedBegin.mockReturnValue(
      new Promise((resolve) => {
        finishBegin = resolve;
      }),
    );
    await renderForm();
    await choosePhotoAndCuisine();
    await fireEvent.press(saveButton());
    await waitFor(() => expect(mockedBegin).toHaveBeenCalledTimes(1));
    await fireEvent.press(saveButton());
    finishBegin({ id: LOG.id, path: LOG.path });
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(mockedBegin).toHaveBeenCalledTimes(1);
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
    expect(mockedFinish).toHaveBeenCalledTimes(1);
  });

  it('the in-code guard turns away a second tap that lands before the first one renders', async () => {
    // Both presses are started together, so both find Save still enabled (the disabled state
    // hasn't rendered yet). Only the in-code guard can stop the second one.
    let finishBegin: (value: { id: string; path: string }) => void = () => {};
    mockedBegin.mockReturnValue(
      new Promise((resolve) => {
        finishBegin = resolve;
      }),
    );
    await renderForm();
    await choosePhotoAndCuisine();
    // Pressability's onClick (the path a screen-reader activation takes) calls onPress and reads
    // `disabled` from the last render. Two clicks in one act land before the disabled Save renders.
    const click = saveButton().props.onClick as (event: unknown) => void;
    const event = { nativeEvent: {}, currentTarget: 1, target: 1, stopPropagation: () => {} };
    await act(async () => {
      click(event);
      click(event);
    });
    await waitFor(() => expect(mockedBegin).toHaveBeenCalled());
    finishBegin({ id: LOG.id, path: LOG.path });
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockedBegin).toHaveBeenCalledTimes(1);
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 10-digit run', 'call 123-456-7890', DESCRIPTION_CONTACT],
    ['an email', 'a @ b.co', DESCRIPTION_CONTACT],
    ['a bidi override', 'a' + cp(8238) + 'b', DESCRIPTION_HIDDEN],
  ])('refuses %s on the phone, before anything is sent', async (_name, text, message) => {
    await renderForm();
    await choosePhotoAndCuisine();
    await fireEvent.changeText(screen.getByLabelText('Description'), text);
    await fireEvent.press(saveButton());
    expect(await screen.findByText(new RegExp(message))).toBeOnTheScreen();
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(mockedBegin).not.toHaveBeenCalled();
  });

  it.each([
    ['a date', 'Ate on 2026-11-14'],
    ['a 9-digit run', 'call 123 456 789'],
    ['an emoji sequence', cp(128104, 8205, 127859) + ' ' + cp(10084, 65039)],
  ])('accepts %s', async (_name, text) => {
    await renderForm();
    await choosePhotoAndCuisine();
    await fireEvent.changeText(screen.getByLabelText('Description'), text);
    await fireEvent.press(saveButton());
    await waitFor(() => expect(mockedBegin).toHaveBeenCalled());
    expect(mockedBegin.mock.calls[0][0].description).toBe(text);
  });

  it('shows a server limit as a banner and stays on the form', async () => {
    mockedBegin.mockRejectedValue(new FoodLogAppError('daily_limit'));
    await renderForm();
    await choosePhotoAndCuisine();
    await fireEvent.press(saveButton());
    expect(
      await screen.findByText(/You've added a lot of photos today\. Try again tomorrow\./),
    ).toBeOnTheScreen();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it("shows the server's contact_info on the description field", async () => {
    mockedBegin.mockRejectedValue(new FoodLogAppError('contact_info'));
    await renderForm();
    await choosePhotoAndCuisine();
    await fireEvent.press(saveButton());
    expect(await screen.findByText(new RegExp(DESCRIPTION_CONTACT))).toBeOnTheScreen();
  });
});

describe('FoodLogFormScreen, edit', () => {
  it('fills the fields, keeps the photo and saves the changes', async () => {
    mockedGet.mockResolvedValue(LOG);
    mockedUpdate.mockResolvedValue({ ...LOG, description: 'Changed', is_public: false });
    await renderForm({ mode: 'edit', id: LOG.id });
    expect(await screen.findByDisplayValue('Meal 1')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cuisine: Italy' })).toBeOnTheScreen();
    expect(screen.getByText("The photo can't be changed.")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /photo$/ })).toBeNull();
    expect(saveButton()).toBeEnabled();

    await fireEvent.changeText(screen.getByLabelText('Description'), 'Changed');
    await fireEvent(screen.getByRole('switch', { name: 'Public' }), 'valueChange', false);
    await fireEvent.press(saveButton());
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockedUpdate).toHaveBeenCalledWith(LOG.id, {
      cuisineCode: 'IT',
      description: 'Changed',
      isPublic: false,
    });
    expect(mockedBegin).not.toHaveBeenCalled();
  });

  it('clearing the description sends null', async () => {
    mockedGet.mockResolvedValue(LOG);
    mockedUpdate.mockResolvedValue({ ...LOG, description: null });
    await renderForm({ mode: 'edit', id: LOG.id });
    await fireEvent.changeText(await screen.findByDisplayValue('Meal 1'), '   ');
    await fireEvent.press(saveButton());
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    expect(mockedUpdate.mock.calls[0][1].description).toBeNull();
  });

  it("shows not-found for a log that isn't mine", async () => {
    mockedGet.mockResolvedValue({ ...LOG, is_mine: false, path: null });
    await renderForm({ mode: 'edit', id: LOG.id });
    expect(await screen.findByText(FOOD_LOG_NOT_FOUND)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
