import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import type { RequestStatus } from './schema';

// The customer's badge is made on the phone (spec 10b Decision 7): for each request, the last
// status this phone showed. A request whose server `display_status` differs from it has changed
// since the person last looked. Nothing here reads the phone clock or asks the server.

const KEY_PREFIX = 'liketoorder.requests.seen.v1.';
/** The most recent requests remembered; an older one is simply a new baseline if it comes back. */
export const MEMORY_CAP = 200;

type Entry = readonly [id: string, status: RequestStatus];
type Row = { id: string; display_status: RequestStatus };

/** `ready` once the phone's copy was read. Until then, and if it cannot be read, no count is made. */
export type MemoryState = {
  phase: 'loading' | 'ready' | 'failed';
  entries: ReadonlyMap<string, RequestStatus>;
};

const EMPTY: MemoryState = { phase: 'loading', entries: new Map() };

const states = new Map<string, MemoryState>();
const loads = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
// Bumped by clearStatusMemory so a read that was already running cannot bring old data back.
let epoch = 0;
// The storage removal of the last clear: a read that starts after a sign-out waits for it.
let clearing: Promise<unknown> = Promise.resolve();

const keyOf = (userId: string) => `${KEY_PREFIX}${userId}`;

function set(userId: string, state: MemoryState) {
  states.set(userId, state);
  listeners.forEach((listener) => listener());
}

const STATUSES: readonly string[] = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
  'completed',
  'no_show',
];

function parse(raw: string | null): Entry[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) return [];
  const entries: Entry[] = [];
  for (const item of value) {
    if (Array.isArray(item) && typeof item[0] === 'string' && STATUSES.includes(item[1])) {
      entries.push([item[0], item[1] as RequestStatus]);
    }
  }
  return entries.slice(0, MEMORY_CAP);
}

/** Reads the person's memory from the phone once. Safe to call again: it joins the running read. */
export function loadMemory(userId: string): Promise<void> {
  const running = loads.get(userId);
  if (running) return running;
  const startedAt = epoch;
  if (!states.has(userId)) states.set(userId, EMPTY);
  const load = clearing
    .then(() => AsyncStorage.getItem(keyOf(userId)))
    .then((raw) => {
      if (startedAt !== epoch) return;
      // Stored entries are oldest-last; the Map keeps oldest-first, so insert them reversed.
      const merged = new Map<string, RequestStatus>([...parse(raw)].reverse());
      // Anything written while the read was running is newer than what was stored.
      states.get(userId)?.entries.forEach((status, id) => {
        merged.delete(id);
        merged.set(id, status);
      });
      set(userId, { phase: 'ready', entries: merged });
    })
    .catch(() => {
      if (startedAt === epoch) set(userId, { phase: 'failed', entries: new Map() });
    });
  loads.set(userId, load);
  return load;
}

function persist(userId: string, entries: ReadonlyMap<string, RequestStatus>) {
  // Most recently written first (the Map holds them oldest-first).
  const list: Entry[] = [...entries].reverse().slice(0, MEMORY_CAP);
  // Not saved on failure: the memory stays in RAM for this session. Nothing to tell the person.
  void AsyncStorage.setItem(keyOf(userId), JSON.stringify(list)).catch(() => undefined);
}

function write(userId: string, updates: readonly Entry[], onlyNew: boolean) {
  const current = states.get(userId) ?? EMPTY;
  const next = new Map(current.entries);
  let changed = false;
  for (const [id, status] of updates) {
    const known = next.get(id);
    if (known === status || (onlyNew && known !== undefined)) continue;
    next.delete(id);
    next.set(id, status);
    changed = true;
  }
  if (!changed) return;
  for (const oldest of next.keys()) {
    if (next.size <= MEMORY_CAP) break;
    next.delete(oldest);
  }
  set(userId, { ...current, entries: next });
  // Only a memory read from the phone is written back, so a write that did not know what was
  // stored can never overwrite it.
  if (current.phase === 'ready') persist(userId, next);
}

const isReady = (userId: string) => states.get(userId)?.phase === 'ready';

/** First sight of a request: remember its status as the baseline. Never counts as a change. */
export function baseline(userId: string, rows: readonly Row[]) {
  if (!isReady(userId)) return;
  write(
    userId,
    rows.map((row): Entry => [row.id, row.display_status]),
    true,
  );
}

/** The person has seen these requests at these statuses: the number goes away. */
export function markSeen(userId: string, rows: readonly Row[]) {
  if (!isReady(userId)) return;
  write(
    userId,
    rows.map((row): Entry => [row.id, row.display_status]),
    false,
  );
}

/** One request seen at one status: the person's own cancel (Decision 18). Works before the read ends. */
export function markSeenAt(userId: string, id: string, status: RequestStatus) {
  write(userId, [[id, status]], false);
  void loadMemory(userId);
}

/** How many of these requests are at a different status than the one last seen. */
export function changedCount(state: MemoryState, rows: readonly Row[]): number {
  let count = 0;
  for (const row of rows) {
    const seen = state.entries.get(row.id);
    if (seen !== undefined && seen !== row.display_status) count += 1;
  }
  return count;
}

/** Forgets everything on this phone (sign-out), in RAM and in storage. */
export function clearStatusMemory(): void {
  epoch += 1;
  states.clear();
  loads.clear();
  listeners.forEach((listener) => listener());
  clearing = AsyncStorage.getAllKeys()
    .then((keys) => {
      const mine = keys.filter((key) => key.startsWith(KEY_PREFIX));
      return mine.length > 0 ? AsyncStorage.multiRemove(mine) : undefined;
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The person's memory as it is now (not a hook: for code outside React and for tests). */
export function peekMemory(userId: string | undefined): MemoryState {
  return userId === undefined ? EMPTY : (states.get(userId) ?? EMPTY);
}

/** The person's memory, read from the phone on first use. */
export function useStatusMemory(userId: string | undefined): MemoryState {
  const state = useSyncExternalStore(
    subscribe,
    () => peekMemory(userId),
    () => EMPTY,
  );
  useEffect(() => {
    if (userId !== undefined) void loadMemory(userId);
  }, [userId, state]);
  return state;
}
