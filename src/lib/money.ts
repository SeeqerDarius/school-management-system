import { Decimal } from '@prisma/client/runtime/library';

/**
 * Money.
 *
 * <p>Invariant I-2: `numeric(19,4)` in PostgreSQL, `Decimal` here, **`string` at every boundary**.
 * Never a JavaScript `number` for an amount. `0.1 + 0.2` is `0.30000000000000004` in a `number`,
 * and a system that does that to a school's fee ledger will, eventually and unpredictably, tell a
 * parent they owe a pesewa they have already paid.
 *
 * <p>The rule is not "be careful with numbers". It is that an amount never becomes a `number` at
 * all — not in a DTO, not in a component prop, not for a moment while formatting. Every function
 * here takes and returns strings, so a `number` cannot get in by accident.
 *
 * <h2>Scale</h2>
 * Four decimal places, matching the column. Two would be enough to hold a GHS amount but not to
 * compute one: a 7.5% levy on ₵1,234.56 is ₵92.5920, and rounding each intermediate to two places
 * is how a total stops matching the sum of its parts.
 *
 * <h2>Rounding</h2>
 * Every division states its rounding mode, because there is no safe default. Half-up is used
 * throughout — it is what a Ghanaian school's accountant does by hand, and matching the human
 * process matters more here than matching the banker's convention nobody in the room is using.
 */

/** Amounts are held to this many places, matching `numeric(19,4)`. */
export const SCALE = 4;

/**
 * Half-up, everywhere a division happens.
 *
 * <p>Named rather than passed as the literal `4`, so a reader of a call site can see which
 * convention is in force without looking it up (AGENTS.md: "always with an explicit RoundingMode
 * at every division").
 */
export const HALF_UP = Decimal.ROUND_HALF_UP;

/** The minor units a currency is actually written in. Display only — storage is always scale 4. */
const MINOR_UNITS: Record<string, number> = {
  GHS: 2,
  NGN: 2,
  KES: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  // Zero-decimal currencies. Listed because formatting ₣1,000.00 for a currency that has no
  // centimes is wrong in a way nobody notices until an auditor does.
  XOF: 0,
  XAF: 0,
  JPY: 0,
};

export function minorUnits(currency: string): number {
  return MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

class MoneyError extends Error {}

/**
 * Parses an amount, refusing anything that is not one.
 *
 * <p>Deliberately strict. `parseFloat('12.34 GHS')` is `12.34`, `parseFloat('abc')` is `NaN`, and
 * `Number('')` is `0` — three different ways for bad input to become a plausible-looking amount.
 * This throws instead, because a fee ledger would rather fail than silently invoice nothing.
 */
export function money(value: string | Decimal): Decimal {
  if (value instanceof Decimal) return value;

  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new MoneyError(`not an amount: ${JSON.stringify(value)}`);
  }

  const parsed = new Decimal(trimmed);
  if (!parsed.isFinite()) throw new MoneyError(`not a finite amount: ${value}`);
  return parsed;
}

/** The canonical string form: fixed scale, so two equal amounts are also equal as strings. */
export function amount(value: string | Decimal): string {
  return money(value).toFixed(SCALE);
}

export const ZERO = '0.0000';

export function add(...values: Array<string | Decimal>): string {
  return values.reduce<Decimal>((total, value) => total.plus(money(value)), new Decimal(0)).toFixed(SCALE);
}

export function subtract(from: string | Decimal, value: string | Decimal): string {
  return money(from).minus(money(value)).toFixed(SCALE);
}

/**
 * Multiplies an amount by a whole quantity.
 *
 * <p>Quantity, not a rate: three exercise books at ₵12.50. Exact, so no rounding mode is needed
 * and none is offered — a rounding mode here would imply a precision question that does not exist.
 */
export function multiplyByQuantity(value: string | Decimal, quantity: number): string {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`quantity must be a non-negative whole number, got ${quantity}`);
  }
  return money(value).times(quantity).toFixed(SCALE);
}

/**
 * Applies a percentage, rounding half-up to the stored scale.
 *
 * <p>The one place a rounding decision is genuinely made, so it is made here once rather than at
 * every call site that offers a discount.
 */
export function percentOf(value: string | Decimal, percent: string | Decimal): string {
  return money(value).times(money(percent)).dividedBy(100).toDecimalPlaces(SCALE, HALF_UP).toFixed(SCALE);
}

export function compare(a: string | Decimal, b: string | Decimal): -1 | 0 | 1 {
  return money(a).comparedTo(money(b)) as -1 | 0 | 1;
}

