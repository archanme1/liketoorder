import { GALLERY_LIMIT, MENU_PHOTO_LIMIT, type BusinessPhoto, type Menu } from './schema';

export const MEDIA_BUCKET = 'business-media';

export type PhotoSections = {
  /** Cover rows; normally one. During a replace the reservation shows here too. */
  cover: BusinessPhoto[];
  gallery: BusinessPhoto[];
  menu: BusinessPhoto[];
  /** Item photo rows by item id. */
  byItem: Map<string, BusinessPhoto[]>;
};

export function groupPhotos(photos: readonly BusinessPhoto[]): PhotoSections {
  const sections: PhotoSections = { cover: [], gallery: [], menu: [], byItem: new Map() };
  for (const photo of photos) {
    if (photo.kind === 'item' && photo.menu_item_id) {
      const list = sections.byItem.get(photo.menu_item_id) ?? [];
      list.push(photo);
      sections.byItem.set(photo.menu_item_id, list);
    } else if (photo.kind === 'cover') {
      sections.cover.push(photo);
    } else if (photo.kind === 'gallery') {
      sections.gallery.push(photo);
    } else if (photo.kind === 'menu') {
      sections.menu.push(photo);
    }
  }
  return sections;
}

/**
 * The one photo to show for a single slot (cover or an item). The owner can also read an
 * unfinished reservation for the slot, which has no file: prefer the row that has a URL.
 */
export function slotPhoto(
  rows: readonly BusinessPhoto[] | undefined,
  urlFor: (path: string) => string | null | undefined,
): BusinessPhoto | undefined {
  if (!rows || rows.length === 0) return undefined;
  return rows.find((row) => typeof urlFor(row.path) === 'string') ?? rows[rows.length - 1];
}

// Decision 16: photos are named by the business or item name.
export const photoNames = {
  cover: (businessName: string) => `Cover photo, ${businessName}`,
  gallery: (index: number, count: number, businessName: string) =>
    `Photo ${index} of ${count}, ${businessName}`,
  menu: (index: number, count: number, businessName: string) =>
    `Menu page ${index} of ${count}, ${businessName}`,
  item: (itemName: string) => `Photo of ${itemName}`,
};

export const photoEditLabels = {
  cover: () => 'Cover photo. Opens photo options.',
  gallery: (index: number, count: number) =>
    `Gallery photo ${index} of ${count}. Opens photo options.`,
  menu: (index: number, count: number) => `Menu photo ${index} of ${count}. Opens photo options.`,
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Manage Business "Menu" row: "12 items · 2 menu photos" or "No menu yet". */
export function menuSummary(menu: Menu): string {
  const menuPhotos = groupPhotos(menu.photos).menu.length;
  const parts = [
    menu.items.length > 0 ? plural(menu.items.length, 'item', 'items') : null,
    menuPhotos > 0 ? plural(menuPhotos, 'menu photo', 'menu photos') : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'No menu yet';
}

/** Manage Business "Photos" row: "Cover set · 3 gallery photos" or "No photos yet". */
export function photosSummary(menu: Menu): string {
  const { cover, gallery } = groupPhotos(menu.photos);
  const parts = [
    cover.length > 0 ? 'Cover set' : null,
    gallery.length > 0 ? plural(gallery.length, 'gallery photo', 'gallery photos') : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'No photos yet';
}

export const PHOTO_LIMITS = { gallery: GALLERY_LIMIT, menu: MENU_PHOTO_LIMIT } as const;
