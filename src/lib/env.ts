import { z } from 'zod';

const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Public Maps SDK keys. Optional: a missing key must not crash the app (the map screen shows
  // "Map isn't configured"). An empty string counts as missing.
  EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: z.string().optional(),
  EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Missing or invalid environment variables: ${names.join(', ')}. ` +
        'Copy .env.example to .env and fill in the values printed by `npx supabase start`.',
    );
  }
  return result.data;
}

// Expo only inlines EXPO_PUBLIC_* vars when they are read with literal property access.
export const env = parseEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY,
  EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY,
});