export const isZero = (value: string | Decimal) => money(value).isZero();
export const isNegative = (value: string | Decimal) => money(value).isNegative();
export const isPositive = (value: string | Decimal) => money(value).greaterThan(0);

/** The larger of two amounts. `max(balance, 0)` is the usual use: an overpayment is not a debt. */
export function max(a: string | Decimal, b: string | Decimal): string {
  return (compare(a, b) >= 0 ? money(a) : money(b)).toFixed(SCALE);
}

export function min(a: string | Decimal, b: string | Decimal): string {
  return (compare(a, b) <= 0 ? money(a) : money(b)).toFixed(SCALE);
}

/**
 * Splits an amount across weights so the parts sum **exactly** to the whole.
 *
 * <p>This is the function that stops a pesewa going missing. Spreading a ₵100 sibling discount
 * across three lines by rounding each share independently gives 33.33 + 33.33 + 33.33 = 99.99, and
 * the school's books are one pesewa short of the discount they granted. Do it the other way and
 * they are a pesewa over. Neither is acceptable in a ledger, and the difference compounds over a
 * term's invoices until somebody has to explain it.
 *
 * <p>So: floor every share to the scale, then hand the remainder out one unit at a time, largest
 * fractional part first. The result always sums to the input. Ties go to the earlier line, which
 * makes the split deterministic — the same invoice regenerated produces the same numbers, which is
 * the property a reprint depends on.
 *
 * <p>With weights that are all zero the amount cannot be apportioned at all, so it is spread
 * evenly instead — the alternative is returning zeroes and silently losing the whole amount.
 */
export function apportion(total: string | Decimal, weights: Array<string | Decimal>): string[] {
  if (weights.length === 0) return [];

  const totalDecimal = money(total);
  const weightDecimals = weights.map((weight) => money(weight));
  const weightSum = weightDecimals.reduce((sum, weight) => sum.plus(weight), new Decimal(0));

  const unit = new Decimal(1).dividedBy(new Decimal(10).pow(SCALE));

  const shares = weightSum.isZero()
    ? weightDecimals.map(() => totalDecimal.dividedBy(weights.length))
    : weightDecimals.map((weight) => totalDecimal.times(weight).dividedBy(weightSum));

  const floored = shares.map((share) => share.toDecimalPlaces(SCALE, Decimal.ROUND_DOWN));
  const distributed = floored.reduce((sum, share) => sum.plus(share), new Decimal(0));

  // How many whole units are left over. Computed in units rather than as a fraction so the loop
  // below terminates on an exact integer rather than on a comparison of two decimals.
  let remaining = totalDecimal.minus(distributed).dividedBy(unit).toDecimalPlaces(0, HALF_UP).toNumber();

  const order = shares
    .map((share, index) => ({ index, fraction: share.minus(floored[index] as Decimal) }))
    .sort((a, b) => {
      const byFraction = b.fraction.comparedTo(a.fraction);
      return byFraction !== 0 ? byFraction : a.index - b.index;
    });

  const result = [...floored];
  // A negative remainder happens when the total is negative — a credit apportioned across lines.
  const step = remaining < 0 ? unit.negated() : unit;
  let cursor = 0;
  while (remaining !== 0 && order.length > 0) {
    const target = order[cursor % order.length] as { index: number };
    result[target.index] = (result[target.index] as Decimal).plus(step);
    remaining += remaining < 0 ? 1 : -1;
    cursor += 1;
  }

  return result.map((share) => share.toFixed(SCALE));
}

/**
 * Formats for a person to read.
 *
 * <p>Display only, and the only function here that produces something that is not a canonical
 * amount. Rounds to the currency's own minor units — a GHS total shows two places even though it
 * is stored with four, because ₵1,234.5000 on an invoice looks like a bug to the person paying it.
 */
export function formatMoney(value: string | Decimal, currency: string, locale = 'en-GH'): string {
  const places = minorUnits(currency);
  const rounded = money(value).toDecimalPlaces(places, HALF_UP);

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: places,
      maximumFractionDigits: places,
      // `Intl` is given a `number`, and that is safe *here* and nowhere else: the value has
      // already been rounded to the places being displayed, and the result is a string for a
      // human rather than an amount anything computes with.
    }).format(rounded.toNumber());
  } catch {
    // An unknown currency code should not blank the page an invoice is on.
    return `${currency.toUpperCase()} ${rounded.toFixed(places)}`;
  }
}
