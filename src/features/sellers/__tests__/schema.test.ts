import {
  BUSINESS_NAME_MAX,
  PLACES_INPUT_MAX,
  PLACES_INPUT_MIN,
  businessNameSchema,
  businessTypeSchema,
  editFormSchema,
  myBusinessSchema,
  onboardingFormSchema,
  placeSuggestionSchema,
} from '../schema';

type Result = { success: boolean; error?: { issues: { message: string }[] } };

function messagesOf(result: Result): string[] {
  return result.error ? result.error.issues.map((issue) => issue.message) : [];
}

const view = {
  id: 'b1',
  type: 'restaurant',
  name: "Joe's Pizza",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  map_lat: 43.65,
  map_lng: -79.38,
  public_address: '1 Main St',
  is_listed: true,
  currency_code: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '1 Main St, Toronto, ON', lat: 43.65, lng: -79.38 },
};

describe('limits', () => {
  it('uses the spec limits', () => {
    expect(BUSINESS_NAME_MAX).toBe(60);
    expect(PLACES_INPUT_MIN).toBe(3);
    expect(PLACES_INPUT_MAX).toBe(120);
  });
});

describe('businessTypeSchema', () => {
  it.each(['restaurant', 'homemade'])('accepts %s', (type) => {
    expect(businessTypeSchema.safeParse(type).success).toBe(true);
  });

  it.each(['', 'cafe', 'Restaurant', undefined])('rejects %p', (type) => {
    const result = businessTypeSchema.safeParse(type);
    expect(result.success).toBe(false);
  });

  it('explains the choice when nothing is picked', () => {
    expect(messagesOf(businessTypeSchema.safeParse(undefined))).toContain(
      'Choose Restaurant or Homemade',
    );
  });
});

describe('businessNameSchema', () => {
  it('trims surrounding whitespace', () => {
    const result = businessNameSchema.safeParse('  Joe’s Pizza  ');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('Joe’s Pizza');
  });

  it('rejects an empty name with a message', () => {
    expect(messagesOf(businessNameSchema.safeParse(''))).toContain('Enter your business name');
  });

  it('rejects a whitespace-only name (empty after trim)', () => {
    const result = businessNameSchema.safeParse('     ');
    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain('Enter your business name');
  });

  it('accepts exactly 60 characters', () => {
    expect(businessNameSchema.safeParse('a'.repeat(60)).success).toBe(true);
  });

  it('counts the length after trimming', () => {
    expect(businessNameSchema.safeParse(` ${'a'.repeat(60)} `).success).toBe(true);
  });

  it('rejects 61 characters with a message', () => {
    const result = businessNameSchema.safeParse('a'.repeat(61));
    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain('Use 60 characters or fewer');
  });

  it.each([
    ['bell', 'Joe\u0007s'],
    ['newline', 'Joe\ns'],
    ['tab', 'Joe\ts'],
    ['delete', 'Joe\u007fs'],
  ])('rejects a control character (%s)', (_label, name) => {
    const result = businessNameSchema.safeParse(name);
    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain('Remove special characters');
  });

  it('accepts accents, emoji and punctuation', () => {
    expect(businessNameSchema.safeParse('Café Ñandú & Co. 🍕').success).toBe(true);
  });
});

