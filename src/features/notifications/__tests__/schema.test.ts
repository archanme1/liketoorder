import {
  PUSH_TOKEN_PATTERN,
  notificationSettingsSchema,
  tapParamsSchema,
  tapPayloadSchema,
} from '../schema';

import { REQUEST_UUID, pushData } from '../__fixtures__/notifications';

describe('tapPayloadSchema', () => {
  it.each([
    ['a sent pickup', pushData()],
    ['a received table request', pushData({ kind: 'table', side: 'received' })],
    ['an upper-case id', pushData({ id: REQUEST_UUID.toUpperCase() })],
  ])('accepts %s', (_label, data) => {
    expect(tapPayloadSchema.safeParse(data).success).toBe(true);
  });

  it.each([
    ['another version', pushData({ v: 2 })],
    ['the version as a string', pushData({ v: '1' })],
    ['no version', { kind: 'pickup', id: REQUEST_UUID, side: 'sent' }],
    ['a bad id', pushData({ id: 'abc' })],
    ['an id with trailing text', pushData({ id: `${REQUEST_UUID}/../x` })],
    ['an unknown kind', pushData({ kind: 'delivery' })],
    ['an unknown side', pushData({ side: 'both' })],
    ['an extra key', pushData({ userId: 'u1' })],
    ['a note', pushData({ note: 'call me' })],
    ['nothing', undefined],
    ['an empty object', {}],
  ])('refuses %s', (_label, data) => {
    expect(tapPayloadSchema.safeParse(data).success).toBe(false);
  });
});

describe('tapParamsSchema', () => {
  it('accepts the payload as route params', () => {
    expect(
      tapParamsSchema.safeParse({ v: '1', kind: 'table', id: REQUEST_UUID, side: 'received' })
        .success,
    ).toBe(true);
  });

  it('refuses extra params and a numeric version', () => {
    expect(
      tapParamsSchema.safeParse({
        v: '1',
        kind: 'table',
        id: REQUEST_UUID,
        side: 'sent',
        next: '/x',
      }).success,
    ).toBe(false);
    expect(
      tapParamsSchema.safeParse({ v: 1, kind: 'table', id: REQUEST_UUID, side: 'sent' }).success,
    ).toBe(false);
  });
});

describe('PUSH_TOKEN_PATTERN (the server check)', () => {
  it.each(['ExponentPushToken[test-0001]', 'ExpoPushToken[abc_DEF-123]'])('accepts %s', (token) => {
    expect(PUSH_TOKEN_PATTERN.test(token)).toBe(true);
  });

  it.each(['', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'token', 'ExponentPushToken[x]\n'])(
    'refuses %j',
    (token) => {
      expect(PUSH_TOKEN_PATTERN.test(token)).toBe(false);
    },
  );
});

describe('notificationSettingsSchema', () => {
  it('maps the server row to camelCase switches', () => {
    expect(
      notificationSettingsSchema.parse({
        answers: true,
        new_requests: false,
        cancellations: true,
        arrivals: false,
      }),
    ).toEqual({ answers: true, newRequests: false, cancellations: true, arrivals: false });
  });

  it('refuses a missing or non-boolean switch', () => {
    expect(
      notificationSettingsSchema.safeParse({
        answers: true,
        new_requests: true,
        cancellations: true,
      }).success,
    ).toBe(false);
    expect(
      notificationSettingsSchema.safeParse({
        answers: 'yes',
        new_requests: true,
        cancellations: true,
        arrivals: true,
      }).success,
    ).toBe(false);
  });
});
