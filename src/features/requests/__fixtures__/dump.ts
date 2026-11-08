import { screen } from '@testing-library/react-native';

/** The whole rendered tree as text (props and all), safe against circular props like contexts. */
export function dump(): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(screen.toJSON(), (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  });
}
