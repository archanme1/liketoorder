import {
  type GoogleClient,
  NotFoundError,
  type PlaceLocation,
} from '../_shared/google.ts';
import { errorResponse, type Handler, json } from '../_shared/http.ts';

// One run takes at most this many rows (the database also caps a claim at 25).
export const BATCH_SIZE = 25;

export type ClaimedRow = { businessId: string; placeId: string };

export type Outcome = 'ok' | 'not_found';

export type Deps = {
  // REFRESH_CRON_SECRET; undefined or empty means the function is not set up.
  cronSecret: string | undefined;
  // False when PLACES_API_KEY is missing. Checked before anything is claimed, so a missing key
  // cannot use up the day's refresh quota or delay rows.
  googleConfigured: boolean;
  // claim_places_refresh_batch: stamps and charges the rows it returns.
  claimBatch: (size: number) => Promise<ClaimedRow[]>;
  // apply_places_refresh: records one row's result. Throws if the database refuses.
  applyOutcome: (businessId: string, outcome: Outcome, location?: PlaceLocation) => Promise<void>;
  google: Pick<GoogleClient, 'getPlaceLocation'>;
};

// Compares SHA-256 digests byte by byte without stopping at the first difference, so the time
// taken does not depend on how much of the secret matched (or on its length).
async function secretMatches(provided: string | null, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided ?? '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0 && provided !== null;
}

// POST with header x-cron-secret → { claimed, ok, not_found, failed } (counts only).
// Rows are refreshed one after another, and each result is saved the moment it is known, so a
// run that stops partway loses nothing: finished rows are saved, unfinished ones were stamped by
// the claim and come back after a day.
export function createHandler(deps: Deps): Handler {
  return async (req) => {
    if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed');
    if (!deps.cronSecret || !deps.googleConfigured) return errorResponse(500, 'not_configured');

    // 401 carries no body and touches neither the database nor Google.
    if (!(await secretMatches(req.headers.get('x-cron-secret'), deps.cronSecret))) {
      return new Response(null, { status: 401 });
    }

    const rows = await deps.claimBatch(BATCH_SIZE);
    const counts = { claimed: rows.length, ok: 0, not_found: 0, failed: 0 };

    for (const row of rows) {
      let outcome: Outcome;
      let location: PlaceLocation | undefined;
      try {
        location = await deps.google.getPlaceLocation(row.placeId);
        outcome = 'ok';
      } catch (e) {
        if (!(e instanceof NotFoundError)) {
          counts.failed++; // timeout, Google error, no usable point: no change, retried after a day
          continue;
        }
        outcome = 'not_found';
      }

      try {
        await deps.applyOutcome(row.businessId, outcome, location);
        if (outcome === 'ok') counts.ok++;
        else counts.not_found++;
      } catch {
        counts.failed++; // saving failed for this row only; the others still run
      }
    }

    return json(200, counts);
  };
}
