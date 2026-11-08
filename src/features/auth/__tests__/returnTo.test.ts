import {
  clearReturnTo,
  peekReturnTo,
  requestFormHref,
  RETURN_TO_TTL_MS,
  setReturnTo,
} from '../returnTo';

const ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  clearReturnTo();
});

describe('returnTo', () => {
  it('keeps the request form for a business', () => {
    expect(setReturnTo(requestFormHref(ID))).toBe(true);
    expect(peekReturnTo()).toBe(`/requests/new?businessId=${ID}`);
  });

  it.each([
    ['another path', '/profile'],
    ['an external URL', 'https://evil.example/requests/new?businessId=' + ID],
    ['a scheme link', 'liketoorder://requests/new?businessId=' + ID],
    ['no id', '/requests/new'],
    ['a bad id', '/requests/new?businessId=abc'],
    ['extra query', `/requests/new?businessId=${ID}&next=/profile`],
    ['trailing text', `/requests/new?businessId=${ID}/../..`],
    ['a protocol-relative URL', '//evil.example'],
    ['the list', '/requests'],
  ])('refuses %s', (_label, href) => {
    expect(setReturnTo(href)).toBe(false);
    expect(peekReturnTo()).toBeNull();
  });

  it('a refused value does not replace an earlier good one', () => {
    setReturnTo(requestFormHref(ID));
    expect(setReturnTo('/profile')).toBe(false);
    expect(peekReturnTo()).toBe(requestFormHref(ID));
  });

  it('can be cleared', () => {
    setReturnTo(requestFormHref(ID));
    clearReturnTo();
    expect(peekReturnTo()).toBeNull();
  });

  it('expires, so an abandoned sign-in cannot hijack a later one', () => {
    setReturnTo(requestFormHref(ID), 1_000);
    expect(peekReturnTo(1_000 + RETURN_TO_TTL_MS)).toBe(requestFormHref(ID));
    expect(peekReturnTo(1_000 + RETURN_TO_TTL_MS + 1)).toBeNull();
  });

  it('peeking changes nothing (safe to call while rendering), even past the expiry', () => {
    setReturnTo(requestFormHref(ID), 1_000);
    expect(peekReturnTo(1_000 + RETURN_TO_TTL_MS + 1)).toBeNull();
    // A peek that had cleared the value would make this null.
    expect(peekReturnTo(1_000 + 1)).toBe(requestFormHref(ID));
    expect(peekReturnTo(1_000 + 1)).toBe(requestFormHref(ID));
  });
});
