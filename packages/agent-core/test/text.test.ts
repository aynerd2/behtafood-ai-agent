import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNairaInText, hasDash, sanitizeReply } from '../src/text';

describe('sanitizeReply: no em or en dashes, ever', () => {
  test('the reported case: a dash before a price becomes a colon, and the price is grouped', () => {
    assert.equal(
      sanitizeReply('Jollof Rice & Chicken — ₦2500 for Iya Ewa Kitchen'),
      'Jollof Rice & Chicken: ₦2,500 for Iya Ewa Kitchen',
    );
  });

  test('en dash before a price is a colon too', () => {
    assert.equal(sanitizeReply('Moin Moin – ₦800'), 'Moin Moin: ₦800');
    assert.equal(sanitizeReply('Fried Rice—₦3500'), 'Fried Rice: ₦3,500');
  });

  test('any other dash becomes a comma', () => {
    assert.equal(sanitizeReply('It is open now — want to order?'), 'It is open now, want to order?');
    assert.equal(sanitizeReply('Iya Ewa Kitchen – Ado-Ekiti'), 'Iya Ewa Kitchen, Ado-Ekiti');
  });

  test('a number range reads "to"', () => {
    assert.equal(sanitizeReply('About 25–35 minutes'), 'About 25 to 35 minutes');
  });

  test('dash bullets at the start of a line are dropped', () => {
    assert.equal(sanitizeReply('Options:\n— Jollof: ₦2,500\n— Ofada: ₦3,000'), 'Options:\nJollof: ₦2,500\nOfada: ₦3,000');
  });

  test('ordinary hyphens stay (Ado-Ekiti, Moin-Moin)', () => {
    assert.equal(sanitizeReply('Moin-Moin in Ado-Ekiti'), 'Moin-Moin in Ado-Ekiti');
  });

  test('no dash survives any input', () => {
    for (const s of ['—', '–', 'a—b', 'a – b — c', '— — —', 'x—₦5000—y', '₦1,000–₦2,000']) {
      assert.equal(hasDash(sanitizeReply(s)), false, s);
    }
  });
});

describe('prices get thousands separators', () => {
  test('naira amounts', () => {
    assert.equal(formatNairaInText('₦2500'), '₦2,500');
    assert.equal(formatNairaInText('₦ 12500.50'), '₦12,500.50');
    assert.equal(formatNairaInText('N2500 total'), '₦2,500 total');
    assert.equal(formatNairaInText('₦800'), '₦800');
    assert.equal(formatNairaInText('₦1,250,000'), '₦1,250,000');
  });
  test('other numbers are left alone', () => {
    assert.equal(formatNairaInText('Order 12345 is on the way'), 'Order 12345 is on the way');
    assert.equal(formatNairaInText('call 08012345678'), 'call 08012345678');
  });
});

describe('plain text only', () => {
  test('markdown is removed', () => {
    assert.equal(sanitizeReply('## Options\n**Jollof Rice**: ₦2500'), 'Options\nJollof Rice: ₦2,500');
    assert.equal(sanitizeReply('Try `Ofada`'), 'Try Ofada');
  });
  test('blank lines collapse and text is trimmed', () => {
    assert.equal(sanitizeReply('  Hi\n\n\n\nThere  '), 'Hi\n\nThere');
  });
});
