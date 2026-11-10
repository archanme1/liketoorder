import { confirmCopy, sellerStatusSentence } from '../sellerMessages';
import { statusSentence } from '../status';

describe('a table request never uses pickup words', () => {
  it.each(['completed', 'no_show'] as const)('the customer sentence for %s', (status) => {
    const sentence = statusSentence(status, "Luigi's", 'table');
    expect(sentence).not.toMatch(/pickup|picked up/i);
  });

  it('says Table visit completed and Marked as not arrived to the customer', () => {
    expect(statusSentence('completed', "Luigi's", 'table')).toBe('Table visit completed');
    expect(statusSentence('no_show', "Luigi's", 'table')).toBe('Marked as not arrived');
  });

  it.each(['completed', 'no_show'] as const)('the seller sentence for %s', (status) => {
    expect(sellerStatusSentence(status, 'table')).not.toMatch(/pickup|picked up/i);
  });

  it.each(['completed', 'no_show'] as const)('the seller confirm for %s', (action) => {
    const copy = confirmCopy(action, false, 'table');
    expect(`${copy.title} ${copy.body}`).not.toMatch(/pick(ed)? ?up/i);
  });

  it('the pickup wording is unchanged', () => {
    expect(statusSentence('completed', 'Joe', 'pickup')).toBe('Pickup completed');
    expect(statusSentence('no_show', 'Joe', 'pickup')).toBe('Marked as not picked up');
  });
});
