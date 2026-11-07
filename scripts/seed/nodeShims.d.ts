// The seed scripts run under Node (npx tsx), but the project has no @types/node and the seed may
// not add a dependency. These are the only three Node functions the seed uses, declared by hand.
declare module 'node:crypto' {
  export function randomUUID(): string;
}
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
