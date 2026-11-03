import { z } from 'zod';
import { type GetUser, requireUser } from '../_shared/auth.ts';
import { type GoogleClient, MissingApiKeyError, UpstreamError } from '../_shared/google.ts';
import { errorResponse, type Handler, json, readJsonBody } from '../_shared/http.ts';
import type { ConsumeQuota } from '../_shared/rateLimit.ts';

const Body = z.object({
  input: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .refine((s) => !/\p{Cc}/u.test(s)),
  sessionToken: z.uuid(),
});

export type Deps = {
  getUser: GetUser;
  consumeQuota: ConsumeQuota;
  google: Pick<GoogleClient, 'autocomplete'>;
};

// POST { input, sessionToken } → { suggestions: { placeId, primaryText, secondaryText }[] } (max 5).
export function createHandler(deps: Deps): Handler {
  return async (req) => {
    if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed');

    const user = await requireUser(req, deps.getUser);
    if (!user) return errorResponse(401, 'unauthorized');

    const body = Body.safeParse(await readJsonBody(req));
    if (!body.success) return errorResponse(400, 'invalid_input');

    if (!(await deps.consumeQuota(user.id, 'autocomplete'))) {
      return errorResponse(429, 'rate_limited');
    }

    try {
      const suggestions = await deps.google.autocomplete(body.data.input, body.data.sessionToken);
      return json(200, { suggestions: suggestions.slice(0, 5) });
    } catch (e) {
      if (e instanceof UpstreamError) return errorResponse(502, 'upstream_error');
      if (e instanceof MissingApiKeyError) return errorResponse(500, 'internal_error');
      throw e;
    }
  };
}
