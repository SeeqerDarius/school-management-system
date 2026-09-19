package io.sankofa.school.architecture;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.library.Architectures.layeredArchitecture;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.fields;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noFields;

/**
 * Enforces the module boundaries that {@code docs/ARCHITECTURE.md} §3 describes.
 *
 * <p>A modular monolith only stays modular if something checks. Boundaries kept by convention
 * erode within a quarter — not through bad intent, but because reaching into another module's
 * repository is the shortest path to a working feature, and nothing pushes back at the moment
 * it happens. These tests are that push-back.
 *
 * <p>If one of these fails, the design is wrong, not the test (AGENTS.md §4). The fix is a
 * published facade or an outbox event, never an exclusion added here.
 */
@AnalyzeClasses(
        packages = "io.sankofa.school",
        importOptions = ImportOption.DoNotIncludeTests.class)
class ModuleBoundaryTest {

    /**
     * Domain modules. Everything that is not a shared kernel or the composition root.
     * New modules are added here as they land.
     */
    private static final String[] DOMAIN_PACKAGES = {
            "io.sankofa.school.identity..",
            "io.sankofa.school.school..",
            "io.sankofa.school.subscription..",
            "io.sankofa.school.admissions..",
            "io.sankofa.school.students..",
            "io.sankofa.school.guardians..",
            "io.sankofa.school.academics..",
            "io.sankofa.school.attendance..",
            "io.sankofa.school.timetable..",
            "io.sankofa.school.assessments..",
            "io.sankofa.school.grading..",
            "io.sankofa.school.reporting..",
            "io.sankofa.school.finance..",
            "io.sankofa.school.accounting..",
            "io.sankofa.school.tax..",
            "io.sankofa.school.hr..",
            "io.sankofa.school.payroll..",
            "io.sankofa.school.library..",
            "io.sankofa.school.inventory..",
            "io.sankofa.school.procurement..",
            "io.sankofa.school.assets..",
            "io.sankofa.school.transport..",
            "io.sankofa.school.hostel..",
            "io.sankofa.school.health..",
            "io.sankofa.school.discipline..",
            "io.sankofa.school.documents..",
            "io.sankofa.school.communications..",
            "io.sankofa.school.messaging..",
            "io.sankofa.school.audit..",
            "io.sankofa.school.analytics..",
            "io.sankofa.school.integrations..",
    };

    // ===================================================================================
    // Shared kernels
    // ===================================================================================

    /**
     * {@code platform} is imported by everything, so it must know nothing about anything.
     * The moment it learns about {@code students}, every module inherits that dependency and
     * the monolith stops being modular.
     */
    @ArchTest
    static final ArchRule platform_knows_nothing_about_domain_modules =
            noClasses()
                    .that().resideInAPackage("io.sankofa.school.platform..")
                    .should().dependOnClassesThat().resideInAnyPackage(DOMAIN_PACKAGES)
                    .because("platform is a shared kernel: everything imports it, so it must "
                            + "import no domain module. Wiring that needs both belongs in "
                            + "io.sankofa.school.config, the composition root.");

    /** Same reasoning for {@code tenancy}, which sits beneath every query in the system. */
    @ArchTest
    static final ArchRule tenancy_knows_nothing_about_domain_modules =
            noClasses()
                    .that().resideInAPackage("io.sankofa.school.tenancy..")
                    .should().dependOnClassesThat().resideInAnyPackage(DOMAIN_PACKAGES)
                    .because("tenancy is a shared kernel beneath every module and must not "
                            + "depend on any of them");

    /** Neither kernel may depend on the composition root; wiring flows one way. */
    @ArchTest
    static final ArchRule kernels_do_not_depend_on_the_composition_root =
            noClasses()
                    .that().resideInAnyPackage(
                            "io.sankofa.school.platform..", "io.sankofa.school.tenancy..")
                    .should().dependOnClassesThat().resideInAPackage("io.sankofa.school.config..")
                    .because("configuration wires modules together; modules must not reach back "
                            + "into their own wiring");

    // ===================================================================================
    // No cycles
    // ===================================================================================

    /**
     * A dependency cycle between modules means they are one module wearing two names, and it
     * removes any possibility of extracting one later.
     */
    @ArchTest
    static final ArchRule modules_are_free_of_cycles =
            slices()
                    .matching("io.sankofa.school.(*)..")
                    .should().beFreeOfCycles()
                    .because("a cycle between modules makes them inseparable and untestable "
                            + "in isolation");

    // ===================================================================================
    // Layering inside a module
    // ===================================================================================

    /**
     * Guards the direction of flow: web calls application, application calls domain and
     * repository, and nothing calls back up. Declared with {@code optionalLayer} so the rule
     * holds now and constrains modules as they are added.
     */
    @ArchTest
    static final ArchRule layers_flow_one_way =
            layeredArchitecture()
                    .consideringOnlyDependenciesInLayers()
                    .layer("Web").definedBy("..web..", "..api..")
                    .optionalLayer("Application").definedBy("..application..")
                    .optionalLayer("Domain").definedBy("..domain..")
                    .optionalLayer("Persistence").definedBy("..repository..", "..persistence..")
                    // Web may be accessed by Web — two controllers sharing a request or response
                    // record is ordinary and desirable. What must never happen is a layer
                    // *beneath* Web depending on it: a service that knows about an HTTP DTO has
                    // put presentation concerns inside a business rule.
                    .whereLayer("Web").mayOnlyBeAccessedByLayers("Web")
                    .whereLayer("Application").mayOnlyBeAccessedByLayers("Web", "Application")
                    .whereLayer("Persistence").mayOnlyBeAccessedByLayers("Application", "Domain")
                    .allowEmptyShould(true)
                    .because("a repository called straight from a controller skips the "
                            + "transaction boundary and the permission check that live in "
                            + "the application layer");

