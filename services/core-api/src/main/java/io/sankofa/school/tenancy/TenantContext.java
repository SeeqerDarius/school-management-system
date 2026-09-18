package io.sankofa.school.tenancy;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * The resolved security context for one request.
 *
 * <p>Invariant I-1: every field here is derived from a <em>verified</em> membership. Nothing in
 * this object may originate from a request header, body, query parameter or subdomain. The
 * subdomain is a routing hint for the UI; the effective tenant is the tenant of the membership
 * that the authenticated principal actually holds.
 *
 * <p>Two shapes exist:
 * <ul>
 *   <li><b>Tenant scope</b> — {@code tenantId} present, {@code platformScope} false. The normal
 *       case. Row Level Security confines every query to this tenant.</li>
 *   <li><b>Platform scope</b> — {@code tenantId} absent, {@code platformScope} true. Used only by
 *       the Platform Super Admin workspace, which operates on the tenant registry and the
 *       aggregate usage counters. It deliberately cannot read a school's student rows: there is
 *       no platform bypass policy on tenant-owned tables (§105).</li>
 * </ul>
 *
 * @param userId       the authenticated principal
 * @param tenantId     the active tenant, or {@code null} in platform scope
 * @param membershipId the membership this request is acting through, or {@code null}
 * @param permissions  effective permission codes, already resolved (ALLOW minus DENY)
 * @param platformScope whether this request acts in Platform Super Admin scope
 * @param supportGrantId the support access grant in force, when platform support is operating
 *                       inside a tenant with the school's visibility (§74); otherwise null
 */
public record TenantContext(
        UUID userId,
        UUID tenantId,
        UUID membershipId,
        Set<String> permissions,
        boolean platformScope,
        UUID supportGrantId) {

    public TenantContext {
        permissions = permissions == null ? Set.of() : Set.copyOf(permissions);
        if (platformScope && tenantId != null) {
            throw new IllegalArgumentException(
                    "A context cannot be platform-scoped and tenant-scoped at once");
        }
    }

    public static TenantContext ofTenant(UUID userId, UUID tenantId, UUID membershipId,
                                         Set<String> permissions) {
        Objects.requireNonNull(userId, "userId");
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(membershipId, "membershipId");
        return new TenantContext(userId, tenantId, membershipId, permissions, false, null);
    }

    public static TenantContext ofPlatform(UUID userId, Set<String> permissions) {
        Objects.requireNonNull(userId, "userId");
        return new TenantContext(userId, null, null, permissions, true, null);
    }

    /**
     * Platform support acting inside a tenant under a time-boxed, reasoned grant.
     *
     * <p>This is tenant-scoped, not platform-scoped: support sees exactly what the grant's
     * permission list allows and nothing more, and every action carries the grant id into the
     * audit trail.
     */
    public static TenantContext ofSupport(UUID userId, UUID tenantId, UUID membershipId,
                                          Set<String> permissions, UUID supportGrantId) {
        Objects.requireNonNull(supportGrantId, "supportGrantId");
        return new TenantContext(userId, tenantId, membershipId, permissions, false, supportGrantId);
    }

    public boolean has(String permissionCode) {
        return permissions.contains(permissionCode);
    }

    public boolean hasAny(String... permissionCodes) {
        for (String code : permissionCodes) {
            if (permissions.contains(code)) {
                return true;
            }
        }
        return false;
    }

    /**
     * The tenant id, or a failure. Use this wherever a tenant is genuinely required, so the
     * absence of one surfaces as a clear error instead of a null propagating into a query.
     */
    public UUID requireTenantId() {
        if (tenantId == null) {
            throw new IllegalStateException(
                    "No tenant bound to this request; a tenant-scoped operation was attempted "
                            + "in platform scope");
        }
        return tenantId;
    }

    public boolean isSupportSession() {
        return supportGrantId != null;
    }
}
