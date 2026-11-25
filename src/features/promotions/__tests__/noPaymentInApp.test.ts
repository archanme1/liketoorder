import { render } from '@testing-library/react-native';
import { createElement } from 'react';
import { Text, View } from 'react-native';

import {
  ALLOWED_STATUS_WORDS,
  FORBIDDEN_BUTTON,
  FORBIDDEN_RENDERED,
  paymentWording,
  RENDERED_PROP_KEYS,
  renderedStrings,
} from '../__fixtures__/noPayment';

// The app's tsconfig loads no Node types, so the Node calls are typed here (as in
// activityGridIsolation.test.ts). __dirname is set by jest's module wrapper.
declare const __dirname: string;
type DirEntry = { name: string; isDirectory: () => boolean };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string, options: { withFileTypes: true }) => DirEntry[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join, sep } = require('path') as {
  join: (...segments: string[]) => string;
  sep: string;
};

// Spec 16b PR 3 Definition of done, Store rules: the app contains no promotion price, Pay button,
// payment link, Stripe URL or wording that steers a seller to pay elsewhere. This reads the source
// files themselves (no shell). The rendered side is checked state by state in PromoteScreen.test.tsx.
// The same patterns as a documented command are in the spec (PR 3 Definition of done).

const ROOT = join(__dirname, '..', '..', '..', '..');
const SKIP_DIRS = new Set(['__tests__', '__fixtures__', 'node_modules']);
const GENERATED = join('src', 'types', 'database.ts');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && path !== GENERATED ? [path] : [];
  });
}

function hits(
  files: readonly string[],
  patterns: readonly RegExp[],
  prepare = (text: string) => text,
) {
  return files.flatMap((file) => {
    const lines = prepare(fs.readFileSync(join(ROOT, file), 'utf8')).split('\n');
    return lines.flatMap((line, i) =>
      patterns.filter((p) => p.test(line)).map((p) => `${file}:${i + 1} ${String(p)}`),
    );
  });
}

/** Everywhere in the app: no Stripe, no key, no in-app browser. */
const FORBIDDEN_ANYWHERE: readonly RegExp[] = [
  /stripe/i,
  /EXPO_PUBLIC_STRIPE/,
  /\b(sk|rk|pk)_(test|live)_/,
  /expo-web-browser/,
  /WebBrowser/,
];

