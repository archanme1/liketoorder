import { screen } from '@testing-library/react-native';

// Spec 16b, Store rules: the app shows promotion STATUS only. No price, no Pay button, no payment
// link, no Stripe URL and no wording that steers a seller to pay somewhere else. These lists are the
// test's definition of that rule. noPaymentInApp.test.ts pins them (count and samples), so they
// cannot shrink without a red test.

/** Never in any text, accessibility label or hint the Promote screen renders, in any state. */
export const FORBIDDEN_RENDERED: readonly RegExp[] = [
  /\bpay\b/i,
  /\bpaying\b/i,
  /\bpayments?\b(?! window)/i,
  /\binvoices?\b/i,
  /stripe/i,
  /\bprices?\b/i,
  /\bcosts?\b/i,
  /\bcharge[sd]?\b/i,
  /\b(credit|debit|bank|payment) cards?\b|card number/i,
  /\bfees?\b/i,
  /\bbilling\b/i,
  /\bcheckout\b/i,
  /\brefunds?\b/i,
  /\bCAD\b/,
  /\$/,
  /\d+[.,]\d{2}\b/,
  /(your|by|via|in the|check) e-?mail|e-?mail(ed)? (you|us)|inbox/i,
  /https?:/i,
  /www\./i,
];

/** Never in the label of anything with the button role on the Promote screen. */
export const FORBIDDEN_BUTTON: RegExp = /pay|price|invoice|checkout|stripe|refund|link/i;

/** Status words the spec allows: the scan must let them through. */
export const ALLOWED_STATUS_WORDS = [
  'Paid and scheduled. Starts on Nov 22, ends on Nov 29.',
  'Payment window closed.',
  'Refunded.',
  "Your headline was approved. We'll be in touch with next steps.",
  'Not approved: the payment window closed.',
  'Contact us to cancel.',
  'A larger flag on the map and a card in Offers for 7 days, both marked Sponsored.',
] as const;

/** The string props renderedStrings reads on every element, besides the text children. */
export const RENDERED_PROP_KEYS = [
  'accessibilityLabel',
  'accessibilityHint',
  'aria-label',
  'title',
  'placeholder',
] as const;

/**
 * The strings the screen renders: every text child, the string props in RENDERED_PROP_KEYS and
 * accessibilityValue.text, on every element of the rendered tree.
 */
export function renderedStrings(): string[] {
  const out: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (typeof node !== 'object' || node === null || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const { props, children } = node as { props?: Record<string, unknown>; children?: unknown };
    for (const key of RENDERED_PROP_KEYS) {
      const value = props?.[key];
      if (typeof value === 'string') out.push(value);
    }
    const accessibilityValue = props?.accessibilityValue as { text?: unknown } | undefined;
    if (typeof accessibilityValue?.text === 'string') out.push(accessibilityValue.text);
    walk(children);
  };
  walk(screen.toJSON());
  return out;
}

/** The labels of everything with the button role (label, else its text). */
export function buttonLabels(): string[] {
  return screen.queryAllByRole('button').map((button) => {
    const label: unknown = button.props.accessibilityLabel;
    if (typeof label === 'string') return label;
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'string') texts.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === 'object' && node !== null && 'props' in node) {
        walk((node as { props: { children?: unknown } }).props.children);
      }
    };
    walk(button.props.children);
    return texts.join(' ');
  });
}

/**
 * The strings that break the rule, with the seller's own headline taken out first (a headline is
 * the seller's words, for example "half price", not app wording).
 */
export function paymentWording(strings: readonly string[], headline: string): string[] {
  // An empty headline would split every string into single characters and pass vacuously.
  if (headline.length === 0) throw new Error('paymentWording needs the seller headline');
  return strings
    .map((text) => text.split(headline).join(' '))
    .filter((text) => FORBIDDEN_RENDERED.some((pattern) => pattern.test(text)));
}