describe('onboardingFormSchema', () => {
  const base = {
    type: 'restaurant',
    name: 'Joe',
    cuisine_code: 'IT',
    accepts_table_requests: true,
  };

  it('keeps accepts_table_requests for a restaurant', () => {
    const result = onboardingFormSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.accepts_table_requests).toBe(true);
  });

  it('forces accepts_table_requests to false for homemade', () => {
    const result = onboardingFormSchema.safeParse({ ...base, type: 'homemade' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('homemade');
      expect(result.data.accepts_table_requests).toBe(false);
    }
  });

  it('keeps false as false for a restaurant', () => {
    const result = onboardingFormSchema.safeParse({ ...base, accepts_table_requests: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.accepts_table_requests).toBe(false);
  });

  it('trims the name in the output', () => {
    const result = onboardingFormSchema.safeParse({ ...base, name: '  Joe  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Joe');
  });

  it('requires a cuisine with a message', () => {
    const result = onboardingFormSchema.safeParse({ ...base, cuisine_code: '' });
    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain('Pick a cuisine');
  });

  it('requires a type with a message', () => {
    const result = onboardingFormSchema.safeParse({ ...base, type: undefined });
    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain('Choose Restaurant or Homemade');
  });

  it('requires a name with a message', () => {
    const result = onboardingFormSchema.safeParse({ ...base, name: '' });
    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain('Enter your business name');
  });
});

describe('editFormSchema', () => {
  const base = { name: 'Joe', cuisine_code: 'IT', accepts_table_requests: false };

  it('accepts the three editable fields', () => {
    expect(editFormSchema.safeParse(base).success).toBe(true);
  });

  it('does not carry a type through (type is fixed after creation)', () => {
    const result = editFormSchema.safeParse({ ...base, type: 'homemade' });
    expect(result.success).toBe(true);
    if (result.success)
      expect(Object.keys(result.data).sort()).toEqual([
        'accepts_table_requests',
        'cuisine_code',
        'name',
      ]);
  });

  it('reuses the name and cuisine messages', () => {
    expect(messagesOf(editFormSchema.safeParse({ ...base, name: '' }))).toContain(
      'Enter your business name',
    );
    expect(messagesOf(editFormSchema.safeParse({ ...base, cuisine_code: '' }))).toContain(
      'Pick a cuisine',
    );
    expect(messagesOf(editFormSchema.safeParse({ ...base, name: 'a'.repeat(61) }))).toContain(
      'Use 60 characters or fewer',
    );
  });
});

describe('myBusinessSchema', () => {
  it('accepts the owner view with a location', () => {
    expect(myBusinessSchema.safeParse(view).success).toBe(true);
  });

  it('accepts the owner view with no location yet', () => {
    const result = myBusinessSchema.safeParse({
      ...view,
      location: null,
      map_lat: null,
      map_lng: null,
      public_address: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown business type', () => {
    expect(myBusinessSchema.safeParse({ ...view, type: 'cafe' }).success).toBe(false);
  });

  it('rejects a missing is_listed', () => {
    const { is_listed: _omit, ...rest } = view;
    expect(myBusinessSchema.safeParse(rest).success).toBe(false);
  });
});

describe('placeSuggestionSchema', () => {
  it('accepts a suggestion', () => {
    expect(
      placeSuggestionSchema.safeParse({
        placeId: 'abc',
        primaryText: '1 Main St',
        secondaryText: 'Toronto, ON',
      }).success,
    ).toBe(true);
  });

  it('rejects a suggestion without a placeId', () => {
    expect(
      placeSuggestionSchema.safeParse({ primaryText: '1 Main St', secondaryText: 'Toronto' })
        .success,
    ).toBe(false);
  });
});

describe('myBusinessSchema map_status (spec 07)', () => {
  it.each(['visible', 'place_not_found', 'needs_refresh'])('accepts %s', (status) => {
    const result = myBusinessSchema.safeParse({ ...view, map_status: status });
    expect(result.success).toBe(true);
    expect(result.data?.map_status).toBe(status);
  });

  it('accepts null (homemade, or a restaurant with no saved address)', () => {
    expect(myBusinessSchema.safeParse({ ...view, map_status: null }).data?.map_status).toBeNull();
  });

  it('accepts a payload from before the field existed', () => {
    const result = myBusinessSchema.safeParse(view);
    expect(result.success).toBe(true);
    expect(result.data?.map_status).toBeUndefined();
  });

  it.each(['hidden', 'closed', '', 1, true])('rejects %p', (status) => {
    expect(myBusinessSchema.safeParse({ ...view, map_status: status }).success).toBe(false);
  });
});
