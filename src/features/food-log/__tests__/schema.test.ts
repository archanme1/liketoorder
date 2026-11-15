import {
  CUISINE_REQUIRED,
  DESCRIPTION_CONTACT,
  DESCRIPTION_HIDDEN,
  DESCRIPTION_TOO_LONG,
  foodLogFormSchema,
  foodLogPageSchema,
  foodLogSchema,
} from '../schema';

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

const LOG = {
  id: 'log-1',
  cuisine_code: 'IT',
  description: null,
  is_public: false,
  local_date: '2026-11-14',
  created_at: '2026-11-14T12:00:00+00:00',
  path: 'u1/log-1.jpg',
  is_mine: true,
};

describe('foodLogSchema', () => {
  it('accepts exactly the 8 keys, with a null description and a null path', () => {
    expect(foodLogSchema.safeParse(LOG).success).toBe(true);
    expect(foodLogSchema.safeParse({ ...LOG, path: null, is_mine: false }).success).toBe(true);
  });

  it.each(['author_id', 'status', 'updated_at'])('refuses an extra %s key', (key) => {
    expect(foodLogSchema.safeParse({ ...LOG, [key]: 'x' }).success).toBe(false);
  });

  it.each(Object.keys(LOG))('refuses a log without %s', (key) => {
    const copy: Record<string, unknown> = { ...LOG };
    delete copy[key];
    expect(foodLogSchema.safeParse(copy).success).toBe(false);
  });

  it('refuses a local_date that is not a calendar date', () => {
    expect(foodLogSchema.safeParse({ ...LOG, local_date: '2026-11-14T00:00:00Z' }).success).toBe(
      false,
    );
  });
});

describe('foodLogPageSchema', () => {
  it('accepts items and a next cursor or null', () => {
    expect(foodLogPageSchema.safeParse({ items: [LOG], next_cursor: 'c' }).success).toBe(true);
    expect(foodLogPageSchema.safeParse({ items: [], next_cursor: null }).success).toBe(true);
    expect(foodLogPageSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe('foodLogFormSchema', () => {
  function messageFor(values: { cuisine_code: string; description: string; is_public: boolean }) {
    const result = foodLogFormSchema.safeParse(values);
    return result.success ? null : result.error.issues[0].message;
  }

  it('requires a cuisine', () => {
    expect(messageFor({ cuisine_code: '', description: '', is_public: true })).toBe(
      CUISINE_REQUIRED,
    );
  });

  it('gives the length, hidden-character and contact messages', () => {
    const base = { cuisine_code: 'IT', is_public: true };
    expect(messageFor({ ...base, description: 'x'.repeat(281) })).toBe(DESCRIPTION_TOO_LONG);
    expect(messageFor({ ...base, description: 'a' + cp(8238) + 'b' })).toBe(DESCRIPTION_HIDDEN);
    expect(messageFor({ ...base, description: 'call 123-456-7890' })).toBe(DESCRIPTION_CONTACT);
    expect(messageFor({ ...base, description: 'Ate on 2026-11-14' })).toBeNull();
    expect(messageFor({ ...base, description: '' })).toBeNull();
  });
});
