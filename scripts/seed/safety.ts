// Safety checks for the local seed scripts. Pure, so they are unit-tested (CI runs those tests,
// never the seed itself).

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);

/** Returns the URL without a trailing slash, or throws unless it is the local Supabase on this machine. */
export function assertLocalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Refusing to run: "${raw}" is not a valid URL.`);
  }
  if (url.protocol !== 'http:') {
    throw new Error('Refusing to run: the local Supabase API is plain http. Got ' + url.protocol);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Refusing to run: host "${url.hostname}" is not local. Only 127.0.0.1 and localhost are allowed.`,
    );
  }
  if (url.username || url.password) {
    throw new Error('Refusing to run: the URL must not contain credentials.');
  }
  return url.origin;
}

/** The only accounts this seed may delete: seed-<something>@example.com. */
const SEED_EMAIL = /^seed-[a-z0-9]+(-[a-z0-9]+)*@example\.com$/;

export function isSeedEmail(email: string | undefined | null): boolean {
  return typeof email === 'string' && SEED_EMAIL.test(email);
}
