package io.sankofa.school.platform.money;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Exact-value tests for monetary arithmetic (AGENTS.md §7: money assertions are on exact
 * {@link BigDecimal} values, never on doubles and never on "approximately").
 *
 * <p>The allocation tests matter most. Splitting a fee across three terms, or one mobile-money
 * payment across four outstanding invoices, is where a school's ledger quietly loses a pesewa per
 * transaction until nothing reconciles. Every allocation test asserts the parts sum back to the
 * original, because that is the property that actually has to hold.
 */
class MoneyTest {

    @Nested
    @DisplayName("construction")
    class Construction {

        @Test
        @DisplayName("normalises to the storage scale of 4")
        void normalisesScale() {
            assertThat(Money.of("100.00", "GHS").amount())
                    .isEqualByComparingTo(new BigDecimal("100.0000"));
            assertThat(Money.of("100.00", "GHS").amount().scale()).isEqualTo(4);
        }

        @Test
        @DisplayName("rejects an amount with more precision than we store, rather than rounding it")
        void rejectsExcessPrecision() {
            // Silently rounding here would hide a bug upstream — a rate computed at 6 decimals,
            // say — and the loss would only surface as an unreconcilable ledger months later.
            assertThatThrownBy(() -> Money.of("10.000001", "GHS"))
                    .isInstanceOf(ArithmeticException.class);
        }

        @Test
        @DisplayName("zero carries its currency")
        void zeroCarriesCurrency() {
            assertThat(Money.zero("GHS").currencyCode()).isEqualTo("GHS");
            assertThat(Money.zero("GHS").isZero()).isTrue();
        }
    }

    @Nested
    @DisplayName("arithmetic")
    class Arithmetic {

        @Test
        @DisplayName("the classic float failure does not occur")
        void decimalArithmeticIsExact() {
            // 0.1 + 0.2 != 0.3 in IEEE-754. This is the entire reason for Invariant I-2.
            Money sum = Money.of("0.10", "GHS").plus(Money.of("0.20", "GHS"));
            assertThat(sum.amount()).isEqualByComparingTo(new BigDecimal("0.3000"));
            assertThat(sum).isEqualTo(Money.of("0.30", "GHS"));
        }

        @Test
        @DisplayName("a thousand additions of one pesewa give exactly ten cedis")
        void repeatedAdditionDoesNotDrift() {
            Money running = Money.zero("GHS");
            Money pesewa = Money.of("0.01", "GHS");
            for (int i = 0; i < 1_000; i++) {
                running = running.plus(pesewa);
            }
            assertThat(running).isEqualTo(Money.of("10.00", "GHS"));
        }

        @Test
        @DisplayName("subtraction can go negative — an overpaid account is a real state")
        void subtractionCanGoNegative() {
            Money balance = Money.of("500.00", "GHS").minus(Money.of("750.00", "GHS"));
            assertThat(balance.isNegative()).isTrue();
            assertThat(balance.amount()).isEqualByComparingTo(new BigDecimal("-250.0000"));
        }

        @ParameterizedTest(name = "{0} x {1} rounding {2} = {3}")
        @CsvSource({
                "100.00, 0.125,  HALF_UP,   12.5000",
                "100.00, 0.125,  HALF_EVEN, 12.5000",
                "33.33,  3,      HALF_UP,   99.9900",
                "0.01,   0.5,    HALF_UP,   0.0050",
        })
        @DisplayName("multiplication applies the rounding mode the caller chose")
        void multiplicationRounds(String amount, String multiplier, RoundingMode mode,
                                  String expected) {
            Money result = Money.of(amount, "GHS").times(new BigDecimal(multiplier), mode);
            assertThat(result.amount()).isEqualByComparingTo(new BigDecimal(expected));
        }

        @Test
        @DisplayName("division by zero is an error, not an infinity")
        void divisionByZeroRejected() {
            assertThatThrownBy(() ->
                    Money.of("100.00", "GHS").dividedBy(BigDecimal.ZERO, RoundingMode.HALF_UP))
                    .isInstanceOf(ArithmeticException.class)
                    .hasMessageContaining("zero");
        }

        @Test
        @DisplayName("currencies are never combined implicitly")
        void currencyMismatchRejected() {
            // A GHS/USD conversion is a business event with a rate and a timestamp. It does not
            // happen silently inside an addition.
            assertThatThrownBy(() -> Money.of("100.00", "GHS").plus(Money.of("100.00", "USD")))
                    .isInstanceOf(CurrencyMismatchException.class)
                    .hasMessageContaining("GHS")
                    .hasMessageContaining("USD");
        }
    }

    @Nested
    @DisplayName("allocation")
    class Allocation {

        @Test
        @DisplayName("GHS 10.00 into three parts loses nothing")
        void thirdsSumBackExactly() {
            // Naive division gives 3.33 three times and a pesewa disappears.
            List<Money> parts = Money.of("10.00", "GHS").allocate(3);

            assertThat(parts).containsExactly(
                    Money.of("3.34", "GHS"),
                    Money.of("3.33", "GHS"),
                    Money.of("3.33", "GHS"));
            assertThat(sum(parts)).isEqualTo(Money.of("10.00", "GHS"));
        }

