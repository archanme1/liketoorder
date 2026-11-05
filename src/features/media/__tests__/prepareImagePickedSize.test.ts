import { File } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';

import { pickImage } from '../pickImage';
import { prepareImage } from '../prepareImage';

type Resize = { width?: number; height?: number };
type SaveOptions = { compress: number; format: string };

function seg(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/** A valid clean JPEG (SOI, DQT, SOS, zero data, EOI). */
function cleanJpeg(): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...seg(0xdb, new Array(65).fill(1)),
    0xff,
    0xda,
    0x00,
    0x02,
    0xff,
    0xd9,
  ]);
}

type Harness = { resizes: Resize[]; saves: SaveOptions[]; renders: number };

/** Fakes the manipulator for a real source of srcW x srcH. Counts every source render. */
function mockManipulator(srcW: number, srcH: number): Harness {
  const harness: Harness = { resizes: [], saves: [], renders: 0 };
  jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
    let w = srcW;
    let h = srcH;
    const context: { resize: jest.Mock; renderAsync: jest.Mock; reset: jest.Mock } = {
      resize: jest.fn((size: Resize) => {
        harness.resizes.push(size);
        if (size.width !== undefined) {
          h = Math.round((srcH * size.width) / srcW);
          w = size.width;
        } else if (size.height !== undefined) {
          w = Math.round((srcW * size.height) / srcH);
          h = size.height;
        }
        return context;
      }),
      renderAsync: jest.fn(async () => {
        harness.renders += 1;
        const width = w;
        const height = h;
        return {
          width,
          height,
          saveAsync: jest.fn(async (options: SaveOptions) => {
            harness.saves.push(options);
            return { uri: 'file:///mock/out.jpg', width, height };
          }),
          release: jest.fn(),
        };
      }),
      reset: jest.fn(() => {
        w = srcW;
        h = srcH;
        return context;
      }),
    };
    return context as unknown as ReturnType<typeof ImageManipulator.manipulate>;
  });
  return harness;
}

const mockedLaunch = jest.mocked(launchImageLibraryAsync);

/** Runs the real pickImage with the picker reporting `width` x `height`; returns the picked uri. */
async function pick(uri: string, width: number, height: number): Promise<string> {
  mockedLaunch.mockResolvedValue({ canceled: false, assets: [{ uri, width, height }] });
  const picked = await pickImage();
  if (picked === null) throw new Error('expected a picked uri');
  return picked;
}

let bytesSpy: jest.SpyInstance;

beforeEach(() => {
  bytesSpy = jest.spyOn(File.prototype, 'bytes');
  bytesSpy.mockResolvedValue(cleanJpeg());
});

afterEach(() => {
  bytesSpy.mockRestore();
  jest.mocked(ImageManipulator.manipulate).mockReset();
  mockedLaunch.mockReset();
  mockedLaunch.mockImplementation(async () => ({ canceled: true, assets: null }));
});

describe('prepareImage with a remembered picker size', () => {
  it('renders a large landscape source once and requests exactly 1600 on the long edge', async () => {
    const h = mockManipulator(4000, 3000);
    const uri = await pick('file:///picker/big-landscape.jpg', 4000, 3000);

    const result = await prepareImage(uri);

    expect(h.renders).toBe(1);
    expect(h.resizes).toEqual([{ width: 1600 }]);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1200);
  });

  it('renders a large portrait source once and requests exactly 1600 on the long edge', async () => {
    const h = mockManipulator(3000, 4000);
    const uri = await pick('file:///picker/big-portrait.jpg', 3000, 4000);

    const result = await prepareImage(uri);

    expect(h.renders).toBe(1);
    expect(h.resizes).toEqual([{ height: 1600 }]);
    expect(result.height).toBe(1600);
  });

  it('renders a small source once and requests no resize', async () => {
    const h = mockManipulator(800, 600);
    const uri = await pick('file:///picker/small.jpg', 800, 600);

    const result = await prepareImage(uri);

    expect(h.renders).toBe(1);
    expect(h.resizes).toEqual([]);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });
});

describe('prepareImage when the picker reported the wrong size', () => {
  it('renders again with the correct resize so the long edge is at most 1600', async () => {
    // The picker says 1000x800 (no resize needed) but the real source is 3000x2000.
    const h = mockManipulator(3000, 2000);
    const uri = await pick('file:///picker/wrong-size.jpg', 1000, 800);

    const result = await prepareImage(uri);

    expect(h.renders).toBe(2);
    expect(h.resizes).toEqual([{ width: 1600 }]);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1600);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(Math.round((2000 * 1600) / 3000));
  });

  it('also holds for a portrait source reported as small', async () => {
    const h = mockManipulator(2000, 3000);
    const uri = await pick('file:///picker/wrong-size-tall.jpg', 800, 1000);

    const result = await prepareImage(uri);

    expect(h.renders).toBe(2);
    expect(h.resizes).toEqual([{ height: 1600 }]);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1600);
  });
});

describe('prepareImage without a picked size', () => {
  it('still resizes a large image to exactly 1600 on the long edge', async () => {
    const h = mockManipulator(4000, 3000);

    const result = await prepareImage('file:///never-picked/big.jpg');

    expect(h.resizes).toEqual([{ width: 1600 }]);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1200);
  });

  it('still leaves a small image at its size', async () => {
    const h = mockManipulator(800, 600);

    const result = await prepareImage('file:///never-picked/small.jpg');

    expect(h.resizes).toEqual([]);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('still encodes JPEG at 0.8', async () => {
    const h = mockManipulator(4000, 3000);

    await prepareImage('file:///never-picked/enc.jpg');

    expect(h.saves).toHaveLength(1);
    expect(h.saves[0].compress).toBe(0.8);
  });
});
