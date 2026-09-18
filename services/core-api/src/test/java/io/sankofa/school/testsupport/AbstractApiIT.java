package io.sankofa.school.testsupport;

import io.sankofa.school.identity.auth.IdentityTokenVerifier;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Base for tests that exercise the API over real HTTP against real PostgreSQL.
 *
 * <p>The application connects as {@code sankofa_app} — the non-superuser role that Row Level
 * Security actually applies to — so these tests exercise the same isolation the production
 * deployment relies on rather than a permissive approximation of it.
 *
 * <p>Flyway is disabled in the Spring context because {@link TestDatabase} has already migrated
 * the schema as the migration role. Running it twice would need migration credentials in the
 * application context, which is exactly the coupling the two-role split exists to avoid.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import(AbstractApiIT.StubVerifierConfiguration.class)
public abstract class AbstractApiIT {

    @Autowired
    protected TestRestTemplate rest;

    @Autowired
    protected StubIdentityTokenVerifier identityTokens;

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        TestDatabase.start();
        registry.add("spring.datasource.url", TestDatabase::jdbcUrl);
        registry.add("spring.datasource.username", () -> TestDatabase.APP_USER);
        registry.add("spring.datasource.password", () -> TestDatabase.APP_PASSWORD);
        registry.add("spring.flyway.enabled", () -> "false");
        // No Firebase project, so FirebaseConfig stays inactive and the stub below is the
        // only IdentityTokenVerifier in the context.
        registry.add("sankofa.firebase.project-id", () -> "");
    }

    @BeforeEach
    void resetIdentityTokens() {
        identityTokens.reset();
    }

    @TestConfiguration
    static class StubVerifierConfiguration {
        /**
         * One bean, not two. {@link StubIdentityTokenVerifier} already implements
         * {@link IdentityTokenVerifier}, so a second bean exposing it under the interface type
         * leaves the context with two candidates and nothing to choose between them.
         */
        @Bean
        StubIdentityTokenVerifier stubIdentityTokenVerifier() {
            return new StubIdentityTokenVerifier();
        }
    }

    // -----------------------------------------------------------------------------------

    protected static HttpEntity<Object> json(Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }

    protected static HttpEntity<Object> authorised(String sessionToken) {
        return authorised(sessionToken, null);
    }

    protected static HttpEntity<Object> authorised(String sessionToken, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(sessionToken);
        return new HttpEntity<>(body, headers);
    }
}
