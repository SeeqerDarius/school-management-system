package io.sankofa.school.tenancy;

import java.util.Optional;

/**
 * Binds the {@link TenantContext} to the executing thread.
 *
 * <p>Deliberately not an inheritable thread local. A background job must establish its own
 * context explicitly via {@link #runAs}, because inheriting a request's tenant into an async
 * task is exactly how a job ends up writing one school's data into another's.
 */
public final class TenantContextHolder {

    private static final ThreadLocal<TenantContext> CURRENT = new ThreadLocal<>();

    private TenantContextHolder() {
    }

    public static Optional<TenantContext> current() {
        return Optional.ofNullable(CURRENT.get());
    }

    /**
     * The current context, or a failure.
     *
     * <p>Called from code that cannot meaningfully proceed without knowing who is acting. Failing
     * here is correct: the alternative is a query that runs unscoped.
     */
    public static TenantContext require() {
        TenantContext ctx = CURRENT.get();
        if (ctx == null) {
            throw new IllegalStateException(
                    "No TenantContext bound to this thread. Either the request bypassed "
                            + "TenantContextFilter, or a background task ran without runAs().");
        }
        return ctx;
    }

    /**
     * Binds a context for the current request.
     *
     * <p>Intended for the authentication filter, which is the one place a request's identity is
     * established. Everywhere else — background jobs, outbox dispatch, tests — should use
     * {@link #runAs}, which restores the previous context on the way out and therefore cannot
     * leave a tenant bound to a thread that has moved on to other work.
     *
     * <p>Every call to this method must be paired with {@link #clear()} in a {@code finally}.
     */
    public static void bind(TenantContext context) {
        CURRENT.set(context);
    }

    /**
     * Unbinds the current context. Must run even when the request failed, because the thread
     * returns to the container's pool and would otherwise carry one school's tenant into
     * whichever request lands on it next.
     */
    public static void clear() {
        CURRENT.remove();
    }

    /**
     * Runs {@code action} under an explicit context, restoring whatever was bound before.
     *
     * <p>The only supported way for a scheduled job, an outbox dispatch or a test to act on
     * behalf of a tenant.
     */
    public static <T> T runAs(TenantContext context, ContextualTask<T> action) throws Exception {
        TenantContext previous = CURRENT.get();
        CURRENT.set(context);
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
    public interface ContextualTask<T> {
        T run() throws Exception;
    }
}
