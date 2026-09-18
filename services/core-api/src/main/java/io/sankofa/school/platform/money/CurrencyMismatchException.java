package io.sankofa.school.platform.money;

/**
 * Raised when two monetary amounts in different currencies are combined.
 *
 * <p>Cross-currency arithmetic is never implicit in this system. Converting GHS to USD is a
 * business event with a rate, a source and a timestamp, and it is recorded as one — not something
 * that quietly happens inside an addition.
 */
public class CurrencyMismatchException extends RuntimeException {

    private final String left;
    private final String right;

    public CurrencyMismatchException(String left, String right) {
        super("Cannot combine amounts in different currencies: " + left + " and " + right);
        this.left = left;
        this.right = right;
    }

    public String left() {
        return left;
    }

    public String right() {
        return right;
    }
}
