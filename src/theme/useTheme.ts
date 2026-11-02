import { theme, type Theme } from './tokens';

// Light only for now. Components read tokens through this hook so a dark
// variant can be added later without touching every component.
export function useTheme(): Theme {
  return theme;
}
