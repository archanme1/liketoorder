import type { SupabaseClient } from '@supabase/supabase-js';

export type AuthUser = { id: string };

// Resolves a JWT to a signed-in user, or null when the token has no user.
export type GetUser = (jwt: string) => Promise<AuthUser | null>;

// The anon key is itself a valid JWT, so platform verify_jwt alone would let guests through.
// Only a token that resolves to a real user passes.
export async function requireUser(req: Request, getUser: GetUser): Promise<AuthUser | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  if (!match) return null;
  const user = await getUser(match[1]);
  return user && user.id ? user : null;
}

export function createGetUser(client: SupabaseClient): GetUser {
  return async (jwt) => {
    const { data, error } = await client.auth.getUser(jwt);
    if (error || !data.user) return null;
    return { id: data.user.id };
  };
}
