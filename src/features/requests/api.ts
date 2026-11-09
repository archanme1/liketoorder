import {
  FunctionsFetchError,
  FunctionsRelayError,
  type PostgrestError,
} from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import {
  pickupAddressSchema,
  pickupRequestSchema,
  requestDetailSchema,
  requestListSchema,
  sellerRequestDetailSchema,
  sellerRequestListSchema,
  sellerRequestSchema,
  waitingCountSchema,
  type OrderLine,
  type PickupAddress,
  type InboxFilter,
  type PickupRequest,
  type RequestDetail,
  type RequestList,
  type SellerDecision,
  type SellerOutcome,
  type SellerRequest,
  type SellerRequestDetail,
  type SellerRequestList,
  type WaitingCount,
} from './schema';

export type RequestErrorCode =
  | 'not_signed_in'
  | 'profile_incomplete'
  | 'invalid_input'
  | 'business_unavailable'
  | 'own_business'
  | 'invalid_pickup_time'
  | 'invalid_items'
  | 'invalid_text'
  | 'item_unavailable'
  | 'empty_order'
  | 'too_many_pending'
  | 'rate_limited'
  | 'invalid_transition'
  | 'not_found'
  | 'network'
  | 'unknown';

const SERVER_CODES: ReadonlySet<string> = new Set<RequestErrorCode>([
  'not_signed_in',
  'profile_incomplete',
  'invalid_input',
  'business_unavailable',
  'own_business',
  'invalid_pickup_time',
  'invalid_items',
  'invalid_text',
  'item_unavailable',
  'empty_order',
  'too_many_pending',
  'rate_limited',
  'invalid_transition',
  'not_found',
]);

// Carries only a code: never the order, the note, an address or the upstream message.
export class RequestAppError extends Error {
  readonly code: RequestErrorCode;

  constructor(code: RequestErrorCode) {
    super(code);
    this.name = 'RequestAppError';
    this.code = code;
  }
}

/** Maps an RPC error from the request functions to a coded error. */
export function mapRequestError(error: unknown): RequestAppError {
  if (error instanceof RequestAppError) return error;
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return new RequestAppError('network');
  }
  if (!error || typeof error !== 'object') return new RequestAppError('unknown');
  const {
    code = '',
    message = '',
    details,
  } = error as Partial<Omit<PostgrestError, 'details'> & { details: string | null }>;

  if (code === 'P0001' && SERVER_CODES.has(message)) {
    return new RequestAppError(message as RequestErrorCode);
  }
  if (!code && /network|fetch/i.test(`${message} ${details ?? ''}`)) {
    return new RequestAppError('network');
  }
  return new RequestAppError('unknown');
}

export type SubmitPickupInput = {
  businessId: string;
  idempotencyKey: string;
  pickupAt: Date;
  /** Item ids and quantities only: the server reads names and prices itself. */
  items?: readonly OrderLine[];
  orderText?: string;
  note?: string;
};

export async function submitPickupRequest(input: SubmitPickupInput): Promise<PickupRequest> {
  const { data, error } = await supabase.rpc('submit_pickup_request', {
    p_business_id: input.businessId,
    p_idempotency_key: input.idempotencyKey,
    p_pickup_at: input.pickupAt.toISOString(),
    p_items: input.items?.map((line) => ({ item_id: line.itemId, quantity: line.quantity })),
    p_order_text: input.orderText,
    p_note: input.note,
  });
  if (error) throw mapRequestError(error);
  const parsed = pickupRequestSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}

export async function cancelPickupRequest(requestId: string): Promise<PickupRequest> {
  const { data, error } = await supabase.rpc('cancel_pickup_request', {
    p_request_id: requestId,
  });
  if (error) throw mapRequestError(error);
  const parsed = pickupRequestSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}

/** One page (50) of the caller's requests, newest first; `before` is the last row's created_at. */
export async function listMyPickupRequests(before?: string): Promise<RequestList> {
  const { data, error } = await supabase.rpc('list_my_pickup_requests', { p_before: before });
  if (error) throw mapRequestError(error);
  const parsed = requestListSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}

/** One of the caller's requests; `request` is null for an unknown id and for someone else's. */
export async function getPickupRequest(requestId: string): Promise<RequestDetail> {
  const { data, error } = await supabase.rpc('get_my_pickup_request', {
    p_request_id: requestId,
  });
  if (error) throw mapRequestError(error);
  const parsed = requestDetailSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}

/** A homemade cook's exact address, or null (the server answers the same for every reason). */
export async function getMyPickupAddress(requestId: string): Promise<PickupAddress | null> {
  const { data, error } = await supabase.rpc('get_my_pickup_address', {
    p_request_id: requestId,
  });
  if (error) throw mapRequestError(error);
  if (data === null) return null;
  const parsed = pickupAddressSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}

// ── Seller side (spec 10) ────────────────────────────────────────────────────────────────────
// The business is always the caller's own (the database derives it from auth.uid()); the app sends
// only a request id, a decision or outcome, a filter and the server's own cursor text.

/** One page (50) of the caller's business requests; `before` is the previous page's next_cursor. */
export async function listBusinessRequests(
  filter: InboxFilter,
  before?: string,
): Promise<SellerRequestList> {
  const { data, error } = await supabase.rpc('list_business_requests', {
    p_status: filter === 'waiting' ? 'waiting' : undefined,
    p_before: before,
  });
  if (error) throw mapRequestError(error);
  const parsed = sellerRequestListSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}

/** A request to the caller's business; `request` is null for an unknown id and for someone else's. */
export async function getBusinessRequest(requestId: string): Promise<SellerRequestDetail> {
  const { data, error } = await supabase.rpc('get_business_request', { p_request_id: requestId });
  if (error) throw mapRequestError(error);
  const parsed = sellerRequestDetailSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}

export async function respondToRequest(
  requestId: string,
  decision: SellerDecision,
): Promise<SellerRequest> {
  const { data, error } = await supabase.rpc('respond_to_request', {
    p_request_id: requestId,
    p_decision: decision,
  });
  if (error) throw mapRequestError(error);
  const parsed = sellerRequestSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}

export async function markRequestOutcome(
  requestId: string,
  outcome: SellerOutcome,
): Promise<SellerRequest> {
  const { data, error } = await supabase.rpc('mark_request_outcome', {
    p_request_id: requestId,
    p_outcome: outcome,
  });
  if (error) throw mapRequestError(error);
  const parsed = sellerRequestSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}

export async function countWaitingRequests(): Promise<WaitingCount> {
  const { data, error } = await supabase.rpc('count_waiting_requests');
  if (error) throw mapRequestError(error);
  const parsed = waitingCountSchema.safeParse(data);
  if (!parsed.success) throw new RequestAppError('unknown');
  return parsed.data;
}
