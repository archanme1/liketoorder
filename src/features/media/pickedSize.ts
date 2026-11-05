// The picker already knows each photo's pixel size, so prepareImage can skip decoding the full
// original just to read it (Decision 33). A short list keyed by URI keeps pickImage's return type
// (the URI) unchanged for every caller. The size is only a hint: prepareImage checks the rendered
// size and corrects it.

const MAX_REMEMBERED = 20;
const sizes = new Map<string, { width: number; height: number }>();

export function rememberPickedSize(uri: string, width: unknown, height: unknown): void {
  if (typeof width !== 'number' || typeof height !== 'number') return;
  if (!(width > 0) || !(height > 0)) return;
  sizes.delete(uri);
  sizes.set(uri, { width, height });
  if (sizes.size > MAX_REMEMBERED) {
    const oldest = sizes.keys().next();
    if (!oldest.done) sizes.delete(oldest.value);
  }
}

export function pickedSizeOf(uri: string): { width: number; height: number } | undefined {
  return sizes.get(uri);
}
