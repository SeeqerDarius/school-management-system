package io.sankofa.school.identity.authz;

import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;
import io.sankofa.school.tenancy.TenantContext;
import io.sankofa.school.tenancy.TenantContextHolder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The permission matrix test required by AGENTS.md §7: every rule asserts <b>both</b> the allow
 * and the deny. A test that only proves the happy path would still pass if the aspect let
 * everything through, which is the one failure mode that matters.
 *
 * <p>Uses a real AspectJ proxy rather than a Spring context, so the advice under test is the same
 * advice that runs in production, without a two-second context startup.
 */
class PermissionAspectTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID MEMBERSHIP = UUID.randomUUID();

    @AfterEach
    void clearContext() {
        TenantContextHolder.clear();
    }

    // ===================================================================================

    @Nested
    @DisplayName("single permission")
    class SinglePermission {

        @Test
        @DisplayName("a holder of the permission is allowed through")
        void allowsHolder() {
            bind(Permissions.GRADE_APPROVE);
            assertThat(guarded().approveResults()).isEqualTo("approved");
        }

        @Test
        @DisplayName("a principal without the permission is refused")
        void refusesNonHolder() {
            // A teacher may enter and submit marks but must not approve them: the segregation
            // that stops one person marking and signing off their own work (spec 134).
            bind(Permissions.GRADE_ENTER, Permissions.GRADE_SUBMIT);

            assertThatThrownBy(() -> guarded().approveResults())
                    .isInstanceOf(ApiException.class)
                    .satisfies(e -> {
                        ApiException api = (ApiException) e;
                        assertThat(api.code()).isEqualTo(ErrorCode.FORBIDDEN);
                        assertThat(api.fieldErrors())
                                .containsEntry("requiredPermission", Permissions.GRADE_APPROVE);
                    });
        }

        @Test
        @DisplayName("holding many unrelated permissions does not substitute for the right one")
        void breadthIsNotDepth() {
            bind(Permissions.STUDENT_VIEW, Permissions.ATTENDANCE_MARK,
                    Permissions.LIBRARY_VIEW, Permissions.FEES_VIEW, Permissions.TIMETABLE_VIEW);
            assertThatThrownBy(() -> guarded().approveResults())
                    .isInstanceOf(ApiException.class);
        }
    }

    @Nested
    @DisplayName("fail closed")
    class FailClosed {

        @Test
        @DisplayName("no bound context is a denial, never a pass")
        void noContextIsDenied() {
            TenantContextHolder.clear();

            // The dangerous bug this guards: treating "no context" as "no restriction". A
            // guarded method reached without authentication must refuse.
            assertThatThrownBy(() -> guarded().approveResults())
                    .isInstanceOf(ApiException.class)
                    .satisfies(e -> assertThat(((ApiException) e).code())
                            .isEqualTo(ErrorCode.UNAUTHENTICATED));
        }

        @Test
        @DisplayName("an empty permission set is a denial")
        void emptyPermissionsDenied() {
            bind();
            assertThatThrownBy(() -> guarded().approveResults())
                    .isInstanceOf(ApiException.class);
        }
    }

    @Nested
    @DisplayName("ANY and ALL modes")
    class Modes {

        @Test
        @DisplayName("ANY passes when the principal holds one of the listed permissions")
        void anyNeedsOnlyOne() {
            bind(Permissions.PAYSLIP_VIEW_OWN);
            assertThat(guarded().viewPayslip()).isEqualTo("payslip");
        }

        @Test
        @DisplayName("ANY refuses when the principal holds none of them")
        void anyRefusesWhenNoneHeld() {
            bind(Permissions.HR_STAFF_VIEW);
            assertThatThrownBy(() -> guarded().viewPayslip())
                    .isInstanceOf(ApiException.class);
        }

        @Test
        @DisplayName("ALL requires every listed permission")
        void allRequiresEvery() {
            // Posting payroll to the ledger needs both authorities. Holding one is not enough:
            // that is what makes maker-checker real rather than decorative (spec 158).
            bind(Permissions.PAYROLL_APPROVE);
            assertThatThrownBy(() -> guarded().postPayroll())
                    .isInstanceOf(ApiException.class);

            bind(Permissions.PAYROLL_POST);
            assertThatThrownBy(() -> guarded().postPayroll())
                    .isInstanceOf(ApiException.class);

            bind(Permissions.PAYROLL_APPROVE, Permissions.PAYROLL_POST);
            assertThat(guarded().postPayroll()).isEqualTo("posted");
        }
    }

    @Nested
    @DisplayName("unguarded methods")
    class Unguarded {

        @Test
        @DisplayName("a method with no annotation is not gated by the aspect")
        void unannotatedMethodPasses() {
            TenantContextHolder.clear();
            // Guarding is opt-in at the method level; the security filter chain decides whether
            // an endpoint is reachable at all.
            assertThat(guarded().publicInformation()).isEqualTo("public");
        }
    }

    // ===================================================================================

    private static void bind(String... permissions) {
        TenantContextHolder.bind(
                TenantContext.ofTenant(USER, TENANT, MEMBERSHIP, Set.of(permissions)));
    }

    private static GuardedService guarded() {
        AspectJProxyFactory factory = new AspectJProxyFactory(new GuardedService());
        factory.addAspect(new PermissionAspect());
        return factory.getProxy();
    }

    /** A stand-in for a real application service, carrying the same annotations one would. */
    static class GuardedService {

        @RequiresPermission(Permissions.GRADE_APPROVE)
        String approveResults() {
            return "approved";
        }

        @RequiresPermission({Permissions.PAYSLIP_VIEW_OWN, Permissions.PAYSLIP_VIEW_ALL})
        String viewPayslip() {
            return "payslip";
        }

        @RequiresPermission(
                value = {Permissions.PAYROLL_APPROVE, Permissions.PAYROLL_POST},
                mode = RequiresPermission.Mode.ALL)
        String postPayroll() {
            return "posted";
        }

        String publicInformation() {
            return "public";
        }
    }
}
