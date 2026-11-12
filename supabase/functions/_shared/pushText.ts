// Fixed push texts (spec 12 Decision 2). The only variable parts are the place name (customer
// pushes only), the kind word and a count. Nothing else from a request ever reaches a push: the
// input type has no field for a note, order text, address, email, phone or customer name.

export type PushEvent = 'new_request' | 'cancelled' | 'arrived' | 'accepted' | 'declined' | 'expired';
export type RequestKind = 'pickup' | 'table';

export type PushTextInput = {
  event: PushEvent;
  kind: RequestKind;
  // How many events the push stands for; more than 1 only for a collapsed push.
  count: number;
  // The business name, sent by the database only for customer events (null for owner events).
  businessName: string | null;
};

export type PushText = { title: string; body: string };

export const PLACE_NAME_MAX = 40;

// The business name with runs of whitespace (newlines included) made one space, trimmed, and cut
// to 40 characters (code points, so a character is never split).
export function placeName(raw: string | null): string {
  const cleaned = (raw ?? '').replace(/\s+/g, ' ').trim();
  const cut = Array.from(cleaned).slice(0, PLACE_NAME_MAX).join('').trim();
  return cut === '' ? 'The place' : cut;
}

export function pushText({ event, kind, count, businessName }: PushTextInput): PushText {
  switch (event) {
    case 'new_request':
      return count > 1
        ? { title: 'New requests', body: `You have ${count} new requests waiting.` }
        : { title: kind === 'pickup' ? 'New pickup request' : 'New table request', body: 'Open LikeToOrder to answer it.' };
    case 'cancelled':
      return count > 1
        ? { title: 'Requests cancelled', body: `${count} requests were cancelled.` }
        : { title: 'Request cancelled', body: `A customer cancelled a ${kind} request.` };
    case 'arrived':
      return { title: 'Customer has arrived', body: 'A customer with a table request is here.' };
    case 'accepted':
      return { title: 'Request accepted', body: `${placeName(businessName)} accepted your ${kind} request.` };
    case 'declined':
      return { title: 'Request declined', body: `${placeName(businessName)} declined your ${kind} request.` };
    case 'expired':
      return { title: 'Request expired', body: `${placeName(businessName)} didn't answer your ${kind} request in time.` };
  }
}
