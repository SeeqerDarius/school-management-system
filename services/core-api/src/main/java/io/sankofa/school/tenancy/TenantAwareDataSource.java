package io.sankofa.school.tenancy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.datasource.DelegatingDataSource;

import javax.sql.DataSource;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/**
 * Binds the request's {@link TenantContext} to the PostgreSQL session behind every connection.
 *
 * <p>This is the second half of Invariant I-1. The application layer adds a tenant predicate to
 * every query; this class makes the database enforce the same thing independently, so that one
 * forgotten {@code WHERE tenant_id = ?} is a failed query rather than a cross-tenant disclosure.
 *
 * <h2>How it works</h2>
 * On checkout, the session variables {@code app.tenant_id}, {@code app.user_id} and
 * {@code app.platform_scope} are set on the connection. Row Level Security policies read them via
 * {@code platform.current_tenant_id()}. On close, they are cleared before the connection returns
 * to the pool.
 *
 * <h2>Why settings are applied on every checkout, not only when a tenant is present</h2>
 * A pooled connection is reused. If a connection were handed back still carrying School A's
 * tenant id and the next borrower did not overwrite it, School B's request would silently read
 * School A's rows. So the values are written unconditionally on every checkout — with an empty
 * string when there is no tenant — and cleared again on close. Either mechanism alone would be
 * sufficient; both together mean a single failure does not produce a leak.
 *
 * <p>Because {@code platform.current_tenant_id()} <em>raises</em> on an empty value rather than
 * returning null, a query that reaches the database without a tenant fails loudly instead of
 * returning every tenant's rows.
 *
 * <h2>The role matters</h2>
 * The runtime role must not be a superuser and must not hold {@code BYPASSRLS}. A superuser
 * ignores Row Level Security unconditionally, which would make this class — and every
 * tenant-isolation test — silently useless. {@code TenantIsolationIT} asserts the effective
 * role's attributes for exactly this reason.
 */
public class TenantAwareDataSource extends DelegatingDataSource {

    private static final Logger log = LoggerFactory.getLogger(TenantAwareDataSource.class);

    private static final String APPLY_SQL =
            "SELECT set_config('app.tenant_id', ?, false), "
                    + "set_config('app.user_id', ?, false), "
                    + "set_config('app.platform_scope', ?, false)";

    private static final String CLEAR_SQL =
            "SELECT set_config('app.tenant_id', '', false), "
                    + "set_config('app.user_id', '', false), "
                    + "set_config('app.platform_scope', 'false', false)";

    public TenantAwareDataSource(DataSource delegate) {
        super(delegate);
    }

    @Override
    public Connection getConnection() throws SQLException {
        return wrap(super.getConnection());
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        return wrap(super.getConnection(username, password));
    }

    private Connection wrap(Connection connection) throws SQLException {
        try {
            applyContext(connection);
        } catch (SQLException | RuntimeException e) {
            // Never hand out a connection whose tenant binding we could not establish: it might
            // still carry the previous borrower's tenant.
            closeQuietly(connection);
            throw e;
        }
        return (Connection) Proxy.newProxyInstance(
                Connection.class.getClassLoader(),
                new Class<?>[]{Connection.class},
                new ResettingConnectionHandler(connection));
    }

    private static void applyContext(Connection connection) throws SQLException {
        TenantContext ctx = TenantContextHolder.current().orElse(null);

        String tenantId = ctx == null || ctx.tenantId() == null ? "" : ctx.tenantId().toString();
        String userId = ctx == null || ctx.userId() == null ? "" : ctx.userId().toString();
        String platformScope = ctx != null && ctx.platformScope() ? "true" : "false";

        try (PreparedStatement ps = connection.prepareStatement(APPLY_SQL)) {
            ps.setString(1, tenantId);
            ps.setString(2, userId);
            ps.setString(3, platformScope);
            ps.execute();
        }
    }

    private static void clearContext(Connection connection) {
        try {
            if (connection.isClosed()) {
                return;
            }
            try (PreparedStatement ps = connection.prepareStatement(CLEAR_SQL)) {
                ps.execute();
            }
        } catch (SQLException e) {
            // The connection is on its way back to the pool. Failing to clear is not fatal —
            // the next checkout overwrites these values — but it is worth knowing about, because
            // it usually means the connection is broken.
            log.warn("Could not clear tenant session variables before returning connection "
                    + "to the pool; the next checkout will overwrite them", e);
        }
    }

    private static void closeQuietly(Connection connection) {
        try {
            connection.close();
        } catch (SQLException e) {
            log.debug("Failed to close connection after a context-binding failure", e);
        }
    }

    /**
     * Clears the session variables immediately before the connection goes back to the pool.
     */
    private record ResettingConnectionHandler(Connection target) implements InvocationHandler {

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            switch (method.getName()) {
                case "close" -> {
                    clearContext(target);
                    target.close();
                    return null;
                }
                case "equals" -> {
                    return proxy == args[0];
                }
                case "hashCode" -> {
                    return System.identityHashCode(proxy);
                }
                case "unwrap" -> {
                    Class<?> iface = (Class<?>) args[0];
                    if (iface.isInstance(target)) {
                        return target;
                    }
                }
                default -> {
                    // fall through to delegation
                }
            }
            try {
                return method.invoke(target, args);
            } catch (InvocationTargetException e) {
                throw e.getTargetException();
            }
        }
    }
}
