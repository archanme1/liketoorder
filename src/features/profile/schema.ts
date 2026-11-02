import { z } from 'zod';

// Must match the check constraints on public.profiles exactly
// (supabase/migrations/20261102033759_auth_and_profiles.sql).
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 160;
export const CITY_MAX = 60;

export const USERNAME_HINT = '3–20 characters: lowercase letters, numbers or _';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, `Use ${USERNAME_HINT}`);

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter your name')
  .max(DISPLAY_NAME_MAX, `Use ${DISPLAY_NAME_MAX} characters or fewer`);

export const bioSchema = z.string().trim().max(BIO_MAX, `Use ${BIO_MAX} characters or fewer`);

export const citySchema = z.string().trim().max(CITY_MAX, `Use ${CITY_MAX} characters or fewer`);

export const setupProfileSchema = z.object({
  display_name: displayNameSchema,
  username: usernameSchema,
});

export const editProfileSchema = z.object({
  display_name: displayNameSchema,
  username: usernameSchema,
  bio: bioSchema,
  city: citySchema,
});

export type SetupProfileValues = z.infer<typeof setupProfileSchema>;
export type EditProfileValues = z.infer<typeof editProfileSchema>;
