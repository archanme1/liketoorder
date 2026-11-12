import { z } from 'zod';

/** The server's own check (register_push_token): anything else is never sent or stored. */
export const PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/;

// Any Postgres uuid (not only RFC v4), compared case-insensitively, as in returnTo.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pushTokenSchema = z.string().regex(PUSH_TOKEN_PATTERN);

const kindSchema = z.enum(['pickup', 'table']);
const sideSchema = z.enum(['sent', 'received']);
const idSchema = z.string().regex(UUID_PATTERN);

/**
 * A notification's `data`, exactly as push-sender writes it: version 1, the request kind and id, and
 * which side of the Requests tab it belongs to. Anything else (another version, a bad id, an unknown
 * kind or side, an extra key) is refused, and the tap opens the Requests tab instead.
 */
export const tapPayloadSchema = z.strictObject({
  v: z.literal(1),
  kind: kindSchema,
  id: idSchema,
  side: sideSchema,
});
export type TapPayload = z.infer<typeof tapPayloadSchema>;

/** The same payload as route params on /notifications/open (every value a string). */
export const tapParamsSchema = z.strictObject({
  v: z.literal('1'),
  kind: kindSchema,
  id: idSchema,
  side: sideSchema,
});

/** What get_notification_settings and set_notification_settings return. */
export const notificationSettingsSchema = z
  .object({
    answers: z.boolean(),
    new_requests: z.boolean(),
    cancellations: z.boolean(),
    arrivals: z.boolean(),
  })
  .transform((row) => ({
    answers: row.answers,
    newRequests: row.new_requests,
    cancellations: row.cancellations,
    arrivals: row.arrivals,
  }));
export type NotificationSettings = z.output<typeof notificationSettingsSchema>;
