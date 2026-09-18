package io.sankofa.school.platform.id;

import com.github.f4b6a3.uuid.UuidCreator;

import java.util.UUID;

/**
 * Identifier generation.
 *
 * <p>Every primary key in this system is a UUIDv7: time-ordered, so B-tree inserts stay at the
 * right edge of the index instead of scattering writes across the whole page range the way
 * UUIDv4 does, and non-sequential in public, so one tenant cannot enumerate another's records
 * by counting upward from an id it was legitimately given.
 *
 * <p>Human-facing references ({@code STU-2026-000123}, {@code REC-2026-000932}) are a separate
 * concern and are allocated by {@code platform.next_reference()} in the database, which takes a
 * row lock so two cashiers cannot mint the same receipt number.
 *
 * @see io.sankofa.school.platform.id.ReferenceNumberService
 */
public final class Ids {

    private Ids() {
    }

    /** A fresh time-ordered identifier for a new aggregate. */
    public static UUID newId() {
        return UuidCreator.getTimeOrderedEpoch();
    }

    /**
     * Parses an identifier received from outside the process.
     *
     * <p>Returns {@code null} rather than throwing, because a malformed id in a path variable is
     * a client error to be turned into a 400, not an exception to propagate. Callers decide.
     */
    public static UUID parseOrNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value.trim());
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }
}
