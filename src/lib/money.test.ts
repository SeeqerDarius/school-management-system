import { describe, expect, it } from 'vitest';

import {
  add,
  amount,
  apportion,
  compare,
  formatMoney,
  max,
  min,
  minorUnits,
  money,
  multiplyByQuantity,
  percentOf,
  subtract,
  ZERO,
} from '@/lib/money';

/**
 * Money.
 *
 * <p>AGENTS.md §7 asks for "a test asserting exact BigDecimal values, including rounding and a
 * partial payment". These are the exact-value ones; the partial payment is in
 * `tests/db/fees.test.ts`, where it belongs, because a payment is a database fact.
 *
 * <p>The apportionment tests are the ones that matter most. Every other function here is a thin
 * wrapper over exact decimal arithmetic; `apportion` is the one that makes a real decision, and
 * the decision is about where a pesewa goes.
 */

describe('an amount is never a JavaScript number', () => {
  it('adds without the floating-point error that makes a ledger untrustworthy', () => {
    // 0.1 + 0.2 === 0.30000000000000004 as a `number`. This is the whole reason for the module.
    expect(add('0.1', '0.2')).toBe('0.3000');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('holds a school-sized total exactly', () => {
    // 1,200 children at ₵1,234.56 — the kind of sum a termly fee run actually produces.
    expect(multiplyByQuantity('1234.56', 1200)).toBe('1481472.0000');
  });

  it('refuses input that is not an amount, rather than turning it into one', () => {
    // parseFloat would give 12.34, NaN and 0 for these three.
    expect(() => money('12.34 GHS')).toThrow(/not an amount/);
    expect(() => money('abc')).toThrow(/not an amount/);
    expect(() => money('')).toThrow(/not an amount/);
    expect(() => money('1e5')).toThrow(/not an amount/);
  });

  it('canonicalises to a fixed scale, so equal amounts compare equal as strings', () => {
    expect(amount('12.5')).toBe('12.5000');
    expect(amount('12.50000')).toBe('12.5000');
    expect(amount('12.5')).toBe(amount('12.50'));
  });

  it('refuses a fractional quantity — three and a half exercise books is a bug', () => {
    expect(() => multiplyByQuantity('12.50', 2.5)).toThrow(/whole number/);
    expect(() => multiplyByQuantity('12.50', -1)).toThrow(/non-negative/);
  });
});

describe('percentages round half-up, once, at the stated scale', () => {
  it('computes a levy exactly', () => {
    expect(percentOf('1234.56', '7.5')).toBe('92.5920');
  });

  it('rounds half-up at the fourth place', () => {
    // 0.00005 exactly — the boundary case. Half-up takes it away from zero.
    expect(percentOf('1.00', '0.005')).toBe('0.0001');
  });

  it('applies a whole-number discount without drift', () => {
    expect(percentOf('2500.00', '10')).toBe('250.0000');
  });
});

describe('comparison and clamping', () => {
  it('compares by value, not by string', () => {
    // '9.00' > '10.00' as strings. This is why compare exists.
    expect(compare('9.00', '10.00')).toBe(-1);
    expect(compare('10.0000', '10')).toBe(0);
    expect(compare('10.01', '10.00')).toBe(1);
  });

  it('clamps a credit balance to zero — an overpayment is not a debt', () => {
    expect(max('-250.00', ZERO)).toBe('0.0000');
    expect(max('250.00', ZERO)).toBe('250.0000');
    expect(min('250.00', '100.00')).toBe('100.0000');
  });

  it('subtracts into a negative, because an overpayment has to be representable', () => {
    expect(subtract('100.00', '250.00')).toBe('-150.0000');
  });
});

describe('apportion — where the pesewa goes', () => {
  it('splits an indivisible amount so the parts sum to the whole', () => {
    // The classic. Three equal shares of ₵100: naively 33.33 each, and a pesewa vanishes.
    const shares = apportion('100.00', ['1', '1', '1']);

    expect(add(...shares)).toBe('100.0000');
    expect(shares).toEqual(['33.3334', '33.3333', '33.3333']);
  });

  it('never loses or invents a unit, across a range of awkward splits', () => {
    // A property, asserted over cases rather than stated in a comment.
    const cases: Array<[string, string[]]> = [
      ['100.00', ['1', '1', '1']],
      ['0.0001', ['1', '1', '1']],
      ['1000.00', ['1', '2', '3', '7']],
      ['-100.00', ['1', '1', '1']],
      ['2500.00', ['1200.00', '800.00', '500.00']],
      ['0.0003', ['1', '1', '1', '1', '1', '1', '1']],
    ];

    for (const [total, weights] of cases) {
      const shares = apportion(total, weights);
      expect(add(...shares), `apportioning ${total} across ${weights.join('/')}`).toBe(
        amount(total),
      );
    }
  });

  it('splits in proportion to the weights, not evenly', () => {
    // A ₵300 discount across a ₵1,200 tuition line and a ₵400 levy line lands 3:1.
    expect(apportion('300.00', ['1200.00', '400.00'])).toEqual(['225.0000', '75.0000']);
  });

  it('gives the spare unit to the earlier line when shares tie', () => {
    // Determinism is the point: the same invoice regenerated has to produce the same numbers,
    // which is what makes a reprint a reprint rather than a new document.
    expect(apportion('100.00', ['1', '1', '1'])).toEqual(apportion('100.00', ['1', '1', '1']));
  });

  it('apportions a credit the same way, downwards', () => {
    const shares = apportion('-100.00', ['1', '1', '1']);
    expect(add(...shares)).toBe('-100.0000');
    expect(shares.every((share) => share.startsWith('-'))).toBe(true);
  });

  it('spreads evenly when every weight is zero, rather than losing the amount', () => {
    // Zero weights cannot express a proportion. Returning zeroes would silently discard the
    // whole amount, which is the one outcome a money function must never have.
    const shares = apportion('100.00', ['0', '0', '0']);
    expect(add(...shares)).toBe('100.0000');
  });

  it('returns nothing for no lines, rather than inventing one', () => {
    expect(apportion('100.00', [])).toEqual([]);
  });

  it('gives a single line the whole amount', () => {
    expect(apportion('100.00', ['1'])).toEqual(['100.0000']);
  });
});

/**
 * `Intl` separates a currency code from the number with a NON-BREAKING space (U+00A0), not the
 * space on your keyboard. Asserting against a literal would mean an invisible character in the
 * source that the next person deletes by accident, so whitespace is normalised first.
 */
const normalise = (value: string) => value.replace(/\s/g, ' ');

describe('formatting is for people and nothing else', () => {
  it('shows a GHS amount in the two places it is written in, not the four it is stored in', () => {
    // ₵1,234.5000 on an invoice reads as a bug to the person paying it.
    expect(normalise(formatMoney('1234.5000', 'GHS'))).toContain('1,234.50');
  });

  it('knows a zero-decimal currency', () => {
    expect(minorUnits('XOF')).toBe(0);
    expect(minorUnits('GHS')).toBe(2);
    expect(formatMoney('1000.0000', 'XOF')).not.toContain('.00');
  });

  it('renders an unrecognised but well-formed code by printing the code', () => {
    // `Intl` accepts any three-letter code and uses it as the symbol, which is the right
    // outcome: a school on a currency this build has never heard of still gets a readable
    // invoice rather than an error.
    expect(normalise(formatMoney('1234.5000', 'ZZZ'))).toBe('ZZZ 1,234.50');
  });

  it('falls back rather than blanking the invoice on a malformed code', () => {
    // `Intl` throws a RangeError on anything that is not three letters. A currency column with
    // bad data in it must not be able to take down the page an invoice is on.
    expect(normalise(formatMoney('1234.5000', 'GH'))).toBe('GH 1234.50');
    expect(normalise(formatMoney('1234.5000', ''))).toBe(' 1234.50');
  });

  it('rounds half-up for display without changing what is stored', () => {
    expect(normalise(formatMoney('1234.5650', 'GHS'))).toContain('1,234.57');
    expect(amount('1234.5650')).toBe('1234.5650');
  });
});
