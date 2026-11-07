import { assertNoHiddenMetadata, readJpegSegments } from '../../../src/features/media/jpegMetadata';
import {
  HOMEMADE_COOKS,
  HOMEMADE_HIDDEN,
  homemadeCookEmail,
  homemadeHiddenEmail,
} from '../homemadeData';
import { HIDDEN } from '../restaurantData';
import { isSeedEmail } from '../safety';

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as {
  readFileSync: (path: string) => Uint8Array;
  readdirSync: (path: string) => string[];
};
const path = require('path') as { join: (...parts: string[]) => string };
/* eslint-enable @typescript-eslint/no-require-imports */

// jest runs from the repo root (the seed does too).
const PHOTO_DIR = path.join('scripts', 'seed', 'photos');
const used = HOMEMADE_COOKS.flatMap((cook) => [
  ...(cook.photos?.cover ? [cook.photos.cover] : []),
  ...(cook.photos?.gallery ?? []),
  ...(cook.photos?.menu ?? []),
]);

describe('the seed photos', () => {
  it('uses only files that exist', () => {
    const files = fs.readdirSync(PHOTO_DIR);
    for (const name of used) expect(files).toContain(`${name}.jpg`);
  });

  it.each(fs.readdirSync(PHOTO_DIR).filter((name) => name.endsWith('.jpg')))(
    '%s is a small, metadata-free JPEG',
    (name) => {
      const bytes = fs.readFileSync(path.join(PHOTO_DIR, name));
      expect(bytes.length).toBeLessThan(100 * 1024);
      expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
      // The app's own check: no EXIF, XMP, IPTC, comment or any other metadata segment.
      expect(() => assertNoHiddenMetadata(bytes)).not.toThrow();
      expect(readJpegSegments(bytes).map((segment) => segment.id ?? segment.name)).not.toContain(
        'Exif',
      );
    },
  );
});

describe('the homemade seed data', () => {
  it('has 13 visible cooks: Oshawa 5, Cambridge 3, Toronto 5', () => {
    const count = (area: string) => HOMEMADE_COOKS.filter((cook) => cook.area === area).length;
    expect(HOMEMADE_COOKS).toHaveLength(13);
    expect([count('oshawa'), count('cambridge'), count('toronto')]).toEqual([5, 3, 5]);
  });

  it('covers every photo case: full, items only, menu photos only, cover only, file missing', () => {
    const rosa = HOMEMADE_COOKS.find((cook) => cook.name === "Nonna Rosa's Table");
    expect(rosa?.photos?.cover).toBeTruthy();
    expect(rosa?.photos?.gallery).toHaveLength(3);
    expect(rosa?.photos?.menu).toHaveLength(2);
    expect(rosa?.menu?.length).toBeGreaterThan(0);
    expect(HOMEMADE_COOKS.some((cook) => cook.menu && !cook.photos)).toBe(true);
    expect(HOMEMADE_COOKS.some((cook) => cook.photos?.menu && !cook.photos.cover)).toBe(true);
    expect(
      HOMEMADE_COOKS.some(
        (cook) => cook.photos?.cover && !cook.photos.gallery && !cook.photos.menu,
      ),
    ).toBe(true);
    expect(HOMEMADE_COOKS.filter((cook) => cook.photos?.fileMissing)).toHaveLength(1);
  });

  it('names the three hidden cooks, and no restaurant seed is a homemade cook any more', () => {
    expect(HOMEMADE_HIDDEN.map((cook) => cook.name)).toEqual([
      'Stale Samosas',
      'Gone Place',
      'Unlisted Kitchen',
    ]);
    expect(HIDDEN.some((row) => row.type === 'homemade')).toBe(false);
  });
});

describe('the homemade seed accounts', () => {
  // The re-run deletes only accounts that isSeedEmail accepts (safety.test.ts covers the helper and
  // the local-URL guard, which the whole seed runs behind). This proves every account the homemade
  // seed creates is one of them, so a re-run cleans up after itself and touches nothing else.
  it('are all accounts the re-run is allowed to delete', () => {
    const emails = [
      ...HOMEMADE_COOKS.map((_cook, index) => homemadeCookEmail(index + 1)),
      ...HOMEMADE_HIDDEN.map((cook) => homemadeHiddenEmail(cook.key)),
    ];
    expect(emails.length).toBe(HOMEMADE_COOKS.length + HOMEMADE_HIDDEN.length);
    for (const email of emails) expect(isSeedEmail(email)).toBe(true);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('includes the two demo logins the manual script uses', () => {
    expect(homemadeCookEmail(1)).toBe('seed-homemade-1@example.com');
    expect(homemadeHiddenEmail('stale')).toBe('seed-homemade-stale@example.com');
  });
});
