package io.sankofa.school.school.domain;

import java.time.LocalDate;
import java.util.UUID;

/**
 * A physical site belonging to one tenant (§138).
 *
 * <p>Every tenant has at least one, including the single-site schools that will never think
 * about the concept. Modelling "one campus" as a degenerate case of "many" rather than as a
 * separate shape means the multi-campus school needs no different code path, and the
 * single-campus school pays nothing for the generality.
 */
public record Campus(
        UUID id,
        UUID tenantId,
        String code,
        String name,
        boolean main,
        CampusStatus status,
        Address address,
        String phoneE164,
        String email,
        String timezone,
        LocalDate openedOn,
        LocalDate closedOn,
        long version) {

    public enum CampusStatus {
        /** Operating. */
        ACTIVE,
        /** Temporarily not operating; records retained and visible. */
        INACTIVE,
        /**
         * Permanently closed. Historical records are never destroyed — a campus closing does
         * not erase the academic history of everyone who attended it (§82).
         */
        CLOSED;

        public static CampusStatus of(String value) {
            try {
                return valueOf(value);
            } catch (IllegalArgumentException | NullPointerException e) {
                throw new IllegalStateException("Unknown campus status in database: " + value, e);
            }
        }
    }

    /**
     * A postal address.
     *
     * <p>Kept loose on purpose. Address formats differ enough between Ghana, the UK and the Gulf
     * that a rigid schema would force bad data into the wrong fields; the structured parts that
     * reporting actually groups by — city, region, country — are the ones named explicitly.
     */
    public record Address(
            String line1,
            String line2,
            String city,
            String region,
            String postalCode,
            String countryCode) {

        public static final Address EMPTY = new Address(null, null, null, null, null, null);

        public boolean isEmpty() {
            return line1 == null && line2 == null && city == null
                    && region == null && postalCode == null && countryCode == null;
        }
    }
}
