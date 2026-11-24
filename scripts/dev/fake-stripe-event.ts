/**
 * LOCAL ONLY (spec 16b PR 2). Signs a fake Stripe event with a made-up secret and posts it to the
 * LOCAL stripe-webhook function. It sends only event types that need no Stripe call (invoice.paid
 * needs the invoice-payments lookup at Stripe, so it is checked in Stripe test mode instead):
 *
 *   deno run --allow-net=127.0.0.1,localhost scripts/dev/fake-stripe-event.ts \
 *     --url http://127.0.0.1:54321/functions/v1/stripe-webhook --secret <made-up local secret> \
 *     --type invoice.voided --invoice in_FakeSeed0001
 *
 *   --type invoice.voided | invoice.marked_uncollectible   needs --invoice in_...
 *   --type charge.refunded           needs --payment-intent pi_... --amount-refunded <cents> [--full]
 *   --type charge.dispute.created    needs --payment-intent pi_...
 *   --type fake.unknown              (stored as ignored)
 *   [--livemode]          marks the event live (the local function expects test: answered 200, nothing stored)
 *   [--stale-timestamp]   signs it 10 minutes in the past (refused with 400)
 *
 * - Talks only to http://127.0.0.1 or http://localhost; anything else is refused before any request
 *   (and the --allow-net flag above enforces it again).
 * - Reads no file and no environment variable: the secret comes only from the command line. It must
 *   be the made-up value in your local function env, never a real Stripe signing secret.
 * - Prints only the HTTP status (or one fixed refusal line). Never run by CI.
 */
import { signStripePayload } from '../../supabase/functions/_shared/stripe.ts';

export const ALLOWED_TYPES = [
  'invoice.voided',
  'invoice.marked_uncollectible',
  'charge.refunded',
  'charge.dispute.created',
  'fake.unknown',
] as const;
type EventType = (typeof ALLOWED_TYPES)[number];

export type Options = {
  url: URL;
  secret: string;
  type: EventType;
  invoice?: string;
  paymentIntent?: string;
  amountRefunded?: number;
  full: boolean;
  livemode: boolean;
  stale: boolean;
};

export class Refused extends Error {}

// Exactly http://127.0.0.1 or http://localhost (any port), no user info.
export function localUrl(raw: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    throw new Refused(
      'refused: give --url http://127.0.0.1:<port>/... or http://localhost:<port>/...',
    );
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Refused('refused: only http://127.0.0.1 or http://localhost URLs');
  }
  return url;
}

export function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--full', '--livemode', '--stale-timestamp'].includes(arg)) flags.add(arg);
    else if (arg.startsWith('--') && i + 1 < argv.length) values.set(arg, argv[++i]);
    else throw new Refused('refused: unknown argument');
  }
  const url = localUrl(values.get('--url'));
  const secret = values.get('--secret');
  if (!secret) throw new Refused('refused: give --secret <made-up local secret>');
  const type = values.get('--type');
  if (!ALLOWED_TYPES.includes(type as EventType)) {
    throw new Refused(`refused: --type must be one of ${ALLOWED_TYPES.join(', ')}`);
  }
  const options: Options = {
    url,
    secret,
    type: type as EventType,
    full: flags.has('--full'),
    livemode: flags.has('--livemode'),
    stale: flags.has('--stale-timestamp'),
  };
  if (type === 'invoice.voided' || type === 'invoice.marked_uncollectible') {
    const invoice = values.get('--invoice');
    if (!invoice || !/^in_[A-Za-z0-9]+$/.test(invoice))
      throw new Refused('refused: give --invoice in_...');
    options.invoice = invoice;
  }
  if (type === 'charge.refunded' || type === 'charge.dispute.created') {
    const pi = values.get('--payment-intent');
    if (!pi || !/^pi_[A-Za-z0-9]+$/.test(pi))
      throw new Refused('refused: give --payment-intent pi_...');
    options.paymentIntent = pi;
  }
  if (type === 'charge.refunded') {
    const amount = Number(values.get('--amount-refunded'));
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new Refused('refused: give --amount-refunded <cents>');
    options.amountRefunded = amount;
  }
  return options;
}

function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildEvent(o: Options): Record<string, unknown> {
  let object: Record<string, unknown>;
  switch (o.type) {
    case 'invoice.voided':
    case 'invoice.marked_uncollectible':
      object = {
        id: o.invoice,
        object: 'invoice',
        status: o.type === 'invoice.voided' ? 'void' : 'uncollectible',
      };
      break;
    case 'charge.refunded':
      object = {
        id: randomId('ch_Local'),
        object: 'charge',
        payment_intent: o.paymentIntent,
        amount_refunded: o.amountRefunded,
        refunded: o.full,
      };
      break;
    case 'charge.dispute.created':
      object = { id: randomId('dp_Local'), object: 'dispute', payment_intent: o.paymentIntent };
      break;
    default:
      object = { object: 'unknown' };
  }
  return {
    id: randomId('evt_Local'),
    object: 'event',
    type: o.type,
    livemode: o.livemode,
    data: { object },
  };
}

// Returns the exit code. `print` gets only the status or one fixed refusal line.
export async function main(
  argv: string[],
  deps: { fetch: typeof fetch; print: (line: string) => void; nowSeconds?: number },
): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    deps.print(e instanceof Refused ? e.message : 'refused: bad arguments');
    return 2;
  }
  const body = JSON.stringify(buildEvent(options));
  const now = deps.nowSeconds ?? Math.floor(Date.now() / 1000);
  const signature = await signStripePayload(body, options.secret, options.stale ? now - 600 : now);
  let res: Response;
  try {
    res = await deps.fetch(options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
      body,
      // A redirect is never followed: the signed event goes only to the checked local URL.
      redirect: 'manual',
    });
  } catch {
    deps.print('refused: the local webhook did not answer');
    return 1;
  }
  await res.body?.cancel();
  deps.print(String(res.status));
  return res.ok ? 0 : 1;
}

// Reached through globalThis so the app's tsc (which type-checks scripts/ without Deno types) accepts
// this file; deno check sees the same code.
const runtime = (globalThis as unknown as { Deno?: { args: string[]; exit(code: number): never } })
  .Deno;
if ((import.meta as { main?: boolean }).main && runtime) {
  runtime.exit(await main(runtime.args, { fetch, print: (line) => console.log(line) }));
}
