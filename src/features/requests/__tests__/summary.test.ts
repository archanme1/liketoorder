import { summarizeOrder } from '../summary';

const items = [
  { id: 'a', name: 'Margherita', price_minor: 1250 },
  { id: 'b', name: 'House salad', price_minor: null },
  { id: 'c', name: 'Soda', price_minor: 300 },
];
const cad = { code: 'USD', minorUnits: 2 };

describe('summarizeOrder', () => {
  it('prices each line and adds the total in whole minor units', () => {
    const summary = summarizeOrder(items, { a: 2, c: 1 }, cad, 'en-US');
    expect(summary.lines).toEqual([
      { itemId: 'a', name: 'Margherita', quantity: 2, price: '$25.00' },
      { itemId: 'c', name: 'Soda', quantity: 1, price: '$3.00' },
    ]);
    expect(summary.total).toBe('$28.00');
    expect(summary.excludesUnpriced).toBe(false);
  });

  it('says the total leaves out items without a price', () => {
    const summary = summarizeOrder(items, { a: 1, b: 2 }, cad, 'en-US');
    expect(summary.total).toBe('$12.50');
    expect(summary.excludesUnpriced).toBe(true);
    expect(summary.lines[1]).toMatchObject({ itemId: 'b', quantity: 2, price: null });
  });

  it('has no total when nothing ordered has a price', () => {
    const summary = summarizeOrder(items, { b: 1 }, cad, 'en-US');
    expect(summary.total).toBeNull();
    expect(summary.excludesUnpriced).toBe(false);
  });

  it('shows no price and no currency symbol when the business has no currency', () => {
    const summary = summarizeOrder(items, { a: 1, c: 1 }, null, 'en-US');
    expect(summary.total).toBeNull();
    expect(summary.lines.every((line) => line.price === null)).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/[$€£¥]/);
  });

  it('skips items with no quantity and uses the currency decimals', () => {
    expect(summarizeOrder(items, { a: 0 }, cad, 'en-US').lines).toEqual([]);
    expect(
      summarizeOrder(
        [{ id: 'x', name: 'Ramen', price_minor: 1200 }],
        { x: 1 },
        { code: 'JPY', minorUnits: 0 },
        'en-US',
      ).total,
    ).toBe('¥1,200');
  });
});
