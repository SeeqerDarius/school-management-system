package io.sankofa.school.platform.context;

/**
 * The correlation id for the unit of work in progress.
 *
 * <p>Deliberately <em>not</em> in the web package. A correlation id is cross-cutting context, not
 * an HTTP concern: a scheduled job, an outbox dispatch and a CLI task all need one, and none of
 * them has a servlet request. Keeping the holder here means the audit log and the notification
 * dispatcher can read it without depending on the web layer — which the module boundary tests
 * enforce, and which is how this class came to exist.
 *
 * <p>{@code CorrelationIdFilter} populates it for HTTP requests. Background work sets it through
 * {@link #runWith}.
 */
public final class CorrelationId {

    private static final String ABSENT = "no-correlation-id";

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private CorrelationId() {
    }

    /** The current id, or a stable placeholder outside any unit of work. */
    public static String current() {
        String value = CURRENT.get();
        return value == null ? ABSENT : value;
    }

    public static void bind(String correlationId) {
        CURRENT.set(correlationId);
    }

    public static void clear() {
        CURRENT.remove();
    }

    /**
     * Runs {@code action} under an explicit correlation id, restoring whatever was bound before.
     *
     * <p>The supported way for a background job to carry the id of the request that queued its
     * work, so a notification can be traced back to the transaction that produced it.
     */
    public static <T> T runWith(String correlationId, CorrelatedTask<T> action) throws Exception {
        String previous = CURRENT.get();
        CURRENT.set(correlationId);
        try {
            return action.run();
        } finally {
            if (previous == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(previous);
            }
        }
    }

    @FunctionalInterface
    public interface CorrelatedTask<T> {
        T run() throws Exception;
    }
}
