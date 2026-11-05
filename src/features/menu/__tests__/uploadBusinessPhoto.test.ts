import { removeFromBucket, uploadToBucket } from '@/features/media/api';
import { MediaError } from '@/features/media/errors';
import { prepareImage } from '@/features/media/prepareImage';

import {
  MenuAppError,
  beginPhotoUpload,
  claimPhotoCleanup,
  deleteBusinessPhoto,
  finishPhotoUpload,
} from '../api';
import { runPhotoCleanup, uploadBusinessPhoto } from '../uploadBusinessPhoto';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('@/features/media/api', () => ({
  uploadToBucket: jest.fn(),
  removeFromBucket: jest.fn(),
  signedUrls: jest.fn(),
}));
jest.mock('@/features/media/prepareImage', () => ({ prepareImage: jest.fn() }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  beginPhotoUpload: jest.fn(),
  finishPhotoUpload: jest.fn(),
  deleteBusinessPhoto: jest.fn(),
  claimPhotoCleanup: jest.fn(),
}));

const mockedPrepare = prepareImage as unknown as jest.Mock;
const mockedUpload = uploadToBucket as unknown as jest.Mock;
const mockedRemove = removeFromBucket as unknown as jest.Mock;
const mockedBegin = beginPhotoUpload as unknown as jest.Mock;
const mockedFinish = finishPhotoUpload as unknown as jest.Mock;
const mockedDelete = deleteBusinessPhoto as unknown as jest.Mock;
const mockedClaim = claimPhotoCleanup as unknown as jest.Mock;

const SOURCE_URI = 'file:///picker/original-with-gps.jpg';
const ENCODER_URI = 'file:///encoder/output.jpg';
const PREPARED_BYTES = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
const RESERVATION = { photo_id: 'photo-1', path: 'b1/photo-1.jpg' };
const PHOTO = {
  id: 'photo-1',
  business_id: 'b1',
  kind: 'gallery',
  menu_item_id: null,
  path: 'b1/photo-1.jpg',
  position: 1,
};

function order(mock: jest.Mock, call = 0): number {
  return mock.mock.invocationCallOrder[call];
}

beforeEach(() => {
  [
    mockedPrepare,
    mockedUpload,
    mockedRemove,
    mockedBegin,
    mockedFinish,
    mockedDelete,
    mockedClaim,
  ].forEach((m) => m.mockReset());
  mockedPrepare.mockResolvedValue({
    uri: ENCODER_URI,
    bytes: PREPARED_BYTES,
    width: 1200,
    height: 900,
    mimeType: 'image/jpeg',
  });
  mockedBegin.mockResolvedValue(RESERVATION);
  mockedUpload.mockResolvedValue(undefined);
  mockedFinish.mockResolvedValue(PHOTO);
  mockedDelete.mockResolvedValue(undefined);
  mockedClaim.mockResolvedValue([]);
  mockedRemove.mockResolvedValue(undefined);
});

describe('uploadBusinessPhoto: the happy path', () => {
  it('runs prepare, begin, upload, finish in that order and returns the photo', async () => {
    const photo = await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' });

    expect(photo).toEqual(PHOTO);
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
    expect(mockedBegin).toHaveBeenCalledTimes(1);
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedFinish).toHaveBeenCalledTimes(1);
    expect(order(mockedPrepare)).toBeLessThan(order(mockedBegin));
    expect(order(mockedBegin)).toBeLessThan(order(mockedUpload));
    expect(order(mockedUpload)).toBeLessThan(order(mockedFinish));
  });

  it('asks the server for a slot of the right kind, and for the item when it is an item photo', async () => {
    await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'item', menuItemId: 'item-1' });
    expect(mockedBegin).toHaveBeenCalledWith('item', 'item-1');
  });

  it('uploads into the business-media bucket at the server-made path', async () => {
    await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' });
    expect(mockedUpload.mock.calls[0][0]).toBe('business-media');
    expect(mockedUpload.mock.calls[0][1]).toBe(RESERVATION.path);
  });

  it('finishes the reservation the server made', async () => {
    await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' });
    expect(mockedFinish).toHaveBeenCalledWith(RESERVATION.photo_id);
  });
});