        @Test
        @DisplayName("an exact division distributes evenly with no remainder")
        void exactDivisionIsEven() {
            List<Money> parts = Money.of("900.00", "GHS").allocate(3);
            assertThat(parts).containsExactly(
                    Money.of("300.00", "GHS"),
                    Money.of("300.00", "GHS"),
                    Money.of("300.00", "GHS"));
            assertThat(sum(parts)).isEqualTo(Money.of("900.00", "GHS"));
        }

        @ParameterizedTest(name = "GHS {0} into {1} parts sums back exactly")
        @CsvSource({
                "0.01, 3", "0.02, 3", "10.00, 3", "10.00, 7", "1000.00, 3",
                "1234.56, 7", "99.99, 4", "0.05, 6", "5000.00, 12",
        })
        @DisplayName("the sum of the parts always equals the original")
        void allocationIsLossless(String amount, int parts) {
            Money original = Money.of(amount, "GHS");
            List<Money> split = original.allocate(parts);

            assertThat(split).hasSize(parts);
            assertThat(sum(split))
                    .as("Allocating %s into %d parts must lose nothing", amount, parts)
                    .isEqualTo(original);
        }

        @Test
        @DisplayName("a term fee split unevenly across terms still sums to the annual fee")
        void weightedAllocationIsLossless() {
            // A real case: an annual fee apportioned across three terms of unequal length.
            Money annual = Money.of("3000.00", "GHS");
            List<Money> terms = annual.allocateByWeights(
                    List.of(new BigDecimal("13"), new BigDecimal("12"), new BigDecimal("14")),
                    RoundingMode.HALF_UP);

            assertThat(terms).hasSize(3);
            assertThat(sum(terms))
                    .as("Term fees must add up to the annual fee exactly")
                    .isEqualTo(annual);
        }

        @Test
        @DisplayName("one payment spread across invoices by outstanding balance loses nothing")
        void paymentAllocationAcrossInvoices() {
            Money payment = Money.of("1000.00", "GHS");
            List<Money> allocated = payment.allocateByWeights(
                    List.of(new BigDecimal("450.00"), new BigDecimal("275.50"),
                            new BigDecimal("274.50")),
                    RoundingMode.HALF_UP);

            assertThat(sum(allocated)).isEqualTo(payment);
        }

        @Test
        @DisplayName("allocating zero parts is rejected")
        void zeroPartsRejected() {
            assertThatThrownBy(() -> Money.of("10.00", "GHS").allocate(0))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        @DisplayName("weights summing to zero are rejected")
        void zeroWeightsRejected() {
            assertThatThrownBy(() -> Money.of("10.00", "GHS")
                    .allocateByWeights(List.of(BigDecimal.ZERO, BigDecimal.ZERO),
                            RoundingMode.HALF_UP))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Nested
    @DisplayName("equality and presentation")
    class EqualityAndPresentation {

        @Test
        @DisplayName("equal amounts written differently are equal, and hash alike")
        void equalityIgnoresInputFormatting() {
            Money a = Money.of("100.00", "GHS");
            Money b = Money.of("100.0000", "GHS");

            assertThat(a).isEqualTo(b);
            assertThat(a.hashCode())
                    .as("equals and hashCode must agree, or Money breaks inside a HashMap")
                    .isEqualTo(b.hashCode());
        }

        @Test
        @DisplayName("the same number in different currencies is not equal")
        void differentCurrenciesAreNotEqual() {
            assertThat(Money.of("100.00", "GHS")).isNotEqualTo(Money.of("100.00", "USD"));
        }

        @Test
        @DisplayName("display rounds to the currency's own fraction digits")
        void displayUsesCurrencyScale() {
            assertThat(Money.of("1234.5678", "GHS").forDisplay())
                    .isEqualByComparingTo(new BigDecimal("1234.57"));
            // JPY has no minor unit, so presentation is whole yen.
            assertThat(Money.of("1234.5678", "JPY").forDisplay())
                    .isEqualByComparingTo(new BigDecimal("1235"));
        }

        @Test
        @DisplayName("a zero-decimal currency still allocates without loss")
        void zeroDecimalCurrencyAllocates() {
            Money yen = Money.of("100.0000", "JPY");
            List<Money> parts = yen.allocate(3);
            assertThat(sum(parts)).isEqualTo(yen);
            assertThat(parts).containsExactly(
                    Money.of("34.0000", "JPY"),
                    Money.of("33.0000", "JPY"),
                    Money.of("33.0000", "JPY"));
        }

        @Test
        @DisplayName("toString is unambiguous about currency")
        void toStringIncludesCurrency() {
            assertThat(Money.of("1500.50", "GHS")).hasToString("GHS 1500.50");
        }
    }

    private static Money sum(List<Money> parts) {
        return parts.stream().reduce(Money::plus).orElseThrow();
    }
}
