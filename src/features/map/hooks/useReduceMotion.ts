// The hook now lives in src/lib so other features (the photo viewer) can use it without
// importing from the map feature. Re-exported here so existing imports keep working.
export { useReduceMotion } from '@/lib/useReduceMotion';
