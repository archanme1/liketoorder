import { clearReturnTo, notificationOpenHref, peekReturnTo, setReturnTo } from '../returnTo';

// Spec 12: a notification tapped while signed out resumes at the tap resolver after sign-in. Only
// the exact resolver href is kept (the request-form rules are in returnTo.test.ts).
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const HREF = `/notifications/open?v=1&kind=pickup&id=${ID}&side=sent`;

afterEach(() => {
  clearReturnTo();
});

describe('returnTo and the notification resolver', () => {
  it('builds the resolver href with its keys in a fixed order', () => {
    expect(notificationOpenHref({ kind: 'pickup', id: ID, side: 'sent' })).toBe(HREF);
    expect(notificationOpenHref({ kind: 'table', id: ID, side: 'received' })).toBe(
      `/notifications/open?v=1&kind=table&id=${ID}&side=received`,
    );
  });

  it.each([
    ['a sent pickup', HREF],
    ['a received table request', `/notifications/open?v=1&kind=table&id=${ID}&side=received`],
    ['an upper-case id', `/notifications/open?v=1&kind=pickup&id=${ID.toUpperCase()}&side=sent`],
  ])('keeps %s', (_label, href) => {
    expect(setReturnTo(href)).toBe(true);
    expect(peekReturnTo()).toBe(href);
  });

  it.each([
    ['an extra key', `${HREF}&next=/profile`],
    ['an extra key in the middle', `/notifications/open?v=1&kind=pickup&x=1&id=${ID}&side=sent`],
    ['keys in another order', `/notifications/open?kind=pickup&v=1&id=${ID}&side=sent`],
    ['another version', `/notifications/open?v=2&kind=pickup&id=${ID}&side=sent`],
    ['an unknown kind', `/notifications/open?v=1&kind=delivery&id=${ID}&side=sent`],
    ['a kind in capitals', `/notifications/open?v=1&kind=PICKUP&id=${ID}&side=sent`],
    ['an unknown side', `/notifications/open?v=1&kind=pickup&id=${ID}&side=both`],
    ['a bad id', '/notifications/open?v=1&kind=pickup&id=abc&side=sent'],
    ['a missing side', `/notifications/open?v=1&kind=pickup&id=${ID}`],
    ['the allow screen', '/notifications/allow'],
    ['a deeper path', `/notifications/open/x?v=1&kind=pickup&id=${ID}&side=sent`],
    ['an external URL', `https://evil.example${HREF}`],
    ['a scheme link', `liketoorder:/${HREF}`],
    ['trailing text', `${HREF}/../..`],
  ])('refuses %s', (_label, href) => {
    expect(setReturnTo(href)).toBe(false);
    expect(peekReturnTo()).toBeNull();
  });
});