describe('uploadBusinessPhoto: only the prepared bytes are uploaded', () => {
  it('passes prepareImage the picked photo and uploads exactly the bytes it returned', async () => {
    await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' });

    expect(mockedPrepare.mock.calls[0][0]).toBe(SOURCE_URI);
    // The very same Uint8Array instance, not a copy of the file and not a re-read.
    expect(mockedUpload.mock.calls[0][2]).toBe(PREPARED_BYTES);
  });

  it('never hands the picker URI (or the encoder file) to the Storage upload', async () => {
    await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'cover' });

    const args = mockedUpload.mock.calls[0] as unknown[];
    expect(args).toHaveLength(3);
    expect(args).not.toContain(SOURCE_URI);
    expect(args).not.toContain(ENCODER_URI);
    expect(args.every((arg) => typeof arg !== 'string' || !arg.startsWith('file:'))).toBe(true);
  });
});

describe('uploadBusinessPhoto: a photo that fails preparation', () => {
  it.each(['metadata_present', 'too_large', 'not_an_image'] as const)(
    '%s reserves nothing and uploads nothing',
    async (code) => {
      mockedPrepare.mockRejectedValue(new MediaError(code));

      await expect(
        uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' }),
      ).rejects.toMatchObject({
        name: 'MediaError',
        code,
      });

      expect(mockedBegin).not.toHaveBeenCalled();
      expect(mockedUpload).not.toHaveBeenCalled();
      expect(mockedFinish).not.toHaveBeenCalled();
      expect(mockedDelete).not.toHaveBeenCalled();
    },
  );
});

describe('uploadBusinessPhoto: cleanup_required (Decision 25)', () => {
  it('runs the cleanup (claim, remove, claim) and retries begin exactly once', async () => {
    mockedBegin
      .mockRejectedValueOnce(new MenuAppError('cleanup_required'))
      .mockResolvedValueOnce(RESERVATION);
    mockedClaim.mockResolvedValueOnce(['b1/old-1.jpg', 'b1/old-2.jpg']).mockResolvedValueOnce([]);

    const photo = await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' });

    expect(photo).toEqual(PHOTO);
    expect(mockedBegin).toHaveBeenCalledTimes(2);
    expect(mockedRemove).toHaveBeenCalledWith('business-media', ['b1/old-1.jpg', 'b1/old-2.jpg']);
    expect(mockedClaim.mock.calls.length).toBeGreaterThanOrEqual(2);
    // begin #1 -> claim -> remove -> claim -> begin #2
    expect(order(mockedBegin, 0)).toBeLessThan(order(mockedClaim, 0));
    expect(order(mockedClaim, 0)).toBeLessThan(order(mockedRemove, 0));
    expect(order(mockedRemove, 0)).toBeLessThan(order(mockedClaim, 1));
    expect(order(mockedClaim, 1)).toBeLessThan(order(mockedBegin, 1));
    expect(mockedUpload).toHaveBeenCalledTimes(1);
  });

  it('prepares the photo only once, not again on the retry', async () => {
    mockedBegin
      .mockRejectedValueOnce(new MenuAppError('cleanup_required'))
      .mockResolvedValueOnce(RESERVATION);
    await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' });
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
  });

  it('surfaces a second cleanup_required and uploads nothing', async () => {
    mockedBegin.mockRejectedValue(new MenuAppError('cleanup_required'));

    const error = await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(MenuAppError);
    expect((error as MenuAppError).code).toBe('cleanup_required');
    expect(mockedBegin).toHaveBeenCalledTimes(2);
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(mockedFinish).not.toHaveBeenCalled();
  });

  it('does not retry for other reservation errors', async () => {
    mockedBegin.mockRejectedValue(new MenuAppError('photo_limit'));
    await expect(
      uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' }),
    ).rejects.toMatchObject({
      code: 'photo_limit',
    });
    expect(mockedBegin).toHaveBeenCalledTimes(1);
    expect(mockedUpload).not.toHaveBeenCalled();
  });
});

