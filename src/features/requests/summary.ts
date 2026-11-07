import type { DetailsItem } from '@/features/map/schema';
import { formatPrice } from '@/features/menu/price';

export type SummaryCurrency = { code: string; minorUnits: number };

export type SummaryLine = {
  itemId: string;
  name: string;
  quantity: number;
  /** The line's price, or null when the item has no price or the currency is unknown. */
  price: string | null;
};

export type OrderSummary = {
  lines: SummaryLine[];
  /** The estimated total, or null: no currency, or nothing ordered has a price. */
  total: string | null;
  /** True when a total is shown but some ordered item has no price (the total leaves it out). */
  excludesUnpriced: boolean;
};

/**
 * The order summary for the form. Prices are shown only in the business's own currency; with no
 * currency there is no symbol and no total. Money is added as whole minor units (integers).
 */
export function summarizeOrder(
  items: readonly Pick<DetailsItem, 'id' | 'name' | 'price_minor'>[],
  quantities: Readonly<Record<string, number>>,
  currency: SummaryCurrency | null,
  locale: string,
): OrderSummary {
  const lines: SummaryLine[] = [];
  let totalMinor = 0;
  let priced = 0;
  let unpriced = 0;
  for (const item of items) {
    const quantity = quantities[item.id] ?? 0;
    if (quantity <= 0) continue;
    const unitPrice = currency !== null ? item.price_minor : null;
    if (unitPrice !== null) {
      totalMinor += unitPrice * quantity;
      priced += 1;
    } else {
      unpriced += 1;
    }
    lines.push({
      itemId: item.id,
      name: item.name,
      quantity,
      price:
        unitPrice !== null && currency
          ? formatPrice(unitPrice * quantity, currency.code, currency.minorUnits, locale)
          : null,
    });
  }
  const showTotal = currency !== null && priced > 0;
  return {
    lines,
    total:
      showTotal && currency
        ? formatPrice(totalMinor, currency.code, currency.minorUnits, locale)
        : null,
    excludesUnpriced: showTotal && unpriced > 0,
  };
}
