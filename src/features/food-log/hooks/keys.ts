// Sign-out clears the whole query cache, so "mine" never outlives the account it was loaded for.
export const foodLogListKey = ['food-log', 'mine'] as const;
export const foodLogKey = (id: string) => ['food-log', id] as const;