/** In the promotions feature and the Promote route: no price data, formatter, link or wording. */
const FORBIDDEN_IN_PROMOTIONS: readonly RegExp[] = [
  /price_cents/,
  /currency_code/,
  /amount_cents/,
  /formatPromotionPrice/,
  /offerLine/,
  /PAYMENT_NOTE/,
  /style: 'currency'/,
  /currencyDisplay/,
  /\binvoice/i,
  /contact you about payment/i,
  /nothing is charged/i,
  /refunds are handled/i,
  /pay (now|online|by|here)/i,
  /check your e-?mail/i,
  /['"`]Pay['"`]/,
  /openURL/,
];

// The one allowed mention: the list of legacy keys the schema drops (spec 16b D15).
const LEGACY_LINE = "export const LEGACY_PRICE_KEYS = ['price_cents', 'currency_code'] as const;";
const SCHEMA = join('src', 'features', 'promotions', 'schema.ts');

const ALL_APP_FILES = [...sourceFiles('src'), ...sourceFiles('app')];
const PROMOTION_FILES = [
  ...sourceFiles(join('src', 'features', 'promotions')),
  join('app', 'seller', 'promote.tsx'),
];

describe('no payment in the app (spec 16b PR 3, Store rules)', () => {
  it('reads the files it means to (the scan is not empty)', () => {
    expect(ALL_APP_FILES.length).toBeGreaterThan(200);
    expect(PROMOTION_FILES).toEqual(
      expect.arrayContaining([
        SCHEMA,
        join('src', 'features', 'promotions', 'components', 'PromoteScreen.tsx'),
        join('src', 'features', 'promotions', 'components', 'PromotionStatusCard.tsx'),
        join('app', 'seller', 'promote.tsx'),
      ]),
    );
    expect(PROMOTION_FILES.some((file) => file.split(sep).includes('__tests__'))).toBe(false);
  });

  it('has no Stripe word, URL or key and no in-app browser anywhere in src/ and app/', () => {
    expect(hits(ALL_APP_FILES, FORBIDDEN_ANYWHERE)).toEqual([]);
  });

  it('has no price data, price formatter, payment link or payment wording in promotions', () => {
    const exempt = (text: string) => text.split(LEGACY_LINE).join('');
    expect(hits(PROMOTION_FILES, FORBIDDEN_IN_PROMOTIONS, exempt)).toEqual([]);
  });

  it('allows exactly one mention of the legacy price keys: the list the schema drops', () => {
    const schema = fs.readFileSync(join(ROOT, SCHEMA), 'utf8');
    expect(schema.split(LEGACY_LINE)).toHaveLength(2);
    expect(schema.match(/price_cents/g)).toHaveLength(1);
  });

  it('keeps every source pattern able to catch what it is for', () => {
    const anywhere = [
      'https://invoice.stripe.com/i/x',
      'EXPO_PUBLIC_STRIPE_KEY',
      'sk_live_abc',
      "import 'expo-web-browser'",
      'WebBrowser.openBrowserAsync',
    ];
    const promotions = [
      'p.price_cents',
      'settings.currency_code',
      'r.amount_cents',
      'formatPromotionPrice(2500)',
      'offerLine(price, 7)',
      'PAYMENT_NOTE',
      "{ style: 'currency' }",
      "currencyDisplay: 'code'",
      'Check the invoice',
      "We'll contact you about payment.",
      'Nothing is charged in the app.',
      'Refunds are handled outside the app.',
      'Pay online',
      'Check your email',
      'title="Pay"',
      'Linking.openURL(url)',
    ];
    expect(FORBIDDEN_ANYWHERE).toHaveLength(anywhere.length);
    expect(FORBIDDEN_IN_PROMOTIONS).toHaveLength(promotions.length);
    anywhere.forEach((sample, i) =>
      expect([i, FORBIDDEN_ANYWHERE[i].test(sample)]).toEqual([i, true]),
    );
    promotions.forEach((sample, i) =>
      expect([i, FORBIDDEN_IN_PROMOTIONS[i].test(sample)]).toEqual([i, true]),
    );
  });

  it('keeps every rendered-text pattern able to catch what it is for (the list cannot shrink)', () => {
    const samples = [
      'Pay now',
      'Paying is easy',
      'Your payment is due',
      'See the invoice',
      'Stripe',
      'The price is fixed',
      'It costs little',
      'You will be charged',
      'Enter your credit card',
      'A small fee',
      'Billing details',
      'Go to checkout',
      'Refunds take 5 days',
      'CAD 25',
      '$25',
      '25.00',
      'Check your email',
      'https://example.test',
      'www.example.test',
    ];
    expect(FORBIDDEN_RENDERED).toHaveLength(samples.length);
    samples.forEach((sample, i) =>
      expect([i, FORBIDDEN_RENDERED[i].test(sample)]).toEqual([i, true]),
    );
    expect(FORBIDDEN_BUTTON.test('Pay')).toBe(true);
    expect(FORBIDDEN_BUTTON.test('Open payment link')).toBe(true);
  });

  it('lets the status words of the spec through', () => {
    expect(paymentWording(ALLOWED_STATUS_WORDS, 'no headline here')).toEqual([]);
    for (const label of ['Cancel request', 'Cancel promotion', 'Promote again', 'Send request']) {
      expect(FORBIDDEN_BUTTON.test(label)).toBe(false);
    }
  });
});

describe('the rendered-text scan reads what it says it reads', () => {
  it('reads exactly these props, plus text children and accessibilityValue.text', () => {
    expect(RENDERED_PROP_KEYS).toEqual([
      'accessibilityLabel',
      'accessibilityHint',
      'aria-label',
      'title',
      'placeholder',
    ]);
  });

  it('finds payment wording in each prop it reads, and in text children', async () => {
    await render(
      createElement(
        View,
        null,
        createElement(Text, null, 'Pay in text'),
        createElement(View, { accessibilityLabel: 'Pay in label' }),
        createElement(View, { accessibilityHint: 'Pay in hint' }),
        createElement(View, { 'aria-label': 'Pay in aria' }),
        createElement(View, { accessibilityValue: { text: 'Pay in value' } }),
        createElement(View, { title: 'Pay in title' } as object),
        createElement(View, { placeholder: 'Pay in placeholder' } as object),
      ),
    );
    expect(paymentWording(renderedStrings(), 'unused headline').sort()).toEqual(
      [
        'Pay in aria',
        'Pay in hint',
        'Pay in label',
        'Pay in placeholder',
        'Pay in text',
        'Pay in title',
        'Pay in value',
      ].sort(),
    );
  });

  it('refuses an empty headline (it would make the scan pass vacuously)', () => {
    expect(() => paymentWording(['Pay now'], '')).toThrow(
      'paymentWording needs the seller headline',
    );
  });
});
