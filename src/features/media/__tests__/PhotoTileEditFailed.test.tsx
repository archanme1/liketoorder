import { act, render, screen } from '@testing-library/react-native';

import { PhotoTile } from '../components/PhotoTile';

const PATH = 'biz-1/photo-1.jpg';
const EDIT_LABEL = 'Gallery photo 2 of 6. Opens photo options.';

function tile() {
  return (
    <PhotoTile
      path={PATH}
      uri="https://signed/one"
      accessibilityLabel="Photo 2 of 6, Maria’s Kitchen"
      onExpired={jest.fn()}
      onPress={jest.fn()}
      editLabel={EDIT_LABEL}
    />
  );
}

async function fireError() {
  await act(async () => {
    screen.getByTestId('expo-image').props.onError();
  });
}

describe('PhotoTile: failed photo in edit mode', () => {
  it('before any failure the button label is just the edit label', async () => {
    await render(tile());

    const button = screen.getByRole('button');
    expect(button.props.accessibilityLabel).toBe(EDIT_LABEL);
  });

  it('after the image fails twice the button label starts with the edit label and ends with "Photo unavailable"', async () => {
    await render(tile());

    await fireError();
    await fireError();

    expect(screen.getByText('Photo unavailable')).toBeTruthy();
    const label = String(screen.getByRole('button').props.accessibilityLabel);
    expect(label.startsWith(EDIT_LABEL)).toBe(true);
    expect(label.endsWith('Photo unavailable')).toBe(true);
  });

  it('after only one error the label is still just the edit label', async () => {
    await render(tile());

    await fireError();

    expect(screen.getByRole('button').props.accessibilityLabel).toBe(EDIT_LABEL);
  });
});