    // ===================================================================================
    // Coding standards that carry real risk
    // ===================================================================================

    /**
     * Field injection hides dependencies from the constructor, which makes a class impossible
     * to instantiate in a plain unit test without a Spring context — and a class that is hard
     * to test is a class that ends up untested.
     */
    @ArchTest
    static final ArchRule no_field_injection =
            noFields()
                    .should().beAnnotatedWith("org.springframework.beans.factory.annotation.Autowired")
                    .orShould().beAnnotatedWith("jakarta.inject.Inject")
                    .allowEmptyShould(true)
                    .because("constructor injection only (AGENTS.md §5): dependencies belong in "
                            + "the signature, not hidden in reflection");

    /**
     * Invariant I-2, scoped to where it actually applies.
     *
     * <p>An earlier version of this rule banned floating point outright. That was wrong, and a
     * WCAG contrast ratio caught it: I-2 says <em>money</em> is {@code BigDecimal}, not that
     * {@code double} is forbidden. Luminance, percentages and statistical ratios are perfectly
     * good doubles, and a rule that flags them trains people to add exclusions — which is how a
     * rule stops meaning anything.
     *
     * <p>So it is enforced two ways instead, each catching what the other misses: no floating
     * point anywhere in a module that handles money, and no floating point on a field whose name
     * says it holds money, wherever it lives.
     */
    @ArchTest
    static final ArchRule no_floating_point_in_money_modules =
            noFields()
                    .that().areDeclaredInClassesThat().resideInAnyPackage(
                            "io.sankofa.school.finance..",
                            "io.sankofa.school.accounting..",
                            "io.sankofa.school.payroll..",
                            "io.sankofa.school.tax..",
                            "io.sankofa.school.procurement..",
                            "io.sankofa.school.platform.money..")
                    .should().haveRawType(double.class)
                    .orShould().haveRawType(float.class)
                    .orShould().haveRawType(Double.class)
                    .orShould().haveRawType(Float.class)
                    .allowEmptyShould(true)
                    .because("Invariant I-2: money is BigDecimal. A float in a module that "
                            + "handles money is a defect that surfaces months later as a ledger "
                            + "that will not balance");

    /**
     * The same invariant, caught by name rather than by location.
     *
     * <p>A {@code double totalAmount} on a reporting DTO is every bit as wrong as one in the
     * accounting module, and this is what catches it there.
     */
    @ArchTest
    static final ArchRule no_floating_point_money_fields =
            noFields()
                    .that().haveNameMatching(
                            "(?i).*(amount|price|total|balance|fee|salary|wage|cost|payment"
                                    + "|credit|debit|discount|refund|tax|levy|allowance"
                                    + "|deduction|gross|net).*")
                    .should().haveRawType(double.class)
                    .orShould().haveRawType(float.class)
                    .orShould().haveRawType(Double.class)
                    .orShould().haveRawType(Float.class)
                    .allowEmptyShould(true)
                    .because("Invariant I-2: a field that holds money is BigDecimal, wherever "
                            + "it happens to be declared");

    /**
     * {@code java.util.Date} is mutable, has no timezone, and silently mixes instants with
     * calendar dates — which is how a student's date of birth shifts by a day across a
     * timezone boundary.
     */
    @ArchTest
    static final ArchRule no_legacy_date_types =
            noClasses()
                    .should().dependOnClassesThat()
                    .haveFullyQualifiedName("java.util.Date")
                    .orShould().dependOnClassesThat()
                    .haveFullyQualifiedName("java.util.Calendar")
                    .orShould().dependOnClassesThat()
                    .haveFullyQualifiedName("java.sql.Timestamp")
                    .allowEmptyShould(true)
                    .because("Invariant I-7: java.time only. java.util.Date is mutable and "
                            + "timezone-blind");

    /**
     * A transaction opened at the controller spans request parsing and response serialisation,
     * holding a database connection — and a row lock — for the whole round trip.
     */
    @ArchTest
    static final ArchRule controllers_are_not_transactional =
            noClasses()
                    .that().areAnnotatedWith("org.springframework.web.bind.annotation.RestController")
                    .should().beAnnotatedWith("org.springframework.transaction.annotation.Transactional")
                    .allowEmptyShould(true)
                    .because("the transaction boundary belongs to the application service, so "
                            + "locks are not held across serialisation (AGENTS.md §5)");

    /**
     * {@code System.out} bypasses the logging pipeline, so the line carries no correlation id,
     * no level, and no redaction — and it is invisible to log search when an incident is live.
     */
    @ArchTest
    static final ArchRule no_direct_console_output =
            noClasses()
                    .should().accessField(System.class, "out")
                    .orShould().accessField(System.class, "err")
                    .allowEmptyShould(true)
                    .because("logging goes through SLF4J so every line carries a correlation id "
                            + "and is subject to the redaction rules in docs/SECURITY.md");

    /** Loggers are per-class, static and final; a shared or instance logger loses its origin. */
    @ArchTest
    static final ArchRule loggers_are_private_static_final =
            fields()
                    .that().haveRawType("org.slf4j.Logger")
                    .should().bePrivate()
                    .andShould().beStatic()
                    .andShould().beFinal()
                    .allowEmptyShould(true)
                    .because("a logger names the class it reports for; making it non-static "
                            + "or shared destroys that");
}
