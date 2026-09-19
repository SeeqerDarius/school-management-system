package io.sankofa.school.school.domain;

import io.sankofa.school.platform.error.ApiException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

/**
 * Contrast arithmetic, checked against values WCAG itself publishes.
 *
 * <p>Worth testing carefully rather than eyeballing: an off-by-a-gamma-curve error here would
 * silently approve unreadable colour pairs, and the failure would only be discovered by someone
 * who could not read the screen.
 */
class BrandColorTest {

    @Nested
    @DisplayName("parsing")
    class Parsing {

        @ParameterizedTest
        @ValueSource(strings = {"#1F5B8F", "#000000", "#FFFFFF", "#ffffff", "  #A62020  "})
        @DisplayName("accepts six-digit hex, any case, with surrounding space")
        void acceptsValidHex(String input) {
            assertThatCode(() -> BrandColor.parse(input, "primaryColor"))
                    .doesNotThrowAnyException();
        }

        @ParameterizedTest
        @ValueSource(strings = {"1F5B8F", "#FFF", "#GGGGGG", "#1F5B8F0", "blue", "", "#"})
        @DisplayName("rejects anything else, naming the field")
        void rejectsInvalidHex(String input) {
            assertThatThrownBy(() -> BrandColor.parse(input, "primaryColor"))
                    .isInstanceOf(ApiException.class)
                    .satisfies(e -> assertThat(((ApiException) e).fieldErrors())
                            .containsKey("primaryColor"));
        }

        @Test
        @DisplayName("null is rejected rather than defaulted")
        void rejectsNull() {
            assertThatThrownBy(() -> BrandColor.parse(null, "accentColor"))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        @DisplayName("round-trips to canonical uppercase hex")
        void roundTrips() {
            assertThat(BrandColor.parse("#1f5b8f", "c").toHex()).isEqualTo("#1F5B8F");
        }
    }

    @Nested
    @DisplayName("contrast")
    class Contrast {

        @Test
        @DisplayName("black on white is 21:1, the maximum the scale allows")
        void blackOnWhiteIsMaximum() {
            BrandColor black = BrandColor.parse("#000000", "c");
            BrandColor white = BrandColor.parse("#FFFFFF", "c");

            assertThat(black.contrastRatio(white)).isCloseTo(21.0, within(0.01));
        }

        @Test
        @DisplayName("a colour against itself is 1:1")
        void identicalColoursHaveNoContrast() {
            BrandColor colour = BrandColor.parse("#1F5B8F", "c");
            assertThat(colour.contrastRatio(colour)).isCloseTo(1.0, within(0.001));
        }

        @Test
        @DisplayName("contrast is symmetric")
        void contrastIsSymmetric() {
            BrandColor a = BrandColor.parse("#1F5B8F", "c");
            BrandColor b = BrandColor.parse("#FFFFFF", "c");

            assertThat(a.contrastRatio(b)).isCloseTo(b.contrastRatio(a), within(0.0001));
        }

        @ParameterizedTest(name = "{0} on white is about {1}:1")
        @CsvSource({
                // Reference values from the WCAG contrast formula. Chosen to span the range
                // rather than to be convenient: a dark brand navy, a mid blue, a light grey.
                "#000000, 21.00",
                "#595959,  7.00",
                "#767676,  4.54",
                "#FFFFFF,  1.00",
        })
        @DisplayName("matches published reference ratios against white")
        void matchesReferenceRatios(String hex, double expected) {
            BrandColor colour = BrandColor.parse(hex, "c");
            BrandColor white = BrandColor.parse("#FFFFFF", "c");

            assertThat(colour.contrastRatio(white)).isCloseTo(expected, within(0.05));
        }

        @Test
        @DisplayName("luminance is perceptual, not a channel average")
        void luminanceIsPerceptual() {
            // Pure green is far brighter to the eye than pure blue, despite identical channel
            // magnitude. A naive (r+g+b)/3 would rate them the same and approve unreadable pairs.
            double green = BrandColor.parse("#00FF00", "c").relativeLuminance();
            double blue = BrandColor.parse("#0000FF", "c").relativeLuminance();

            assertThat(green).isGreaterThan(blue * 5);
        }
    }

    @Nested
    @DisplayName("usability as a background")
    class Usability {

