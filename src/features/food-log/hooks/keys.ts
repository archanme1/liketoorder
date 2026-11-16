// Sign-out clears the whole query cache, so "mine" never outlives the account it was loaded for.
export const foodLogListKey = ['food-log', 'mine'] as const;
export const foodLogKey = (id: string) => ['food-log', id] as const;

// Spec 14. The prefixes are invalidated after create, update and delete. A detail key holds a uuid,
// so it never starts with 'activity' or 'day'.
export const foodLogActivityPrefix = ['food-log', 'activity'] as const;
export const foodLogDayPrefix = ['food-log', 'day'] as const;
export const foodLogActivityKey = (weeks: number) => ['food-log', 'activity', weeks] as const;
export const foodLogDayKey = (date: string) => ['food-log', 'day', date] as const;
