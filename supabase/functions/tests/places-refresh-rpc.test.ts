// The database calls of places-refresh: exact function names, exact argument names, and how the
// answer is read. A wrong name here would pass every handler test (they fake the whole database).
import assert from 'node:assert/strict';
import { createDatabase, type Rpc } from '../places-refresh/rpc.ts';

type Call = { fn: string; args: Record<string, unknown> };

function fakeRpc(answer: { data?: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const rpc: Rpc = (fn, args) => {
    calls.push({ fn, args });
    return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
  };
  return { rpc, calls };
}

Deno.test('rpc: claimBatch calls claim_places_refresh_batch with p_batch only', async () => {
  const { rpc, calls } = fakeRpc({ data: [] });
  await createDatabase(rpc).claimBatch(25);
  assert.deepEqual(calls, [{ fn: 'claim_places_refresh_batch', args: { p_batch: 25 } }]);
});

Deno.test('rpc: claimBatch maps business_id and place_id to businessId and placeId', async () => {
  const { rpc } = fakeRpc({
    data: [{ business_id: 'b1', place_id: 'p1', type: 'restaurant' }],
  });
  assert.deepEqual(await createDatabase(rpc).claimBatch(25), [{ businessId: 'b1', placeId: 'p1' }]);
});

Deno.test('rpc: claimBatch fails on a database error and on an unexpected shape', async () => {
  const failed = fakeRpc({ error: { message: 'secret detail' } });
  await assert.rejects(createDatabase(failed.rpc).claimBatch(25), (e: Error) => {
    assert.equal(e.message, 'claim_places_refresh_batch failed');
    return true;
  });
  const odd = fakeRpc({ data: [{ id: 'b1' }] });
  await assert.rejects(createDatabase(odd.rpc).claimBatch(25), /unexpected shape/);
});

Deno.test('rpc: applyOutcome ok sends p_business_id, p_outcome, p_lat and p_lng', async () => {
  const { rpc, calls } = fakeRpc({});
  await createDatabase(rpc).applyOutcome('b1', 'ok', { latitude: 43.5, longitude: -79.25 });
  assert.deepEqual(calls, [
    {
      fn: 'apply_places_refresh',
      args: { p_business_id: 'b1', p_outcome: 'ok', p_lat: 43.5, p_lng: -79.25 },
    },
  ]);
});

Deno.test('rpc: applyOutcome not_found sends null coordinates', async () => {
  const { rpc, calls } = fakeRpc({});
  await createDatabase(rpc).applyOutcome('b1', 'not_found');
  assert.deepEqual(calls[0].args, {
    p_business_id: 'b1',
    p_outcome: 'not_found',
    p_lat: null,
    p_lng: null,
  });
});

Deno.test('rpc: applyOutcome fails on a database error without passing the detail on', async () => {
  const { rpc } = fakeRpc({ error: { message: 'secret detail' } });
  await assert.rejects(createDatabase(rpc).applyOutcome('b1', 'not_found'), (e: Error) => {
    assert.equal(e.message, 'apply_places_refresh failed');
    return true;
  });
});