describe('uploadBusinessPhoto: a failure after the slot is reserved', () => {
  it('a failed upload deletes the reservation, then runs the cleanup, and finishes nothing', async () => {
    mockedUpload.mockRejectedValue(new MediaError('upload_failed'));
    mockedClaim.mockResolvedValueOnce(['b1/photo-1.jpg']).mockResolvedValueOnce([]);

    await expect(
      uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' }),
    ).rejects.toBeInstanceOf(Error);

    expect(mockedFinish).not.toHaveBeenCalled();
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith(RESERVATION.photo_id);
    expect(mockedClaim).toHaveBeenCalled();
    expect(order(mockedDelete)).toBeLessThan(order(mockedClaim, 0));
    expect(mockedRemove).toHaveBeenCalledWith('business-media', ['b1/photo-1.jpg']);
  });

  it('a failed finish deletes the reservation, then runs the cleanup', async () => {
    mockedFinish.mockRejectedValue(new MenuAppError('upload_missing'));
    mockedClaim.mockResolvedValueOnce(['b1/photo-1.jpg']).mockResolvedValueOnce([]);

    await expect(
      uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' }),
    ).rejects.toBeInstanceOf(Error);

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith(RESERVATION.photo_id);
    expect(order(mockedFinish)).toBeLessThan(order(mockedDelete));
    expect(order(mockedDelete)).toBeLessThan(order(mockedClaim, 0));
    expect(mockedRemove).toHaveBeenCalledWith('business-media', ['b1/photo-1.jpg']);
  });

  it('still reports the failure when deleting the reservation also fails', async () => {
    mockedUpload.mockRejectedValue(new MediaError('network'));
    mockedDelete.mockRejectedValue(new MenuAppError('network'));

    await expect(
      uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' }),
    ).rejects.toBeInstanceOf(Error);
    expect(mockedDelete).toHaveBeenCalledTimes(1);
  });

  it('does not delete anything after a successful upload', async () => {
    await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind: 'gallery' });
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});

describe('uploadBusinessPhoto: replacing a cover or item photo', () => {
  it.each([
    ['cover', undefined],
    ['item', 'item-1'],
  ] as const)(
    '%s runs the cleanup afterwards to remove the replaced file',
    async (kind, itemId) => {
      mockedClaim.mockResolvedValueOnce(['b1/replaced.jpg']).mockResolvedValueOnce([]);

      await uploadBusinessPhoto({ sourceUri: SOURCE_URI, kind, menuItemId: itemId });

      expect(order(mockedFinish)).toBeLessThan(order(mockedClaim, 0));
      expect(mockedRemove).toHaveBeenCalledWith('business-media', ['b1/replaced.jpg']);
    },
  );
});

describe('runPhotoCleanup', () => {
  it('claims, removes the returned paths, then claims again so the server drops the rows', async () => {
    mockedClaim.mockResolvedValueOnce(['b1/a.jpg']).mockResolvedValueOnce([]);

    await runPhotoCleanup();

    expect(mockedClaim).toHaveBeenCalledTimes(2);
    expect(mockedRemove).toHaveBeenCalledWith('business-media', ['b1/a.jpg']);
    expect(order(mockedClaim, 0)).toBeLessThan(order(mockedRemove, 0));
    expect(order(mockedRemove, 0)).toBeLessThan(order(mockedClaim, 1));
  });

  it('removes nothing when nothing is queued', async () => {
    mockedClaim.mockResolvedValue([]);
    await runPhotoCleanup();
    const removedSomething = mockedRemove.mock.calls.some(
      (call) => Array.isArray(call[1]) && (call[1] as unknown[]).length > 0,
    );
    expect(removedSomething).toBe(false);
  });

  it('never throws, so a failed removal stays queued for the next run', async () => {
    mockedClaim.mockResolvedValue(['b1/a.jpg']);
    mockedRemove.mockRejectedValue(new MediaError('network'));
    await expect(runPhotoCleanup()).resolves.toBeUndefined();
  });

  it('never throws when the claim itself fails', async () => {
    mockedClaim.mockRejectedValue(new MenuAppError('network'));
    await expect(runPhotoCleanup()).resolves.toBeUndefined();
  });
});
