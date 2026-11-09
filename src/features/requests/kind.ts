/** What a request is. Today only a pickup; spec 11 adds 'table' and the lists need no rewrite. */
export type RequestKind = 'pickup';

const KIND_LABELS: Record<RequestKind, string> = { pickup: 'Pickup' };

export function kindLabel(kind: RequestKind): string {
  return KIND_LABELS[kind];
}
