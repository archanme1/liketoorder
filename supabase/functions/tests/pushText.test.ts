// Push texts, tested against the spec 12 Texts table (Decision 2). Pure functions, no network.
import assert from 'node:assert/strict';
import { PLACE_NAME_MAX, placeName, type PushEvent, pushText, type PushTextInput } from '../_shared/pushText.ts';

const PRIVATE = {
  note: 'NOTE-MUST-NOT-LEAK please knock twice',
  order_text: 'ORDER-MUST-NOT-LEAK two dumplings',
  address: 'ADDRESS-MUST-NOT-LEAK 12 Hidden Lane',
  email: 'email-must-not-leak@example.test',
  phone: '+1 555 0100 PHONE',
  customer_name: 'CUSTOMER-NAME-MUST-NOT-LEAK',
};

function text(event: PushEvent, kind: 'pickup' | 'table', count = 1, businessName: string | null = null) {
  return pushText({ event, kind, count, businessName });
}

Deno.test('owner texts: new pickup and new table requests', () => {
  assert.deepEqual(text('new_request', 'pickup'), { title: 'New pickup request', body: 'Open LikeToOrder to answer it.' });
  assert.deepEqual(text('new_request', 'table'), { title: 'New table request', body: 'Open LikeToOrder to answer it.' });
});

Deno.test('collapsed new requests: "New requests" with the count', () => {
  assert.deepEqual(text('new_request', 'table', 3), { title: 'New requests', body: 'You have 3 new requests waiting.' });
  assert.deepEqual(text('new_request', 'pickup', 2), { title: 'New requests', body: 'You have 2 new requests waiting.' });
});

Deno.test('cancelled: the singular text for one, the collapsed text for more', () => {
  assert.deepEqual(text('cancelled', 'pickup'), { title: 'Request cancelled', body: 'A customer cancelled a pickup request.' });
  assert.deepEqual(text('cancelled', 'table'), { title: 'Request cancelled', body: 'A customer cancelled a table request.' });
  assert.deepEqual(text('cancelled', 'table', 2), { title: 'Requests cancelled', body: '2 requests were cancelled.' });
  assert.deepEqual(text('cancelled', 'pickup', 7), { title: 'Requests cancelled', body: '7 requests were cancelled.' });
});

Deno.test('arrived: a fixed text with no name', () => {
  assert.deepEqual(text('arrived', 'table'), { title: 'Customer has arrived', body: 'A customer with a table request is here.' });
});

Deno.test('customer texts name the place and the kind', () => {
  assert.deepEqual(text('accepted', 'pickup', 1, 'Pasta Place'), { title: 'Request accepted', body: 'Pasta Place accepted your pickup request.' });
  assert.deepEqual(text('declined', 'table', 1, 'Pasta Place'), { title: 'Request declined', body: 'Pasta Place declined your table request.' });
  assert.deepEqual(text('expired', 'pickup', 1, 'Pasta Place'), {
    title: 'Request expired',
    body: "Pasta Place didn't answer your pickup request in time.",
  });
});

Deno.test('the place name is trimmed, its whitespace runs made one space, and cut to 40 characters', () => {
  assert.equal(placeName('   Pasta \n\t  Place  '), 'Pasta Place');
  const long = 'A'.repeat(39) + 'BCDEF';
  assert.equal(placeName(long), 'A'.repeat(39) + 'B');
  assert.equal(Array.from(placeName(long)).length, PLACE_NAME_MAX);
  // A cut never splits a character outside the BMP (built at run time: the source stays ASCII).
  const noodle = String.fromCodePoint(0x1f35c);
  const emoji = noodle.repeat(45);
  assert.equal(placeName(emoji), noodle.repeat(40));
  // A cut that ends on a space does not leave it.
  assert.equal(placeName('B'.repeat(39) + ' tail'), 'B'.repeat(39));
  assert.equal(text('accepted', 'pickup', 1, long).body, `${'A'.repeat(39)}B accepted your pickup request.`);
});

Deno.test('a missing or blank place name reads "The place"', () => {
  assert.equal(placeName(null), 'The place');
  assert.equal(placeName('   '), 'The place');
});

Deno.test('privacy: request fields passed in by mistake never reach any title or body', () => {
  const events: PushEvent[] = ['new_request', 'cancelled', 'arrived', 'accepted', 'declined', 'expired'];
  for (const event of events) {
    for (const kind of ['pickup', 'table'] as const) {
      for (const count of [1, 2]) {
        const input = { event, kind, count, businessName: 'Pasta Place', ...PRIVATE } as PushTextInput;
        const out = JSON.stringify(pushText(input));
        for (const secret of Object.values(PRIVATE)) {
          assert.ok(!out.includes(secret), `${event}/${kind}/${count} must not contain ${secret}`);
        }
      }
    }
  }
});

Deno.test('owner texts never name the place, even if a name is passed', () => {
  for (const event of ['new_request', 'cancelled', 'arrived'] as const) {
    for (const count of [1, 3]) {
      assert.ok(!JSON.stringify(text(event, 'table', count, 'Pasta Place')).includes('Pasta'));
    }
  }
});

Deno.test('no text calls a pending request confirmed', () => {
  const events: PushEvent[] = ['new_request', 'cancelled', 'arrived', 'accepted', 'declined', 'expired'];
  for (const event of events) {
    assert.ok(!/confirm/i.test(JSON.stringify(text(event, 'pickup', 1, 'Pasta Place'))));
  }
});
