package io.sankofa.school.platform.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.Objects;

/**
 * An exact monetary amount in a specific currency.
 *
 * <p>Invariant I-2: money is decimal and carries its currency. {@code double} and {@code float}
 * are disqualified — {@code 0.1 + 0.2 != 0.3} in IEEE-754, and a school ledger that drifts by a
 * pesewa per transaction is a ledger nobody can reconcile.
 *
 * <p>Amounts are held at scale 4. Presentation rounds to the currency's own scale (2 for GHS,
 * USD, GBP, EUR; 0 for JPY), but intermediate arithmetic keeps the extra digits so that a unit
 * price, a tax rate and a per-student apportionment compose without compounding rounding error.
 *
 * <p>Every operation that can lose precision takes an explicit {@link RoundingMode}. There is no
 * default, because the right choice differs between tax (usually HALF_UP), interest (often
 * HALF_EVEN) and allocation (see {@link #allocate}).
 */
public final class Money implements Comparable<Money> {

    /** Storage scale. Matches {@code numeric(19,4)} in PostgreSQL. */
    public static final int SCALE = 4;

    private final BigDecimal amount;
    private final Currency currency;

    private Money(BigDecimal amount, Currency currency) {
        this.amount = amount.setScale(SCALE, RoundingMode.UNNECESSARY);
        this.currency = currency;
    }

    public static Money of(BigDecimal amount, Currency currency) {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        // setScale with HALF_UP here would silently accept a 5-decimal input. Reject instead:
        // an amount with more precision than we store is a bug upstream, not something to round.
        return new Money(amount.setScale(SCALE, RoundingMode.UNNECESSARY), currency);
    }

    public static Money of(String amount, String currencyCode) {
        return of(new BigDecimal(amount), Currency.getInstance(currencyCode));
    }

    public static Money zero(Currency currency) {
        return new Money(BigDecimal.ZERO.setScale(SCALE, RoundingMode.UNNECESSARY), currency);
    }

    public static Money zero(String currencyCode) {
        return zero(Currency.getInstance(currencyCode));
    }

    public BigDecimal amount() {
        return amount;
    }

    public Currency currency() {
        return currency;
    }

    public String currencyCode() {
        return currency.getCurrencyCode();
    }

    // ---------------------------------------------------------------------------------------
    // Arithmetic
    // ---------------------------------------------------------------------------------------

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money minus(Money other) {
        requireSameCurrency(other);
        return new Money(amount.subtract(other.amount), currency);
    }

    public Money times(BigDecimal multiplier, RoundingMode rounding) {
        Objects.requireNonNull(rounding, "rounding");
        return new Money(amount.multiply(multiplier).setScale(SCALE, rounding), currency);
    }

    public Money dividedBy(BigDecimal divisor, RoundingMode rounding) {
        Objects.requireNonNull(rounding, "rounding");
        if (divisor.signum() == 0) {
            throw new ArithmeticException("Division of a monetary amount by zero");
        }
        return new Money(amount.divide(divisor, SCALE, rounding), currency);
    }

    public Money negated() {
        return new Money(amount.negate(), currency);
    }

    public Money abs() {
        return new Money(amount.abs(), currency);
    }

    /**
     * Splits this amount into {@code parts} pieces whose sum is exactly this amount.
     *
     * <p>Naive division loses money: GHS 10.00 into 3 gives 3.33 three times, and a pesewa
     * vanishes. This uses the largest-remainder method — divide down, then distribute the
     * remainder one minor unit at a time from the first part onward — so the parts always add
     * back up. Used when apportioning a fee across terms or a payment across invoice lines.
     */
    public List<Money> allocate(int parts) {
        if (parts <= 0) {
            throw new IllegalArgumentException("parts must be positive, was " + parts);
        }
        BigDecimal minor = minorUnit();
        BigDecimal total = amount;
        BigDecimal each = total.divide(BigDecimal.valueOf(parts), currency.getDefaultFractionDigits(),
                RoundingMode.DOWN);

        List<Money> result = new ArrayList<>(parts);
        BigDecimal running = BigDecimal.ZERO;
        for (int i = 0; i < parts; i++) {
            result.add(new Money(each.setScale(SCALE, RoundingMode.UNNECESSARY), currency));
            running = running.add(each);
        }

        BigDecimal remainder = total.subtract(running);
        int i = 0;
        // Distribute whatever is left, one minor unit per part, until it is exhausted.
        while (remainder.compareTo(BigDecimal.ZERO) > 0 && minor.signum() > 0) {
            Money bumped = result.get(i).plus(new Money(minor, currency));
            result.set(i, bumped);
            remainder = remainder.subtract(minor);
            i = (i + 1) % parts;
        }
        return List.copyOf(result);
    }

    /**
     * Splits this amount in proportion to {@code weights}, preserving the total exactly.
     *
     * <p>Used to spread one payment across several outstanding invoices, or a shared cost across
     * departments. The last non-zero weight absorbs the rounding difference, so the parts always
     * sum back to the original.
     */
    public List<Money> allocateByWeights(List<BigDecimal> weights, RoundingMode rounding) {
        Objects.requireNonNull(weights, "weights");
        if (weights.isEmpty()) {
            throw new IllegalArgumentException("weights must not be empty");
        }
        BigDecimal totalWeight = weights.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        if (totalWeight.signum() == 0) {
            throw new IllegalArgumentException("weights must not sum to zero");
        }

        List<Money> result = new ArrayList<>(weights.size());
        Money running = zero(currency);
        for (int i = 0; i < weights.size() - 1; i++) {
            Money part = times(weights.get(i), rounding).dividedBy(totalWeight, rounding);
            result.add(part);
            running = running.plus(part);
        }
        result.add(minus(running));
        return List.copyOf(result);
    }

    // ---------------------------------------------------------------------------------------
    // Comparison
    // ---------------------------------------------------------------------------------------

    public boolean isZero() {
        return amount.signum() == 0;
    }

    public boolean isPositive() {
        return amount.signum() > 0;
    }

    public boolean isNegative() {
        return amount.signum() < 0;
    }

    public boolean isGreaterThan(Money other) {
        return compareTo(other) > 0;
    }

    public boolean isLessThan(Money other) {
        return compareTo(other) < 0;
    }

    @Override
    public int compareTo(Money other) {
        requireSameCurrency(other);
        return amount.compareTo(other.amount);
    }

    /** The amount as it should be presented: rounded to the currency's own fraction digits. */
    public BigDecimal forDisplay() {
        return amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_UP);
    }

    private BigDecimal minorUnit() {
        int digits = currency.getDefaultFractionDigits();
        return digits < 0 ? BigDecimal.ONE : BigDecimal.ONE.movePointLeft(digits);
    }

    private void requireSameCurrency(Money other) {
        Objects.requireNonNull(other, "other");
        if (!currency.equals(other.currency)) {
            // Cross-currency arithmetic is never implicit. A conversion is a business event with
            // a rate, a source and a timestamp, and it gets recorded as one.
            throw new CurrencyMismatchException(currency.getCurrencyCode(),
                    other.currency.getCurrencyCode());
        }
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Money other)) {
            return false;
        }
        return amount.compareTo(other.amount) == 0 && currency.equals(other.currency);
    }

    @Override
    public int hashCode() {
        return Objects.hash(amount.stripTrailingZeros(), currency);
    }

    @Override
    public String toString() {
        return currency.getCurrencyCode() + " " + forDisplay().toPlainString();
    }
}
