import { launchImageLibraryAsync } from 'expo-image-picker';

import { pickImage } from '../pickImage';

// Set by jest's module wrapper (the app's tsconfig loads no Node types).
declare const __dirname: string;

const mockedLaunch = jest.mocked(launchImageLibraryAsync);

afterEach(() => {
  mockedLaunch.mockReset();
  mockedLaunch.mockImplementation(async () => ({ canceled: true, assets: null }));
});

describe('pickImage', () => {
  it('asks for a single image from the library, with exif off and no editing', async () => {
    await pickImage();

    expect(mockedLaunch).toHaveBeenCalledTimes(1);
    const options = mockedLaunch.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        exif: false,
      }),
    );
    expect(options?.allowsEditing ?? false).toBe(false);
  });

  it('returns null when the user cancels', async () => {
    mockedLaunch.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickImage()).resolves.toBeNull();
  });

  it('returns the asset URI of the chosen photo', async () => {
    mockedLaunch.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library/IMG_0001.jpg', width: 4000, height: 3000 }],
    });
    await expect(pickImage()).resolves.toBe('file:///library/IMG_0001.jpg');
  });

  it('does not use the camera (library only, no camera permission)', () => {
    // No Node types in the app's tsconfig, so the two calls are typed inline. __dirname is set by
    // jest's module wrapper.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs') as {
      readFileSync: (path: string, encoding: 'utf8') => string;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path') as { join: (...segments: string[]) => string };
    const source = readFileSync(join(__dirname, '..', 'pickImage.ts'), 'utf8');
    expect(source).not.toMatch(/launchCameraAsync|CameraPermission/);
  });
});
