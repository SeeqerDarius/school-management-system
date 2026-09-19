package io.sankofa.school.school.domain;

import io.sankofa.school.platform.error.ApiException;

import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A school's brand colour, and the contrast arithmetic that keeps it usable.
 *
 * <p>§94 requires that a school-chosen colour either passes accessibility checks or is
 * constrained to accessible usage. The approach here is the second, and it matters which:
 * rejecting a school's actual brand colour because it happens to be a mid-tone green is both
 * rude and futile — they will pick something close and wrong, or give up.
 *
 * <h2>Where a brand colour can and cannot fail</h2>
 * These are different problems and only one of them needs a guard.
 *
 * <p><b>As a background</b> — a button, a header band, a report-card masthead — the colour never
 * fails, because we choose the text colour to go on it. That is not optimism, it is arithmetic:
 * contrast against white falls as luminance rises while contrast against black rises, and the two
 * curves cross at luminance ≈0.179 where <em>both</em> read 4.58:1. So the worst case for
 * {@link #bestInkContrast()} over every colour in sRGB is 4.58, which clears AA's 4.5. There is
 * no unusable band, and therefore no rejection here — an earlier version of this class had one,
 * and it was unreachable code that a test caught.
 *
 * <p><b>As text or an icon on the application's own surface</b> the colour absolutely can fail,
 * and commonly does: a light brand yellow as link text on white is unreadable. That is the case
 * {@link #requireUsableAsForeground} guards, and it is the one §94 is really about.
 *
 * <p>The arithmetic is WCAG 2.2's relative luminance and contrast ratio, implemented directly.
 * It is twenty lines and exact; pulling in a dependency for it would be worse.
 */
public record BrandColor(int red, int green, int blue) {

    private static final Pattern HEX = Pattern.compile("^#([0-9A-Fa-f]{6})$");

    /** WCAG 2.2 AA for normal-size text. */
    public static final double AA_NORMAL_TEXT = 4.5;

    /** WCAG 2.2 AA for large text and for UI component boundaries. */
    public static final double AA_LARGE_TEXT = 3.0;

    private static final BrandColor WHITE = new BrandColor(255, 255, 255);
    private static final BrandColor BLACK = new BrandColor(0, 0, 0);

    public BrandColor {
        if (outOfRange(red) || outOfRange(green) || outOfRange(blue)) {
            throw new IllegalArgumentException("Colour channels must be between 0 and 255");
        }
    }

    /**
     * Parses {@code #RRGGBB}.
     *
     * @param field the request field being validated, so the error lands on the right input
     */
    public static BrandColor parse(String hex, String field) {
        if (hex == null || !HEX.matcher(hex.trim()).matches()) {
            throw ApiException.validation("That is not a valid colour",
                    Map.of(field, "must be a hex colour such as #1F5B8F"));
        }
        String digits = hex.trim().substring(1);
        return new BrandColor(
                Integer.parseInt(digits.substring(0, 2), 16),
                Integer.parseInt(digits.substring(2, 4), 16),
                Integer.parseInt(digits.substring(4, 6), 16));
    }

    public String toHex() {
        return String.format(Locale.ROOT, "#%02X%02X%02X", red, green, blue);
    }

    /**
     * WCAG relative luminance.
     *
     * <p>Not simple brightness: the channels are weighted for how the eye actually perceives
     * them — green contributes roughly ten times what blue does — and each is linearised first,
     * because sRGB values are gamma-encoded.
     */
    public double relativeLuminance() {
        return 0.2126 * linearise(red) + 0.7152 * linearise(green) + 0.0722 * linearise(blue);
    }

    private static double linearise(int channel) {
        double c = channel / 255.0;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    /** Contrast ratio against another colour, between 1.0 (identical) and 21.0 (black on white). */
    public double contrastRatio(BrandColor other) {
        double a = relativeLuminance();
        double b = other.relativeLuminance();
        double lighter = Math.max(a, b);
        double darker = Math.min(a, b);
        return (lighter + 0.05) / (darker + 0.05);
    }

    /**
     * The text colour to use on top of this one.
     *
     * <p>Whichever of black or white contrasts better. This is what makes a school's own colour
     * safe to use as a button or header background without anyone hand-checking it.
     */
    public BrandColor readableInk() {
        return contrastRatio(WHITE) >= contrastRatio(BLACK) ? WHITE : BLACK;
    }

    public double bestInkContrast() {
        return Math.max(contrastRatio(WHITE), contrastRatio(BLACK));
    }

    /**
     * Whether this colour is legible as text or an icon on {@code background}.
     *
     * <p>This is the check that can actually fail. A school whose brand is a light gold will
     * find it unreadable as link text on a white page, and no amount of choosing a partner
     * colour helps — the background is fixed by the application, not by us.
     */
    public boolean isUsableAsForeground(BrandColor background) {
        return contrastRatio(background) >= AA_NORMAL_TEXT;
    }

    /**
     * Rejects a colour that cannot be read as text on the given background.
     *
     * <p>The message tells the person what to do — go darker or lighter — rather than quoting a
     * ratio they have no way to evaluate. It also says where the colour <em>will</em> still be
     * used, because "your brand colour is rejected" and "your brand colour cannot be the link
     * colour" are very different messages to receive.
     */
    public void requireUsableAsForeground(BrandColor background, String field) {
        if (!isUsableAsForeground(background)) {
            boolean backgroundIsLight = background.relativeLuminance() > 0.5;
            throw ApiException.validation(
                    "That colour is not readable as text on a "
                            + (backgroundIsLight ? "light" : "dark") + " background. Try a "
                            + (backgroundIsLight ? "darker" : "lighter")
                            + " shade — it can still be used for buttons and headers, where the "
                            + "text colour is chosen to suit it.",
                    Map.of(field, String.format(Locale.ROOT,
                            "contrast is %.1f:1 against the page, and %.1f:1 is required",
                            contrastRatio(background), AA_NORMAL_TEXT)));
        }
    }

    /** The light surface this application renders on. Matches {@code --color-surface}. */
    public static BrandColor lightSurface() {
        return WHITE;
    }

    private static boolean outOfRange(int channel) {
        return channel < 0 || channel > 255;
    }
}
