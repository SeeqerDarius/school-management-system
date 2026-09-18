package io.sankofa.school.identity.authz;

import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;
import io.sankofa.school.tenancy.TenantContext;
import io.sankofa.school.tenancy.TenantContextHolder;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;
import java.util.Arrays;

/**
 * Enforces {@link RequiresPermission}.
 *
 * <p>Runs before the transactional advice, so an unauthorized call never opens a transaction and
 * never touches a row. Ordering matters here: if this ran inside the transaction, a denied write
 * would still have taken locks.
 *
 * <p>A missing {@link TenantContext} is treated as a denial, not as a pass. The failure mode of
 * "no context so let it through" is exactly the bug this class exists to prevent.
 */
@Aspect
@Component
@Order(0)
public class PermissionAspect {

    private static final Logger log = LoggerFactory.getLogger(PermissionAspect.class);

    @Around("@annotation(io.sankofa.school.identity.authz.RequiresPermission) "
            + "|| @within(io.sankofa.school.identity.authz.RequiresPermission)")
    public Object enforce(ProceedingJoinPoint joinPoint) throws Throwable {
        Method method = ((MethodSignature) joinPoint.getSignature()).getMethod();

        RequiresPermission required = AnnotatedElementUtils.findMergedAnnotation(
                method, RequiresPermission.class);
        if (required == null) {
            required = AnnotatedElementUtils.findMergedAnnotation(
                    method.getDeclaringClass(), RequiresPermission.class);
        }
        if (required == null) {
            return joinPoint.proceed();
        }

        TenantContext context = TenantContextHolder.current().orElse(null);
        if (context == null) {
            // Fail closed. An unauthenticated path reaching a guarded method is a routing defect,
            // and the correct response is a denial plus a loud log line — never a quiet pass.
            log.error("Guarded method {}.{} invoked with no TenantContext bound",
                    method.getDeclaringClass().getSimpleName(), method.getName());
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Authentication is required");
        }

        String[] codes = required.value();
        boolean permitted = required.mode() == RequiresPermission.Mode.ALL
                ? Arrays.stream(codes).allMatch(context::has)
                : Arrays.stream(codes).anyMatch(context::has);

        if (!permitted) {
            log.info("Permission denied: user={} tenant={} needed={} mode={} method={}.{}",
                    context.userId(), context.tenantId(), Arrays.toString(codes), required.mode(),
                    method.getDeclaringClass().getSimpleName(), method.getName());
            throw ApiException.forbidden(String.join(",", codes));
        }

        return joinPoint.proceed();
    }
}
