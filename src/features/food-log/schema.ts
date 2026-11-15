import { z } from 'zod';

import { checkDescription } from './text';

// The log object returned by finish, update, get and list: exactly these 8 keys (pinned by pgTAP).
// path is null when the log is not the caller's own.
export const foodLogSchema = z.strictObject({
  id: z.string(),
  cuisine_code: z.string(),
  description: z.string().nullable(),
  is_public: z.boolean(),
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  created_at: z.string(),
  path: z.string().nullable(),
  is_mine: z.boolean(),
});
export type FoodLog = z.infer<typeof foodLogSchema>;

export const foodLogPageSchema = z.strictObject({
  items: z.array(foodLogSchema),
  next_cursor: z.string().nullable(),
});
export type FoodLogPage = z.infer<typeof foodLogPageSchema>;

export const foodLogReservationSchema = z.strictObject({ id: z.string(), path: z.string() });
export type FoodLogReservation = z.infer<typeof foodLogReservationSchema>;

export const CUISINE_REQUIRED = 'Choose a cuisine.';
export const DESCRIPTION_TOO_LONG = 'Keep the description to 280 characters.';
export const DESCRIPTION_HIDDEN =
  'The description has a hidden or formatting character. Retype it without pasting.';
export const DESCRIPTION_CONTACT = "Don't add phone numbers or emails.";

const DESCRIPTION_MESSAGES = {
  invalid_input: DESCRIPTION_TOO_LONG,
  invalid_text: DESCRIPTION_HIDDEN,
  contact_info: DESCRIPTION_CONTACT,
} as const;

// Fast feedback only: begin_food_log_upload and update_food_log judge.
export const foodLogFormSchema = z.object({
  cuisine_code: z.string().min(1, CUISINE_REQUIRED),
  description: z.string().superRefine((value, ctx) => {
    const check = checkDescription(value);
    if (!check.ok) ctx.addIssue({ code: 'custom', message: DESCRIPTION_MESSAGES[check.code] });
  }),
  is_public: z.boolean(),
});
export type FoodLogForm = z.infer<typeof foodLogFormSchema>;

export function descriptionMessage(code: keyof typeof DESCRIPTION_MESSAGES): string {
  return DESCRIPTION_MESSAGES[code];
}