        @ParameterizedTest(name = "{0} takes {1} text")
        @CsvSource({
                "#1F5B8F, #FFFFFF",
                "#000000, #FFFFFF",
                "#FFFFFF, #000000",
                "#FFE066, #000000",
        })
        @DisplayName("picks the readable text colour for a background")
        void picksReadableInk(String background, String expectedInk) {
            BrandColor colour = BrandColor.parse(background, "c");
            assertThat(colour.readableInk().toHex()).isEqualTo(expectedInk);
        }

        @ParameterizedTest
        @ValueSource(strings = {
                "#1F5B8F", "#A62020", "#17734A", "#FFFFFF", "#000000",
                "#FFE066", "#808080", "#7F7F80", "#767676", "#797979"})
        @DisplayName("no colour is ever unusable as a background")
        void everyColourWorksAsABackground(String hex) {
            // Not optimism — arithmetic. Contrast against white falls as luminance rises while
            // contrast against black rises, and the curves cross at ≈4.58:1, above AA's 4.5.
            // The values above bracket that crossover deliberately.
            BrandColor colour = BrandColor.parse(hex, "primaryColor");
            assertThat(colour.bestInkContrast()).isGreaterThanOrEqualTo(BrandColor.AA_NORMAL_TEXT);
        }

        @Test
        @DisplayName("the worst case across the whole sRGB greyscale still clears AA")
        void worstCaseAcrossGreyscaleClearsAa() {
            // Sweeps the axis the crossover lies on. If a future change to the luminance
            // formula introduced an unusable band, this is what would catch it.
            double worst = Double.MAX_VALUE;
            String worstHex = null;
            for (int v = 0; v <= 255; v++) {
                BrandColor grey = new BrandColor(v, v, v);
                if (grey.bestInkContrast() < worst) {
                    worst = grey.bestInkContrast();
                    worstHex = grey.toHex();
                }
            }

            assertThat(worst)
                    .as("worst case was %s at %.2f:1", worstHex, worst)
                    .isGreaterThanOrEqualTo(BrandColor.AA_NORMAL_TEXT)
                    .isLessThan(5.0);
        }
    }

    @Nested
    @DisplayName("usability as text on the page")
    class Foreground {

        private static final BrandColor PAGE = BrandColor.parse("#FFFFFF", "c");

        @ParameterizedTest
        @ValueSource(strings = {"#1F5B8F", "#A62020", "#17734A", "#000000"})
        @DisplayName("a sufficiently dark brand colour works as link text on a light page")
        void darkBrandColoursWorkAsText(String hex) {
            BrandColor colour = BrandColor.parse(hex, "accentColor");
            assertThat(colour.isUsableAsForeground(PAGE)).isTrue();
            assertThatCode(() -> colour.requireUsableAsForeground(PAGE, "accentColor"))
                    .doesNotThrowAnyException();
        }

        @ParameterizedTest
        @ValueSource(strings = {"#FFE066", "#AAAAAA", "#7ED0FF", "#FFFFFF"})
        @DisplayName("a light brand colour is refused as text, with advice rather than a ratio")
        void lightBrandColoursAreRefusedAsText(String hex) {
            // This is the failure §94 is really about: a light gold as link text on white.
            BrandColor colour = BrandColor.parse(hex, "accentColor");

            assertThat(colour.isUsableAsForeground(PAGE)).isFalse();
            assertThatThrownBy(() -> colour.requireUsableAsForeground(PAGE, "accentColor"))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("not readable as text")
                    .hasMessageContaining("darker")
                    // "Rejected" and "cannot be the link colour" are very different messages.
                    .hasMessageContaining("buttons and headers");
        }

        @Test
        @DisplayName("the advice flips for a dark page")
        void adviceFlipsForDarkBackground() {
            BrandColor darkPage = BrandColor.parse("#111820", "c");
            BrandColor darkNavy = BrandColor.parse("#1F2B3A", "accentColor");

            assertThatThrownBy(() -> darkNavy.requireUsableAsForeground(darkPage, "accentColor"))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("dark background")
                    .hasMessageContaining("lighter");
        }

        @Test
        @DisplayName("the light surface constant matches the design token")
        void lightSurfaceMatchesToken() {
            // --color-surface in globals.css. If the palette changes, this should fail rather
            // than validate brand colours against a page that no longer exists.
            assertThat(BrandColor.lightSurface().toHex()).isEqualTo("#FFFFFF");
        }
    }
}
