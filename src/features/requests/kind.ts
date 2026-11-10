/** What a request is. Every request object carries it as `kind`. */
export type RequestKind = 'pickup' | 'table';

const KIND_LABELS: Record<RequestKind, string> = { pickup: 'Pickup', table: 'Table' };

export function kindLabel(kind: RequestKind): string {
  return KIND_LABELS[kind];
}

/** A route parameter is a hint, never an authority: anything but a known kind is no kind. */
export function parseKind(value: unknown): RequestKind | null {
  return value === 'pickup' || value === 'table' ? value : null;
}
