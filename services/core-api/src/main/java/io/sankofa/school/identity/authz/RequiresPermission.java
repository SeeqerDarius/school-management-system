package io.sankofa.school.identity.authz;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares the granular permission a method requires.
 *
 * <p>This is the <em>only</em> way authorization is expressed in this codebase. There are no role
 * name comparisons scattered through services (§11), because a role is a bundle that a school can
 * redefine, while a permission code is a stable capability that the code can reason about.
 *
 * <pre>
 * &#64;RequiresPermission(Permissions.GRADE_APPROVE)
 * public void approve(UUID resultSetId) { ... }
 * </pre>
 *
 * <p>Hiding a navigation item is not authorization (§98). This annotation is what actually
 * decides, and it runs on the server regardless of what the browser chose to render.
 *
 * @see PermissionAspect
 * @see Permissions
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RequiresPermission {

    /**
     * Permission codes. The principal must hold at least one when {@link #mode()} is
     * {@link Mode#ANY}, or all of them when it is {@link Mode#ALL}.
     */
    String[] value();

    Mode mode() default Mode.ANY;

    /**
     * Whether this action must be recorded in the audit log with a caller-supplied reason (§188).
     * Applies to grade overrides, refunds, journal reversals, permission escalation and the like.
     */
    boolean requiresReason() default false;

    enum Mode {
        ANY,
        ALL
    }
}
