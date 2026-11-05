import { removeFromBucket, signedUrls, uploadToBucket } from '../api';
import { MediaError } from '../errors';

// jest.mock is hoisted above the imports; the factory reads these lazily (mock-prefixed names).
const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockCreateSignedUrls = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        mockFrom(bucket);
        return {
          upload: mockUpload,
          remove: mockRemove,
          createSignedUrls: mockCreateSignedUrls,
        };
      },
    },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUpload.mockResolvedValue({ data: { path: 'x' }, error: null });
  mockRemove.mockResolvedValue({ data: [], error: null });
  mockCreateSignedUrls.mockResolvedValue({ data: [], error: null });
});

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]);

describe('uploadToBucket', () => {
  it('uploads to the given bucket and path with upsert false', async () => {
    await uploadToBucket('business-media', 'biz/photo.jpg', BYTES);

    expect(mockFrom).toHaveBeenCalledWith('business-media');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [uploadPath, , options] = mockUpload.mock.calls[0];
    expect(uploadPath).toBe('biz/photo.jpg');
    expect(options).toEqual(expect.objectContaining({ upsert: false }));
  });

  it('declares the content type as JPEG', async () => {
    await uploadToBucket('business-media', 'biz/photo.jpg', BYTES);
    expect(mockUpload.mock.calls[0][2]).toEqual(
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
  });

  it('sends the bytes it was given', async () => {
    await uploadToBucket('business-media', 'biz/photo.jpg', BYTES);
    const body = mockUpload.mock.calls[0][1] as ArrayBuffer | Uint8Array;
    expect(Array.from(new Uint8Array(body instanceof Uint8Array ? body : body))).toEqual(
      Array.from(BYTES),
    );
  });

  it('refuses more than 2 097 152 bytes before calling storage', async () => {
    const tooBig = new Uint8Array(2097153);
    await expect(uploadToBucket('business-media', 'biz/p.jpg', tooBig)).rejects.toMatchObject({
      code: 'too_large',
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('accepts exactly 2 097 152 bytes', async () => {
    await uploadToBucket('business-media', 'biz/p.jpg', new Uint8Array(2097152));
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('throws a MediaError when storage reports an error', async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: 'new row violates policy' } });
    const error = await uploadToBucket('business-media', 'biz/p.jpg', BYTES).catch((e) => e);
    expect(error).toBeInstanceOf(MediaError);
    expect((error as MediaError).code).toBe('upload_failed');
  });

  it('maps a network failure to the network code', async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await expect(uploadToBucket('business-media', 'biz/p.jpg', BYTES)).rejects.toMatchObject({
      code: 'network',
    });
  });
});

describe('removeFromBucket', () => {
  it('removes all given paths in one call', async () => {
    await removeFromBucket('business-media', ['a/1.jpg', 'a/2.jpg']);
    expect(mockFrom).toHaveBeenCalledWith('business-media');
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith(['a/1.jpg', 'a/2.jpg']);
  });

  it('throws a MediaError when storage reports an error', async () => {
    mockRemove.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(removeFromBucket('business-media', ['a/1.jpg'])).rejects.toBeInstanceOf(
      MediaError,
    );
  });
});

describe('signedUrls', () => {
  it('requests one batch with a 3600 second TTL', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: [
        { path: 'a/1.jpg', signedUrl: 'https://s/1', error: null },
        { path: 'a/2.jpg', signedUrl: 'https://s/2', error: null },
      ],
      error: null,
    });

    await signedUrls('business-media', ['a/1.jpg', 'a/2.jpg'], 3600);

    expect(mockFrom).toHaveBeenCalledWith('business-media');
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['a/1.jpg', 'a/2.jpg'], 3600);
  });

  it('returns a map of path to URL', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: [
        { path: 'a/1.jpg', signedUrl: 'https://s/1', error: null },
        { path: 'a/2.jpg', signedUrl: 'https://s/2', error: null },
      ],
      error: null,
    });
    await expect(signedUrls('business-media', ['a/1.jpg', 'a/2.jpg'], 3600)).resolves.toEqual({
      'a/1.jpg': 'https://s/1',
      'a/2.jpg': 'https://s/2',
    });
  });

  it('maps a path the server gave no URL for to null', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: [
        { path: 'a/1.jpg', signedUrl: 'https://s/1', error: null },
        { path: 'a/2.jpg', signedUrl: null, error: 'Object not found' },
      ],
      error: null,
    });
    await expect(signedUrls('business-media', ['a/1.jpg', 'a/2.jpg'], 3600)).resolves.toEqual({
      'a/1.jpg': 'https://s/1',
      'a/2.jpg': null,
    });
  });

  it('maps a path missing from the response to null', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: [{ path: 'a/1.jpg', signedUrl: 'https://s/1', error: null }],
      error: null,
    });
    const urls = await signedUrls('business-media', ['a/1.jpg', 'a/2.jpg'], 3600);
    expect(urls['a/2.jpg']).toBeNull();
  });

  it('throws a MediaError when the whole request fails', async () => {
    mockCreateSignedUrls.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(signedUrls('business-media', ['a/1.jpg'], 3600)).rejects.toBeInstanceOf(
      MediaError,
    );
  });
});
